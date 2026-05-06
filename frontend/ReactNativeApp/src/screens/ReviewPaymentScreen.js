import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import useBillWebSocket from '../hooks/useBillWebSocket';
import {
  bills as billsApi,
  members as membersApi,
  ApiError,
} from '../services/api';

function formatMoney(n) {
  const x = typeof n === 'string' ? parseFloat(n) : Number(n);
  if (Number.isNaN(x)) return '$0.00';
  return `$${x.toFixed(2)}`;
}

function TopBar({ insets, onBack, title }) {
  return (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <TouchableOpacity onPress={onBack} style={styles.topBarBtn} activeOpacity={0.7}>
        <MaterialIcons name="arrow-back" size={24} color={colors.onSurfaceVariant} />
      </TouchableOpacity>
      <Text style={styles.topBarTitle}>{title || 'Payment Tracking'}</Text>
      <View style={styles.topBarBtn} />
    </View>
  );
}

function ProgressCard({ collected, remaining, total, percent }) {
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>Collection Progress</Text>
        <Text style={styles.progressPercent}>{percent}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, percent)}%` }]} />
      </View>
      <View style={styles.progressFooter}>
        <View style={styles.progressStat}>
          <Text style={styles.progressAmount}>{formatMoney(collected)}</Text>
          <Text style={styles.progressStatLabel}>collected</Text>
        </View>
        <View style={styles.progressStat}>
          <Text style={[styles.progressAmount, styles.progressAmountRemaining]}>
            {formatMoney(remaining)}
          </Text>
          <Text style={styles.progressStatLabel}>remaining</Text>
        </View>
      </View>
    </View>
  );
}

function getStatusConfig(status) {
  switch (status) {
    case 'paid':
      return {
        label: 'PAID',
        icon: 'check-circle',
        color: colors.secondary,
        filled: true,
      };
    case 'reminder_sent':
      return {
        label: 'REMINDER SENT',
        icon: 'mail',
        color: colors.tertiary,
        filled: false,
      };
    case 'pending':
    default:
      return {
        label: 'PENDING',
        icon: 'schedule',
        color: colors.outline,
        filled: false,
      };
  }
}

function ParticipantRow({ participant }) {
  const statusCfg = getStatusConfig(participant.status);
  return (
    <View style={styles.participantCard}>
      <View style={styles.participantLeft}>
        <View style={styles.participantAvatar}>
          <Text style={styles.participantAvatarText}>
            {(participant.nickname || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View>
          <Text style={styles.participantName}>
            {participant.nickname || 'Member'}
          </Text>
          <Text style={styles.participantSubtext}>{participant.subtitle}</Text>
        </View>
      </View>
      <View style={styles.participantRight}>
        <Text style={styles.participantAmount}>{formatMoney(participant.amountOwed)}</Text>
        <View style={styles.statusBadge}>
          <MaterialIcons name={statusCfg.icon} size={12} color={statusCfg.color} />
          <Text style={[styles.statusText, { color: statusCfg.color }]}>
            {statusCfg.label}
          </Text>
        </View>
      </View>
    </View>
  );
}

function CashSection({ onMarkPaid }) {
  return (
    <View style={styles.cashSection}>
      <Text style={styles.cashTitle}>Did someone pay in cash?</Text>
      <Text style={styles.cashSubtext}>
        You can manually mark participants as paid if they settled outside of the app.
      </Text>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onMarkPaid}
        style={styles.markPaidButton}
      >
        <Text style={styles.markPaidButtonText}>Mark Others as Paid</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ReviewPaymentScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const billId = route?.params?.billId;

  const [loading, setLoading] = useState(true);
  const [bill, setBill] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [hostShare, setHostShare] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);

  const load = useCallback(async (isBackgroundRefresh = false) => {
    if (!billId) return;
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    try {
      // Pull totals from `/balance-breakdown` rather than recomputing
      // them client-side. The backend's CalculationService is the canonical
      // source: it includes service_fee + receipt_extra_fees and honors
      // `expected_party_size`-based equal tax. Recomputing here drifted
      // away from the party (web) view — the host saw a smaller "owed"
      // amount because client math forgot the service fee, so guests
      // would owe (e.g.) $68.74 on the web but show as $61.22 on the
      // host's tracker.
      const [sumRes, breakdownRes] = await Promise.all([
        billsApi.getSummary(billId),
        billsApi.getBalanceBreakdown(billId),
      ]);

      const data = sumRes.data;
      const b = data.bill;
      const mems = data.members ?? [];
      setBill(b);

      const breakdown = breakdownRes?.data ?? {};
      const breakdownMembers = Array.isArray(breakdown.members) ? breakdown.members : [];
      const breakdownByMemberId = new Map(
        breakdownMembers.map((bm) => [String(bm.member_id), bm]),
      );

      const uid = String(user?.id ?? '');
      const totalBill = parseFloat(b?.total ?? 0);

      const allMemberData = mems.map((m) => {
        const isHost = m.user_id != null && String(m.user_id) === uid;
        const bm = breakdownByMemberId.get(String(m.id)) ?? {};
        const amountOwed = parseFloat(bm.total_owed ?? 0);
        const amountPaid = parseFloat(bm.total_paid ?? 0);
        const remaining = parseFloat(bm.remaining ?? Math.max(0, amountOwed - amountPaid));

        let status = 'pending';
        let subtitle = 'Pending request';
        if (amountOwed > 0 && remaining <= 0) {
          status = 'paid';
          subtitle = 'Paid via Settld';
        } else if (m.marked_paid) {
          status = 'paid';
          subtitle = 'Marked as paid';
        }

        return {
          ...m,
          amountOwed,
          amountPaid,
          status,
          subtitle,
          isHost,
        };
      });

      const nonHostMembers = allMemberData.filter((m) => !m.isHost);
      const amountToCollect = nonHostMembers.reduce(
        (sum, m) => sum + (m.amountOwed || 0),
        0,
      );
      setHostShare(Math.max(0, totalBill - amountToCollect));
      setParticipants(nonHostMembers);
    } catch (err) {
      console.error('[PaymentTracking] load error:', err);
      if (!isBackgroundRefresh) {
        setBill(null);
      }
    } finally {
      if (!isBackgroundRefresh) {
        setLoading(false);
      }
    }
  }, [billId, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  // ─── WebSocket: real-time updates ───────────────────────────────────────────
  const wsHandlers = useMemo(() => ({
    onConnected: () => {
      load(true);
    },
    onPaymentComplete: (data) => {
      if (data?.member_id) {
        setParticipants((prev) =>
          prev.map((p) =>
            String(p.id) === String(data.member_id)
              ? { ...p, status: 'paid', subtitle: 'Paid via Settld' }
              : p,
          ),
        );
      }
      load(true);
    },
    onMemberJoined: () => {
      load(true);
    },
    onAssignmentUpdate: () => {
      load(true);
    },
  }), [load]);

  const { connected: wsConnected } = useBillWebSocket(billId, wsHandlers);

  // Fallback polling only when WebSocket is disconnected. 2s keeps the
  // payment-collection UI reactive for the host while a half-dead socket
  // is being torn down by the liveness check in useBillWebSocket.
  useEffect(() => {
    if (wsConnected) return;
    const poll = setInterval(() => load(true), 2000);
    return () => clearInterval(poll);
  }, [wsConnected, load]);

  const handleMarkPaid = () => {
    const unpaid = participants.filter((p) => p.status !== 'paid');
    if (unpaid.length === 0) {
      Alert.alert('All paid', 'Everyone is already marked as paid.');
      return;
    }

    Alert.alert(
      'Mark as Paid',
      'Select a member to mark as paid:',
      [
        ...unpaid.map((p) => ({
          text: p.nickname || 'Member',
          onPress: async () => {
            try {
              await membersApi.update(billId, p.id, { marked_paid: true });
            } catch {
              // continue even if API fails
            }
            setParticipants((prev) =>
              prev.map((pp) =>
                pp.id === p.id
                  ? { ...pp, status: 'paid', subtitle: 'Marked as paid (cash)' }
                  : pp,
              ),
            );
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={colors.secondary} />
      </View>
    );
  }

  if (!bill) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={styles.errorText}>Bill not found.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={styles.linkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const billTitle = bill.merchant_name || bill.title || 'Bill';
  const memberCount = participants.length;
  const guestPayUnlocked = bill.guest_pay_unlocked !== false;

  const totalBill = parseFloat(bill?.total ?? 0);
  const amountToCollect = participants.reduce((s, p) => s + (p.amountOwed || 0), 0);
  const totalCollected = participants.reduce((s, p) => s + (p.amountPaid || 0), 0);
  const totalRemaining = Math.max(0, amountToCollect - totalCollected);
  const percent = amountToCollect > 0 ? Math.round((totalCollected / amountToCollect) * 100) : 0;

  const runUnlockGuestPay = async (force) => {
    if (!billId) return;
    setUnlockBusy(true);
    try {
      await billsApi.unlockGuestPayments(billId, { force });
      await load(true);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      if (code === 'ASSIGNMENTS_INCOMPLETE' && !force) {
        Alert.alert(
          'Items not fully assigned',
          'Every receipt line should be assigned before guests pay. Open payments anyway?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open anyway',
              style: 'destructive',
              onPress: () => runUnlockGuestPay(true),
            },
          ],
        );
      } else {
        Alert.alert('Could not open payments', err?.message ?? 'Try again.');
      }
    } finally {
      setUnlockBusy(false);
    }
  };

  const promptUnlockGuestPay = () => {
    Alert.alert(
      'Allow guest payments?',
      'Guests can check out and use SMS pay links only after you confirm everyone has picked their items.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Allow payments', onPress: () => runUnlockGuestPay(false) },
      ],
    );
  };

  const promptLockGuestPay = () => {
    Alert.alert(
      'Pause guest payments?',
      'Guests will not be able to start new checkouts until you allow payments again. In-flight payments may still complete.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pause',
          style: 'destructive',
          onPress: async () => {
            try {
              await billsApi.lockGuestPayments(billId);
              await load(true);
            } catch (err) {
              Alert.alert('Could not pause', err?.message ?? 'Try again.');
            }
          },
        },
      ],
    );
  };

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
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handlePullToRefresh}
            tintColor={colors.secondary}
            colors={[colors.secondary]}
          />
        }
      >
        {/* Locked-state banner: pinned above everything else so the host
            can never miss the "guests are blocked, tap to allow" CTA. */}
        {!guestPayUnlocked && (
          <View style={styles.lockedBanner}>
            <View style={styles.lockedBannerHeader}>
              <View style={styles.lockedBannerIconWrap}>
                <MaterialIcons name="lock" size={22} color={colors.onError} />
              </View>
              <View style={styles.lockedBannerCopy}>
                <Text style={styles.lockedBannerTitle}>Guests can’t pay yet</Text>
                <Text style={styles.lockedBannerSub}>
                  You haven’t opened payments. Members see “waiting on host” and the Pay button is disabled until you allow it.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={promptUnlockGuestPay}
              disabled={unlockBusy}
              activeOpacity={0.85}
              style={[styles.lockedBannerCta, unlockBusy && styles.guestPayBtnDisabled]}
            >
              {unlockBusy ? (
                <ActivityIndicator color={colors.onSecondary} size="small" />
              ) : (
                <>
                  <MaterialIcons name="lock-open" size={18} color={colors.onSecondary} />
                  <Text style={styles.lockedBannerCtaText}>Allow guests to pay</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Bill header */}
        <View style={styles.billHeader}>
          <View style={styles.billHeaderLeft}>
            <Text style={styles.billTitle}>{billTitle}</Text>
            <Text style={styles.billSubtitle}>
              {memberCount} member{memberCount !== 1 ? 's' : ''} owe you
            </Text>
          </View>
          <View style={styles.billHeaderRight}>
            <Text style={styles.billTotal}>{formatMoney(amountToCollect)}</Text>
            <Text style={styles.billTotalLabel}>TO COLLECT</Text>
          </View>
        </View>

        {guestPayUnlocked && (
          <View style={styles.guestPayCard}>
            <MaterialIcons name="lock-open" size={22} color={colors.secondary} />
            <View style={styles.guestPayCopy}>
              <Text style={styles.guestPayTitle}>Guest payments open</Text>
              <Text style={styles.guestPaySub}>
                Guests can pay their share. Pause if you need to fix items first.
              </Text>
            </View>
            <TouchableOpacity
              onPress={promptLockGuestPay}
              style={styles.guestPayBtnSecondary}
              hitSlop={8}
            >
              <Text style={styles.guestPayBtnSecondaryText}>Pause</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Host's share callout */}
        {hostShare > 0 && (
          <View style={styles.hostShareCard}>
            <MaterialIcons name="account-balance-wallet" size={18} color={colors.secondary} />
            <View style={styles.hostShareInfo}>
              <Text style={styles.hostShareLabel}>Covered by host</Text>
              <Text style={styles.hostShareSub}>
                {formatMoney(totalBill)} total − {formatMoney(hostShare)} not collected = {formatMoney(amountToCollect)} to collect
              </Text>
            </View>
          </View>
        )}

        {/* Progress */}
        <ProgressCard
          collected={totalCollected}
          remaining={totalRemaining}
          total={amountToCollect}
          percent={percent}
        />

        {/* Participants */}
        <View style={styles.participantsSection}>
          <Text style={styles.sectionTitle}>Participant Status</Text>

          {participants.map((p) => (
            <ParticipantRow key={p.id} participant={p} />
          ))}
        </View>

        {/* Cash section */}
        <CashSection onMarkPaid={handleMarkPaid} />
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
    backgroundColor: 'rgba(248, 249, 250, 0.85)',
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

  // Bill header
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 20,
    paddingTop: 8,
  },
  billHeaderLeft: {
    flex: 1,
    marginRight: 16,
  },
  billTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onBackground,
  },
  billSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  billHeaderRight: {
    alignItems: 'flex-end',
  },
  billTotal: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 24,
    fontWeight: '700',
    color: colors.secondary,
  },
  billTotalLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 2,
    color: colors.outline,
    marginTop: 2,
  },

  // Host share callout
  hostShareCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 16,
    marginBottom: 16,
  },
  hostShareInfo: {
    flex: 1,
  },
  hostShareLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
  },
  hostShareSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },

  // Big "guests can't pay yet" warning banner shown at the very top of
  // the screen until the host explicitly opens payments. Intentionally
  // visually loud — this is the *only* gate keeping guests from paying,
  // so the host should never wonder where the unlock is.
  lockedBanner: {
    backgroundColor: colors.errorContainer ?? '#FFE4E1',
    borderRadius: radii.xl,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.error ?? '#B3261E',
    ...Platform.select({
      ios: {
        shadowColor: colors.error ?? '#B3261E',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
      },
      android: { elevation: 4 },
    }),
  },
  lockedBannerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  lockedBannerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.error ?? '#B3261E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedBannerCopy: {
    flex: 1,
  },
  lockedBannerTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: colors.onErrorContainer ?? '#410E0B',
  },
  lockedBannerSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.onErrorContainer ?? '#410E0B',
    marginTop: 4,
    lineHeight: 18,
  },
  lockedBannerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.secondary,
    paddingVertical: 14,
    borderRadius: radii.full,
  },
  lockedBannerCtaText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },

  guestPayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.secondaryContainer,
    borderRadius: radii.xl,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  guestPayCardMuted: {
    backgroundColor: colors.surfaceContainerLow,
  },
  guestPayCopy: {
    flex: 1,
  },
  guestPayTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  guestPaySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 4,
    lineHeight: 16,
  },
  guestPayBtn: {
    minWidth: 88,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestPayBtnDisabled: {
    opacity: 0.65,
  },
  guestPayBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSecondary,
  },
  guestPayBtnSecondary: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  guestPayBtnSecondaryText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
  },

  // Progress card
  progressCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 28,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  progressLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  progressPercent: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    fontWeight: '700',
    color: colors.onBackground,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: 10,
    backgroundColor: colors.secondary,
    borderRadius: 5,
  },
  progressFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  progressStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  progressAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onBackground,
  },
  progressAmountRemaining: {
    color: colors.error,
  },
  progressStatLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: colors.outline,
  },

  // Participants section
  participantsSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onBackground,
  },
  // Participant card
  participantCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  participantLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  participantAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  participantAvatarText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },
  participantName: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
  },
  participantSubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  participantRight: {
    alignItems: 'flex-end',
  },
  participantAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onBackground,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  statusText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Cash section
  cashSection: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: colors.secondary,
  },
  cashTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onBackground,
    marginBottom: 8,
  },
  cashSubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    lineHeight: 19,
    marginBottom: 16,
  },
  markPaidButton: {
    width: '100%',
    paddingVertical: 14,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markPaidButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
  },
});
