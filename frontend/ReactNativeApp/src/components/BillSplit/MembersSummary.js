import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, radii } from '../../theme';
import {
  computeMemberMoneyBreakdown,
  resolveHostUserId,
  resolvePartyN,
} from './memberMoneyBreakdown';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

export function MembersSummary({ members, serverAssignments, bill }) {
  const hostUserId = resolveHostUserId(bill);
  const partyN = resolvePartyN(bill);

  const memberTotals = members.map((m) => {
    const b = computeMemberMoneyBreakdown(m, {
      serverAssignments,
      bill,
      hostUserId,
      partyN,
    });
    return { ...m, ...b };
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
