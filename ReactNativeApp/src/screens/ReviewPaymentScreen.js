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
  assignments as assignmentsApi,
  payments as paymentsApi,
  members as membersApi,
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
  const [nudging, setNudging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isBackgroundRefresh = false) => {
    if (!billId) return;
    if (!isBackgroundRefresh) {
      setLoading(true);
    }
    try {
      const [sumRes, payRes] = await Promise.all([
        billsApi.getSummary(billId),
        paymentsApi.listForBill(billId),
      ]);

      const data = sumRes.data;
      const b = data.bill;
      const mems = data.members ?? [];
      const allPayments = payRes.data ?? [];
      setBill(b);

      let assignRes;
      try {
        assignRes = await assignmentsApi.list(billId);
      } catch {
        assignRes = { data: [] };
      }
      const allAssignments = assignRes.data ?? [];

      const uid = String(user?.id ?? '');

      const allMemberData = mems.map((m) => {
        const mAssignments = allAssignments.filter(
          (a) => String(a.bill_member_id) === String(m.id),
        );
        const amountOwed = mAssignments.reduce(
          (s, a) => s + parseFloat(a.amount_owed ?? 0),
          0,
        );

        const mPayments = allPayments.filter(
          (p) => String(p.bill_member_id) === String(m.id) && p.status === 'succeeded',
        );
        const amountPaid = mPayments.reduce(
          (s, p) => s + parseFloat(p.amount ?? 0),
          0,
        );

        const isHost = m.user_id != null && String(m.user_id) === uid;

        let status = 'pending';
        let subtitle = 'Pending request';
        if (amountPaid >= amountOwed && amountOwed > 0) {
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

      const hostMember = allMemberData.find((m) => m.isHost);
      setHostShare(hostMember?.amountOwed ?? 0);

      // Only show non-host members in the tracking list
      setParticipants(allMemberData.filter((m) => !m.isHost));
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

    // Poll every 3s to pick up payments and member changes
    const poll = setInterval(() => load(true), 3000);
    return () => clearInterval(poll);
  }, [load]);

  const handlePullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  // ─── WebSocket: real-time updates ───────────────────────────────────────────
  const wsHandlers = useMemo(() => ({
    onPaymentComplete: (data) => {
      if (!data?.member_id) return;
      setParticipants((prev) =>
        prev.map((p) =>
          String(p.id) === String(data.member_id)
            ? { ...p, status: 'paid', subtitle: 'Paid via Settld' }
            : p,
        ),
      );
      // Also do a background refresh to get accurate amounts
      load(true);
    },
    onMemberJoined: (data) => {
      if (!data?.member_id) return;
      // Background refresh to pick up the new member
      load(true);
    },
    onAssignmentUpdate: () => {
      // Assignments changed, refresh to recalculate amounts
      load(true);
    },
  }), [load]);

  useBillWebSocket(billId, wsHandlers);

  const totalBill = parseFloat(bill?.total ?? 0);
  // The host paid upfront — the amount to collect is the bill minus the host's share
  const amountToCollect = Math.max(0, totalBill - hostShare);
  const totalCollected = participants.reduce((s, p) => s + (p.amountPaid || 0), 0);
  const totalRemaining = Math.max(0, amountToCollect - totalCollected);
  const percent = amountToCollect > 0 ? Math.round((totalCollected / amountToCollect) * 100) : 0;

  const pendingParticipants = participants.filter((p) => p.status === 'pending');

  const handleNudge = async () => {
    if (pendingParticipants.length === 0) {
      Alert.alert('All paid', 'Everyone has already paid their share.');
      return;
    }
    setNudging(true);
    try {
      Alert.alert(
        'Reminders Sent',
        `Nudged ${pendingParticipants.length} pending ${pendingParticipants.length === 1 ? 'member' : 'members'}.`,
      );
      setParticipants((prev) =>
        prev.map((p) =>
          p.status === 'pending'
            ? { ...p, status: 'reminder_sent', subtitle: 'Reminder sent just now' }
            : p,
        ),
      );
    } finally {
      setNudging(false);
    }
  };

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

        {/* Host's share callout */}
        {hostShare > 0 && (
          <View style={styles.hostShareCard}>
            <MaterialIcons name="account-balance-wallet" size={18} color={colors.secondary} />
            <View style={styles.hostShareInfo}>
              <Text style={styles.hostShareLabel}>Your share (paid upfront)</Text>
              <Text style={styles.hostShareSub}>
                {formatMoney(totalBill)} total − {formatMoney(hostShare)} yours = {formatMoney(amountToCollect)} to collect
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
          <View style={styles.participantsHeader}>
            <Text style={styles.sectionTitle}>Participant Status</Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleNudge}
              disabled={nudging || pendingParticipants.length === 0}
              style={[
                styles.nudgeButton,
                pendingParticipants.length === 0 && styles.nudgeButtonDisabled,
              ]}
            >
              {nudging ? (
                <ActivityIndicator size="small" color={colors.onSecondary} />
              ) : (
                <>
                  <MaterialIcons name="campaign" size={16} color={colors.onSecondary} />
                  <Text style={styles.nudgeButtonText}>Nudge Pending</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

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
  participantsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onBackground,
  },
  nudgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.secondary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.full,
  },
  nudgeButtonDisabled: {
    opacity: 0.4,
  },
  nudgeButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSecondary,
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
