import hashlib
import logging
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.virtual_card import VirtualCard
from app.services.readiness_service import ReadinessService

logger = logging.getLogger(__name__)


class VirtualCardService:
    def __init__(self, db: Session):
        self.db = db

    def create_card_for_bill(
        self,
        bill_id: str,
        actor_id: str,
    ) -> VirtualCard:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError("NOT_FOUND")

        if str(bill.owner_id) != actor_id:
            raise ValueError("FORBIDDEN")

        readiness_svc = ReadinessService(self.db)
        evaluation = readiness_svc.evaluate(bill_id)
        if not evaluation["ready_to_pay"] and not evaluation["meets_threshold"]:
            raise ValueError("NOT_READY")

        idempotency_key = self._idempotency_key(bill_id)
        existing = (
            self.db.query(VirtualCard)
            .filter(VirtualCard.idempotency_key == idempotency_key)
            .first()
        )
        if existing:
            logger.info(
                "virtual_card_duplicate_prevented",
                extra={"bill_id": bill_id, "card_id": str(existing.id)},
            )
            return existing

        bill_total = bill.total or Decimal("0")
        amount_cents = int(bill_total * 100)

        if not settings.STRIPE_ISSUING_ENABLED:
            card = self._create_mock_card(
                bill_id=bill_id,
                actor_id=actor_id,
                amount_cents=amount_cents,
                currency=bill.currency,
                idempotency_key=idempotency_key,
            )
        else:
            card = self._create_stripe_card(
                bill=bill,
                actor_id=actor_id,
                amount_cents=amount_cents,
                idempotency_key=idempotency_key,
            )

        logger.info(
            "virtual_card_created",
            extra={
                "bill_id": bill_id,
                "card_id": str(card.id),
                "actor_id": actor_id,
                "amount_cents": amount_cents,
                "provider": "stripe" if settings.STRIPE_ISSUING_ENABLED else "mock",
            },
        )

        return card

    def get_card_for_bill(self, bill_id: str) -> VirtualCard | None:
        return (
            self.db.query(VirtualCard)
            .filter(
                VirtualCard.bill_id == bill_id,
                VirtualCard.status.in_(["active", "pending"]),
            )
            .first()
        )

    def deactivate_card(self, card_id: str, actor_id: str) -> VirtualCard:
        card = self.db.query(VirtualCard).filter(VirtualCard.id == card_id).first()
        if not card:
            raise ValueError("NOT_FOUND")

        bill = self.db.query(Bill).filter(Bill.id == card.bill_id).first()
        if not bill or str(bill.owner_id) != actor_id:
            raise ValueError("FORBIDDEN")

        if settings.STRIPE_ISSUING_ENABLED and card.stripe_card_id:
            self._cancel_stripe_card(card.stripe_card_id)

        card.status = "canceled"
        card.is_active = False
        self.db.commit()
        self.db.refresh(card)

        logger.info(
            "virtual_card_deactivated",
            extra={"card_id": str(card.id), "bill_id": str(card.bill_id)},
        )
        return card

    def _create_stripe_card(
        self,
        bill: Bill,
        actor_id: str,
        amount_cents: int,
        idempotency_key: str,
    ) -> VirtualCard:
        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY

        cardholder = stripe.issuing.Cardholder.create(
            name=f"WealthSplit Bill {bill.title[:40]}",
            type="individual",
            billing={
                "address": {
                    "line1": "N/A",
                    "city": "N/A",
                    "state": "CA",
                    "postal_code": "00000",
                    "country": "US",
                }
            },
            idempotency_key=f"{idempotency_key}_ch",
        )

        stripe_card = stripe.issuing.Card.create(
            cardholder=cardholder.id,
            currency=bill.currency.lower(),
            type="virtual",
            spending_controls={
                "spending_limits": [
                    {
                        "amount": amount_cents,
                        "interval": "all_time",
                    }
                ]
            },
            metadata={
                "bill_id": str(bill.id),
                "idempotency_key": idempotency_key,
            },
            idempotency_key=f"{idempotency_key}_card",
        )

        card = VirtualCard(
            bill_id=bill.id,
            stripe_card_id=stripe_card.id,
            stripe_cardholder_id=cardholder.id,
            spending_limit_cents=amount_cents,
            currency=bill.currency,
            status="active",
            is_active=True,
            idempotency_key=idempotency_key,
            created_by=actor_id,
        )
        self.db.add(card)
        self.db.commit()
        self.db.refresh(card)
        return card

    def _create_mock_card(
        self,
        bill_id: str,
        actor_id: str,
        amount_cents: int,
        currency: str,
        idempotency_key: str,
    ) -> VirtualCard:
        import secrets

        card = VirtualCard(
            bill_id=bill_id,
            stripe_card_id=f"ic_mock_{secrets.token_hex(8)}",
            stripe_cardholder_id=f"ich_mock_{secrets.token_hex(8)}",
            spending_limit_cents=amount_cents,
            currency=currency,
            status="active",
            is_active=True,
            idempotency_key=idempotency_key,
            created_by=actor_id,
        )
        self.db.add(card)
        self.db.commit()
        self.db.refresh(card)
        return card

    def _cancel_stripe_card(self, stripe_card_id: str) -> None:
        import stripe

        stripe.api_key = settings.STRIPE_SECRET_KEY
        try:
            stripe.issuing.Card.modify(stripe_card_id, status="canceled")
        except stripe.error.StripeError as e:
            logger.error(
                "stripe_card_cancel_failed",
                extra={"stripe_card_id": stripe_card_id, "error": str(e)},
            )
            raise

    @staticmethod
    def _idempotency_key(bill_id: str) -> str:
        return hashlib.sha256(f"vcard:{bill_id}".encode()).hexdigest()[:64]
