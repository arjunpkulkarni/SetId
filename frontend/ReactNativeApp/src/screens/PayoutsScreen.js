import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, shadows } from '../theme';
import { stripeConnect } from '../services/api';

function formatUsd(cents) {
  const num = (Number(cents) || 0) / 100;
  return `$${num.toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

// Human-friendly mapping of Stripe payout statuses.
const STATUS_META = {
  paid: { label: 'Paid', color: colors.secondary, icon: 'check-circle' },
  pending: { label: 'Pending', color: colors.onSurfaceVariant, icon: 'schedule' },
  in_transit: { label: 'In transit', color: colors.secondary, icon: 'sync' },
  failed: { label: 'Failed', color: colors.error, icon: 'error-outline' },
  canceled: { label: 'Canceled', color: colors.onSurfaceVariant, icon: 'cancel' },
};

/**
 * Translate a Stripe `requirements.currently_due` / `past_due` key into
 * a sentence the host can act on. Covers the common items we see on
 * Custom accounts in practice. Unknown keys fall back to the raw path
 * so we never silently hide a requirement.
 */
function describeRequirement(key) {
  const map = {
    'external_account': 'Add a debit card for payouts.',
    'individual.verification.document': 'Upload a photo of your ID.',
    'individual.verification.additional_document': 'Upload an additional document (utility bill or bank statement).',
    'individual.id_number': 'Provide your full SSN.',
    'individual.ssn_last_4': 'Provide the last 4 of your SSN.',
    'individual.first_name': 'Provide your first name.',
    'individual.last_name': 'Provide your last name.',
    'individual.dob.day': 'Provide your date of birth.',
    'individual.dob.month': 'Provide your date of birth.',
    'individual.dob.year': 'Provide your date of birth.',
    'individual.address.line1': 'Provide your street address.',
    'individual.address.city': 'Provide your city.',
    'individual.address.state': 'Provide your state.',
    'individual.address.postal_code': 'Provide your ZIP code.',
    'individual.phone': 'Provide your phone number.',
    'individual.email': 'Provide your email address.',
    'tos_acceptance.date': 'Re-accept the Stripe terms.',
    'tos_acceptance.ip': 'Re-accept the Stripe terms.',
    'business_profile.url': 'Add a business website.',
    'business_profile.mcc': 'Select a business category.',
  };
  return map[key] || key;
}

export default function PayoutsScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState(false);

  const [status, setStatus] = useState(null);
  const [balanceCents, setBalanceCents] = useState(0);
  const [payouts, setPayouts] = useState([]);
  const [amount, setAmount] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshAll = useCallback(async () => {
    // Status first — if not connected, skip balance/payouts fetches (would
    // either 409 or just return empty).
    try {
      const statusRes = await stripeConnect.getStatus();
      if (!mountedRef.current) return;
      const s = statusRes?.data ?? null;
      setStatus(s);

      if (s?.connected && s?.payouts_enabled) {
        const [balanceRes, payoutsRes] = await Promise.all([
          stripeConnect.getBalance().catch(() => null),
          stripeConnect.listPayouts().catch(() => null),
        ]);
        if (!mountedRef.current) return;
        setBalanceCents(balanceRes?.data?.instant_available_cents ?? 0);
        setPayouts(Array.isArray(payoutsRes?.data) ? payoutsRes.data : []);
      } else {
        setBalanceCents(0);
        // Still load history even if payouts are currently disabled —
        // user may want to see past successful payouts.
        const payoutsRes = await stripeConnect.listPayouts().catch(() => null);
        if (!mountedRef.current) return;
        setPayouts(Array.isArray(payoutsRes?.data) ? payoutsRes.data : []);
      }
    } catch (err) {
      if (__DEV__) console.warn('[Payouts] refresh failed', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      refreshAll().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [refreshAll]),
  );

  const onPullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  }, [refreshAll]);

  // Opens the in-app setup form (Custom accounts — no browser redirect).
  // Refresh status when we come back so the card goes green immediately if
  // Stripe enabled payouts.
  const handleStartOnboarding = () => {
    navigation.navigate('SetupPayouts', {
      onComplete: () => refreshAll(),
    });
  };

  const handleCashOut = async () => {
    if (paying) return;

    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive dollar amount.');
      return;
    }
    const cents = Math.round(parsed * 100);
    if (cents < 50) {
      Alert.alert('Too small', 'Minimum instant payout is $0.50.');
      return;
    }
    if (cents > balanceCents) {
      Alert.alert(
        'Amount too high',
        `You have ${formatUsd(balanceCents)} available for instant payout.`,
      );
      return;
    }

    setPaying(true);
    try {
      await stripeConnect.createPayout({ amount_cents: cents, currency: 'usd' });
      setAmount('');
      await refreshAll();
      Alert.alert(
        'Payout sent',
        'Funds typically land on your debit card within 30 minutes.',
      );
    } catch (err) {
      Alert.alert(
        'Payout failed',
        err?.error?.message ?? err?.message ?? 'Please try again.',
      );
    } finally {
      setPaying(false);
    }
  };

  // ── UI subsections ────────────────────────────────────────────────────

  const renderStatusCard = () => {
    if (!status || !status.connected) {
      return (
        <View style={[styles.statusCard, styles.statusCardInactive, shadows.card]}>
          <View style={styles.statusIconWrap}>
            <MaterialIcons name="account-balance" size={22} color={colors.onSurfaceVariant} />
          </View>
          <View style={styles.statusTextCol}>
            <Text style={styles.statusTitle}>Not connected</Text>
            <Text style={styles.statusSubtitle}>
              Connect a debit card to receive payouts from bills you host.
            </Text>
          </View>
        </View>
      );
    }

    if (!status.details_submitted) {
      return (
        <View style={[styles.statusCard, styles.statusCardPending, shadows.card]}>
          <View style={styles.statusIconWrap}>
            <MaterialIcons name="hourglass-top" size={22} color={colors.tertiary} />
          </View>
          <View style={styles.statusTextCol}>
            <Text style={styles.statusTitle}>Finish onboarding</Text>
            <Text style={styles.statusSubtitle}>
              Resume Stripe verification so we can pay you out.
            </Text>
          </View>
        </View>
      );
    }

    if (!status.payouts_enabled) {
      // Prefer `past_due` (account is blocked) over `currently_due` (soon-
      // due) when building the human-readable list. Fall back to the
      // generic disabled_reason only if we have neither.
      const blocking = Array.isArray(status.requirements_past_due) && status.requirements_past_due.length > 0
        ? status.requirements_past_due
        : Array.isArray(status.requirements_due) ? status.requirements_due : [];
      return (
        <View style={[styles.statusCard, styles.statusCardPending, shadows.card]}>
          <View style={styles.statusIconWrap}>
            <MaterialIcons name="warning-amber" size={22} color={colors.tertiary} />
          </View>
          <View style={styles.statusTextCol}>
            <Text style={styles.statusTitle}>Verification pending</Text>
            {blocking.length > 0 ? (
              <>
                <Text style={styles.statusSubtitle}>
                  Stripe still needs:
                </Text>
                {blocking.slice(0, 4).map((req) => (
                  <Text key={req} style={styles.statusRequirement}>
                    • {describeRequirement(req)}
                  </Text>
                ))}
                {blocking.length > 4 && (
                  <Text style={styles.statusRequirement}>
                    + {blocking.length - 4} more
                  </Text>
                )}
              </>
            ) : (
              <Text style={styles.statusSubtitle}>
                Your account needs attention before payouts can run.
              </Text>
            )}
          </View>
        </View>
      );
    }

    const cardDesc =
      status.external_account_last4
        ? `${status.external_account_brand ?? 'Card'} •• ${status.external_account_last4}`
        : 'Payouts active';

    return (
      <View style={[styles.statusCard, styles.statusCardActive, shadows.card]}>
        <View style={styles.statusIconWrap}>
          <MaterialIcons name="verified" size={22} color={colors.secondary} />
        </View>
        <View style={styles.statusTextCol}>
          <Text style={styles.statusTitle}>Payouts active</Text>
          <Text style={styles.statusSubtitle}>{cardDesc}</Text>
        </View>
      </View>
    );
  };

  const renderBalanceCard = () => {
    const canInstantPayout =
      status?.connected
      && status?.payouts_enabled
      && status?.has_instant_external_account;

    return (
      <View style={[styles.balanceCard, shadows.card]}>
        <Text style={styles.balanceLabel}>Available for instant payout</Text>
        <Text style={styles.balanceAmount}>{formatUsd(balanceCents)}</Text>

        {!status?.connected ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleStartOnboarding}
            style={styles.primaryBtn}
          >
            <LinearGradient
              colors={[colors.secondary, colors.secondaryDim]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryBtnGradient}
            >
              <MaterialIcons name="account-balance" size={18} color={colors.onSecondary} />
              <Text style={styles.primaryBtnText}>Connect a debit card</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : !status.details_submitted || !status.payouts_enabled ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleStartOnboarding}
            style={styles.primaryBtn}
          >
            <LinearGradient
              colors={[colors.secondary, colors.secondaryDim]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryBtnGradient}
            >
              <MaterialIcons name="arrow-forward" size={18} color={colors.onSecondary} />
              <Text style={styles.primaryBtnText}>
                {status.details_submitted ? 'Update card info' : 'Finish setup'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.amountRow}>
              <Text style={styles.amountPrefix}>$</Text>
              <TextInput
                style={styles.amountInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.outline}
                value={amount}
                onChangeText={setAmount}
                editable={!paying && canInstantPayout}
                returnKeyType="done"
              />
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setAmount((balanceCents / 100).toFixed(2))}
                disabled={!canInstantPayout || balanceCents === 0}
                style={styles.maxButton}
              >
                <Text
                  style={[
                    styles.maxButtonText,
                    (!canInstantPayout || balanceCents === 0) && styles.maxButtonTextDisabled,
                  ]}
                >
                  MAX
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleCashOut}
              disabled={paying || !canInstantPayout || balanceCents === 0}
              style={[
                styles.primaryBtn,
                (!canInstantPayout || balanceCents === 0) && styles.primaryBtnDisabled,
              ]}
            >
              <LinearGradient
                colors={[colors.secondary, colors.secondaryDim]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.primaryBtnGradient}
              >
                {paying ? (
                  <ActivityIndicator color={colors.onSecondary} />
                ) : (
                  <>
                    <MaterialIcons name="flash-on" size={18} color={colors.onSecondary} />
                    <Text style={styles.primaryBtnText}>Cash out instantly</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {!status.has_instant_external_account && (
              <Text style={styles.hint}>
                Add a debit card that supports instant payouts to enable this.
              </Text>
            )}
          </>
        )}
      </View>
    );
  };

  const renderHistory = () => {
    if (!payouts.length) return null;
    return (
      <View style={styles.historySection}>
        <Text style={styles.sectionLabel}>Recent payouts</Text>
        <View style={[styles.historyCard, shadows.card]}>
          {payouts.map((p, i) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.pending;
            return (
              <View
                key={p.id}
                style={[
                  styles.historyRow,
                  i !== payouts.length - 1 && styles.historyRowBorder,
                ]}
              >
                <View style={styles.historyIconWrap}>
                  <MaterialIcons name={meta.icon} size={20} color={meta.color} />
                </View>
                <View style={styles.historyInfo}>
                  <Text style={styles.historyAmount}>{formatUsd(p.amount_cents)}</Text>
                  <Text style={styles.historyMeta}>
                    {formatDate(p.created_at)}
                    {p.failure_message ? ` · ${p.failure_message}` : ''}
                  </Text>
                </View>
                <Text style={[styles.historyStatus, { color: meta.color }]}>
                  {meta.label}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          style={styles.backBtn}
        >
          <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payouts</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullToRefresh}
            tintColor={colors.secondary}
          />
        }
      >
        {loading ? (
          <ActivityIndicator
            size="large"
            color={colors.secondary}
            style={{ marginTop: 60 }}
          />
        ) : (
          <>
            {renderStatusCard()}
            {renderBalanceCard()}
            {renderHistory()}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 20,
    fontWeight: '800',
    color: colors.onSurface,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },

  // Status card variants
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 18,
    borderRadius: radii.xl,
    marginBottom: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusCardInactive: {
    backgroundColor: colors.surfaceContainerLowest,
    borderColor: colors.surfaceContainerHigh,
  },
  statusCardPending: {
    backgroundColor: '#fff7ed',
    borderColor: '#f7d8b5',
  },
  statusCardActive: {
    backgroundColor: colors.secondaryContainer,
    borderColor: 'transparent',
  },
  statusIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTextCol: {
    flex: 1,
  },
  statusTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
  },
  statusSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginTop: 2,
    lineHeight: 18,
  },
  statusRequirement: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.onSurface,
    marginTop: 3,
    lineHeight: 18,
  },

  // Balance card
  balanceCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 24,
  },
  balanceLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
  },
  balanceAmount: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 44,
    fontWeight: '800',
    color: colors.onSurface,
    letterSpacing: -1.5,
    marginTop: 6,
    marginBottom: 18,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  amountPrefix: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    color: colors.onSurfaceVariant,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    color: colors.onSurface,
    padding: 0,
  },
  maxButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainer,
  },
  maxButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    color: colors.secondary,
    letterSpacing: 1,
  },
  maxButtonTextDisabled: {
    color: colors.outline,
  },
  primaryBtn: {
    borderRadius: radii.full,
    overflow: 'hidden',
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    minHeight: 54,
  },
  primaryBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
  },

  // History
  historySection: {
    marginTop: 8,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  historyCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  historyRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerLow,
  },
  historyIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyInfo: {
    flex: 1,
  },
  historyAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
  },
  historyMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  historyStatus: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
