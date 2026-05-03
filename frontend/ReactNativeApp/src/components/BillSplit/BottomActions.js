import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii, shadows } from '../../theme';
import {
  computeMemberMoneyBreakdown,
  effectiveBillSubtotal,
  effectiveBillTax,
  parsePriceValue,
  resolveHostUserId,
  resolvePartyN,
  roundMoney,
} from './memberMoneyBreakdown';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

/**
 * Sticky footer on assign-items: shows the host’s own line items + subtotal +
 * tax/tip/total only for the host (same math as MembersSummary). Full bill +
 * collection live on Review Payment (next step).
 */
export function BottomActions({
  insets,
  items,
  assignmentMap,
  serverAssignments,
  bill,
  members,
  onSend,
  isHost,
}) {
  const totalLines = items.length;
  const assignedLines = items.filter((i) => (assignmentMap[i.id] || []).length > 0).length;

  const hostUserId = resolveHostUserId(bill);
  const partyN = resolvePartyN(bill);
  const hostMember = useMemo(() => {
    if (!hostUserId || !members?.length) return null;
    return members.find((m) => m.user_id != null && String(m.user_id) === hostUserId) ?? null;
  }, [hostUserId, members]);

  const breakdown = useMemo(() => {
    if (isHost && hostMember) {
      const mine = computeMemberMoneyBreakdown(hostMember, {
        serverAssignments,
        bill,
        hostUserId,
        partyN,
      });
      const hostIdStr = String(hostMember.id);

      const itemRows = items
        .filter((item) =>
          serverAssignments.some(
            (a) =>
              String(a.receipt_item_id) === String(item.id) &&
              String(a.bill_member_id) === hostIdStr,
          ),
        )
        .map((item) => {
          const lineTotal = serverAssignments
            .filter(
              (a) =>
                String(a.receipt_item_id) === String(item.id) &&
                String(a.bill_member_id) === hostIdStr,
            )
            .reduce((s, a) => s + parsePriceValue(a.amount_owed), 0);
          return {
            id: item.id,
            name: item.name || 'Item',
            amount: roundMoney(lineTotal),
          };
        })
        .filter((row) => row.amount > 0);

      return {
        itemRows,
        subtotal: mine.subtotal,
        taxShare: mine.taxShare,
        tipShare: mine.tipShare,
        total: mine.total,
        mode: 'host',
      };
    }

    // Legacy: guest or missing host mapping — keep prior aggregate behavior
    const assignedSubtotal = serverAssignments.reduce(
      (s, a) => s + parsePriceValue(a.amount_owed),
      0,
    );
    const billSubtotal = effectiveBillSubtotal(bill, assignedSubtotal);
    const subForTax = parsePriceValue(bill?.subtotal) > 0 ? parsePriceValue(bill.subtotal) : billSubtotal;
    const billTax = effectiveBillTax(bill, subForTax);
    const billTip =
      bill?.tip_split_mode === 'proportional' ? parsePriceValue(bill?.tip ?? 0) : 0;
    const proportion =
      billSubtotal > 0 ? Math.min(1, assignedSubtotal / billSubtotal) : 0;
    const taxShare = roundMoney(billTax * proportion);
    const tipShare = roundMoney(billTip * proportion);
    const total = roundMoney(assignedSubtotal + taxShare + tipShare);

    const itemRows = items
      .filter((i) => (assignmentMap[i.id] || []).length > 0)
      .map((item) => {
        const lineTotal = serverAssignments
          .filter((a) => String(a.receipt_item_id) === String(item.id))
          .reduce((s, a) => s + parsePriceValue(a.amount_owed), 0);
        return {
          id: item.id,
          name: item.name || 'Item',
          amount: roundMoney(lineTotal),
        };
      })
      .filter((row) => row.amount > 0);

    return {
      itemRows,
      subtotal: assignedSubtotal,
      taxShare,
      tipShare,
      total,
      mode: 'aggregate',
    };
  }, [
    isHost,
    hostMember,
    bill,
    items,
    assignmentMap,
    serverAssignments,
    hostUserId,
    partyN,
  ]);

  const { itemRows, subtotal, taxShare, tipShare, total, mode } = breakdown;
  const showTax = taxShare > 0;
  const showTip = tipShare > 0;
  const subtotalLabel =
    mode === 'host' ? 'Subtotal (your items)' : 'Subtotal (items)';
  const totalLabel = mode === 'host' ? 'Your total' : 'Total';

  return (
    <View style={[styles.bottomActions, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <Text style={styles.assignedCount} numberOfLines={1}>
        {assignedLines} of {totalLines} items assigned
      </Text>

      {itemRows.length > 0 ? (
        <ScrollView
          style={styles.itemsScroll}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={itemRows.length > 4}
        >
          {itemRows.map((row) => (
            <View key={String(row.id)} style={styles.lineRow}>
              <Text style={styles.lineName} numberOfLines={2}>
                {row.name}
              </Text>
              <Text style={styles.lineAmount}>{formatCurrency(row.amount)}</Text>
            </View>
          ))}
        </ScrollView>
      ) : mode === 'host' ? (
        <Text style={styles.hostOnlyHint}>
          Nothing assigned to you yet — your total is $0.00 until you add yourself to items.
        </Text>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>{subtotalLabel}</Text>
        <Text style={styles.breakdownValue}>{formatCurrency(subtotal)}</Text>
      </View>
      {showTax ? (
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Tax</Text>
          <Text style={styles.breakdownValue}>{formatCurrency(taxShare)}</Text>
        </View>
      ) : null}
      {showTip ? (
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Tip (your share)</Text>
          <Text style={styles.breakdownValue}>{formatCurrency(tipShare)}</Text>
        </View>
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>{totalLabel}</Text>
        <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
      </View>

      <TouchableOpacity activeOpacity={0.85} onPress={onSend}>
        <LinearGradient
          colors={[colors.secondary, colors.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.sendButton, shadows.sendButton]}
        >
          <Text style={styles.sendButtonText}>
            {isHost ? 'Next' : 'Submit My Items'}
          </Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(255, 255, 255, 0.95)' },
    }),
    paddingHorizontal: 24,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
  },
  assignedCount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    marginBottom: 8,
  },
  hostOnlyHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginBottom: 8,
    lineHeight: 16,
  },
  itemsScroll: {
    maxHeight: 140,
    marginBottom: 8,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
  },
  lineName: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurface,
  },
  lineAmount: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.outlineVariant,
    marginBottom: 10,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  breakdownLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
  },
  breakdownValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 14,
  },
  totalLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
  },
  totalAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
  },
  sendButton: {
    paddingVertical: 18,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});
