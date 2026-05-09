import logging
import secrets
from decimal import ROUND_HALF_UP, Decimal
from uuid import uuid4

from sqlalchemy import func as _sa_func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.item_assignment import ItemAssignment
from app.models.payment import Payment
from app.models.user import User

logger = logging.getLogger(__name__)


def _platform_fee_cents(amount_cents: int) -> int:
    """Flat-rate fallback for the platform fee, in cents.

    Used only when we can't compute a per-guest service-fee share from
    the bill (e.g. the bill has no `service_fee` set yet, no subtotal,
    or the member has no item assignments). Reads `PLATFORM_FEE_BPS`
    so an operator can still force a flat % across all charges if they
    don't want to rely on the bill-level `service_fee` field.

    Returns 0 when unconfigured. Rounded down to the cent (favors the
    host on the rounding boundary). Stripe's own per-transaction fee is
    separate and is debited from the platform's portion of a destination
    charge automatically.
    """
    bps = int(settings.PLATFORM_FEE_BPS or 0)
    if bps <= 0 or amount_cents <= 0:
        return 0
    return (amount_cents * bps) // 10_000


def _application_fee_for_member(
    db: Session,
    bill_id: str,
    member_id: str,
    amount_cents: int,
) -> int:
    """Per-guest platform cut to pass as Stripe `application_fee_amount`.

    On a destination charge, Stripe routes the full `amount` to the
    connected account UNLESS we tell it to siphon a slice into the
    platform's own balance via `application_fee_amount`. Without this,
    the entire "Service fee" line we're displaying on the bill ends up
    in the host's Connect balance — which is precisely the bug the
    Payouts UI was reporting (Settld absorbing Stripe's processing fee
    while the host received the gross amount).

    The fee we collect here mirrors what
    :meth:`CalculationService.get_balance_breakdown` allocates to this
    member as their ``fee_share`` of ``bill.service_fee`` — i.e. the
    SAME number we already showed the guest in their bill breakdown.
    Critically it does NOT include ``receipt_extra_fees`` (those are
    fees printed on the original receipt, e.g. mandatory tip in NYC,
    facility fees — they belong to the host, not the platform).

    Math::

        member_subtotal = sum(ItemAssignment.amount_owed for member)
        proportion      = member_subtotal / bill.subtotal
        fee_share       = round(proportion * bill.service_fee)
        application_fee = int(fee_share * 100)   # cents

    Falls back to :func:`_platform_fee_cents` (the BPS knob) when the
    inputs aren't there to do the proportional math, so we never
    silently drop the platform cut on legacy / partially-built bills.

    The result is clamped to ``[0, amount_cents]`` since Stripe rejects
    an application fee greater than the charge.
    """
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if bill is None:
        return _platform_fee_cents(amount_cents)

    bill_service_fee = bill.service_fee or Decimal("0")
    bill_subtotal = bill.subtotal or Decimal("0")
    if bill_service_fee <= 0 or bill_subtotal <= 0:
        return _platform_fee_cents(amount_cents)

    member_subtotal_raw = (
        db.query(_sa_func.coalesce(_sa_func.sum(ItemAssignment.amount_owed), 0))
        .filter(ItemAssignment.bill_member_id == member_id)
        .scalar()
    )
    member_subtotal = Decimal(str(member_subtotal_raw or 0))
    if member_subtotal <= 0:
        # Member has no assignments yet — fall back rather than charge a
        # phantom fee on what's effectively a $0 share.
        return _platform_fee_cents(amount_cents)

    proportion = member_subtotal / bill_subtotal
    fee_share = (proportion * bill_service_fee).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )
    fee_cents = int(fee_share * 100)
    return max(0, min(fee_cents, amount_cents))


