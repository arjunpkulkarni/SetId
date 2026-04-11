import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { bills as billsApi, assignments as assignmentsApi, payments as paymentsApi } from '../services/api';

const SERVICE_FEE_RATE = 0.03;
const TAX_RATE = 0.1;

const TIP_OPTIONS = [
  { label: '15%', value: 0.15 },
  { label: '18%', value: 0.18 },
  { label: '20%', value: 0.2 },
  { label: '25%', value: 0.25 },
  { label: 'CUSTOM', value: 'custom' },
];

function formatMoney(n) {
  const x = typeof n === 'string' ? parseFloat(n) : Number(n);
  if (Number.isNaN(x)) return '$0.00';
  return `$${x.toFixed(2)}`;
}

function TopBar({ insets, onBack }) {
  return (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <TouchableOpacity onPress={onBack} style={styles.topBarBtn} activeOpacity={0.7}>
        <MaterialIcons name="arrow-back" size={24} color={colors.onSurfaceVariant} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle}>Review Payment</Text>
      <View style={styles.topBarBtn} />
    </View>
  );
}

function MerchantHero({ bill, memberNickname }) {
  const name = bill?.merchant_name || bill?.title || 'Bill';
  return (
    <View style={styles.heroSection}>
      <View style={styles.heroIcon}>
        <MaterialIcons name="receipt-long" size={36} color={colors.secondary} />
      </View>
      <Text style={styles.heroName}>{name}</Text>
      <Text style={styles.heroDesc}>
        Your share{memberNickname ? ` (${memberNickname})` : ''} — review and pay below.
      </Text>
    </View>
  );
}

function ReceiptLineItem({ name, amount }) {
  return (
    <View style={styles.lineItem}>
      <View style={styles.lineItemLeft}>
        <Text style={styles.lineItemName}>{name}</Text>
        <Text style={styles.lineItemDesc}>Assigned to you</Text>
      </View>
      <Text style={styles.lineItemPrice}>{formatMoney(amount)}</Text>
    </View>
  );
}

function TonalDivider() {
  return <View style={styles.tonalDivider} />;
}

function DashedDivider() {
  return <View style={styles.dashedDivider} />;
}

