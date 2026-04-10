import logging
from decimal import Decimal
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill_member import BillMember
from app.models.payment import Payment

logger = logging.getLogger(__name__)


class PaymentService:
    def __init__(self, db: Session):
        self.db = db

    def create_payment_intent(
        self,
        bill_id: str,
        member_id: str,
        user_id: str,
        amount: Decimal,
        currency: str = "USD",
    ) -> Payment:
        stripe_pi_id = None
        stripe_client_secret = None

        if settings.STRIPE_SECRET_KEY:
            import stripe

            stripe.api_key = settings.STRIPE_SECRET_KEY

            amount_in_cents = int(amount * 100)
            intent = stripe.PaymentIntent.create(
                amount=amount_in_cents,
                currency=currency.lower(),
                metadata={
                    "bill_id": str(bill_id),
                    "member_id": str(member_id),
                },
            )
            stripe_pi_id = intent.id
            stripe_client_secret = intent.client_secret
        else:
            stripe_pi_id = f"pi_mock_{uuid4().hex[:16]}"
            stripe_client_secret = (
                f"pi_mock_{uuid4().hex[:16]}_secret_{uuid4().hex[:8]}"
            )

        payment = Payment(
            bill_id=bill_id,
            bill_member_id=member_id,
            user_id=user_id,
            amount=amount,
            currency=currency,
            status="pending",
            stripe_payment_intent_id=stripe_pi_id,
            stripe_client_secret=stripe_client_secret,
        )
        self.db.add(payment)
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
