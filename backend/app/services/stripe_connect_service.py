"""
Stripe Connect — Custom connected accounts + automatic daily payouts to
US debit cards or US bank accounts (ACH).

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
                    └─▶ Host's debit card or bank account (ACH)

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


_ALLOWED_PAYOUT_TOKEN_FUNDING = frozenset({"debit", "prepaid"})


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
    # "card" | "bank" — disambiguates `external_account_brand` in the UI.
    external_account_type: Optional[str]
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

    def _require_debit_payout_token(self, card_token: str) -> None:
        """Ensure the tokenized card is debit or prepaid — never credit.

        Stripe's external-account attach may fail opaquely; we retrieve the
        Token first so we can return a clear INVALID_CARD for credit cards.
        """
        token_id = (card_token or "").strip()
        if not token_id.startswith("tok_"):
            raise StripeConnectError(
                "INVALID_CARD",
                "Invalid card token. Please try adding your card again.",
            )
        try:
            tok = stripe.Token.retrieve(token_id)
        except stripe.error.InvalidRequestError as e:
            raise StripeConnectError(
                "INVALID_CARD", self._safe_stripe_message(e)
            )
        except stripe.error.StripeError as e:
            logger.exception("stripe_token_retrieve_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        card = getattr(tok, "card", None)
        ttype = getattr(tok, "type", None)
        if ttype != "card":
            raise StripeConnectError(
                "INVALID_CARD",
                "A card token was expected for this request.",
            )
        funding = (
            getattr(card, "funding", None) if card is not None else None
        )
        if funding == "credit":
            raise StripeConnectError(
                "INVALID_CARD",
                "Credit cards can't be used for payouts. Add a US debit card.",
            )
        if funding is not None and funding not in _ALLOWED_PAYOUT_TOKEN_FUNDING:
            raise StripeConnectError(
                "INVALID_CARD",
                "Use a US debit card for payouts. Credit cards aren't supported.",
            )

    def _require_bank_payout_token(self, bank_token: str) -> None:
        """Ensure `tok_...` is a US bank-account token from the client SDK."""
        token_id = (bank_token or "").strip()
        if not token_id.startswith("tok_"):
            raise StripeConnectError(
                "INVALID_BANK_ACCOUNT",
                "Invalid bank token. Please try again.",
            )
        try:
            tok = stripe.Token.retrieve(token_id)
        except stripe.error.InvalidRequestError as e:
            raise StripeConnectError(
                "INVALID_BANK_ACCOUNT", self._safe_stripe_message(e)
            )
        except stripe.error.StripeError as e:
            logger.exception("stripe_bank_token_retrieve_failed")
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )
        if getattr(tok, "type", None) != "bank_account":
            raise StripeConnectError(
                "INVALID_BANK_ACCOUNT",
                "Use a US checking account for payouts.",
            )


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
        client_ip: str,
        card_token: Optional[str] = None,
        bank_token: Optional[str] = None,
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
        Exactly one of `card_token` or `bank_token` must be set — each a
        `tok_...` from the Stripe client SDK (`Card` or `BankAccount`).
        `client_ip` is required by Stripe for Custom-account ToS
        acceptance.

        Flow:
          1. Ensure Custom account exists.
          2. `Account.modify`: set `individual.*` + `tos_acceptance`.
          3. Validate token (debit card or bank), then
             `Account.create_external_account`.
          4. Optionally attach `payment_method_id` (card only) to Customer.
          5. Refresh cached status and return it.
        """
        ct = (card_token or "").strip() or None
        bt = (bank_token or "").strip() or None
        if bool(ct) + bool(bt) != 1:
            raise StripeConnectError(
                "INVALID_CARD",
                "Provide either a debit card token or a bank account token.",
            )
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

        # Attach the tokenized payout destination (debit card or bank).
        # If the user already had an account attached, this adds a new one;
        # `default_for_currency=True` routes payouts to the latest.
        attach_token = ct or bt
        if ct:
            self._require_debit_payout_token(ct)
        else:
            self._require_bank_payout_token(bt)
        try:
            ext = stripe.Account.create_external_account(
                account_id,
                external_account=attach_token,
                default_for_currency=True,
            )
        except stripe.error.CardError as e:
            raise StripeConnectError(
                "CARD_DECLINED", self._safe_stripe_message(e)
            )
        except stripe.error.InvalidRequestError as e:
            code = "INVALID_BANK_ACCOUNT" if bt else "INVALID_CARD"
            raise StripeConnectError(code, self._safe_stripe_message(e))
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

        # If the client also sent a PaymentMethod id (card flow only),
        # attach it to the user's Stripe Customer for paying bills as a guest.
        if payment_method_id and ct:
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
                external_account_type=None,
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

        has_instant, last4, brand, acct_type = self._inspect_external_accounts(
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
            external_account_type=acct_type,
            requirements_due=currently_due,
            requirements_past_due=past_due,
            disabled_reason=disabled_reason,
        )

    def replace_external_account(
        self,
        user: User,
        *,
        card_token: Optional[str] = None,
        bank_token: Optional[str] = None,
    ) -> ConnectedAccountStatus:
        """Swap the payout card or bank account without re-running KYC.

        Exactly one of `card_token` or `bank_token` must be supplied.
        """
        ct = (card_token or "").strip() or None
        bt = (bank_token or "").strip() or None
        if bool(ct) + bool(bt) != 1:
            raise StripeConnectError(
                "INVALID_CARD",
                "Provide either a debit card token or a bank account token.",
            )
        account_id = self.ensure_connected_account(user)

        attach = ct or bt
        if ct:
            self._require_debit_payout_token(ct)
        else:
            self._require_bank_payout_token(bt)
        try:
            ext = stripe.Account.create_external_account(
                account_id,
                external_account=attach,
                default_for_currency=True,
            )
        except stripe.error.CardError as e:
            raise StripeConnectError(
                "CARD_DECLINED", self._safe_stripe_message(e)
            )
        except stripe.error.InvalidRequestError as e:
            code = "INVALID_BANK_ACCOUNT" if bt else "INVALID_CARD"
            raise StripeConnectError(code, self._safe_stripe_message(e))
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
    ) -> tuple[bool, Optional[str], Optional[str], Optional[str]]:
        """Returns (has_instant, last4, display_name, account_type).

        `display_name` is card brand (e.g. Visa) or bank name.
        `account_type` is ``card`` | ``bank`` | None.
        """
        has_instant = False
        last4: Optional[str] = None
        brand: Optional[str] = None
        acct_type: Optional[str] = None

        try:
            cards = stripe.Account.list_external_accounts(
                account_id, object="card", limit=20
            )
            cards_data = list(cards.data or [])
            banks = stripe.Account.list_external_accounts(
                account_id, object="bank_account", limit=20
            )
            banks_data = list(banks.data or [])

            for card in cards_data:
                apm = getattr(card, "available_payout_methods", None) or []
                if "instant" in apm:
                    has_instant = True
                    break
            if not has_instant:
                for ba in banks_data:
                    apm = getattr(ba, "available_payout_methods", None) or []
                    if "instant" in apm:
                        has_instant = True
                        break

            for card in cards_data:
                if getattr(card, "default_for_currency", False):
                    last4 = card.last4
                    raw = getattr(card, "brand", None) or "Card"
                    brand = raw.title() if isinstance(raw, str) else str(raw)
                    acct_type = "card"
                    break
            if last4 is None:
                for ba in banks_data:
                    if getattr(ba, "default_for_currency", False):
                        last4 = getattr(ba, "last4", None)
                        brand = getattr(ba, "bank_name", None) or "Bank"
                        acct_type = "bank"
                        break
            if last4 is None and cards_data:
                c = cards_data[0]
                last4 = c.last4
                raw = getattr(c, "brand", None) or "Card"
                brand = raw.title() if isinstance(raw, str) else str(raw)
                acct_type = "card"
            elif last4 is None and banks_data:
                ba = banks_data[0]
                last4 = getattr(ba, "last4", None)
                brand = getattr(ba, "bank_name", None) or "Bank"
                acct_type = "bank"
        except stripe.error.StripeError:
            logger.warning(
                "stripe_connect_list_external_failed",
                extra={"account_id": account_id},
            )

        return has_instant, last4, brand, acct_type

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
