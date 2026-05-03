import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii } from '../../theme';

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

export function MembersSummary({ members, serverAssignments, bill }) {
  const hostUserId = bill?.owner_id != null ? String(bill.owner_id) : null;
  const partyNRaw = bill?.expected_party_size;
  const partyN =
    partyNRaw != null && Number.isFinite(Number(partyNRaw)) ? Math.max(0, Number(partyNRaw)) : null;

  // Sum amount_owed from backend assignments per member
  const allItemsSubtotal = serverAssignments.reduce(
    (s, a) => s + parsePriceValue(a.amount_owed), 0,
  );
  const billSubtotal = parsePriceValue(bill?.subtotal ?? allItemsSubtotal);
  const billTax = parsePriceValue(bill?.tax ?? 0);
  const billTip = bill?.tip_split_mode === 'proportional'
    ? parsePriceValue(bill?.tip ?? 0)
    : 0;

  const memberTotals = members.map((m) => {
    const isHost = hostUserId != null && m.user_id != null && String(m.user_id) === hostUserId;

    const mAssignments = serverAssignments.filter(
      (a) => String(a.bill_member_id) === String(m.id),
    );
    const subtotal = mAssignments.reduce(
      (s, a) => s + parsePriceValue(a.amount_owed), 0,
    );
    const itemCount = mAssignments.length;
    const proportion = billSubtotal > 0 ? subtotal / billSubtotal : 0;

    let taxShare;
    let tipShare;
    if (isHost) {
      taxShare = 0;
      tipShare = 0;
    } else if (partyN && partyN > 0) {
      taxShare = billTax / partyN;
      tipShare = billTip * proportion;
    } else {
      taxShare = billTax * proportion;
      tipShare = billTip * proportion;
    }

    const overheadShare = taxShare + tipShare;
    const total = roundMoney(subtotal + overheadShare);
    return { ...m, subtotal: roundMoney(subtotal), overheadShare: roundMoney(overheadShare), total, itemCount };
  });

  return (
    <View style={styles.membersSection}>
      <Text style={styles.membersTitle}>Members</Text>
      {memberTotals.map((m) => (
        <View key={m.id} style={styles.memberRow}>
          <View style={styles.memberLeft}>
            <View style={styles.memberAvatarWrap}>
              <MaterialIcons name="person" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View>
              <Text style={styles.memberName}>{m.nickname}</Text>
              <Text style={styles.memberItemCount}>
                {m.itemCount} {m.itemCount === 1 ? 'Item' : 'Items'}
                {m.overheadShare > 0 ? ` · incl. ${formatCurrency(m.overheadShare)} tax/tip` : ''}
              </Text>
            </View>
          </View>
          <Text style={styles.memberAmount}>{formatCurrency(m.total)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  membersSection: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 16,
  },
  membersTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 20,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  memberItemCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  memberAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },
});