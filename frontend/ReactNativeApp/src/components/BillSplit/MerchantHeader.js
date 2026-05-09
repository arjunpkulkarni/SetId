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

// Format "Rp 500,000" / "€42.50" / "¥6,200" for the small hint we show
// underneath the USD total when the receipt was scanned in a non-USD
// currency. Uses Intl.NumberFormat so we get correct symbol placement
// (some currencies prefix, some suffix) and correct fractional digits
// (JPY/KRW/VND etc. have none, BHD/JOD have three) without a lookup
// table on our side.
function formatNativeAmount(amount, currency) {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  if (!Number.isFinite(num) || !currency) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).format(num);
  } catch {
    // Older RN runtimes / unknown currency code → fall back to a plain
    // "<amount> <code>" so the hint still renders something useful.
    return `${num.toLocaleString('en-US')} ${currency}`;
  }
}

export function MerchantHeader({ bill }) {
  const billTitle = bill.title || bill.merchant_name;
  const merchant = bill.merchant_name || bill.title;

  // The receipt parser stamps these three fields on the bill ONLY when
  // the photo was scanned in a non-USD currency (Bali / Singapore /
  // London / etc.). The USD figure shown in the badge is already
  // converted; this hint is purely so the host can sanity-check the
  // conversion against the printed receipt.
  const hasOriginal =
    bill?.original_currency &&
    bill.original_currency !== 'USD' &&
    bill?.original_total != null;
  const nativeHint = hasOriginal
    ? formatNativeAmount(bill.original_total, bill.original_currency)
    : '';

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
        {hasOriginal && nativeHint ? (
          <Text style={styles.totalNativeHint} numberOfLines={1}>
            ≈ {nativeHint}
          </Text>
        ) : null}
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
  // Small "≈ Rp 500,000" hint that sits below the USD total on bills
  // scanned in a non-USD currency. Uses the same muted color as the
  // "TOTAL" label so it doesn't compete visually with the headline.
  totalNativeHint: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    marginTop: 4,
    letterSpacing: 0.2,
    maxWidth: 140,
    textAlign: 'center',
  },
});