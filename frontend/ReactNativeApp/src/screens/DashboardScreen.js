import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
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
  Dimensions,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, shadows, spacing } from '../theme';
import { useAuth } from '../contexts/AuthContext';
import { bills } from '../services/api';
import {
  useGetDashboardQuery,
  hydrateDashboardFromCache,
} from '../store/api';
import LazyImage from '../components/LazyImage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');



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
};

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num == null || isNaN(num)) return '$0.00';
  return `$${Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatRelativeTime(timestamp) {
  const date = new Date(timestamp);
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

// ─── Sub-components ──────────────────────────────────────────────────────────

function TopAppBar({ insets, user }) {
  const { logout } = useAuth();

  const displayName =
    user?.full_name && user.full_name !== 'Member'
      ? compactDisplayName(user.full_name)
      : user?.phone
        ? compactDisplayName(user.phone)
        : 'Member';

  const initials = (user?.full_name || user?.phone || '?')
    .toString()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const onLogout = () => {
    Alert.alert('Log out', 'Sign out of WealthSplit on this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBarInner}>
        <View style={styles.profileRow}>
          <View style={styles.avatarContainer}>
            {user?.avatar_url ? (
              <LazyImage
                source={{ uri: user.avatar_url }}
                style={styles.profileAvatar}
                fallbackIcon="person"
              />
            ) : (
              <View style={[styles.profileAvatar, styles.initialsAvatar]}>
                <Text style={styles.initialsText}>{initials}</Text>
              </View>
            )}
          </View>
          <View style={styles.profileTextCol}>
            <Text style={styles.welcomeLabel}>Welcome back,</Text>
            <Text style={styles.userName} numberOfLines={1} ellipsizeMode="tail">
              {displayName}
            </Text>
          </View>
        </View>
        <View style={styles.topBarActions}>
          <TouchableOpacity
            style={styles.iconButtonWrap}
            activeOpacity={0.7}
            onPress={onLogout}
            accessibilityLabel="Log out"
          >
            <MaterialIcons name="logout" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function BalanceHero({ overview, isLoading }) {
  const owedToYou = parseFloat(overview?.total_owed_to_you ?? 0);
  const youOwe = parseFloat(overview?.total_you_owe ?? 0);
  const net = owedToYou - youOwe;
  const badgeText = net >= 0
    ? `+${formatCurrency(net)} owed to you`
    : `-${formatCurrency(net)} you owe`;

  return (
    <View style={styles.balanceHero}>
      <Text style={styles.balanceLabel}>Current Balance</Text>
      {isLoading ? (
        // Reserve the same vertical space the real amount would take so the
        // badge below doesn't jump when data arrives.
        <View style={styles.balanceLoader}>
          <ActivityIndicator size="large" color={colors.secondary} />
        </View>
      ) : (
        <>
          <Text style={styles.balanceAmount}>
            {net < 0 ? '-' : ''}{formatCurrency(net)}
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.weeklyBadge, net < 0 && styles.weeklyBadgeNegative]}>
              <Text style={[styles.weeklyBadgeText, net < 0 && styles.weeklyBadgeTextNegative]}>
                {badgeText}
              </Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function MemberCountBubbles({ count }) {
  const shown = Math.min(count, 3);
  const extra = count - shown;
  return (
    <View style={styles.avatarStack}>
      {Array.from({ length: shown }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stackAvatar,
            styles.placeholderAvatar,
            { marginLeft: i === 0 ? 0 : -12, zIndex: shown - i },
          ]}
        >
          <MaterialIcons name="person" size={18} color={colors.onSurfaceVariant} />
        </View>
      ))}
      {extra > 0 && (
        <View style={[styles.stackOverflow, { marginLeft: -12 }]}>
          <Text style={styles.stackOverflowText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * Wraps a bill card with left-swipe-to-delete. Only drafts are actually
 * deletable from here; for other statuses we just render the child unchanged
 * so users can't accidentally delete an active or settled bill.
 */
function SwipeToDeleteBill({ bill, onDelete, children }) {
  const swipeableRef = useRef(null);
  const isDraft = bill?.status === 'draft';

  if (!isDraft) {
    return children;
  }

  const close = () => {
    try {
      swipeableRef.current?.close();
    } catch {
      // ignore — ref may already be unmounted mid-animation
    }
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete draft?',
      'This will permanently remove this draft bill. This action cannot be undone.',
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

function FeaturedBillCard({ bill, onSettle }) {
  if (!bill) return null;
  const remaining = parseFloat(bill.remaining ?? bill.total ?? 0);

  return (
    <View style={[styles.featuredCard, shadows.card]}>
      <View style={styles.featuredCardTop}>
        <View style={styles.featuredIconWrap}>
          <MaterialIcons name="receipt-long" size={24} color={colors.tertiary} />
        </View>
        {remaining > 50 && (
          <View style={styles.priorityBadge}>
            <Text style={styles.priorityText}>High Priority</Text>
          </View>
        )}
      </View>
      <Text style={styles.featuredTitle} numberOfLines={1}>
        {bill.title || bill.merchant_name}
      </Text>
      <Text style={styles.featuredSubtitle}>
        Split between {bill.member_count} {bill.member_count === 1 ? 'person' : 'people'}
      </Text>
      <View style={styles.featuredBottom}>
        <MemberCountBubbles count={bill.member_count} />
        <View style={styles.settleRow}>
          <Text style={styles.featuredAmount}>{formatCurrency(remaining)}</Text>
          <TouchableOpacity activeOpacity={0.85} onPress={() => onSettle(bill)}>
            <LinearGradient
              colors={[colors.secondary, colors.secondaryDim]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.settleButton, shadows.settleButton]}
            >
              <Text style={styles.settleButtonText}>Settle Now</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function SecondaryBillCard({ bill }) {
  return (
    <View style={styles.secondaryCard}>
      <View style={styles.secondaryIconWrap}>
        <MaterialIcons name="receipt-long" size={22} color={colors.secondary} />
      </View>
      <View style={styles.secondaryInfo}>
        <Text style={styles.secondaryTitle} numberOfLines={1}>
          {bill.title || bill.merchant_name}
        </Text>
        <Text style={styles.secondarySubtitle}>
          {bill.status} • {bill.member_count} {bill.member_count === 1 ? 'member' : 'members'}
        </Text>
      </View>
      <Text style={styles.secondaryAmount}>{formatCurrency(bill.remaining ?? bill.total)}</Text>
    </View>
  );
}

function ActiveBillsSection({ bills, onSettle, onDelete, isLoading }) {
  // While the backend is cold-starting, show a card-shaped spinner so the
  // page layout stays stable instead of collapsing to an empty state.
  if (isLoading) {
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Active Bills</Text>
        </View>
        <View style={[styles.loadingCard, shadows.card]}>
          <ActivityIndicator size="large" color={colors.secondary} />
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
      </View>
      <SwipeToDeleteBill bill={featured} onDelete={onDelete}>
        <FeaturedBillCard bill={featured} onSettle={onSettle} />
      </SwipeToDeleteBill>
      {rest.length > 0 && <View style={styles.secondaryBillsGap} />}
      {rest.slice(0, 3).map((bill) => (
        <React.Fragment key={bill.id}>
          <SwipeToDeleteBill bill={bill} onDelete={onDelete}>
            <SecondaryBillCard bill={bill} />
          </SwipeToDeleteBill>
          <View style={styles.billCardGap} />
        </React.Fragment>
      ))}
    </View>
  );
}

function ActivityItem({ item, isLast, onPress }) {
  const meta = ACTIVITY_TYPE_META[item.type] || { icon: 'info', positive: true };
  const hasAmount = item.amount != null;
  const positive = meta.positive;

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
        <Text style={styles.activityDate}>{formatRelativeTime(item.timestamp)}</Text>
      </View>
      <View style={styles.activityRight}>
        {hasAmount && (
          <Text
            style={[
              styles.activityAmount,
              { color: positive ? colors.secondary : colors.error },
            ]}
          >
            {positive ? '+' : '-'}{formatCurrency(item.amount)}
          </Text>
        )}
        <Text style={styles.activityStatus}>
          {item.type.replace(/_/g, ' ')}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function RecentActivitySection({ activities, onItemPress }) {
  if (!activities || activities.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={[styles.emptyCard, shadows.card]}>
          <MaterialIcons name="history" size={40} color={colors.outlineVariant} />
          <Text style={styles.emptyText}>No recent activity</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Recent Activity</Text>
      <View style={[styles.activityCard, shadows.card]}>
        {activities.map((item, i) => (
          <ActivityItem
            key={`${item.type}-${item.timestamp}-${i}`}
            item={item}
            isLast={i === activities.length - 1}
            onPress={() => onItemPress(item)}
          />
        ))}
      </View>
    </View>
  );
}

function FloatingActionButton({ tabBarHeight, onPress, loading }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={loading}
      style={[styles.fab, shadows.fab, { bottom: tabBarHeight + 16 }]}
    >
      <LinearGradient
        colors={[colors.secondary, colors.secondaryDim]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.fabGradient, loading && styles.fabGradientDisabled]}
      >
        {loading ? (
          <ActivityIndicator color={colors.onSecondary} />
        ) : (
          <MaterialIcons name="add" size={28} color={colors.onSecondary} />
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
  const recentActivity = [];

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

  const handleDeleteBill = useCallback(
    async (bill) => {
      if (!bill?.id) return;
      try {
        await bills.delete(bill.id);
      } finally {
        // Always refetch — the server is the source of truth. If the
        // delete failed the bill simply reappears, which is the right UX.
        await refetchDashboard();
      }
    },
    [refetchDashboard],
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
      <TopAppBar insets={insets} user={user} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 72, paddingBottom: tabBarHeight + 88 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.secondary}
          />
        }
      >
        <BalanceHero overview={overview} isLoading={balanceLoading} />
        <ActiveBillsSection
          bills={activeBills}
          onSettle={handleSettle}
          onDelete={handleDeleteBill}
          isLoading={billsLoadingInline}
        />
        <RecentActivitySection
          activities={recentActivity}
          onItemPress={(item) => {
            if (item.bill_id) navigation.navigate('ActivityDetail', { billId: item.bill_id });
          }}
        />
      </ScrollView>

      <FloatingActionButton
        tabBarHeight={tabBarHeight}
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
    backgroundColor: 'rgba(248, 249, 250, 0.7)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(248, 249, 250, 0.92)' },
    }),
  },
  topBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  profileTextCol: {
    flex: 1,
    minWidth: 0,
  },
  avatarContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: colors.surfaceContainerHighest,
  },
  profileAvatar: {
    width: 40,
    height: 40,
  },
  initialsAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.secondaryContainer,
    borderRadius: 20,
  },
  initialsText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
  },
  welcomeLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: colors.onSurfaceVariant,
  },
  userName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
  },
  iconButtonWrap: {
    padding: 8,
    position: 'relative',
  },
  notifBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    color: colors.onError,
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  balanceHero: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  balanceLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: colors.onSurfaceVariant,
    marginBottom: 4,
  },
  balanceAmount: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -2,
    color: colors.onSurface,
  },
  // 84px ≈ the combined height of the $48 amount + the badge row below it,
  // so swapping spinner → real content doesn't shift the page.
  balanceLoader: {
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  weeklyBadge: {
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  weeklyBadgeNegative: {
    backgroundColor: colors.errorContainer,
  },
  weeklyBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSecondaryContainer,
  },
  weeklyBadgeTextNegative: {
    color: colors.error,
  },

  section: {
    marginTop: 16,
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
    marginBottom: 10
  },
  viewAllText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.secondary,
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
    padding: 24,
  },
  featuredCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  featuredIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.tertiaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityBadge: {
    backgroundColor: colors.errorContainer,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.sm,
  },
  priorityText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    color: colors.error,
  },
  featuredTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 22,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 4,
  },
  featuredSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
  },
  featuredBottom: {
    marginTop: 24,
  },
  settleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  featuredAmount: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    color: colors.onSurface,
  },
  settleButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: radii.full,
  },
  settleButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSecondary,
  },

  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.surfaceContainerLowest,
  },
  placeholderAvatar: {
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackOverflow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.surfaceContainerLowest,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackOverflowText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },

  secondaryBillsGap: {
    height: 12,
  },
  billCardGap: {
    height: 12,
  },
  secondaryCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  secondaryIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryInfo: {
    flex: 1,
  },
  secondaryTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
  },
  secondarySubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  secondaryAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
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
    right: 24,
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
