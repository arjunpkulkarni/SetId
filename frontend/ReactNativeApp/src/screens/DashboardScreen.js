import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDispatch, useStore } from 'react-redux';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, shadows } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { bills } from '../services/api';
import {
  api,
  useGetDashboardQuery,
  hydrateDashboardFromCache,
  DASHBOARD_CACHE_KEY,
  DASHBOARD_CACHE_TTL,
  tombstoneDashboardBillDeletion,
  clearDashboardBillTombstone,
} from '../store/api';
import { offlineStorage } from '../services/offlineStorage';
import LazyImage from '../components/LazyImage';

/** Dashboard marketing / mockup palette */
const DASHBOARD_GREEN = '#004D40';
const DASHBOARD_GREEN_MID = '#00695C';
const RECEIPT_ICON_FEATURED_BG = '#FCE4EC';
const RECEIPT_ICON_FEATURED_FG = '#880E4F';
const MINT_ICON_BG = '#E0F2F1';

/** FAB pinned to bottom-right of the *tab screen* (area above the tab bar).
 *  Do not add `tabBarHeight` here — React Navigation already lays out the
 *  screen above the bar; large `bottom` values float the button into the list. */
const FAB_BOTTOM = 24;
const FAB_RIGHT = 20;


/** Keeps header compact so action icons stay on-screen (E.164 is very long). */
function compactDisplayName(raw) {
  if (!raw) return 'Member';
  if (typeof raw === 'string' && raw.startsWith('+')) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
      return `•••• ${digits.slice(-4)}`;
    }
  }
  if (raw.length > 22) {
    return `${raw.slice(0, 20)}…`;
  }
  return raw;
}

const DRAFT_BILL_TITLE = 'Settld Bill';

