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

Fees:
  - Stripe's per-PaymentIntent fee (~2.9% + $0.30 US). On a destination
    charge with `application_fee_amount` set, Stripe deducts this fee
    from the platform's portion (i.e. our application fee) — NOT from
    the host's slice. So sizing the platform fee correctly is what
    keeps the host whole.
  - No instant-payout fee (daily standard payouts are free).
  - Our `application_fee_amount` on the PaymentIntent (see
    `PaymentService._application_fee_for_member`). Equal to the
    per-guest share of `bill.service_fee` — matches the "Service fee"
    line shown on the bill breakdown so the guest, host, and platform
    all see the same number. `settings.PLATFORM_FEE_BPS` is a
    fallback flat-rate knob used only when the bill has no
    `service_fee` configured (e.g. legacy bills).
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.payment import Payment
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
    # Submitted docs / answers Stripe is still verifying (often after a
    # business-model questionnaire). Payouts may stay paused until cleared.
    requirements_pending_verification: list[str]
    # Stripe `requirements.errors[].reason` (plus context) — e.g. rejected
    # doc; user must reopen the flow and fix, which feels like “didn’t save”.
    requirement_error_messages: list[str]
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
        """Ensure the value is a US bank-account token from the client SDK.

        Stripe's React Native ``createToken({ type: 'BankAccount', ... })`` call
        returns IDs prefixed with ``btok_``, not ``tok_`` (which is what the
        same call returns for cards). We previously rejected anything that
        didn't start with ``tok_`` here, which made every bank-onboarding and
        Change-payout-method attempt fail with "Invalid bank token. Please try
        again." even though the Stripe SDK had successfully tokenized the
        account.

        We accept both prefixes and let ``stripe.Token.retrieve`` plus the
        ``type == "bank_account"`` check below do the real validation —
        attaching a card token here would still be caught and rejected.
        """
        token_id = (bank_token or "").strip()
        if not (token_id.startswith("btok_") or token_id.startswith("tok_")):
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
        Exactly one of `card_token` or `bank_token` must be set. Both come
        from the Stripe client SDK (`createToken` → `Card` ⇒ ``tok_…`` /
        `BankAccount` ⇒ ``btok_…``). `client_ip` is required by Stripe for
        Custom-account ToS acceptance.

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
                requirements_pending_verification=[],
                requirement_error_messages=[],
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
        pending_verification = list(
            req_obj.get("pending_verification") or []
        )
        err_msgs: list[str] = []
        for err in req_obj.get("errors") or []:
            if not isinstance(err, dict):
                continue
            reason = (err.get("reason") or "").strip()
            code = (err.get("code") or "").strip()
            requirement = err.get("requirement")
            parts = [reason or code]
            if requirement and requirement not in (reason + code):
                parts.append(str(requirement))
            line = ": ".join(p for p in parts if p)
            if line:
                err_msgs.append(line)
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
            requirements_pending_verification=pending_verification,
            requirement_error_messages=err_msgs,
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

    def get_balance_breakdown(
        self, user: User, currency: str = "usd"
    ) -> tuple[int, int]:
        """Return ``(available_cents, pending_cents)`` for the connected account.

        Two buckets matter for the host UI:

        * ``available`` — money that has cleared Stripe's per-transaction hold
          and is queued for the next scheduled daily payout.
        * ``pending``  — money that has been **received** for this account but
          is still inside Stripe's standard hold period (typically ~2 business
          days for US card payments). It will move to ``available`` automatically.

        We sum BOTH because the mobile app labels the figure "Pending balance"
        in the everyday English sense — i.e. "money you've collected but haven't
        been paid out yet". Showing only ``available`` makes the screen read
        $0.00 for the first couple days after every payment, which is what the
        hosts have been complaining about.
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

        def _sum(entries) -> int:
            total = 0
            for entry in entries or []:
                if getattr(entry, "currency", None) == currency:
                    total += int(getattr(entry, "amount", 0) or 0)
            return total

        available_cents = _sum(getattr(balance, "available", None))
        pending_cents = _sum(getattr(balance, "pending", None))
        return available_cents, pending_cents

    def get_available_cents(
        self, user: User, currency: str = "usd"
    ) -> int:
        """Backwards-compatible wrapper — only the cleared bucket.

        Kept for any caller that still wants the strict "ready to pay out
        tonight" figure. New code should prefer :meth:`get_balance_breakdown`.
        """
        available, _ = self.get_balance_breakdown(user, currency)
        return available

    def list_payouts(self, user: User, limit: int = 20) -> list[Payout]:
        return (
            self.db.query(Payout)
            .filter(Payout.user_id == user.id)
            .order_by(Payout.created_at.desc())
            .limit(limit)
            .all()
        )

    def list_recent_balance_transactions(
        self, user: User, limit: int = 20
    ) -> list[dict]:
        """Return the recent incoming transactions making up the host's
        pending balance — used by the "Recent transactions" list on the
        Payouts screen so a host can see *which* guest payments their
        headline is composed of.

        We pull straight from ``stripe.BalanceTransaction.list`` (scoped to
        the connected account) because that's the only source that matches
        the headline 1:1 — it returns the **net-to-host** amount per entry
        and the same ``status`` (``available`` / ``pending``) Stripe uses
        in :meth:`get_balance_breakdown`.

        We then enrich each entry with the bill title + payer name from our
        local DB by:
          1. ``expand=['data.source']`` so each balance txn carries its
             charge inline.
          2. Reading ``charge.payment_intent`` and looking up the matching
             ``Payment`` row — this is the same id we wrote when the guest
             paid (see ``payment_service.py``).
          3. Joining ``Bill`` + ``BillMember`` for ``title`` and
             ``nickname``.
        Refunds, payouts, transfers, and stripe_fee entries are filtered
        out — the host doesn't think of those as "transactions making up
        my balance".
        """
        if not user.stripe_account_id:
            raise StripeConnectError(
                "NOT_CONNECTED",
                "Add a payout method before checking your balance.",
            )
        try:
            txns = stripe.BalanceTransaction.list(
                limit=max(1, min(limit, 100)),
                expand=["data.source"],
                stripe_account=user.stripe_account_id,
            )
        except stripe.error.StripeError as e:
            raise StripeConnectError(
                "STRIPE_ERROR", self._safe_stripe_message(e)
            )

        # `type` we keep: incoming-money entries that haven't been paid out
        # yet. `payment` is what destination charges show up as on the
        # connected account; `charge` is the direct-charge variant. Anything
        # else (payouts, fees, refunds) is intentionally hidden — they
        # don't belong in a "what's making up my pending balance" list.
        _KEEP_TYPES = {"payment", "charge"}

        # Pre-collect the PaymentIntent ids so we can resolve all bills/
        # members in a single pair of queries instead of one-per-row. We
        # deliberately only look at the first page (`txns.data`); a
        # `limit=20` slice is plenty for the UI list and avoids accidental
        # auto-paging through the host's whole Stripe history.
        pending_entries: list[tuple[stripe.BalanceTransaction, Optional[str]]] = []
        for entry in txns.data:
            etype = getattr(entry, "type", None)
            if etype not in _KEEP_TYPES:
                continue
            source = getattr(entry, "source", None)
            # `source` is the charge object (expanded). `payment_intent`
            # is a string id like `pi_...`. Older / out-of-band charges
            # may not carry one — we fall through to None and skip the
            # local enrichment in that case.
            pi_id = (
                getattr(source, "payment_intent", None) if source else None
            )
            pending_entries.append((entry, pi_id))

        pi_ids = [pi for (_, pi) in pending_entries if pi]
        payment_rows: list[Payment] = (
            self.db.query(Payment)
            .filter(Payment.stripe_payment_intent_id.in_(pi_ids))
            .all()
            if pi_ids
            else []
        )
        payments_by_pi = {p.stripe_payment_intent_id: p for p in payment_rows}

        bill_ids = {p.bill_id for p in payment_rows}
        member_ids = {p.bill_member_id for p in payment_rows}
        bills_by_id = (
            {
                b.id: b
                for b in self.db.query(Bill)
                .filter(Bill.id.in_(bill_ids))
                .all()
            }
            if bill_ids
            else {}
        )
        members_by_id = (
            {
                m.id: m
                for m in self.db.query(BillMember)
                .filter(BillMember.id.in_(member_ids))
                .all()
            }
            if member_ids
            else {}
        )

        out: list[dict] = []
        for entry, pi_id in pending_entries:
            amount = int(getattr(entry, "amount", 0) or 0)
            fee = int(getattr(entry, "fee", 0) or 0)
            # Gross = what the guest paid. ``net`` (amount on the
            # connected account) excludes the Stripe fee + our application
            # fee; gross = amount + fee.
            gross = amount + fee

            payment = payments_by_pi.get(pi_id) if pi_id else None
            bill = bills_by_id.get(payment.bill_id) if payment else None
            member = (
                members_by_id.get(payment.bill_member_id) if payment else None
            )

            # `created` is a unix timestamp — convert to a tz-aware
            # datetime so the Pydantic schema serializes a normal ISO
            # string for the client.
            created_unix = int(getattr(entry, "created", 0) or 0)
            created_at = datetime.fromtimestamp(created_unix, tz=timezone.utc)

            out.append(
                {
                    "id": getattr(entry, "id", "") or "",
                    "amount_cents": amount,
                    "gross_cents": gross,
                    "fee_cents": fee,
                    "status": getattr(entry, "status", "pending") or "pending",
                    "created_at": created_at,
                    "bill_id": bill.id if bill else None,
                    "bill_title": bill.title if bill else None,
                    "payer_name": (
                        member.nickname if member is not None else None
                    ),
                }
            )

        return out

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
