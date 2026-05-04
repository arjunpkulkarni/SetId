from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.models.bill import Bill
from app.models.bill_member import BillMember
from app.models.item_assignment import ItemAssignment
from app.models.payment import Payment
from app.models.receipt_item import ReceiptItem


class CalculationService:
    def __init__(self, db: Session):
        self.db = db

    def _calculate_amount_owed(
        self, share_type: str, share_value: Decimal, item: ReceiptItem, assignment_count: int
    ) -> Decimal:
        if share_type == "equal":
            if assignment_count <= 0:
                return Decimal("0")
            return (item.total_price / assignment_count).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        elif share_type == "percentage":
            return (item.total_price * share_value / Decimal("100")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
        elif share_type == "fixed":
            return share_value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        else:
            raise ValueError(f"Unknown share_type: {share_type}")

    def create_assignments(
        self, bill_id: str, assignments_data: list[dict]
    ) -> list[ItemAssignment]:
        # Pre-count how many assignments each item will have (existing + new)
        item_new_counts: dict[str, int] = {}
        for data in assignments_data:
            rid = str(data["receipt_item_id"])
            item_new_counts[rid] = item_new_counts.get(rid, 0) + 1

        created = []
        for data in assignments_data:
            item = (
                self.db.query(ReceiptItem)
                .filter(ReceiptItem.id == data["receipt_item_id"])
                .first()
            )
            if not item:
                raise ValueError(f"ReceiptItem {data['receipt_item_id']} not found")

            share_type = data.get("share_type", "equal")
            share_value = Decimal(str(data.get("share_value", 0)))

            # For equal splits, count all assignments for this item (existing + all new for this item)
            existing_count = (
                self.db.query(ItemAssignment)
                .filter(ItemAssignment.receipt_item_id == item.id)
                .count()
            )
            total_count = existing_count + item_new_counts.get(str(item.id), 0)

            amount_owed = self._calculate_amount_owed(
                share_type, share_value, item, total_count
            )

            assignment = ItemAssignment(
                receipt_item_id=data["receipt_item_id"],
                bill_member_id=data["bill_member_id"],
                share_type=share_type,
                share_value=share_value,
                amount_owed=amount_owed,
            )
            self.db.add(assignment)
            created.append(assignment)

        # For equal splits, recalculate all existing assignments for affected items
        # since the count has changed
        for rid_str in item_new_counts:
            existing_assignments = (
                self.db.query(ItemAssignment)
                .filter(
                    ItemAssignment.receipt_item_id == rid_str,
                    ItemAssignment.share_type == "equal",
                )
                .all()
            )
            if existing_assignments:
                item = (
                    self.db.query(ReceiptItem)
                    .filter(ReceiptItem.id == rid_str)
                    .first()
                )
                new_in_batch = [
                    a for a in created
                    if str(a.receipt_item_id) == rid_str and a.share_type == "equal"
                ]
                total = len(existing_assignments) + len(new_in_batch)
                if total > 0 and item:
                    per_person = (item.total_price / total).quantize(
                        Decimal("0.01"), rounding=ROUND_HALF_UP
                    )
                    for a in existing_assignments:
                        a.amount_owed = per_person

        self.db.commit()
        for a in created:
            self.db.refresh(a)
        return created

    def get_assignments(self, bill_id: str) -> list[ItemAssignment]:
        return (
            self.db.query(ItemAssignment)
            .join(ReceiptItem, ItemAssignment.receipt_item_id == ReceiptItem.id)
            .filter(ReceiptItem.bill_id == bill_id)
            .options(joinedload(ItemAssignment.item), joinedload(ItemAssignment.member))
            .all()
        )

    def update_assignment(self, assignment_id: str, data: dict) -> ItemAssignment:
        assignment = (
            self.db.query(ItemAssignment)
            .filter(ItemAssignment.id == assignment_id)
            .first()
        )
        if not assignment:
            raise ValueError(f"ItemAssignment {assignment_id} not found")

        for key, value in data.items():
            if hasattr(assignment, key):
                setattr(assignment, key, value)

        item = (
            self.db.query(ReceiptItem)
            .filter(ReceiptItem.id == assignment.receipt_item_id)
            .first()
        )
        if item:
            if assignment.share_type == "equal":
                count = (
                    self.db.query(ItemAssignment)
                    .filter(ItemAssignment.receipt_item_id == item.id)
                    .count()
                )
                assignment.amount_owed = self._calculate_amount_owed(
                    "equal", Decimal("0"), item, count
                )
            else:
                assignment.amount_owed = self._calculate_amount_owed(
                    assignment.share_type, assignment.share_value, item, 1
                )

        self.db.commit()
        self.db.refresh(assignment)
        return assignment

    def delete_assignment(self, assignment_id: str) -> None:
        assignment = (
            self.db.query(ItemAssignment)
            .filter(ItemAssignment.id == assignment_id)
            .first()
        )
        if not assignment:
            raise ValueError(f"ItemAssignment {assignment_id} not found")

        self.db.delete(assignment)
        self.db.commit()

    def auto_split(
        self, bill_id: str, member_ids: list[str] | None = None
    ) -> list[ItemAssignment]:
        # Delete existing assignments for items in this bill
        items = (
            self.db.query(ReceiptItem)
            .filter(ReceiptItem.bill_id == bill_id)
            .all()
        )
        item_ids = [item.id for item in items]

        if item_ids:
            self.db.query(ItemAssignment).filter(
                ItemAssignment.receipt_item_id.in_(item_ids)
            ).delete(synchronize_session="fetch")

        # Get members (excluding the shared invite-link placeholder row)
        if member_ids is None:
            members = (
                self.db.query(BillMember)
                .filter(
                    BillMember.bill_id == bill_id,
                    BillMember.status != "invite_link",
                )
                .all()
            )
            member_ids = [str(m.id) for m in members]

        if not member_ids:
            self.db.commit()
            return []

        num_members = len(member_ids)
        assignments = []

        for item in items:
            per_person = (item.total_price / num_members).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            for mid in member_ids:
                assignment = ItemAssignment(
                    receipt_item_id=item.id,
                    bill_member_id=mid,
                    share_type="equal",
                    share_value=Decimal("0"),
                    amount_owed=per_person,
                )
                self.db.add(assignment)
                assignments.append(assignment)

        self.db.commit()
        for a in assignments:
            self.db.refresh(a)
        return assignments

    def calculate_service_fee(self, bill_id: str) -> Decimal:
        """
        Calculate service fee based on bill's service_fee_type.
        Returns the calculated fee amount.
        """
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            return Decimal("0")

        # Use bill-specific settings or fall back to global defaults
        fee_type = bill.service_fee_type or settings.SERVICE_FEE_TYPE
        
        if fee_type == "flat":
            # Use bill's stored flat fee or global default
            flat_amount = Decimal(str(settings.SERVICE_FEE_FLAT_AMOUNT))
            return flat_amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        
        elif fee_type == "percentage":
            # Use bill's percentage or global default
            percentage = bill.service_fee_percentage or Decimal(str(settings.SERVICE_FEE_PERCENTAGE))
            # Calculate percentage of subtotal
            subtotal = bill.subtotal or Decimal("0")
            fee = (subtotal * percentage / Decimal("100")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            return fee
        
        return Decimal("0")

    def apply_service_fee(self, bill_id: str, fee_type: str | None = None, percentage: Decimal | None = None) -> Bill:
        """
        Apply service fee to a bill. 
        If fee_type and percentage are provided, update the bill's settings.
        Then calculate and store the fee amount.
        """
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        # Update bill's service fee settings if provided
        if fee_type:
            bill.service_fee_type = fee_type
        if percentage is not None:
            bill.service_fee_percentage = percentage

        # Bill total tracks the full amount the host paid.
        bill.service_fee = self.calculate_service_fee(bill_id)
        rx = bill.receipt_extra_fees or Decimal("0")
        bill.total = bill.subtotal + bill.tax + (bill.tip or Decimal("0")) + rx + bill.service_fee

        self.db.commit()
        self.db.refresh(bill)
        return bill

    def recalculate(self, bill_id: str) -> dict:
        items = (
            self.db.query(ReceiptItem)
            .filter(ReceiptItem.bill_id == bill_id)
            .all()
        )

        items_recalculated = 0
        for item in items:
            assignments = (
                self.db.query(ItemAssignment)
                .filter(ItemAssignment.receipt_item_id == item.id)
                .all()
            )
            if not assignments:
                continue

            # For mixed share types: fixed/percentage consume a known portion of the
            # item price.  The remainder is split among "equal" assignments.
            equal_assignments = [a for a in assignments if a.share_type == "equal"]
            non_equal = [a for a in assignments if a.share_type != "equal"]

            claimed = Decimal("0")
            for a in non_equal:
                a.amount_owed = self._calculate_amount_owed(
                    a.share_type, a.share_value, item, 1
                )
                claimed += a.amount_owed

            if equal_assignments:
                remainder = max(item.total_price - claimed, Decimal("0"))
                per_person = (remainder / len(equal_assignments)).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
                for a in equal_assignments:
                    a.amount_owed = per_person

            items_recalculated += 1

        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if bill:
            # Recalculate service fee based on current settings.
            bill.service_fee = self.calculate_service_fee(bill_id)
            rx = bill.receipt_extra_fees or Decimal("0")
            bill.total = bill.subtotal + bill.tax + (bill.tip or Decimal("0")) + rx + bill.service_fee

        self.db.commit()

        total = bill.total if bill else Decimal("0")
        return {"items_recalculated": items_recalculated, "total": total}

    def _is_bill_owner_member(self, member: BillMember, bill: Bill) -> bool:
        """Check if a bill member is the bill owner (host who paid upfront)."""
        return member.user_id is not None and str(member.user_id) == str(bill.owner_id)

    def get_balance_breakdown(self, bill_id: str) -> dict:
        bill = self.db.query(Bill).filter(Bill.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        # Exclude the shared invite-link placeholder row — it represents the
        # share link itself, not a real guest, and has no assignments.
        members = (
            self.db.query(BillMember)
            .filter(
                BillMember.bill_id == bill_id,
                BillMember.status != "invite_link",
            )
            .all()
        )
        member_ids = [m.id for m in members]

        bill_subtotal = bill.subtotal or Decimal("0")
        bill_tax = bill.tax or Decimal("0")
        bill_tip = bill.tip or Decimal("0")
        tip_split_mode = bill.tip_split_mode or "proportional"
        party_n = getattr(bill, "expected_party_size", None)
        use_equal_tax = party_n is not None and int(party_n) > 0
        per_guest_tax = Decimal("0")
        if use_equal_tax:
            per_guest_tax = (bill_tax / Decimal(int(party_n))).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

        bill_receipt_extra = bill.receipt_extra_fees or Decimal("0")
        bill_platform = bill.service_fee or Decimal("0")
        if bill_platform == Decimal("0") and bill_subtotal > 0:
            bill_platform = self.calculate_service_fee(bill_id)

        bill_fee = bill_receipt_extra + bill_platform

        # Aggregate assignment subtotals and succeeded-payment totals per
        # member in two queries instead of 2×N. On a bill with 10 members
        # this drops from 20 round-trips to 2.
        assignment_subtotals: dict[str, Decimal] = {}
        payment_totals: dict[str, Decimal] = {}
        if member_ids:
            from sqlalchemy import func as _func

            assignment_rows = (
                self.db.query(
                    ItemAssignment.bill_member_id,
                    _func.coalesce(_func.sum(ItemAssignment.amount_owed), 0),
                )
                .filter(ItemAssignment.bill_member_id.in_(member_ids))
                .group_by(ItemAssignment.bill_member_id)
                .all()
            )
            for mid, total in assignment_rows:
                assignment_subtotals[str(mid)] = Decimal(str(total or 0))

            payment_rows = (
                self.db.query(
                    Payment.bill_member_id,
                    _func.coalesce(_func.sum(Payment.amount), 0),
                )
                .filter(
                    Payment.bill_member_id.in_(member_ids),
                    Payment.status == "succeeded",
                )
                .group_by(Payment.bill_member_id)
                .all()
            )
            for mid, total in payment_rows:
                payment_totals[str(mid)] = Decimal(str(total or 0))

        member_breakdowns = []
        total_paid_all = Decimal("0")
        total_remaining_all = Decimal("0")

        for member in members:
            is_host = self._is_bill_owner_member(member, bill)
            subtotal = assignment_subtotals.get(str(member.id), Decimal("0"))

            if bill_subtotal > 0:
                proportion = subtotal / bill_subtotal
            else:
                proportion = Decimal("0")

            if is_host:
                tax_share = Decimal("0.00")
            elif use_equal_tax:
                tax_share = per_guest_tax
            else:
                tax_share = (proportion * bill_tax).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
            if tip_split_mode == "proportional":
                tip_share = (proportion * bill_tip).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )
            else:
                tip_share = Decimal("0.00")
            fee_share = (proportion * bill_fee).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

            # Host paid upfront -- they owe nothing
            if is_host:
                total_owed = Decimal("0")
            else:
                total_owed = subtotal + tax_share + tip_share + fee_share

            total_paid = payment_totals.get(str(member.id), Decimal("0"))
            remaining = max(total_owed - total_paid, Decimal("0"))

            total_paid_all += total_paid
            total_remaining_all += remaining

            member_breakdowns.append(
                {
                    "member_id": str(member.id),
                    "nickname": member.nickname,
                    "is_host": is_host,
                    "subtotal": subtotal,
                    "tax_share": tax_share,
                    "tip_share": tip_share,
                    "fee_share": fee_share,
                    "total_owed": total_owed,
                    "total_paid": total_paid,
                    "remaining": remaining,
                }
            )

        return {
            "members": member_breakdowns,
            "bill_total": bill.total,
            "total_paid": total_paid_all,
            "total_remaining": total_remaining_all,
        }

    def get_member_balances(self, bill_id: str) -> list[dict]:
        breakdown = self.get_balance_breakdown(bill_id)
        return [
            {
                "member_id": m["member_id"],
                "nickname": m["nickname"],
                "is_host": m["is_host"],
                "total_owed": m["total_owed"],
                "total_paid": m["total_paid"],
                "balance": m["remaining"],
            }
            for m in breakdown["members"]
        ]