def _stripe_intent_for_payment(
    bill_id: str,
    member_id: str,
    amount: Decimal,
    currency: str,
    *,
    destination_account_id: str | None = None,
    application_fee_cents: int = 0,
) -> tuple[str, str]:
    """Create (or mock) a Stripe PaymentIntent for a guest's share.

    When `destination_account_id` is provided (the bill owner has a
    Connect account with `charges_enabled=True`), the PaymentIntent is
    created as a DESTINATION CHARGE — Stripe automatically transfers the
    funds to the host's connected account balance (minus Stripe's
    per-txn fee and our `application_fee_amount`). This is what lets the
    host later run an instant payout to their debit card.

    `application_fee_cents` is the slice of `amount` we siphon into the
    PLATFORM's balance (Settld). Computed by the caller via
    :func:`_application_fee_for_member` so it matches the per-guest
    `fee_share` we already showed on the bill breakdown — i.e. the
    "Service fee" line on the receipt actually flows to Settld instead
    of routing to the host along with the rest of the charge. Stripe
    debits its own per-charge processing fee from this same platform
    portion, which is why `SERVICE_FEE_PERCENTAGE` is sized to cover
    both Stripe's cut and Settld's margin.

    When `destination_account_id` is None, the PaymentIntent lands in the
    platform's balance with no automatic routing — same as the legacy
    behavior. We log a warning in that case so prod operators notice
    hosts who haven't connected.
    """
    if settings.STRIPE_SECRET_KEY:
        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY
        amount_in_cents = int(amount * 100)

        intent_kwargs: dict = {
            "amount": amount_in_cents,
            "currency": currency.lower(),
            "metadata": {
                "bill_id": str(bill_id),
                "member_id": str(member_id),
            },
        }

        if destination_account_id:
            # Destination charge — money routes to the host's connected
            # account. `application_fee_amount` is our platform's cut and
            # is also where Stripe debits its per-charge processing fee
            # from, so this slice ends up as (service_fee - stripe_fee)
            # on the platform's balance.
            intent_kwargs["transfer_data"] = {"destination": destination_account_id}
            # Defensive clamp: never exceed the charge amount or Stripe
            # rejects the call.
            app_fee = max(0, min(int(application_fee_cents or 0), amount_in_cents))
            if app_fee > 0:
                intent_kwargs["application_fee_amount"] = app_fee
                intent_kwargs["metadata"]["application_fee_cents"] = str(app_fee)
            intent_kwargs["metadata"]["destination_account_id"] = destination_account_id
        else:
            # No host account on file → funds stay on platform balance.
            # Callers with a host-connected bill should pass destination
            # to avoid this branch (see PaymentService.create_payment_intent).
            logger.warning(
                "stripe_intent_no_destination",
                extra={"bill_id": bill_id, "member_id": member_id},
            )

        logger.info(
            "Creating Stripe PaymentIntent",
            extra={
                "bill_id": bill_id,
                "member_id": member_id,
                "amount": str(amount),
                "amount_cents": amount_in_cents,
                "currency": currency,
                "destination_account_id": destination_account_id,
            },
        )

        try:
            intent = stripe.PaymentIntent.create(**intent_kwargs)
            logger.info(
                "Stripe PaymentIntent created successfully",
                extra={
                    "payment_intent_id": intent.id,
                    "destination_account_id": destination_account_id,
                },
            )
            return intent.id, intent.client_secret or ""
        except stripe.error.StripeError as e:
            logger.error(
                "Stripe PaymentIntent creation failed",
                extra={
                    "error_type": type(e).__name__,
                    "error_message": str(e),
                    "bill_id": bill_id,
                    "member_id": member_id,
                    "amount": str(amount),
                    "currency": currency,
                    "destination_account_id": destination_account_id,
                },
                exc_info=True,
            )
            raise ValueError(f"Payment setup failed: {str(e)}")

    stripe_pi_id = f"pi_mock_{uuid4().hex[:16]}"
    stripe_client_secret = f"pi_mock_{uuid4().hex[:16]}_secret_{uuid4().hex[:8]}"
    return stripe_pi_id, stripe_client_secret


