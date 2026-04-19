import logging

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.payment_method import PaymentMethod
from app.models.user import User

logger = logging.getLogger(__name__)


class PaymentMethodService:
    def __init__(self, db: Session):
        self.db = db
        if settings.STRIPE_SECRET_KEY:
            stripe.api_key = settings.STRIPE_SECRET_KEY

    def _ensure_stripe_customer(self, user: User) -> str:
        """Get or create a Stripe Customer for the user."""
        if user.stripe_customer_id:
            return user.stripe_customer_id

        if not settings.STRIPE_SECRET_KEY:
            mock_id = f"cus_mock_{str(user.id).replace('-', '')[:16]}"
            user.stripe_customer_id = mock_id
            self.db.commit()
            self.db.refresh(user)
            return mock_id

        customer = stripe.Customer.create(
            email=user.email,
            name=user.full_name,
            metadata={"user_id": str(user.id)},
        )
        user.stripe_customer_id = customer.id
        self.db.commit()
        self.db.refresh(user)

        logger.info("stripe_customer_created", extra={"user_id": str(user.id), "customer_id": customer.id})
        return customer.id

    def create_setup_intent(self, user: User) -> dict:
        """Create a Stripe SetupIntent so the frontend can collect card details."""
        customer_id = self._ensure_stripe_customer(user)

        if not settings.STRIPE_SECRET_KEY:
            import secrets
            return {
                "client_secret": f"seti_mock_{secrets.token_hex(12)}_secret_{secrets.token_hex(8)}",
                "stripe_publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
            }

        setup_intent = stripe.SetupIntent.create(
            customer=customer_id,
            payment_method_types=["card"],
            metadata={"user_id": str(user.id)},
        )

        return {
            "client_secret": setup_intent.client_secret,
            "stripe_publishable_key": settings.STRIPE_PUBLISHABLE_KEY,
        }

    def attach_payment_method(self, user: User, stripe_pm_id: str) -> PaymentMethod:
        """
        Attach a Stripe PaymentMethod to the user's customer and save it locally.
        Called after the frontend confirms the SetupIntent.
        """
        customer_id = self._ensure_stripe_customer(user)

        existing = (
            self.db.query(PaymentMethod)
            .filter(PaymentMethod.stripe_payment_method_id == stripe_pm_id)
            .first()
        )
        if existing:
            return existing

        card_brand = None
        card_last4 = None
        card_exp_month = None
        card_exp_year = None

        if settings.STRIPE_SECRET_KEY:
            # Attach to customer (may already be attached via SetupIntent)
            try:
                stripe.PaymentMethod.attach(stripe_pm_id, customer=customer_id)
            except stripe.error.InvalidRequestError as e:
                if "already been attached" not in str(e):
                    raise

            pm = stripe.PaymentMethod.retrieve(stripe_pm_id)
            if pm.card:
                card_brand = pm.card.brand
                card_last4 = pm.card.last4
                card_exp_month = pm.card.exp_month
                card_exp_year = pm.card.exp_year
        else:
            card_brand = "visa"
            card_last4 = stripe_pm_id[-4:] if len(stripe_pm_id) >= 4 else "0000"
            card_exp_month = 12
            card_exp_year = 2030

        has_methods = (
            self.db.query(PaymentMethod)
            .filter(PaymentMethod.user_id == user.id)
            .count()
        )
        is_first = has_methods == 0

        method = PaymentMethod(
            user_id=user.id,
            stripe_payment_method_id=stripe_pm_id,
            card_brand=card_brand,
            card_last4=card_last4,
            card_exp_month=card_exp_month,
            card_exp_year=card_exp_year,
            is_default=is_first,
        )
        self.db.add(method)
        self.db.commit()
        self.db.refresh(method)

        logger.info(
            "payment_method_attached",
            extra={
                "user_id": str(user.id),
                "pm_id": str(method.id),
                "brand": card_brand,
                "last4": card_last4,
            },
        )
        return method

    def list_payment_methods(self, user_id: str) -> list[PaymentMethod]:
        return (
            self.db.query(PaymentMethod)
            .filter(PaymentMethod.user_id == user_id)
            .order_by(PaymentMethod.is_default.desc(), PaymentMethod.created_at.desc())
            .all()
        )

    def set_default(self, user_id: str, method_id: str) -> PaymentMethod:
        method = (
            self.db.query(PaymentMethod)
            .filter(PaymentMethod.id == method_id, PaymentMethod.user_id == user_id)
            .first()
        )
        if not method:
            raise ValueError("NOT_FOUND")

        # Unset all other defaults
        self.db.query(PaymentMethod).filter(
            PaymentMethod.user_id == user_id,
            PaymentMethod.id != method_id,
        ).update({"is_default": False})

        method.is_default = True

        if settings.STRIPE_SECRET_KEY:
            user = self.db.query(User).filter(User.id == user_id).first()
            if user and user.stripe_customer_id:
                try:
                    stripe.Customer.modify(
                        user.stripe_customer_id,
                        invoice_settings={"default_payment_method": method.stripe_payment_method_id},
                    )
                except stripe.error.StripeError as e:
                    logger.warning("stripe_set_default_failed", extra={"error": str(e)})

        self.db.commit()
        self.db.refresh(method)
        return method

    def delete_payment_method(self, user_id: str, method_id: str) -> None:
        method = (
            self.db.query(PaymentMethod)
            .filter(PaymentMethod.id == method_id, PaymentMethod.user_id == user_id)
            .first()
        )
        if not method:
            raise ValueError("NOT_FOUND")

        if settings.STRIPE_SECRET_KEY:
            try:
                stripe.PaymentMethod.detach(method.stripe_payment_method_id)
            except stripe.error.StripeError as e:
                logger.warning("stripe_detach_failed", extra={"error": str(e)})

        was_default = method.is_default
        self.db.delete(method)
        self.db.commit()

        # Promote another method to default if we deleted the default
        if was_default:
            next_method = (
                self.db.query(PaymentMethod)
                .filter(PaymentMethod.user_id == user_id)
                .order_by(PaymentMethod.created_at.desc())
                .first()
            )
            if next_method:
                next_method.is_default = True
                self.db.commit()
