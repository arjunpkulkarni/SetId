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

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Sticky footer: assigned line items + items subtotal, tax / tip (tip only when
 * bill has proportional tip > 0), and total — before host taps Next.
 */
export function BottomActions({
  insets,
  items,
  assignmentMap,
  serverAssignments,
  bill,
  onSend,
  isHost,
}) {
  const totalLines = items.length;
  const assignedLines = items.filter((i) => (assignmentMap[i.id] || []).length > 0).length;

  const assignedSubtotal = serverAssignments.reduce(
    (s, a) => s + parsePriceValue(a.amount_owed),
    0,
  );

  const breakdown = useMemo(() => {
    const billSubtotal = parsePriceValue(bill?.subtotal ?? assignedSubtotal);
    const billTax = parsePriceValue(bill?.tax ?? 0);
    const billTip =
      bill?.tip_split_mode === 'proportional'
        ? parsePriceValue(bill?.tip ?? 0)
        : 0;
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
      taxShare,
      tipShare,
      total,
    };
  }, [bill, items, assignmentMap, serverAssignments, assignedSubtotal]);

  const { itemRows, taxShare, tipShare, total } = breakdown;
  const showTax = taxShare > 0;
  const showTip = tipShare > 0;

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
      ) : null}

      <View style={styles.divider} />

      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownLabel}>Subtotal (items)</Text>
        <Text style={styles.breakdownValue}>{formatCurrency(assignedSubtotal)}</Text>
      </View>
      {showTax ? (
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Tax (assigned share)</Text>
          <Text style={styles.breakdownValue}>{formatCurrency(taxShare)}</Text>
        </View>
      ) : null}
      {showTip ? (
        <View style={styles.breakdownRow}>
          <Text style={styles.breakdownLabel}>Tip (assigned share)</Text>
          <Text style={styles.breakdownValue}>{formatCurrency(tipShare)}</Text>
        </View>
      ) : null}

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
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