const ACTIVITY_TYPE_META = {
  bill_created: { icon: 'receipt-long', positive: true },
  payment_received: { icon: 'arrow-downward', positive: true },
  payment_sent: { icon: 'arrow-upward', positive: false },
  member_joined: { icon: 'person-add', positive: true },
  receipt_parsed: { icon: 'document-scanner', positive: true },
  past_bill: { icon: 'history', positive: true, neutralAmount: true },
};

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num == null || isNaN(num)) return '$0.00';
  return `$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRelativeTime(timestamp) {
  if (timestamp == null) return '';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pastBillStatusLabel(status) {
  if (!status) return 'Past bill';
  if (status === 'settled') return 'Settled';
  return `${status}`.replace(/_/g, ' ');
}

/** Feed the Recent activity list from non-active bills returned on `/dashboard`. */
function mapPastBillsToActivityItems(pastBills) {
  return (pastBills ?? []).map((b) => ({
    type: 'past_bill',
    bill_id: b.id,
    bill_title: b.title || b.merchant_name || 'Bill',
    description: '',
    amount: b.total != null ? parseFloat(String(b.total)) : null,
    timestamp: b.updated_at || b.created_at,
    status_label: pastBillStatusLabel(b.status),
    member_count: b.member_count ?? 0,
  }));
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function firstNameFromUser(user) {
  const raw =
    user?.full_name && user.full_name !== 'Member'
      ? user.full_name
      : user?.phone
        ? user.phone
        : '';
  if (!raw) return 'Member';
  if (typeof raw === 'string' && raw.startsWith('+')) {
    return compactDisplayName(raw);
  }
  const first = `${raw}`.trim().split(/\s+/)[0];
  return first.length > 16 ? `${first.slice(0, 14)}…` : first;
}

function TopAppBar({ insets, user, navigation }) {
  const { logout } = useAuth();
  const firstName = firstNameFromUser(user);

  const initials = (user?.full_name || user?.phone || '?')
    .toString()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const confirmLogout = () => {
    Alert.alert('Log out', 'Sign out of Settld on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBarInner}>
        <View style={styles.greetingBlock}>
          <Text style={styles.greetingName} numberOfLines={1}>
            {firstName}
          </Text>
          <Text style={styles.greetingRest}>Welcome back! 👋</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="Account"
          accessibilityHint="Opens profile. Long press to log out."
          onPress={() => navigation.navigate('ProfileTab')}
          onLongPress={confirmLogout}
          activeOpacity={0.85}
          style={styles.headerAvatarBtn}
        >
          {user?.avatar_url ? (
            <LazyImage
              source={{ uri: user.avatar_url }}
              style={styles.headerAvatarImg}
              fallbackIcon="person"
            />
          ) : (
            <View style={styles.headerAvatarCircle}>
              <Text style={styles.headerAvatarInitials}>{initials}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BalanceHero({ overview, isLoading }) {
  const owedToYou = parseFloat(overview?.total_owed_to_you ?? 0);
  const youOwe = parseFloat(overview?.total_you_owe ?? 0);
  const net = owedToYou - youOwe;
  const badgeText =
    net >= 0 ? `+${formatCurrency(net)} owed to you` : `${formatCurrency(Math.abs(net))} you owe`;

  return (
    <View style={styles.balanceHeroWrap}>
      <LinearGradient
        colors={[DASHBOARD_GREEN, DASHBOARD_GREEN_MID]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.balanceGradientCard, shadows.card]}
      >
        <View style={styles.balanceCardRow}>
          <View style={styles.balanceCardMain}>
            <Text style={styles.balanceLabelOnDark}>Current Balance</Text>
            {isLoading ? (
              <View style={styles.balanceLoaderDark}>
                <ActivityIndicator size="large" color="rgba(255,255,255,0.85)" />
              </View>
            ) : (
              <>
                <Text style={styles.balanceAmountOnDark}>
                  {net < 0 ? '-' : ''}
                  {formatCurrency(net)}
                </Text>
                <View style={[styles.balanceTrendBadge, net < 0 && styles.balanceTrendBadgeNeg]}>
                  <Text
                    style={[styles.balanceTrendBadgeText, net < 0 && styles.balanceTrendBadgeTextNeg]}
                    numberOfLines={1}
                  >
                    {net >= 0 ? '↗ ' : '↘ '}
                    {badgeText}
                  </Text>
                </View>
              </>
            )}
          </View>
          {!isLoading ? (
            <View style={styles.balanceDollarRing}>
              <MaterialIcons name="attach-money" size={28} color="rgba(255,255,255,0.92)" />
            </View>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}

/**
 * Wraps a bill card with left-swipe-to-delete. Works for any bill status
 * (draft / active / settled). Non-draft deletions get a stronger
 * confirmation because they remove real financial history — guests who
 * paid their share will lose the bill from their Activity too.
 */
function SwipeToDeleteBill({ bill, onDelete, children }) {
  const swipeableRef = useRef(null);
  const status = bill?.status ?? 'draft';
  const isDraft = status === 'draft';

  const close = () => {
    try {
      swipeableRef.current?.close();
    } catch {
      // ignore — ref may already be unmounted mid-animation
    }
  };

  const confirmDelete = () => {
    // Draft = nothing-lost delete. Active/settled = warn about guest-side
    // impact and use a firmer prompt. Backend allows all three equally
    // (`DELETE /bills/:id` only gates on bill ownership).
    const title = isDraft
      ? 'Delete draft?'
      : status === 'settled'
        ? 'Delete settled bill?'
        : 'Delete active bill?';
    const message = isDraft
      ? 'This will permanently remove this draft bill. This action cannot be undone.'
      : 'This permanently removes the bill for you AND anyone you invited. '
        + 'Payments already collected won\'t be refunded. This cannot be undone.';

    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: close },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            close();
            try {
              await onDelete(bill);
            } catch (err) {
              Alert.alert(
                'Could not delete',
                err?.message ?? 'Please try again.',
              );
            }
          },
        },
      ],
      { cancelable: true, onDismiss: close },
    );
  };

  const renderRightActions = (_progress, dragX) => {
    const scale = dragX.interpolate({
      inputRange: [-100, -40, 0],
      outputRange: [1, 0.85, 0.6],
      extrapolate: 'clamp',
    });
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={confirmDelete}
        style={styles.swipeDeleteAction}
      >
        <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
          <MaterialIcons name="delete-outline" size={24} color={colors.onError} />
          <Text style={styles.swipeDeleteText}>Delete</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      friction={2}
      overshootRight={false}
    >
      {children}
    </Swipeable>
  );
}

function FeaturedBillCard({ bill, onSettle, onOpenBill }) {
  if (!bill) return null;
  const remaining = parseFloat(bill.remaining ?? bill.total ?? 0);

  return (
    <View style={[styles.featuredCard, shadows.card]}>
      <TouchableOpacity activeOpacity={0.92} onPress={() => onOpenBill(bill)}>
        <View style={styles.featuredCardHeaderRow}>
          <View style={styles.featuredIconWrapFeatured}>
            <MaterialIcons name="receipt-long" size={22} color={RECEIPT_ICON_FEATURED_FG} />
          </View>
          <View style={styles.featuredHeaderText}>
            <Text style={styles.featuredTitle} numberOfLines={1}>
              {bill.title || bill.merchant_name}
            </Text>
            <Text style={styles.featuredSubtitle}>
              Split between {bill.member_count} {bill.member_count === 1 ? 'person' : 'people'}
            </Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color={colors.outlineVariant} />
        </View>
        <View style={styles.featuredParticipantsRow}>
          <MaterialIcons name="person-outline" size={18} color={colors.onSurfaceVariant} />
          <Text style={styles.featuredParticipantsText}>
            {bill.member_count} {bill.member_count === 1 ? 'participant' : 'participants'}
          </Text>
        </View>
      </TouchableOpacity>
      <View style={styles.featuredAmountFooter}>
        <View style={styles.featuredAmountCol}>
          <Text style={styles.amountDueLabel}>Amount due</Text>
          <Text style={styles.featuredAmountLarge}>{formatCurrency(remaining)}</Text>
        </View>
        <TouchableOpacity activeOpacity={0.85} onPress={() => onSettle(bill)}>
          <LinearGradient
            colors={[DASHBOARD_GREEN, DASHBOARD_GREEN_MID]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.settleButtonDark, shadows.settleButton]}
          >
            <Text style={styles.settleButtonText}>Settle Now</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SecondaryBillCard({ bill, onOpenBill }) {
  return (
    <TouchableOpacity
      style={[styles.secondaryCard, shadows.card]}
      activeOpacity={0.92}
      onPress={() => onOpenBill(bill)}
    >
      <View style={styles.secondaryIconWrapMint}>
        <MaterialIcons name="receipt-long" size={22} color={DASHBOARD_GREEN} />
      </View>
      <View style={styles.secondaryInfo}>
        <Text style={styles.secondaryTitle} numberOfLines={1}>
          {bill.title || bill.merchant_name}
        </Text>
        <Text style={styles.secondarySubtitle}>
          {bill.status} • {bill.member_count} {bill.member_count === 1 ? 'member' : 'members'}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={colors.outlineVariant} />
    </TouchableOpacity>
  );
}

function ActiveBillsSection({ bills, onSettle, onDelete, onOpenBill, onViewAll, isLoading }) {
  // While the backend is cold-starting, show a card-shaped spinner so the
  // page layout stays stable instead of collapsing to an empty state.
  if (isLoading) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Bills</Text>
          {onViewAll ? (
            <TouchableOpacity onPress={onViewAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.viewAllText}>View all</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={[styles.loadingCard, shadows.card]}>
          <ActivityIndicator size="large" color={DASHBOARD_GREEN} />
          <Text style={styles.loadingText}>Loading your bills…</Text>
        </View>
      </View>
    );
  }

  if (!bills || bills.length === 0) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Bills</Text>
          {onViewAll ? (
            <TouchableOpacity onPress={onViewAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.viewAllText}>View all</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={[styles.emptyCard, shadows.card]}>
          <MaterialIcons name="receipt-long" size={40} color={colors.outlineVariant} />
          <Text style={styles.emptyText}>No active bills</Text>
          <Text style={styles.emptySubtext}>Tap + to create your first bill</Text>
        </View>
      </View>
    );
  }

  const [featured, ...rest] = bills;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Active Bills</Text>
        {onViewAll ? (
          <TouchableOpacity onPress={onViewAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.viewAllText}>View all</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <SwipeToDeleteBill bill={featured} onDelete={onDelete}>
        <FeaturedBillCard bill={featured} onSettle={onSettle} onOpenBill={onOpenBill} />
      </SwipeToDeleteBill>
      {rest.length > 0 && <View style={styles.secondaryBillsGap} />}
      {rest.slice(0, 3).map((bill) => (
        <React.Fragment key={bill.id}>
          <SwipeToDeleteBill bill={bill} onDelete={onDelete}>
            <SecondaryBillCard bill={bill} onOpenBill={onOpenBill} />
          </SwipeToDeleteBill>
          <View style={styles.billCardGap} />
        </React.Fragment>
      ))}
    </View>
  );
}

function ActivityItem({ item, isLast, onPress }) {
  const meta = ACTIVITY_TYPE_META[item.type] || { icon: 'info', positive: true };
  const hasAmount = item.amount != null && Number.isFinite(item.amount);
  const positive = meta.positive;
  const neutralAmount = !!meta.neutralAmount;

  const statusLabel =
    item.type === 'past_bill'
      ? (item.status_label || 'Past bill')
      : item.type.replace(/_/g, ' ');

  const subtitle =
    item.type === 'past_bill' && item.member_count != null
      ? `${formatRelativeTime(item.timestamp)} · ${item.member_count} ${
          item.member_count === 1 ? 'person' : 'people'
        }`
      : formatRelativeTime(item.timestamp);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.activityItem, !isLast && styles.activityItemBorder]}
    >
      <View style={styles.activityIconWrap}>
        <MaterialIcons name={meta.icon} size={20} color={colors.onSurfaceVariant} />
      </View>
      <View style={styles.activityInfo}>
        <Text style={styles.activityTitle} numberOfLines={1}>
          {item.bill_title || item.description}
        </Text>
        <Text style={styles.activityDate}>{subtitle}</Text>
      </View>
      <View style={styles.activityRight}>
        {hasAmount && (
          <Text
            style={[
              styles.activityAmount,
              neutralAmount && styles.activityAmountNeutral,
              !neutralAmount && { color: positive ? colors.secondary : colors.error },
            ]}
          >
            {neutralAmount
              ? formatCurrency(item.amount)
              : `${positive ? '+' : '-'}${formatCurrency(item.amount)}`}
          </Text>
        )}
        <Text style={styles.activityStatus}>{statusLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

function RecentActivitySection({ activities, onItemPress }) {
  if (!activities || activities.length === 0) {
    return (
      <View style={[styles.section, styles.sectionRecentActivity]}>
        <Text style={styles.sectionTitle}>Recent activity</Text>
        <View style={[styles.emptyCard, shadows.card]}>
          <MaterialIcons name="history" size={40} color={colors.outlineVariant} />
          <Text style={styles.emptyText}>No past bills yet</Text>
          <Text style={styles.emptySubtext}>Settled and closed bills show up here</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.section, styles.sectionRecentActivity]}>
      <Text style={styles.sectionTitle}>Recent activity</Text>
      <View style={[styles.activityCard, shadows.card]}>
        {activities.map((item, i) => (
          <ActivityItem
            key={
              item.bill_id
                ? `past-bill-${item.bill_id}`
                : `${item.type}-${String(item.timestamp)}-${i}`
            }
            item={item}
            isLast={i === activities.length - 1}
            onPress={() => onItemPress(item)}
          />
        ))}
      </View>
    </View>
  );
}

function FloatingActionButton({ onPress, loading }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={loading}
      style={[styles.fab, shadows.fab]}
    >
      <LinearGradient
        colors={[DASHBOARD_GREEN, DASHBOARD_GREEN_MID]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fabGradient, loading && styles.fabGradientDisabled]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <MaterialIcons name="add" size={28} color="#FFFFFF" />
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

// Throttle window for the focus-triggered draft cleanup. The backend call
// isn't free and rapid tab-switching was firing it on every focus; once a
// minute is plenty for garbage-collecting stale drafts.
const CLEANUP_THROTTLE_MS = 60 * 1000;

export default function DashboardScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const { user } = useAuth();
  const dispatch = useDispatch();
  const store = useStore();

  // Hydrate the RTK Query cache from AsyncStorage once per mount. This
  // runs synchronously (via `upsertQueryData`) the moment the disk read
  // resolves, so the very first paint of the dashboard shows the last-known
  // balance + active bills instead of a skeleton — while a background
  // refetch silently updates the numbers.
  const hydrationStartedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    let cancelled = false;
    (async () => {
      await hydrateDashboardFromCache(dispatch);
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [dispatch]);

  // Single round-trip: overview + active bill list in one payload. The
  // `getDashboard` endpoint persists to AsyncStorage via `onQueryStarted`
  // so repeat cold opens are instant.
  const {
    data,
    isLoading: dashboardLoading,
    refetch: refetchDashboard,
  } = useGetDashboardQuery();

  const overview = data?.overview ?? null;
  const activeBills = data?.activeBills ?? [];
  const pastBills = data?.pastBills ?? [];

  // Per-section loading flags. We *don't* gate the whole page on these —
  // the layout always renders so the user immediately sees their name,
  // avatar, and the FAB, with inline spinners where data is still fetching.
  //
  // "Loading" means: we don't have data yet AND (the network is still in
  // flight OR we haven't finished reading the disk cache). This prevents
  // a brief flash of a stale "$0.00" while the AsyncStorage read is
  // resolving on cold launch.
  const balanceLoading = !overview && (dashboardLoading || !hydrated);
  const billsLoadingInline =
    activeBills.length === 0 && (dashboardLoading || !hydrated);
  const recentActivity = useMemo(
    () => mapPastBillsToActivityItems(pastBills),
    [pastBills],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [creatingBill, setCreatingBill] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchDashboard();
    setRefreshing(false);
  }, [refetchDashboard]);

  // Auto-delete stale empty drafts whenever the dashboard regains focus.
  // We fire-and-forget so a cold network doesn't block the UI; a successful
  // cleanup refetches the dashboard so ghost drafts disappear. Throttled
  // to once per minute so rapid tab switches don't pile on extra calls.
  const lastCleanupRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastCleanupRef.current < CLEANUP_THROTTLE_MS) {
        return undefined;
      }
      lastCleanupRef.current = now;

      let cancelled = false;
      (async () => {
        try {
          const res = await bills.cleanupEmptyDrafts();
          const deleted = res?.data?.deleted_count ?? 0;
          if (!cancelled && deleted > 0) {
            await refetchDashboard();
          }
        } catch (err) {
          if (__DEV__) {
            console.warn('[Dashboard] cleanupEmptyDrafts failed', err);
          }
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [refetchDashboard]),
  );

  const handleSettle = (bill) => {
    navigation.navigate('BillSplit', { billId: bill.id });
  };

  const handleOpenBill = useCallback(
    (bill) => {
      if (bill?.id) navigation.navigate('BillSplit', { billId: bill.id });
    },
    [navigation],
  );

  const handleViewAllBills = useCallback(() => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      parent.navigate('Notifications');
    }
  }, [navigation]);

  const handleDeleteBill = useCallback(
    async (bill) => {
      if (!bill?.id) return;
      const idStr = String(bill.id);
      tombstoneDashboardBillDeletion(idStr);

      const selectDashboard = api.endpoints.getDashboard.select(undefined);
      const prevEntry = selectDashboard(store.getState());
      const prevData = prevEntry?.data;

      const applyList = (list) =>
        (list ?? []).filter((b) => String(b.id) !== idStr);

      if (prevData?.activeBills) {
        const nextData = {
          ...prevData,
          activeBills: applyList(prevData.activeBills),
        };
        dispatch(api.util.upsertQueryData('getDashboard', undefined, nextData));
        offlineStorage.set(DASHBOARD_CACHE_KEY, nextData, DASHBOARD_CACHE_TTL).catch(() => {});
      }

      try {
        await bills.delete(bill.id);
      } catch (err) {
        clearDashboardBillTombstone(idStr);
        if (prevData) {
          dispatch(api.util.upsertQueryData('getDashboard', undefined, prevData));
          offlineStorage.set(DASHBOARD_CACHE_KEY, prevData, DASHBOARD_CACHE_TTL).catch(() => {});
        }
        throw err;
      }
      // Reconcile with server without blocking the UI (delete already succeeded).
      void refetchDashboard();
    },
    [dispatch, store, refetchDashboard],
  );

  const handleCreateBillFromReceipt = useCallback(async () => {
    if (creatingBill) return;

    setCreatingBill(true);
    try {
      const res = await bills.create({ title: DRAFT_BILL_TITLE });
      const billId = res?.data?.id;

      if (!billId) {
        throw new Error('Missing bill ID');
      }

      navigation.navigate('ScanReceipt', { billId });
    } catch (err) {
      Alert.alert('Could not start bill', err?.error?.message ?? 'Please try again.');
    } finally {
      setCreatingBill(false);
    }
  }, [creatingBill, navigation]);

  return (
    <View style={styles.root}>
      <TopAppBar insets={insets} user={user} navigation={navigation} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 72, paddingBottom: tabBarHeight + 120 },
        ]}
        showsVerticalScrollIndicator={false}
        // When the dashboard fits on a single screen there's nothing to scroll to,
        // so disable iOS rubber-band and Android overscroll. RefreshControl still
        // works because pull-to-refresh doesn't need overscroll to trigger.
        alwaysBounceVertical={false}
        overScrollMode="never"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={DASHBOARD_GREEN}
          />
        }
      >
        <BalanceHero overview={overview} isLoading={balanceLoading} />
        <ActiveBillsSection
          bills={activeBills}
          onSettle={handleSettle}
          onDelete={handleDeleteBill}
          onOpenBill={handleOpenBill}
          onViewAll={handleViewAllBills}
          isLoading={billsLoadingInline}
        />
        <RecentActivitySection
          activities={recentActivity}
          onItemPress={(item) => {
            if (item.bill_id) navigation.navigate('BillSplit', { billId: item.bill_id });
          }}
        />
      </ScrollView>

      <FloatingActionButton
        loading={creatingBill}
        onPress={handleCreateBillFromReceipt}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: 'rgba(248, 249, 250, 0.88)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(248, 249, 250, 0.95)' },
    }),
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 14,
  },
  greetingBlock: {
    flex: 1,
    paddingRight: 12,
  },
  greetingName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
  },
  greetingRest: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  headerAvatarBtn: {
    flexShrink: 0,
  },
  headerAvatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#00897B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitials: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerAvatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  balanceHeroWrap: {
    marginTop: 24,
    marginBottom: 8,
  },
  balanceGradientCard: {
    borderRadius: radii.xl,
    padding: 24,
    overflow: 'hidden',
  },
  balanceCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balanceCardMain: {
    flex: 1,
    paddingRight: 12,
    minWidth: 0,
  },
  balanceLabelOnDark: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.6,
    color: 'rgba(255,255,255,0.72)',
    marginBottom: 8,
  },
  balanceAmountOnDark: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: '#FFFFFF',
  },
  balanceLoaderDark: {
    height: 72,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  balanceTrendBadge: {
    alignSelf: 'flex-start',
    marginTop: 14,
    backgroundColor: '#B2DFDB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.full,
  },
  balanceTrendBadgeNeg: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  balanceTrendBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: DASHBOARD_GREEN,
  },
  balanceTrendBadgeTextNeg: {
    color: '#FFFFFF',
  },
  balanceDollarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: {
    marginTop: 16,
    marginBottom: 32,
  },
  sectionRecentActivity: {
    marginBottom: 56,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
  },
  viewAllText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: DASHBOARD_GREEN,
  },

  emptyCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  emptySubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.outlineVariant,
  },
  // Same dimensions as the featured bill card below so the layout doesn't
  // snap to a taller/shorter card when real data arrives.
  loadingCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },

  featuredCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 20,
  },
  featuredCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  featuredIconWrapFeatured: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: RECEIPT_ICON_FEATURED_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featuredHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  featuredTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 4,
  },
  featuredSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
  },
  featuredParticipantsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  featuredParticipantsText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
  },
  featuredAmountFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surfaceContainerHigh,
  },
  featuredAmountCol: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  amountDueLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.onSurfaceVariant,
    marginBottom: 6,
  },
  featuredAmountLarge: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.onSurface,
  },
  settleButtonDark: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radii.full,
  },
  settleButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  secondaryBillsGap: {
    height: 12,
  },
  billCardGap: {
    height: 12,
  },
  secondaryCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    paddingVertical: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  secondaryIconWrapMint: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: MINT_ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryInfo: {
    flex: 1,
    minWidth: 0,
  },
  secondaryTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },
  secondarySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginTop: 3,
  },

  activityCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  activityItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerLow,
  },
  activityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityInfo: {
    flex: 1,
  },
  activityTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
  activityDate: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  activityRight: {
    alignItems: 'flex-end',
  },
  activityAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
  },
  activityAmountNeutral: {
    color: colors.onSurfaceVariant,
  },
  activityStatus: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },

  swipeDeleteAction: {
    backgroundColor: colors.error,
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
    marginLeft: 12,
    borderRadius: radii.xl,
    paddingVertical: 16,
  },
  swipeDeleteText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    color: colors.onError,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  fab: {
    position: 'absolute',
    right: FAB_RIGHT,
    bottom: FAB_BOTTOM,
    zIndex: 40,
  },
  fabGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGradientDisabled: {
    opacity: 0.82,
  },
});