def _lookup_host_destination(db: Session, bill_id: str) -> str | None:
    """Return the host's Stripe Connect account id if it's eligible for
    destination charges, else None. Eligibility = owner has an
    `stripe_account_id` AND Stripe's `charges_enabled` flag is cached as
    True (kept fresh by the Connect webhook).

    Keeping this behind a helper so both `create_payment_intent` and
    `ensure_stripe_client_for_payment` stay in sync.
    """
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        return None
    owner = db.query(User).filter(User.id == bill.owner_id).first()
    if not owner or not owner.stripe_account_id:
        return None
    if not owner.stripe_charges_enabled:
        # Host started onboarding but hasn't been approved for charges yet.
        # Better to block than silently route to platform balance.
        return None
    return owner.stripe_account_id


class PaymentService:
    def __init__(self, db: Session):
        self.db = db

    def create_payment_intent(
        self,
        bill_id: str,
        member_id: str,
        user_id: str | None,
        amount: Decimal,
        currency: str = "USD",
    ) -> Payment:
        # Validate amount
        if amount <= 0:
            raise ValueError("Payment amount must be greater than 0")
        
        # Validate currency and check Stripe minimums
        currency_upper = currency.upper()
        min_amounts = {
            "USD": Decimal("0.50"),
            "EUR": Decimal("0.50"),
            "GBP": Decimal("0.30"),
            "CAD": Decimal("0.50"),
            "AUD": Decimal("0.50"),
        }
        
        if currency_upper in min_amounts and amount < min_amounts[currency_upper]:
            raise ValueError(
                f"Payment amount must be at least {min_amounts[currency_upper]} {currency_upper}"
            )

        from app.models.bill import Bill
        from app.services.guest_pay_gate import assert_guest_payment_allowed

        bill_row = self.db.query(Bill).filter(Bill.id == bill_id).first()
        assert_guest_payment_allowed(bill_row)

        existing = (
            self.db.query(Payment)
            .filter(
                Payment.bill_id == bill_id,
                Payment.bill_member_id == member_id,
                Payment.status == "pending",
            )
            .first()
        )

        # Look up the host's Connect account once. When present, the
        # PaymentIntent becomes a destination charge and the funds flow
        # straight to their Connect balance — enabling instant payouts
        # to their debit card from the Payouts screen.
        destination = _lookup_host_destination(self.db, bill_id)

        # Compute the platform fee for this specific guest's share so
        # `application_fee_amount` matches the "Service fee" line we
        # already showed them on the bill. Skipped when there's no
        # destination — without a Connect account there's no platform
        # vs. host split to make.
        amount_cents = int(amount * 100)
        app_fee_cents = (
            _application_fee_for_member(self.db, bill_id, member_id, amount_cents)
            if destination
            else 0
        )

        try:
            stripe_pi_id, stripe_client_secret = _stripe_intent_for_payment(
                bill_id,
                member_id,
                amount,
                currency,
                destination_account_id=destination,
                application_fee_cents=app_fee_cents,
            )
        except ValueError as e:
            # Re-raise ValueError from Stripe errors
            raise

        if existing:
            existing.amount = amount
            existing.user_id = user_id
            existing.currency = currency
            existing.stripe_payment_intent_id = stripe_pi_id
            existing.stripe_client_secret = stripe_client_secret
            if not existing.payment_link_token:
                existing.payment_link_token = secrets.token_urlsafe(32)
            self.db.commit()
            self.db.refresh(existing)
            return existing

        payment = Payment(
            bill_id=bill_id,
            bill_member_id=member_id,
            user_id=user_id,
            amount=amount,
            currency=currency,
            status="pending",
            stripe_payment_intent_id=stripe_pi_id,
            stripe_client_secret=stripe_client_secret,
            payment_link_token=secrets.token_urlsafe(32),
        )
        self.db.add(payment)
        self.db.commit()
        self.db.refresh(payment)
        return payment

    def get_payment_by_link_token(self, token: str) -> Payment | None:
        return (
            self.db.query(Payment)
            .filter(Payment.payment_link_token == token)
            .first()
        )

    def ensure_stripe_client_for_payment(self, payment_id: str) -> Payment:
        """Attach a Stripe PaymentIntent when user opens the public pay link."""
        payment = self.get_payment(payment_id)
        if not payment:
            raise ValueError("NOT_FOUND")
        if payment.status != "pending":
            return payment
        if payment.stripe_client_secret:
            return payment

        # Validate payment amount before creating Stripe intent
        if not payment.amount or payment.amount <= 0:
            logger.error(
                "Invalid payment amount",
                extra={"payment_id": payment_id, "amount": str(payment.amount)}
            )
            raise ValueError("Payment amount is invalid or missing")

        destination = _lookup_host_destination(self.db, str(payment.bill_id))
        amount_cents = int((payment.amount or Decimal("0")) * 100)
        app_fee_cents = (
            _application_fee_for_member(
                self.db,
                str(payment.bill_id),
                str(payment.bill_member_id),
                amount_cents,
            )
            if destination
            else 0
        )

        try:
            stripe_pi_id, stripe_client_secret = _stripe_intent_for_payment(
                str(payment.bill_id),
                str(payment.bill_member_id),
                payment.amount,
                payment.currency or "USD",
                destination_account_id=destination,
                application_fee_cents=app_fee_cents,
            )
        except ValueError as e:
            # Re-raise with more context
            logger.error(
                "Failed to create Stripe PaymentIntent for payment link",
                extra={"payment_id": payment_id, "error": str(e)}
            )
            raise
            
        payment.stripe_payment_intent_id = stripe_pi_id
        payment.stripe_client_secret = stripe_client_secret
        self.db.commit()
        self.db.refresh(payment)
        return payment

    def get_payment(self, payment_id: str) -> Payment | None:
        return self.db.query(Payment).filter(Payment.id == payment_id).first()

    def get_bill_payments(self, bill_id: str) -> list[Payment]:
        return (
            self.db.query(Payment)
            .filter(Payment.bill_id == bill_id)
            .order_by(Payment.created_at.desc())
            .all()
        )

    def confirm_payment(self, payment_id: str) -> Payment:
        payment = self.db.query(Payment).filter(Payment.id == payment_id).first()
        if not payment:
            raise ValueError(f"Payment {payment_id} not found")

        payment.status = "succeeded"

        member = (
            self.db.query(BillMember)
            .filter(BillMember.id == payment.bill_member_id)
            .first()
        )
        if member:
            member.status = "paid"

        self.db.commit()
        self.db.refresh(payment)
        return payment

    def handle_stripe_webhook(self, payload: bytes, sig_header: str) -> None:
        if not settings.STRIPE_WEBHOOK_SECRET:
            logger.info("No STRIPE_WEBHOOK_SECRET configured, skipping webhook verification")
            return

        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY

        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
        except stripe.error.SignatureVerificationError as e:
            raise ValueError(f"Invalid webhook signature: {e}")

        event_type = event["type"]
        data_object = event["data"]["object"]

        if event_type == "payment_intent.succeeded":
            pi_id = data_object["id"]
            payment = (
                self.db.query(Payment)
                .filter(Payment.stripe_payment_intent_id == pi_id)
                .first()
            )
            if payment:
                payment.status = "succeeded"
                member = (
                    self.db.query(BillMember)
                    .filter(BillMember.id == payment.bill_member_id)
                    .first()
                )
                if member:
                    member.status = "paid"
                self.db.commit()
                logger.info(f"Payment {payment.id} succeeded via webhook")
            else:
                logger.warning(f"No payment found for PaymentIntent {pi_id}")

        elif event_type == "payment_intent.payment_failed":
            pi_id = data_object["id"]
            payment = (
                self.db.query(Payment)
                .filter(Payment.stripe_payment_intent_id == pi_id)
                .first()
            )
            if payment:
                payment.status = "failed"
                self.db.commit()
                logger.info(f"Payment {payment.id} failed via webhook")
            else:
                logger.warning(f"No payment found for PaymentIntent {pi_id}")

        else:
            logger.info(f"Unhandled webhook event type: {event_type}")
