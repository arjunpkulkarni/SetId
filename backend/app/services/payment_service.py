import logging
import secrets
from decimal import Decimal
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.payment import Payment
from app.models.user import User

logger = logging.getLogger(__name__)


def _platform_fee_cents(amount_cents: int) -> int:
    """Platform's cut, in cents, computed from `PLATFORM_FEE_BPS`.

    Returns 0 when unconfigured. Rounded down to the cent (favors the
    host on the rounding boundary). Stripe's own per-transaction fee is
    separate and always applies regardless.
    """
    bps = int(settings.PLATFORM_FEE_BPS or 0)
    if bps <= 0 or amount_cents <= 0:
        return 0
    return (amount_cents * bps) // 10_000


def _stripe_intent_for_payment(
    bill_id: str,
    member_id: str,
    amount: Decimal,
    currency: str,
    *,
    destination_account_id: str | None = None,
) -> tuple[str, str]:
    """Create (or mock) a Stripe PaymentIntent for a guest's share.

    When `destination_account_id` is provided (the bill owner has a
    Connect account with `charges_enabled=True`), the PaymentIntent is
    created as a DESTINATION CHARGE — Stripe automatically transfers the
    funds to the host's connected account balance (minus Stripe's
    per-txn fee and our `application_fee_amount`). This is what lets the
    host later run an instant payout to their debit card.

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
            # account. `application_fee_amount` is our platform's cut.
            intent_kwargs["transfer_data"] = {"destination": destination_account_id}
            app_fee = _platform_fee_cents(amount_in_cents)
            if app_fee > 0:
                intent_kwargs["application_fee_amount"] = app_fee
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

        try:
            stripe_pi_id, stripe_client_secret = _stripe_intent_for_payment(
                bill_id,
                member_id,
                amount,
                currency,
                destination_account_id=destination,
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

        try:
            stripe_pi_id, stripe_client_secret = _stripe_intent_for_payment(
                str(payment.bill_id),
                str(payment.bill_member_id),
                payment.amount,
                payment.currency or "USD",
                destination_account_id=destination,
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
