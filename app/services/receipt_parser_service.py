import os
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.bill import Bill
from app.models.receipt import ReceiptUpload
from app.models.receipt_item import ReceiptItem


class ReceiptParserService:
    def __init__(self, db: Session):
        self.db = db

    def save_upload(
        self,
        bill_id: str,
        file_content: bytes,
        filename: str,
        content_type: str,
    ) -> ReceiptUpload:
        upload_dir = os.path.join(settings.UPLOAD_DIR, str(bill_id))
        os.makedirs(upload_dir, exist_ok=True)

        file_path = os.path.join(upload_dir, filename)
        with open(file_path, "wb") as f:
            f.write(file_content)

        receipt = ReceiptUpload(
            bill_id=bill_id,
            file_path=file_path,
            original_filename=filename,
            content_type=content_type,
        )
        self.db.add(receipt)
        self.db.commit()
        self.db.refresh(receipt)
        return receipt

    def get_receipt(self, bill_id: str) -> ReceiptUpload | None:
        return (
            self.db.query(ReceiptUpload)
            .filter(ReceiptUpload.bill_id == bill_id)
            .first()
        )

    def parse_receipt(self, bill_id: str) -> list[ReceiptItem]:
        receipt = self.get_receipt(bill_id)
        if not receipt:
            raise ValueError(f"No receipt found for bill {bill_id}")

        if receipt.parsed:
            return self.get_items(bill_id)

        mock_items_data = [
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

        items = []
        for item_data in mock_items_data:
            item = ReceiptItem(
                receipt_id=receipt.id,
                bill_id=bill_id,
                **item_data,
            )
            self.db.add(item)
            items.append(item)

        # subtotal = sum of all items = 68.48
        subtotal = sum(d["total_price"] for d in mock_items_data)
        # taxable total = 14.99 + 11.50 + 9.99 + 12.50 = 48.98
        taxable_total = sum(
            d["total_price"] for d in mock_items_data if d["is_taxable"]
        )
        # tax = 9% of taxable items
        tax = (taxable_total * Decimal("0.09")).quantize(Decimal("0.01"))
        total = subtotal + tax

        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if bill:
            bill.subtotal = subtotal
            bill.tax = tax
            bill.total = total

        receipt.parsed = True
        receipt.parsed_at = datetime.now(timezone.utc)

        self.db.commit()
        for item in items:
            self.db.refresh(item)
        return items

    def get_items(self, bill_id: str) -> list[ReceiptItem]:
        return (
            self.db.query(ReceiptItem)
            .filter(ReceiptItem.bill_id == bill_id)
            .order_by(ReceiptItem.sort_order)
            .all()
        )

    def update_item(self, item_id: str, data: dict) -> ReceiptItem:
        item = self.db.query(ReceiptItem).filter(ReceiptItem.id == item_id).first()
        if not item:
            raise ValueError(f"ReceiptItem {item_id} not found")

        for key, value in data.items():
            if hasattr(item, key):
                setattr(item, key, value)

        if "unit_price" in data or "quantity" in data:
            item.total_price = item.unit_price * item.quantity

        self.db.commit()
        self.db.refresh(item)
        return item
