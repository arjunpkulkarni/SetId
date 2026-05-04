/** Shared subtotal / tax / tip math for bill split — keep MembersSummary and BottomActions aligned. */

export function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

export function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

export function resolveHostUserId(bill) {
  return bill?.owner_id != null ? String(bill.owner_id) : null;
}

export function resolvePartyN(bill) {
  const raw = bill?.expected_party_size;
  return raw != null && Number.isFinite(Number(raw)) ? Math.max(0, Number(raw)) : null;
}

/** Bill subtotal for splits: trust API when > 0; else fall back to sum of assignments (subtotal `0` is valid-ish from API but breaks proportions). */
export function effectiveBillSubtotal(bill, allAssignedSubtotal) {
  const fromBill = parsePriceValue(bill?.subtotal);
  if (fromBill > 0) return fromBill;
  return allAssignedSubtotal > 0 ? allAssignedSubtotal : 0;
}

/**
 * Use stored `bill.tax` when present; otherwise infer from
 * `total - subtotal - tip - service_fee - receipt_extra_fees` when subtotal is known (covers stale/empty tax on the row).
 */
export function effectiveBillTax(bill, billSubtotalForResidual) {
  let t = parsePriceValue(bill?.tax);
  if (t > 0) return t;
  if (!bill || billSubtotalForResidual <= 0) return 0;
  const total = parsePriceValue(bill.total);
  const tip = parsePriceValue(bill.tip ?? 0);
  const platform = parsePriceValue(bill.service_fee ?? 0);
  const extra = parsePriceValue(bill.receipt_extra_fees ?? 0);
  const implied = roundMoney(total - billSubtotalForResidual - tip - platform - extra);
  if (implied > 0.005 && implied < total) return implied;
  return 0;
}

/**
 * @param {object} member — bill member with `id`, optional `user_id`
 * @param {object} opts
 * @param {object[]} opts.serverAssignments
 * @param {object|null} opts.bill
 * @param {string|null} opts.hostUserId
 * @param {number|null} opts.partyN — expected_party_size when set
 */
export function computeMemberMoneyBreakdown(member, { serverAssignments, bill, hostUserId, partyN }) {
  const isHost = hostUserId != null && member.user_id != null && String(member.user_id) === hostUserId;

  const mAssignments = serverAssignments.filter(
    (a) => String(a.bill_member_id) === String(member.id),
  );
  const subtotal = mAssignments.reduce((s, a) => s + parsePriceValue(a.amount_owed), 0);
  const itemCount = mAssignments.length;

  const allItemsSubtotal = serverAssignments.reduce(
    (s, a) => s + parsePriceValue(a.amount_owed),
    0,
  );
  const billSubtotal = effectiveBillSubtotal(bill, allItemsSubtotal);
  const subtotalForTaxResidual = parsePriceValue(bill?.subtotal) > 0
    ? parsePriceValue(bill.subtotal)
    : billSubtotal;
  const billTax = effectiveBillTax(bill, subtotalForTaxResidual);
  const billTip =
    bill?.tip_split_mode === 'proportional' ? parsePriceValue(bill?.tip ?? 0) : 0;
  const receiptExtra = parsePriceValue(bill?.receipt_extra_fees ?? 0);
  const platformFee = parsePriceValue(bill?.service_fee ?? 0);
  const billCombinedFees = receiptExtra + platformFee;

  const proportion = billSubtotal > 0 ? subtotal / billSubtotal : 0;

  let taxShare;
  let tipShare;
  let feeShare;
  if (isHost) {
    // Item-weighted share of tax/tip so host sees the same "your portion of the
    // check" as on the receipt (collection logic on the server may differ).
    taxShare = billTax * proportion;
    tipShare = billTip * proportion;
    feeShare = billCombinedFees * proportion;
  } else if (partyN && partyN > 0) {
    taxShare = billTax / partyN;
    tipShare = billTip * proportion;
    feeShare = billCombinedFees * proportion;
  } else {
    taxShare = billTax * proportion;
    tipShare = billTip * proportion;
    feeShare = billCombinedFees * proportion;
  }

  const overheadShare = taxShare + tipShare + feeShare;
  const total = roundMoney(subtotal + overheadShare);

  return {
    subtotal: roundMoney(subtotal),
    overheadShare: roundMoney(overheadShare),
    total,
    itemCount,
    taxShare: roundMoney(taxShare),
    tipShare: roundMoney(tipShare),
    feeShare: roundMoney(feeShare),
  };
}

/** Equal-split per-person amount from persisted assignments (avoids 26.99/2 → 13.49 vs 13.50 drift). */
export function equalSplitAmountFromServer(itemId, assignedMemberIds, serverAssignments) {
  if (!assignedMemberIds?.length || !serverAssignments?.length) return null;
  const idSet = new Set(assignedMemberIds.map((x) => String(x)));
  const rows = serverAssignments.filter(
    (a) => String(a.receipt_item_id) === String(itemId) && idSet.has(String(a.bill_member_id)),
  );
  if (rows.length !== assignedMemberIds.length) return null;
  const amounts = rows.map((r) => roundMoney(parsePriceValue(r.amount_owed)));
  const first = amounts[0];
  if (amounts.some((v) => v !== first)) return null;
  return first;
}
