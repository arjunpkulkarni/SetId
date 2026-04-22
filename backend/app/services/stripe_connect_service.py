"""
Stripe Connect — Custom connected accounts + automatic daily payouts to
debit cards.

This is the ONE place we talk to Stripe in the Connect context. Every call
that touches a connected account passes `stripe_account=acct_id` so Stripe
acts as that account (not the platform) — missing that keyword is the
classic way to accidentally pay out from the platform's balance, so we
always pass it explicitly.

Money flow this service enables:

    Web/mobile guest card
        └─▶ PaymentIntent (created by PaymentService with
                            `transfer_data.destination = host_acct_id`)
            └─▶ Host's Connect balance (`available`)
                └─▶ Stripe's automatic daily payout runs on schedule
                    └─▶ Host's debit card (arrives in 1–2 business days)

We do NOT trigger payouts ourselves. The account's payout schedule is set
to daily at account-creation time (see `ensure_connected_account`), so
Stripe issues payouts automatically — the app only surfaces pending
balance + arrival date.

Fees (out of our control):
  - Stripe's per-PaymentIntent fee (~2.9% + $0.30 US) — deducted before
    funds land in host's Connect balance.
  - No instant-payout fee (daily standard payouts are free).
  - Our `application_fee_amount` on the PaymentIntent (see
    `PaymentService` + `settings.PLATFORM_FEE_BPS`) — the platform's cut.
"""

import logging
from dataclasses import dataclass
from typing import Optional

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.payout import Payout
from app.models.user import User

logger = logging.getLogger(__name__)