function TipSelector({ selectedTip, onSelect, customAmount, onCustomChange }) {
  return (
    <View style={styles.tipSection}>
      <Text style={styles.tipLabel}>ADD A TIP</Text>
      <View style={styles.tipRow}>
        {TIP_OPTIONS.map((option) => {
          const isActive =
            option.value === 'custom'
              ? selectedTip.type === 'custom'
              : selectedTip.type === 'percent' && selectedTip.value === option.value;
          return (
            <TouchableOpacity
              key={option.label}
              onPress={() => onSelect(option)}
              activeOpacity={0.8}
              style={[styles.tipChip, isActive && styles.tipChipActive]}
            >
              <Text
                style={[
                  styles.tipChipText,
                  isActive && styles.tipChipTextActive,
                  option.value === 'custom' && styles.tipChipCustomText,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {selectedTip.type === 'custom' && (
        <TextInput
          style={styles.customTipInput}
          placeholder="Tip amount ($)"
          placeholderTextColor={colors.outlineVariant}
          keyboardType="decimal-pad"
          value={customAmount}
          onChangeText={onCustomChange}
        />
      )}
    </View>
  );
}

function BreakdownRow({ label, value }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownValue}>{value}</Text>
    </View>
  );
}

function ProgressiveReceipt({
  lineItems,
  payBase,
  selectedTip,
  onSelectTip,
  customTipStr,
  onCustomTipChange,
  tipAmount,
  serviceFee,
  tax,
  total,
}) {
  const tipLabel =
    selectedTip.type === 'custom'
      ? 'Custom'
      : `${Math.round(selectedTip.value * 100)}%`;

  return (
    <View style={[styles.receiptCard, shadows.card]}>
      {lineItems.length === 0 ? (
        <Text style={styles.emptyLines}>No line items for your share.</Text>
      ) : (
        lineItems.map((row, i) => <ReceiptLineItem key={row.key} name={row.name} amount={row.amount} />)
      )}

      <TonalDivider />

      <TipSelector
        selectedTip={selectedTip}
        onSelect={onSelectTip}
        customAmount={customTipStr}
        onCustomChange={onCustomTipChange}
      />

      <TonalDivider />

      <View style={styles.breakdownSection}>
        <BreakdownRow label="Subtotal (your share)" value={formatMoney(payBase)} />
        <BreakdownRow label="Service Fee (3%)" value={formatMoney(serviceFee)} />
        <BreakdownRow label="Tax (10%)" value={formatMoney(tax)} />
        <BreakdownRow label={`Tip (${tipLabel})`} value={formatMoney(tipAmount)} />
      </View>

      <DashedDivider />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total to Pay</Text>
        <Text style={styles.totalAmount}>{formatMoney(total)}</Text>
      </View>
    </View>
  );
}

function ParticipantStrip({ members }) {
  const shown = (members || []).slice(0, 4);
  const extra = Math.max(0, (members || []).length - 4);
  return (
    <View style={styles.detailsGrid}>
      <View style={[styles.detailCard, { flex: 1 }]}>
        <MaterialIcons name="group" size={22} color={colors.secondary} style={styles.detailIcon} />
        <Text style={styles.detailLabel}>PARTICIPANTS</Text>
        <View style={styles.participantRow}>
          {shown.map((m, i) => (
            <View key={m.id} style={[styles.participantChip, i > 0 && { marginLeft: -6 }]}>
              <Text style={styles.participantChipText} numberOfLines={1}>
                {m.nickname?.charAt(0) || '?'}
              </Text>
            </View>
          ))}
          {extra > 0 && (
            <View style={[styles.participantOverflow, { marginLeft: -6 }]}>
              <Text style={styles.participantOverflowText}>+{extra}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={[styles.detailCard, { flex: 1 }]}>
        <MaterialIcons name="security" size={22} color={colors.secondary} style={styles.detailIcon} />
        <Text style={styles.detailLabel}>SECURITY</Text>
        <Text style={styles.detailValue}>Payments processed securely via Stripe</Text>
      </View>
    </View>
  );
}

function isMockPayment(payment) {
  const id = payment?.stripe_payment_intent_id || '';
  return id.startsWith('pi_mock');
}

export default function ReviewPaymentScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const billId = route?.params?.billId;

  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState(null);
  const [members, setMembers] = useState([]);
  const [lineItems, setLineItems] = useState([]);
  const [payBase, setPayBase] = useState(0);
  const [myMember, setMyMember] = useState(null);
  const [paying, setPaying] = useState(false);

  const [selectedTip, setSelectedTip] = useState({ type: 'percent', value: 0.2 });
  const [customTipStr, setCustomTipStr] = useState('3.00');

  const load = useCallback(async () => {
    if (!billId || !user?.id) return;
    setLoading(true);
    try {
      const [sumRes, assignRes, payRes] = await Promise.all([
        billsApi.getSummary(billId),
        assignmentsApi.list(billId),
        paymentsApi.listForBill(billId),
      ]);

      const data = sumRes.data;
      const b = data.bill;
      const mems = data.members ?? [];
      setBill(b);
      setMembers(mems);

      const uid = String(user.id);
      const me = mems.find((m) => m.user_id != null && String(m.user_id) === uid);
      setMyMember(me || null);

      const assignments = assignRes.data ?? [];
      const payments = payRes.data ?? [];

      if (!me) {
        setLineItems([]);
        setPayBase(0);
        setLoading(false);
        return;
      }

      const mine = assignments.filter((a) => String(a.bill_member_id) === String(me.id));
      const rows = mine.map((a, idx) => ({
        key: `${a.id}-${idx}`,
        name: a.item_name || 'Item',
        amount: parseFloat(a.amount_owed ?? 0),
      }));
      setLineItems(rows);

      const owed = rows.reduce((s, r) => s + r.amount, 0);
      const paid = payments
        .filter((p) => String(p.bill_member_id) === String(me.id) && p.status === 'succeeded')
        .reduce((s, p) => s + parseFloat(p.amount ?? 0), 0);
      setPayBase(Math.max(0, owed - paid));
    } catch {
      setBill(null);
    } finally {
      setLoading(false);
    }
  }, [billId, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const tipAmount =
    selectedTip.type === 'custom'
      ? Math.max(0, parseFloat(customTipStr) || 0)
      : payBase * selectedTip.value;

  const serviceFee = payBase * SERVICE_FEE_RATE;
  const tax = payBase * TAX_RATE;
  const total = payBase + serviceFee + tax + tipAmount;

  const handleSelectTip = useCallback((option) => {
    if (option.value === 'custom') {
      setSelectedTip({ type: 'custom', value: 'custom' });
    } else {
      setSelectedTip({ type: 'percent', value: option.value });
    }
  }, []);

  const runPayment = async () => {
    if (!billId || !myMember || payBase <= 0) {
      Alert.alert('Nothing to pay', 'You have no remaining balance on this bill.');
      return;
    }
    if (total <= 0) {
      Alert.alert('Invalid total', 'Amount must be greater than zero.');
      return;
    }

    setPaying(true);
    try {
      const createRes = await paymentsApi.createIntent({
        billId,
        memberId: myMember.id,
        amount: total.toFixed(2),
        currency: bill?.currency || 'USD',
      });
      const payment = createRes.data;

      const finish = async () => {
        await paymentsApi.confirm(payment.id);
        navigation.replace('FundsCollected', {
          amount: total,
          merchantName: bill?.merchant_name || bill?.title,
          billTitle: bill?.title,
          billId,
        });
      };

      if (isMockPayment(payment)) {
        Alert.alert(
          'Complete payment',
          `Charge ${formatMoney(total)}? (Stripe is not configured — this records a test payment.)`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Pay',
              onPress: () =>
                finish().catch((e) => Alert.alert('Error', e?.error?.message ?? 'Failed to confirm')),
            },
          ],
        );
      } else {
        Alert.alert(
          'Payment intent created',
          'Use Stripe PaymentSheet with the client secret from this response. In __DEV__ you can still confirm without charging a card.',
          [
            { text: 'Cancel', style: 'cancel' },
            ...(typeof __DEV__ !== 'undefined' && __DEV__
              ? [
                  {
                    text: 'Confirm (dev)',
                    onPress: () =>
                      finish().catch((e) => Alert.alert('Error', e?.error?.message ?? 'Failed')),
                  },
                ]
              : []),
          ],
        );
      }
    } catch (err) {
      Alert.alert('Payment failed', err?.error?.message ?? 'Could not start payment');
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  if (!bill || !myMember) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.errorText}>
          {!bill ? 'Bill not found.' : "You're not on this bill as a member."}
        </Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={styles.linkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TopBar insets={insets} onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <MerchantHero bill={bill} memberNickname={myMember.nickname} />
        <ProgressiveReceipt
          lineItems={lineItems}
          payBase={payBase}
          selectedTip={selectedTip}
          onSelectTip={handleSelectTip}
          customTipStr={customTipStr}
          onCustomTipChange={setCustomTipStr}
          tipAmount={tipAmount}
          serviceFee={serviceFee}
          tax={tax}
          total={total}
        />

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={runPayment}
          disabled={paying || payBase <= 0}
          style={payBase <= 0 ? { opacity: 0.5 } : null}
        >
          <LinearGradient
            colors={[colors.secondary, colors.secondaryDim]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.payPrimary, shadows.settleButton]}
          >
            {paying ? (
              <ActivityIndicator color={colors.onSecondary} />
            ) : (
              <>
                <MaterialIcons name="lock" size={20} color={colors.onSecondary} />
                <Text style={styles.payPrimaryText}>
                  {payBase <= 0 ? 'Nothing owed' : `Pay ${formatMoney(total)}`}
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.payHint}>
          {payBase > 0
            ? 'Uses your saved payment flow. Without Stripe keys, payments are recorded as test transactions.'
            : 'Your share is fully paid or has no assigned items.'}

        </Text>

        <ParticipantStrip members={members} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  linkText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: colors.secondary,
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    minHeight: 56,
    backgroundColor: 'rgba(248, 249, 250, 0.7)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(248, 249, 250, 0.92)' },
    }),
  },
  topBarBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

  heroSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  heroName: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1,
    color: colors.onSurface,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroDesc: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },

  receiptCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 28,
    marginBottom: 20,
  },
  emptyLines: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingVertical: 8,
  },

  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  lineItemLeft: {
    flex: 1,
    marginRight: 16,
  },
  lineItemName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 3,
  },
  lineItemDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  lineItemPrice: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },

  tonalDivider: {
    height: 1,
    backgroundColor: colors.surfaceContainerLow,
    marginVertical: 20,
  },
  dashedDivider: {
    height: 1,
    backgroundColor: colors.surfaceContainerHigh,
    marginTop: 20,
    marginBottom: 16,
  },

  tipSection: {
    gap: 14,
  },
  tipLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
  },
  tipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tipChip: {
    flexGrow: 1,
    minWidth: '18%',
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(171, 179, 183, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipChipActive: {
    borderColor: colors.secondary,
    backgroundColor: 'rgba(0, 108, 92, 0.08)',
  },
  tipChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  tipChipTextActive: {
    color: colors.secondary,
  },
  tipChipCustomText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  customTipInput: {
    marginTop: 4,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    color: colors.onSurface,
  },

  breakdownSection: {
    gap: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
  },
  breakdownValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.onSurface,
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  totalLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },
  totalAmount: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: colors.secondary,
  },

  payPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 56,
    borderRadius: radii.full,
    marginBottom: 12,
  },
  payPrimaryText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 17,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  payHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.outlineVariant,
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 18,
  },

  detailsGrid: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 24,
  },
  detailCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 20,
  },
  detailIcon: {
    marginBottom: 10,
  },
  detailLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 8,
  },
  detailValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSurface,
    lineHeight: 17,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  participantChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surfaceContainerLow,
  },
  participantChipText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    color: colors.secondary,
  },
  participantOverflow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.surfaceContainerLow,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantOverflowText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },
});
