import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function MerchantHeader({ bill }) {
  const billTitle = bill.title || bill.merchant_name;
  const merchant = bill.merchant_name || bill.title;
  
  return (
    <View style={styles.merchantHeader}>
      <View style={styles.merchantLeft}>
        <Text style={styles.splittingLabel}>Splitting Bill From</Text>
        <Text style={styles.merchantName}>{merchant}</Text>
        <Text style={styles.merchantDate}>{formatDate(bill.created_at)}</Text>
      </View>
      <View style={styles.totalBadge}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalAmount}>{formatCurrency(bill.total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  merchantHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 32,
  },
  merchantLeft: {
    flex: 1,
    marginRight: 16,
  },
  splittingLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
    marginBottom: 6,
  },
  merchantName: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
    color: colors.onSurface,
    lineHeight: 34,
  },
  merchantDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    marginTop: 6,
  },
  totalBadge: {
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: radii.xl,
    alignItems: 'center',
    minWidth: 100,
  },
  totalLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
    marginBottom: 2,
  },
  totalAmount: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 20,
    fontWeight: '800',
    color: colors.secondary,
  },
});