class StripeConnectError(ValueError):
    """Raised for any Connect-flow problem. `code` is the stable machine
    identifier the HTTP layer maps to an error_response code. `message`
    is user-safe; never include raw Stripe error bodies that might leak
    internals."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ConnectedAccountStatus:
    connected: bool
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    # True if the account has at least one external account (card or bank)
    # that supports instant payouts. Checked via the `available_payout_methods`
    # field Stripe returns on each external account.
    has_instant_external_account: bool
    external_account_last4: Optional[str]
    external_account_brand: Optional[str]
    # Stripe's requirement buckets, surfaced separately so the UI can
    # distinguish "needs attention soon" (currently_due) from "already
    # overdue, account disabled" (past_due). Each entry is a Stripe key
    # like "individual.verification.document" or "external_account".
    requirements_due: list[str]
    requirements_past_due: list[str]
    disabled_reason: Optional[str]


_SYNTHETIC_EMAIL_DOMAIN = "@phone.users.spltr"


class StripeConnectService:
    def __init__(self, db: Session):
        self.db = db
        if not settings.STRIPE_SECRET_KEY:
            raise StripeConnectError(
                "STRIPE_NOT_CONFIGURED",
                "Stripe is not configured on the server.",
            )
        stripe.api_key = settings.STRIPE_SECRET_KEY

    # ─── Account lifecycle ───────────────────────────────────────────────

    def ensure_connected_account(self, user: User) -> str:
        """Return the user's `acct_...` id, creating a Custom account if
        they don't have one yet.

        We use Custom (not Express) accounts so the entire onboarding UX
        stays inside our app — no browser redirect. That means WE collect
        identity (name, DOB, address, SSN last 4) and WE accept ToS on
        the user's behalf (requires passing their IP + a timestamp in
        `submit_payout_setup`). See Stripe's "Custom account onboarding"
        docs for the regulatory underpinning.

        If the user already has an account id but it's NOT a Custom
        account (e.g. left over from an earlier Express-based attempt),
        Stripe blocks platform-side writes to `individual` and
        `tos_acceptance` with a PermissionError. We detect that here and
        transparently recycle the stale id so the next onboarding runs
        cleanly. Same for accounts the platform admin deleted in the
        Stripe dashboard — they return InvalidRequestError on retrieve.

        The account row here is the skeleton; `submit_payout_setup`
        fills in identity + attaches the debit card + flips ToS.
        """
        if user.stripe_account_id:
            stale = False
            try:
                acct = stripe.Account.retrieve(user.stripe_account_id)
                if getattr(acct, "type", None) == "custom":
                    return user.stripe_account_id
                logger.info(
                    "stripe_connect_account_type_mismatch",
                    extra={
                        "user_id": str(user.id),
                        "account_id": user.stripe_account_id,
                        "type": getattr(acct, "type", None),
                    },
                )
                stale = True
            except stripe.error.PermissionError:
                # Express account the platform can't touch any more.
                logger.info(
                    "stripe_connect_account_permission_error_recycling",
                    extra={
                        "user_id": str(user.id),
                        "account_id": user.stripe_account_id,
                    },
                )
                stale = True
            except stripe.error.InvalidRequestError:
                # Account was deleted in Stripe dashboard.
                logger.info(
                    "stripe_connect_account_missing_recycling",
                    extra={
                        "user_id": str(user.id),
                        "account_id": user.stripe_account_id,
                    },
                )
                stale = True
            except stripe.error.StripeError as e:
                # Any other API error: surface rather than silently
                # orphaning the id.
                logger.exception("stripe_connect_account_retrieve_failed")
                raise StripeConnectError(
                    "STRIPE_ERROR", self._safe_stripe_message(e)
                )

            if stale:
                user.stripe_account_id = None
                user.stripe_charges_enabled = False
                user.stripe_payouts_enabled = False
                user.stripe_details_submitted = False
                self.db.commit()
                self.db.refresh(user)

        email = user.email if not self._is_synthetic_email(user.email) else None

        try:
            account = stripe.Account.create(
                type="custom",
                country="US",
                email=email,
                capabilities={
                    # Required for destination charges so guest card payments
                    # can land in this host's Connect balance.
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
                business_type="individual",
                # Pin the payout schedule to automatic daily so Stripe runs
                # payouts for us on the minimum available delay. We never
                # trigger `Payout.create` ourselves — the app only reads
                # balance + listPayouts for display. `delay_days=minimum`
                # uses whatever Stripe's country-specific minimum is
                # (typically 2 business days in the US).
                settings={
                    "payouts": {
                        "schedule": {
                            "interval": "daily",
                            "delay_days": "minimum",
                        }
                    }
                },
                business_profile={
                    "product_description": (
                        "Settld bill-splitting: receives funds from guests "
                        "and pays out to the host who picked up the check."
                    ),
                    # 7299 = Miscellaneous personal services.
                    "mcc": "7299",
                    "url": "https://settld.live",
                },
                metadata={"user_id": str(user.id)},
            )
        except stripe.error.StripeError as e:
            logger.exception("stripe_connect_account_create_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        user.stripe_account_id = account.id
        self.db.commit()
        self.db.refresh(user)
        logger.info(
            "stripe_connect_account_created",
            extra={"user_id": str(user.id), "account_id": account.id},
        )
        return account.id

    def submit_payout_setup(
        self,
        user: User,
        *,
        individual: dict,
        card_token: str,
        client_ip: str,
        payment_method_id: Optional[str] = None,
    ) -> ConnectedAccountStatus:
        """Complete in-app onboarding in a single call.

        `individual` is the KYC payload the mobile app collected:
            {
              first_name, last_name, email,
              dob_day, dob_month, dob_year,
              address_line1, address_city, address_state, address_postal_code,
              ssn_last_4, phone,
            }
        `card_token` is a `tok_...` produced by Stripe Elements / React
        Native SDK on the client — the raw card number never touches
        our servers. `client_ip` is required by Stripe for ToS
        acceptance on Custom accounts (CCPA/PCI evidence trail).

        Flow, all in one atomic-ish sequence:
          1. Ensure Custom account exists.
          2. `Account.modify`: set `individual.*` + `tos_acceptance`.
          3. `Account.create_external_account`: attach the card token as
             the payout destination. Stripe rejects non-debit cards here
             automatically — we don't need to pre-check the brand.
          4. Refresh cached status and return it.
        """
        account_id = self.ensure_connected_account(user)

        dob = {
            "day": int(individual["dob_day"]),
            "month": int(individual["dob_month"]),
            "year": int(individual["dob_year"]),
        }
        address = {
            "line1": individual["address_line1"].strip(),
            "city": individual["address_city"].strip(),
            "state": individual["address_state"].strip().upper(),
            "postal_code": individual["address_postal_code"].strip(),
            "country": "US",
        }
        individual_payload: dict = {
            "first_name": individual["first_name"].strip(),
            "last_name": individual["last_name"].strip(),
            "email": individual["email"].strip(),
            "phone": individual["phone"].strip(),
            "dob": dob,
            "address": address,
            # Stripe accepts last 4 OR full SSN; we pass last 4 and let
            # Stripe ask for full SSN via `requirements.currently_due`
            # if/when it flags the account.
            "ssn_last_4": individual["ssn_last_4"].strip(),
        }

        # ToS acceptance — timestamp must be a unix int in seconds.
        import time

        tos = {
            "date": int(time.time()),
            "ip": client_ip,
            "user_agent": individual.get("user_agent") or "settld-mobile",
        }

        try:
            stripe.Account.modify(
                account_id,
                individual=individual_payload,
                tos_acceptance=tos,
            )
        except stripe.error.InvalidRequestError as e:
            raise StripeConnectError(
                "IDENTITY_REJECTED", self._safe_stripe_message(e)
            )
        except stripe.error.StripeError as e:
            logger.exception("stripe_connect_account_modify_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        # Attach the tokenized debit card as the default payout
        # destination. If the user already had a card attached, this
        # adds a new one — we then mark it `default_for_currency=True`
        # so payouts route to the latest card.
        try:
            ext = stripe.Account.create_external_account(
                account_id,
                external_account=card_token,
                default_for_currency=True,
            )
        except stripe.error.CardError as e:
            raise StripeConnectError(
                "CARD_DECLINED", self._safe_stripe_message(e)
            )
        except stripe.error.InvalidRequestError as e:
            # Stripe rejects credit cards and non-US debit cards with
            # InvalidRequestError; surface a specific error so the UI
            # can say "use a US debit card".
            raise StripeConnectError(
                "INVALID_CARD", self._safe_stripe_message(e)
            )
        except stripe.error.StripeError as e:
            logger.exception("stripe_connect_external_account_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        logger.info(
            "stripe_connect_setup_submitted",
            extra={
                "user_id": str(user.id),
                "account_id": account_id,
                "external_account_id": getattr(ext, "id", None),
            },
        )

        # If the client also sent a PaymentMethod id (same physical card,
        # separately tokenized), attach it to the user's Stripe Customer
        # so the same debit card works for CHARGING them (paying a bill
        # as a guest). Without this, the user would have to re-add their
        # card through the separate "Add Payment Method" flow. Failures
        # here are non-fatal — Connect setup is the primary goal; the
        # payment-method sync is convenience and can be redone later.
        if payment_method_id:
            try:
                self._sync_payment_method_to_customer(user, payment_method_id)
            except Exception:
                logger.exception(
                    "stripe_connect_payment_method_sync_failed",
                    extra={
                        "user_id": str(user.id),
                        "payment_method_id": payment_method_id,
                    },
                )

        return self.refresh_account_status(user)

    def _sync_payment_method_to_customer(
        self, user: User, payment_method_id: str
    ) -> None:
        """Attach a `pm_...` to the user's Stripe Customer and save it in
        our `payment_methods` table so it shows up alongside any other
        cards the user has added.

        Delegates to `PaymentMethodService.attach_payment_method` which
        already handles: customer creation, idempotent re-attach, and
        the local row insert. Keeps this service focused on Connect and
        avoids duplicating card-metadata extraction logic.
        """
        # Import here to avoid a circular import at module-load time
        # (payment_method_service doesn't depend on Connect, but pulling
        # it at the top would widen our import surface for no reason).
        from app.services.payment_method_service import PaymentMethodService

        svc = PaymentMethodService(self.db)
        svc.attach_payment_method(user, payment_method_id)
        logger.info(
            "stripe_connect_payment_method_synced",
            extra={
                "user_id": str(user.id),
                "payment_method_id": payment_method_id,
            },
        )

    def refresh_account_status(self, user: User) -> ConnectedAccountStatus:
        """Pull the authoritative account state from Stripe and cache the
        booleans locally.

        `has_instant_external_account` is still populated for informational
        purposes (in case we ever re-enable instant payouts), but nothing
        gates on it any more — payouts run automatically on the daily
        schedule regardless of instant eligibility.

        Called from:
          - GET /stripe/connect/status (user is checking their onboarding)
          - Connect webhook handler (after `account.updated`)
        """
        if not user.stripe_account_id:
            return ConnectedAccountStatus(
                connected=False,
                charges_enabled=False,
                payouts_enabled=False,
                details_submitted=False,
                has_instant_external_account=False,
                external_account_last4=None,
                external_account_brand=None,
                requirements_due=[],
                requirements_past_due=[],
                disabled_reason=None,
            )

        try:
            account = stripe.Account.retrieve(user.stripe_account_id)
        except stripe.error.StripeError as e:
            logger.exception("stripe_connect_account_retrieve_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        charges = bool(account.charges_enabled)
        payouts = bool(account.payouts_enabled)
        details = bool(account.details_submitted)
        req_obj = account.requirements or {}
        # `currently_due` = items Stripe wants eventually (account still works)
        # `past_due`     = items overdue, account is DISABLED until resolved
        # We surface both so the UI can render the right message.
        currently_due = list(req_obj.get("currently_due") or [])
        past_due = list(req_obj.get("past_due") or [])
        disabled_reason = req_obj.get("disabled_reason")

        has_instant, last4, brand = self._inspect_external_accounts(
            user.stripe_account_id
        )

        # Cache on user row so the hot path can read it inline (O(1))
        # instead of roundtripping to Stripe.
        user.stripe_charges_enabled = charges
        user.stripe_payouts_enabled = payouts
        user.stripe_details_submitted = details
        self.db.commit()

        return ConnectedAccountStatus(
            connected=True,
            charges_enabled=charges,
            payouts_enabled=payouts,
            details_submitted=details,
            has_instant_external_account=has_instant,
            external_account_last4=last4,
            external_account_brand=brand,
            requirements_due=currently_due,
            requirements_past_due=past_due,
            disabled_reason=disabled_reason,
        )

    def replace_external_account(
        self, user: User, *, card_token: str
    ) -> ConnectedAccountStatus:
        """Swap the user's payout card without re-running KYC.

        Used by the "Change card on file" flow — the user has a Custom
        account already, identity is on file, they just want to point
        future payouts at a new debit card. We:

          1. Attach the new card as an external account with
             `default_for_currency=True` so subsequent payouts route to
             it immediately.
          2. Stripe auto-demotes the previously-default card for the
             same currency, so we don't need to `default_for_currency`-
             flip anything else. We also don't delete the old card — if
             the user wants to go back to it they'll add it again; no
             stored cleanup risk if the new attach fails midway.

        Requires the account to already exist. If for some reason we're
        called on a user without one, we fall through to
        `ensure_connected_account` which just creates the skeleton; the
        attach then succeeds (though the user is now in a weird "card
        attached but identity never submitted" state — this path isn't
        a normal entry point, so that's acceptable).
        """
        account_id = self.ensure_connected_account(user)

        try:
            ext = stripe.Account.create_external_account(
                account_id,
                external_account=card_token,
                default_for_currency=True,
            )
        except stripe.error.CardError as e:
            raise StripeConnectError(
                "CARD_DECLINED", self._safe_stripe_message(e)
            )
        except stripe.error.InvalidRequestError as e:
            raise StripeConnectError(
                "INVALID_CARD", self._safe_stripe_message(e)
            )
        except stripe.error.StripeError as e:
            logger.exception("stripe_connect_external_account_replace_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        logger.info(
            "stripe_connect_external_account_replaced",
            extra={
                "user_id": str(user.id),
                "account_id": account_id,
                "external_account_id": getattr(ext, "id", None),
            },
        )

        return self.refresh_account_status(user)

    # ─── Balance + payouts ───────────────────────────────────────────────

    def get_available_cents(
        self, user: User, currency: str = "usd"
    ) -> int:
        """Balance eligible for the next scheduled daily payout, in cents.

        Reads the `available` bucket (money that has cleared Stripe's
        transaction-level holds and will go out on the account's daily
        payout schedule). This is NOT `instant_available`; we no longer
        run instant payouts.
        """
        if not user.stripe_account_id:
            raise StripeConnectError(
                "NOT_CONNECTED",
                "Add a payout method before checking your balance.",
            )
        try:
            balance = stripe.Balance.retrieve(
                stripe_account=user.stripe_account_id
            )
        except stripe.error.StripeError as e:
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        total = 0
        for entry in balance.available or []:
            if entry.currency == currency:
                total += int(entry.amount)
        return total

    def list_payouts(self, user: User, limit: int = 20) -> list[Payout]:
        return (
            self.db.query(Payout)
            .filter(Payout.user_id == user.id)
            .order_by(Payout.created_at.desc())
            .limit(limit)
            .all()
        )

    # ─── Webhook ─────────────────────────────────────────────────────────

    def handle_connect_webhook(self, payload: bytes, sig_header: str) -> None:
        """Verify and dispatch a Connect-scoped webhook event.

        Uses `STRIPE_CONNECT_WEBHOOK_SECRET` (NOT the payment webhook
        secret). Stripe signs each endpoint's events with that endpoint's
        own secret, so reusing the payments secret would fail signature
        verification on every call.
        """
        if not settings.STRIPE_CONNECT_WEBHOOK_SECRET:
            raise StripeConnectError(
                "WEBHOOK_NOT_CONFIGURED",
                "Connect webhook secret missing on server.",
            )
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_CONNECT_WEBHOOK_SECRET
            )
        except stripe.error.SignatureVerificationError as e:
            raise StripeConnectError("INVALID_SIGNATURE", str(e))

        event_type = event["type"]
        obj = event["data"]["object"]
        logger.info(
            "stripe_connect_webhook_received",
            extra={"event_type": event_type, "id": obj.get("id")},
        )

        if event_type == "account.updated":
            self._refresh_user_from_account_webhook(obj)
        elif event_type in (
            "payout.paid",
            "payout.failed",
            "payout.canceled",
            "payout.updated",
        ):
            self._update_payout_from_webhook(obj)
        # All other events are accepted and ignored; Stripe re-sends if
        # we 5xx, so we return 200 even for unhandled types.

    # ─── Internals ───────────────────────────────────────────────────────

    def _inspect_external_accounts(
        self, account_id: str
    ) -> tuple[bool, Optional[str], Optional[str]]:
        """Returns (has_instant, last4, brand).

        Checks `available_payout_methods` on each external account — an
        entry of `"instant"` means Stripe can instant-payout to that card
        or bank account. Without an instant-capable external account, a
        payout with `method="instant"` will 400.
        """
        has_instant = False
        last4: Optional[str] = None
        brand: Optional[str] = None

        try:
            cards = stripe.Account.list_external_accounts(
                account_id, object="card", limit=10
            )
            for card in cards.data or []:
                apm = getattr(card, "available_payout_methods", None) or []
                if "instant" in apm:
                    return True, card.last4, card.brand

            banks = stripe.Account.list_external_accounts(
                account_id, object="bank_account", limit=10
            )
            for ba in banks.data or []:
                apm = getattr(ba, "available_payout_methods", None) or []
                if "instant" in apm:
                    return True, ba.last4, ba.bank_name or "Bank"
        except stripe.error.StripeError:
            # Non-fatal — we return False and let validation fail cleanly
            # downstream rather than blowing up the whole status call.
            logger.warning(
                "stripe_connect_list_external_failed",
                extra={"account_id": account_id},
            )

        return has_instant, last4, brand

    def _refresh_user_from_account_webhook(self, account_obj: dict) -> None:
        acct_id = account_obj.get("id")
        if not acct_id:
            return
        user = (
            self.db.query(User)
            .filter(User.stripe_account_id == acct_id)
            .first()
        )
        if not user:
            return
        user.stripe_charges_enabled = bool(account_obj.get("charges_enabled"))
        user.stripe_payouts_enabled = bool(account_obj.get("payouts_enabled"))
        user.stripe_details_submitted = bool(
            account_obj.get("details_submitted")
        )
        self.db.commit()

    def _update_payout_from_webhook(self, payout_obj: dict) -> None:
        stripe_payout_id = payout_obj.get("id")
        if not stripe_payout_id:
            return
        payout = (
            self.db.query(Payout)
            .filter(Payout.stripe_payout_id == stripe_payout_id)
            .first()
        )
        if not payout:
            # Event for a payout we didn't create (shouldn't happen with
            # correct webhook filtering, but log and drop).
            logger.info(
                "stripe_connect_webhook_unknown_payout",
                extra={"stripe_payout_id": stripe_payout_id},
            )
            return
        payout.status = payout_obj.get("status") or payout.status
        payout.failure_code = payout_obj.get("failure_code")
        payout.failure_message = payout_obj.get("failure_message")
        arrival = payout_obj.get("arrival_date")
        if arrival is not None:
            payout.arrival_date = arrival
        self.db.commit()

    @staticmethod
    def _is_synthetic_email(email: Optional[str]) -> bool:
        """Phone-auth users get a synthetic email like
        `14155551234@phone.users.spltr`. Stripe rejects those at
        onboarding, so pass None and let the user enter a real email
        on Stripe's form."""
        return bool(email and email.endswith(_SYNTHETIC_EMAIL_DOMAIN))

    @staticmethod
    def _safe_stripe_message(e: stripe.error.StripeError) -> str:
        """Prefer Stripe's `user_message` (intended for end users) and
        fall back to the generic error message. Never surface raw
        `str(e)` which can include request IDs + internal fields."""
        return getattr(e, "user_message", None) or str(e) or "Stripe error"
