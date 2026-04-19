"""
Seed script for WealthSplit demo data.
Run with: python -m scripts.seed
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from app.db.session import SessionLocal, engine
from app.db.base import Base
from app.models import (
    User,
    Bill,
    BillMember,
    ReceiptUpload,
    ReceiptItem,
    ItemAssignment,
    Payment,
    Notification,
)
from app.core.security import hash_password


def seed() -> None:
    # Create all tables
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Check if demo user already exists
        existing = db.query(User).filter(User.email == "demo@wealthsplit.com").first()
        if existing:
            print("Seed data already exists. Skipping.")
            return

        # ── Users ──────────────────────────────────────────────────────
        demo_user = User(
            id=uuid.uuid4(),
            email="demo@wealthsplit.com",
            password_hash=hash_password("password123"),
            full_name="Demo User",
        )
        jane = User(
            id=uuid.uuid4(),
            email="jane@example.com",
            password_hash=hash_password("password123"),
            full_name="Jane Smith",
        )
        bob = User(
            id=uuid.uuid4(),
            email="bob@example.com",
            password_hash=hash_password("password123"),
            full_name="Bob Wilson",
        )
        db.add_all([demo_user, jane, bob])
        db.flush()

        # ── Bill ───────────────────────────────────────────────────────
        bill = Bill(
            id=uuid.uuid4(),
            title="Friday Night Dinner",
            merchant_name="Olive Garden",
            currency="USD",
            owner_id=demo_user.id,
            status="active",
        )
        db.add(bill)
        db.flush()

        # ── Bill Members ──────────────────────────────────────────────
        member_demo = BillMember(
            id=uuid.uuid4(),
            bill_id=bill.id,
            user_id=demo_user.id,
            nickname="Demo User",
            email=demo_user.email,
            status="joined",
            joined_at=datetime.now(timezone.utc),
        )
        member_jane = BillMember(
            id=uuid.uuid4(),
            bill_id=bill.id,
            user_id=jane.id,
            nickname="Jane Smith",
            email=jane.email,
            status="joined",
            joined_at=datetime.now(timezone.utc),
        )
        member_bob = BillMember(
            id=uuid.uuid4(),
            bill_id=bill.id,
            user_id=bob.id,
            nickname="Bob Wilson",
            email=bob.email,
            status="invited",
        )
        db.add_all([member_demo, member_jane, member_bob])
        db.flush()

        # ── Receipt Upload ────────────────────────────────────────────
        receipt = ReceiptUpload(
            id=uuid.uuid4(),
            bill_id=bill.id,
            file_path="mock/receipt.jpg",
            original_filename="receipt.jpg",
            content_type="image/jpeg",
            parsed=True,
            parsed_at=datetime.now(timezone.utc),
        )
        db.add(receipt)
        db.flush()

        # ── Receipt Items ─────────────────────────────────────────────
        items_data = [
            {
                "name": "Margherita Pizza",
                "quantity": 1,
                "unit_price": Decimal("14.99"),
                "total_price": Decimal("14.99"),
                "category": "Entree",
                "confidence": 0.95,
                "is_taxable": True,
                "sort_order": 0,
            },
            {
                "name": "Caesar Salad",
                "quantity": 1,
                "unit_price": Decimal("11.50"),
                "total_price": Decimal("11.50"),
                "category": "Appetizer",
                "confidence": 0.92,
                "is_taxable": True,
                "sort_order": 1,
            },
            {
                "name": "Craft IPA Beer",
                "quantity": 2,
                "unit_price": Decimal("8.00"),
                "total_price": Decimal("16.00"),
                "category": "Beverage",
                "confidence": 0.89,
                "is_taxable": False,
                "sort_order": 2,
            },
            {
                "name": "Sparkling Water",
                "quantity": 1,
                "unit_price": Decimal("3.50"),
                "total_price": Decimal("3.50"),
                "category": "Beverage",
                "confidence": 0.94,
                "is_taxable": False,
                "sort_order": 3,
            },
            {
                "name": "Truffle Fries",
                "quantity": 1,
                "unit_price": Decimal("9.99"),
                "total_price": Decimal("9.99"),
                "category": "Appetizer",
                "confidence": 0.91,
                "is_taxable": True,
                "sort_order": 4,
            },
            {
                "name": "Chocolate Lava Cake",
                "quantity": 1,
                "unit_price": Decimal("12.50"),
                "total_price": Decimal("12.50"),
                "category": "Dessert",
                "confidence": 0.88,
                "is_taxable": True,
                "sort_order": 5,
            },
        ]

        receipt_items = []
        for item_data in items_data:
            item = ReceiptItem(
                id=uuid.uuid4(),
                receipt_id=receipt.id,
                bill_id=bill.id,
                **item_data,
            )
            receipt_items.append(item)
        db.add_all(receipt_items)
        db.flush()

        # ── Update bill totals ────────────────────────────────────────
        bill.subtotal = Decimal("68.48")
        bill.tax = Decimal("6.16")
        bill.tip = Decimal("10.00")
        bill.service_fee = Decimal("0")
        bill.total = Decimal("84.64")
        db.flush()

        # ── Item Assignments (split between demo + jane) ─────────────
        for item in receipt_items:
            half = (item.total_price / 2).quantize(Decimal("0.01"))
            assignment_demo = ItemAssignment(
                id=uuid.uuid4(),
                receipt_item_id=item.id,
                bill_member_id=member_demo.id,
                share_type="equal",
                amount_owed=half,
            )
            assignment_jane = ItemAssignment(
                id=uuid.uuid4(),
                receipt_item_id=item.id,
                bill_member_id=member_jane.id,
                share_type="equal",
                amount_owed=half,
            )
            db.add_all([assignment_demo, assignment_jane])
        db.flush()

        # ── Payment ───────────────────────────────────────────────────
        payment = Payment(
            id=uuid.uuid4(),
            bill_id=bill.id,
            bill_member_id=member_demo.id,
            user_id=demo_user.id,
            amount=Decimal("42.32"),
            currency="USD",
            status="succeeded",
            stripe_payment_intent_id="pi_mock_" + uuid.uuid4().hex[:24],
        )
        db.add(payment)
        db.flush()

        # ── Notification ──────────────────────────────────────────────
        notification = Notification(
            id=uuid.uuid4(),
            user_id=jane.id,
            type="bill_invite",
            title="You've been added to a bill",
            message="Demo User added you to Friday Night Dinner",
            data={"bill_id": str(bill.id)},
        )
        db.add(notification)

        db.commit()

        print("Seed data created successfully!")
        print(f"  Users:            3  (demo, jane, bob)")
        print(f"  Bill:             1  (Friday Night Dinner)")
        print(f"  Bill members:     3  (2 joined, 1 invited)")
        print(f"  Receipt upload:   1")
        print(f"  Receipt items:    6")
        print(f"  Item assignments: 12 (6 items x 2 members)")
        print(f"  Payment:          1  (demo paid $42.32)")
        print(f"  Notification:     1  (bill invite for jane)")

    except Exception as e:
        db.rollback()
        print(f"Error seeding data: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
