import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useDispatch, useStore } from 'react-redux';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg, {
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Path,
  Stop,
} from 'react-native-svg';
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
const DASHBOARD_GREEN = '#105D4B';
const DASHBOARD_GREEN_MID = '#1FA87A';
const DESIGN_BG = '#F7F9F8';
const DESIGN_SURFACE_BORDER = '#ECF0EE';
const DESIGN_TEXT = '#0F1F1A';
const DESIGN_MUTED = '#6B7280';
const DESIGN_MINT = '#4FD1A7';
const DESIGN_CARD_GRADIENT = ['#0E5443', '#105D4B', '#0A7C63'];
const RECEIPT_ICON_FEATURED_BG = '#FCE4EC';
const RECEIPT_ICON_FEATURED_FG = '#880E4F';
const MINT_ICON_BG = '#E0F2F1';

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

/**
 * "Done but not yet finalized" — every share owed has been paid, but the
 * host hasn't tapped *Mark bill completed* yet (which would flip the bill to
 * `settled` and route it through Recent activity instead).
 *
 * Two perspectives, both backed by fields the dashboard endpoint now returns:
 *   - Host: collected everything from non-host members
 *     (`bill_remaining ≈ 0` and we have actually collected at least
 *     something, so a brand-new draft with zero items doesn't masquerade
 *     as complete).
 *   - Guest: their own share is paid (`remaining ≈ 0`).
 *
 * We use a half-cent tolerance to absorb floating-point drift between the
 * dashboard payload (Decimal → JSON string → parseFloat) and the DB.
 */
function isBillComplete(bill) {
  if (!bill) return false;
  if (bill.is_host) {
    const billPaid = parseFloat(bill.bill_paid ?? 0);
    const billRemaining = parseFloat(bill.bill_remaining ?? 0);
    return billPaid > 0 && billRemaining <= 0.005;
  }
  const yourShare = parseFloat(bill.your_share ?? 0);
  const remaining = parseFloat(bill.remaining ?? 0);
  return yourShare > 0 && remaining <= 0.005;
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

function splitCurrencyParts(value) {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  const v = Number.isFinite(num) ? Number(num) : 0;
  const abs = Math.abs(v);
  const [ints, dec] = abs.toFixed(2).split('.');
  const formattedInts = Number(ints).toLocaleString('en-US');
  return { sign: v < 0 ? '-' : '', ints: formattedInts, dec };
}

/** Trend graphic for the hero balance card (matches marketing mock). */
function SparkHeroChart({ trendUp }) {
  const W = 92;
  const H = 32;
  const pts = trendUp
    ? [
        [0, H],
        [8.36, H - 5.33],
        [16.73, H - 2.67],
        [25.09, H - 10.67],
        [33.45, H - 8],
        [41.82, H - 16],
        [50.18, H - 13.33],
        [58.55, H - 21.33],
        [66.91, H - 18.67],
        [75.27, H - 26.67],
        [83.64, H - 24],
        [92, 0],
      ]
    : [
        [0, 4],
        [10, 12],
        [20, 8],
        [30, 18],
        [40, 14],
        [50, 22],
        [60, 16],
        [70, 26],
        [80, 20],
        [92, H - 4],
      ];
  const lineD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const areaD = `${lineD} L${W},${H} L0,${H} Z`;
  const lx = pts[pts.length - 1][0];
  const ly = pts[pts.length - 1][1];
  const gid = trendUp ? 'heroSparkUp' : 'heroSparkDn';
  return (
    <Svg width={W} height={H}>
      <Defs>
        <SvgLinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={DESIGN_MINT} stopOpacity={0.28} />
          <Stop offset="100%" stopColor={DESIGN_MINT} stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Path d={areaD} fill={`url(#${gid})`} />
      <Path
        d={lineD}
        fill="none"
        stroke={DESIGN_MINT}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={lx} cy={ly} r={3} fill={DESIGN_MINT} />
      <Circle cx={lx} cy={ly} r={6} fill={DESIGN_MINT} opacity={0.25} />
    </Svg>
  );
}

/** Compact spark for person rows (`uid` avoids Svg gradient id collisions). */
function SparkRowChart({ positive, uid = 'spark' }) {
  const W = 48;
  const H = 20;
  const pts = positive
    ? [
        [0, H],
        [8, H - 6.67],
        [16, H - 3.33],
        [24, H - 10],
        [32, H - 16.67],
        [40, H - 13.33],
        [48, 0],
      ]
    : [
        [0, 2],
        [8, 6],
        [16, 12],
        [24, 8],
        [32, 16],
        [40, H],
        [48, H - 5],
      ];
  const stroke = positive ? DESIGN_MINT : '#E25C5C';
  const lineD = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const areaD = `${lineD} L${W},${H} L0,${H} Z`;
  const lx = pts[pts.length - 1][0];
  const ly = pts[pts.length - 1][1];
  const gid = `${uid}-${positive ? 'rowSparkUp' : 'rowSparkDn'}`;
  return (
    <Svg width={W} height={H}>
      <Defs>
        <SvgLinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <Stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Path d={areaD} fill={`url(#${gid})`} />
      <Path
        d={lineD}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={lx} cy={ly} r={3} fill={stroke} />
      <Circle cx={lx} cy={ly} r={6} fill={stroke} opacity={0.25} />
    </Svg>
  );
}

function TopAppBar({ insets, user, navigation }) {
  const firstName = firstNameFromUser(user);

  const initials = (user?.full_name || user?.phone || '?')
    .toString()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

  const openProfile = () => navigation.navigate('ProfileTab');
  const openNotifications = () => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) parent.navigate('Notifications');
  };

  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 6 }]}>
      <View style={styles.topBarRow}>
        <View style={styles.headerIdentity}>
          <TouchableOpacity
            accessibilityLabel="Profile"
            onPress={openProfile}
            activeOpacity={0.85}
            style={styles.headerAvatarGradientWrap}
          >
            <LinearGradient
              colors={[DESIGN_MINT, DASHBOARD_GREEN]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerAvatarGradient}
            >
              {user?.avatar_url ? (
                <LazyImage
                  source={{ uri: user.avatar_url }}
                  style={styles.headerAvatarImgSmall}
                  fallbackIcon="person"
                  fallbackIconSize={20}
                />
              ) : (
                <Text style={styles.headerAvatarGradientInitials}>{initials}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
          <View style={styles.headerGreetingCol}>
            <Text style={styles.welcomeBackSmall}>Welcome back</Text>
            <Text style={styles.headerDisplayName} numberOfLines={1}>
              {firstName}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.85}
            onPress={openNotifications}
            accessibilityLabel="Notifications"
          >
            <MaterialIcons name="notifications-none" size={22} color={DESIGN_TEXT} />
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function NetBalanceCard({
  overview,
  isLoading,
  billsThisWeek,
}) {
  const [hidden, setHidden] = useState(false);
  /** MVP: surface only money owed *to* the user (host / collecting). */
  const owedToYou = parseFloat(overview?.total_owed_to_you ?? 0);
  const parts = splitCurrencyParts(owedToYou);
  const trendUp = owedToYou >= 0;

  const weeklyLabel =
    billsThisWeek > 0
      ? `${billsThisWeek} bill${billsThisWeek === 1 ? '' : 's'} updated this week`
      : null;

  return (
    <View style={styles.netCardOuter}>
      <LinearGradient
        colors={DESIGN_CARD_GRADIENT}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[styles.netCardGradient, shadows.card]}
      >
        <View style={styles.netOrbTop} />
        <View style={styles.netOrbBottom} />

        <View style={styles.netCardInner}>
          <View style={styles.netCardTitleRow}>
            <Text style={styles.netBalanceLabel}>You&apos;re owed</Text>
            <TouchableOpacity
              style={styles.netEyeBtn}
              onPress={() => setHidden((h) => !h)}
              accessibilityLabel={hidden ? 'Show amount' : 'Hide amount'}
            >
              <MaterialIcons
                name={hidden ? 'visibility' : 'visibility-off'}
                size={16}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>

          <View style={styles.netAmountRow}>
            <View style={styles.netAmountLeft}>
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" style={{ marginTop: 8 }} />
              ) : hidden ? (
                <Text style={styles.netAmountHidden}>••••••</Text>
              ) : (
                <View style={styles.netAmountSplit}>
                  <Text style={styles.netDollarSym}>{parts.sign}$</Text>
                  <Text style={styles.netDollars}>{parts.ints}</Text>
                  <Text style={styles.netCents}>.{parts.dec}</Text>
                </View>
              )}
            </View>
            {!isLoading && !hidden ? (
              <View style={styles.sparkHeroWrap}>
                <SparkHeroChart trendUp={trendUp} />
              </View>
            ) : null}
          </View>

          {!isLoading && !hidden && weeklyLabel ? (
            <View style={styles.netWeeklyPill}>
              <MaterialIcons name="trending-up" size={12} color={DESIGN_MINT} />
              <Text style={styles.netWeeklyPillText}>{weeklyLabel}</Text>
            </View>
          ) : null}
        </View>
      </LinearGradient>
    </View>
  );
}

const PEOPLE_AVATAR_COLORS = ['#1FA87A', '#E8A443', '#5B8DEF', '#D762A4', '#6B7280'];

function buildPeoplePreviewRows(activeBills, completedActiveBills) {
  const rows = [];
  const paletteIdx = { current: 0 };
  const nextColor = () => {
    const c = PEOPLE_AVATAR_COLORS[paletteIdx.current % PEOPLE_AVATAR_COLORS.length];
    paletteIdx.current += 1;
    return c;
  };

  const pushBill = (bill) => {
    // MVP: only list splits where you're collecting (owed to you).
    if (!bill.is_host) return;

    const title = bill.merchant_name || bill.title || 'Bill';
    const letter = `${title}`.trim().charAt(0).toUpperCase() || '?';
    const billRem = parseFloat(bill.bill_remaining ?? 0);
    const paidAgg = parseFloat(bill.bill_paid ?? 0);

    let amountLabel = '';
    let positive = true;
    let subtitle = `${bill.member_count} ${bill.member_count === 1 ? 'person' : 'people'}`;
    if (billRem > 0.005) {
      amountLabel = `+${formatCurrency(billRem)}`;
      subtitle = `Collecting · ${subtitle}`;
    } else if (paidAgg > 0 && billRem <= 0.005) {
      amountLabel = formatCurrency(paidAgg);
      subtitle = `Paid · ${subtitle}`;
    } else {
      amountLabel = formatCurrency(0);
      subtitle = `${bill.status} · ${subtitle}`;
    }
    rows.push({
      key: `host-${bill.id}`,
      initials: letter,
      avatarColor: nextColor(),
      title,
      subtitle,
      amountLabel,
      positive,
    });
  };

  for (const b of activeBills ?? []) pushBill(b);
  for (const b of completedActiveBills ?? []) pushBill(b);

  return rows.slice(0, 12);
}

function PersonPreviewCard({ row }) {
  const amtColor = row.positive ? DASHBOARD_GREEN_MID : '#E25C5C';
  return (
    <View style={[styles.personCard, shadows.card]}>
      <View style={[styles.personAvatar, { backgroundColor: row.avatarColor }]}>
        <Text style={styles.personAvatarLetter}>{row.initials}</Text>
      </View>
      <View style={styles.personCardMid}>
        <Text style={styles.personCardTitle} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.personCardSub} numberOfLines={1}>
          {row.subtitle}
        </Text>
      </View>
      <View style={styles.personCardRight}>
        <SparkRowChart positive={row.positive} uid={String(row.key)} />
        <Text style={[styles.personCardAmt, { color: amtColor }]}>{row.amountLabel}</Text>
      </View>
    </View>
  );
}

function ActivityPreviewCard({ item, onPress, sparkUid = 'activity' }) {
  const meta = ACTIVITY_TYPE_META[item.type] || { icon: 'info', positive: true };
  const hasAmount = item.amount != null && Number.isFinite(item.amount);
  const neutralAmount = !!meta.neutralAmount;
  const subtitle =
    item.type === 'past_bill' && item.member_count != null
      ? `${formatRelativeTime(item.timestamp)} · ${item.member_count} ${
          item.member_count === 1 ? 'person' : 'people'
        }`
      : formatRelativeTime(item.timestamp);
  const chipLetter = (item.bill_title || '?').trim().charAt(0).toUpperCase();

  let amtText = '';
  let amtPositive = meta.positive;
  if (hasAmount) {
    amtText = neutralAmount
      ? formatCurrency(item.amount)
      : `${meta.positive ? '+' : '−'}${formatCurrency(item.amount)}`;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => onPress(item)}
      style={[styles.personCard, shadows.card]}
    >
      <View style={[styles.personAvatar, { backgroundColor: PEOPLE_AVATAR_COLORS[2] }]}>
        <Text style={styles.personAvatarLetter}>{chipLetter}</Text>
      </View>
      <View style={styles.personCardMid}>
        <Text style={styles.personCardTitle} numberOfLines={1}>
          {item.bill_title || item.description || 'Activity'}
        </Text>
        <Text style={styles.personCardSub} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.personCardRight}>
        {hasAmount ? (
          <>
            <SparkRowChart positive={amtPositive} uid={sparkUid} />
            <Text
              style={[
                styles.personCardAmt,
                neutralAmount && { color: DESIGN_MUTED },
                !neutralAmount && { color: amtPositive ? DASHBOARD_GREEN_MID : '#E25C5C' },
              ]}
            >
              {amtText}
            </Text>
          </>
        ) : (
          <MaterialIcons name={meta.icon} size={22} color={DESIGN_MUTED} />
        )}
      </View>
    </TouchableOpacity>
  );
}

function YourPeopleSection({
  tab,
  onTabChange,
  peopleRows,
  recentActivity,
  navigation,
  activeBills,
  completedActiveBills,
  onSettle,
  onDelete,
  onOpenBill,
  billsLoading,
}) {
  const openNotifications = () => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) parent.navigate('Notifications');
  };

  const tabs = [
    { key: 'friends', label: 'Friends' },
    { key: 'bills', label: 'Bills' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <View style={styles.yourPeopleSection}>
      <View style={styles.yourPeopleHeader}>
        <Text style={styles.yourPeopleTitle}>Your people</Text>
      </View>

      <View style={styles.segmentWrap}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => onTabChange(t.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'friends' ? (
        <View style={styles.yourPeopleList}>
          {peopleRows.length === 0 ? (
            <View style={[styles.personEmptyCard, shadows.card]}>
              <MaterialIcons name="groups" size={36} color={DESIGN_MUTED} />
              <Text style={styles.personEmptyTitle}>No active splits yet</Text>
              <Text style={styles.personEmptySub}>Scan a receipt and invite friends — they&apos;ll show up here.</Text>
            </View>
          ) : (
            peopleRows.map((row) => <PersonPreviewCard key={row.key} row={row} />)
          )}
        </View>
      ) : null}

      {tab === 'bills' ? (
        <View style={styles.yourPeopleListFlat}>
          <ActiveBillsSection
            bills={activeBills}
            onSettle={onSettle}
            onDelete={onDelete}
            onOpenBill={onOpenBill}
            onViewAll={openNotifications}
            isLoading={billsLoading}
          />
          <BillCompleteSection bills={completedActiveBills} onOpenBill={onOpenBill} onDelete={onDelete} />
        </View>
      ) : null}

      {tab === 'activity' ? (
        <View style={styles.yourPeopleList}>
          {!recentActivity?.length ? (
            <View style={[styles.personEmptyCard, shadows.card]}>
              <MaterialIcons name="history" size={36} color={DESIGN_MUTED} />
              <Text style={styles.personEmptyTitle}>No activity yet</Text>
              <Text style={styles.personEmptySub}>Closed bills and updates will appear here.</Text>
            </View>
          ) : (
            recentActivity.map((item, idx) => (
              <ActivityPreviewCard
                key={
                  item.bill_id
                    ? `act-${item.bill_id}-${idx}`
                    : `${item.type}-${String(item.timestamp)}-${idx}`
                }
                sparkUid={`activity-${idx}`}
                item={item}
                onPress={(it) => {
                  if (it.bill_id) navigation.navigate('BillSplit', { billId: it.bill_id });
                }}
              />
            ))
          )}
        </View>
      ) : null}
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

/**
 * Card variant shown inside the "Bill complete" section. Visually celebratory
 * (green check + filled mint background) and replaces the Settle Now CTA with
 * a quiet status row, since there's nothing for the user to act on except
 * optionally finalizing the bill (handled inside the bill detail screen).
 */
function CompletedBillCard({ bill, onOpenBill }) {
  if (!bill) return null;
  const collected = parseFloat(
    bill.is_host ? (bill.bill_paid ?? 0) : (bill.paid ?? 0),
  );
  return (
    <TouchableOpacity
      style={[styles.completedCard, shadows.card]}
      activeOpacity={0.92}
      onPress={() => onOpenBill(bill)}
    >
      <View style={styles.completedIconWrap}>
        <MaterialIcons name="check-circle" size={22} color={DASHBOARD_GREEN} />
      </View>
      <View style={styles.completedInfo}>
        <Text style={styles.completedTitle} numberOfLines={1}>
          {bill.title || bill.merchant_name}
        </Text>
        <Text style={styles.completedSubtitle}>
          {bill.is_host
            ? `All ${bill.member_count} ${bill.member_count === 1 ? 'member' : 'members'} paid · ${formatCurrency(collected)} collected`
            : `You paid ${formatCurrency(collected)} · awaiting host`}
        </Text>
      </View>
      <View style={styles.completedBadge}>
        <Text style={styles.completedBadgeText}>Paid</Text>
      </View>
    </TouchableOpacity>
  );
}

function BillCompleteSection({ bills, onOpenBill, onDelete }) {
  if (!bills || bills.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Bill complete</Text>
      </View>
      {bills.map((bill, idx) => (
        <React.Fragment key={bill.id}>
          <SwipeToDeleteBill bill={bill} onDelete={onDelete}>
            <CompletedBillCard bill={bill} onOpenBill={onOpenBill} />
          </SwipeToDeleteBill>
          {idx !== bills.length - 1 && <View style={styles.billCardGap} />}
        </React.Fragment>
      ))}
    </View>
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
  const rawActiveBills = data?.activeBills ?? [];
  const pastBills = data?.pastBills ?? [];

  // Split `active` bills the server returns into two buckets:
  //   • `activeBills` — still collecting (rendered with Settle Now CTA).
  //   • `completedActiveBills` — every share paid, but the host hasn't
  //     tapped Mark bill completed yet, so the bill row is technically
  //     still `active`. We give those their own "Bill complete" section
  //     so the home screen doesn't keep nagging the user with a Settle Now
  //     button on a bill that has nothing left to settle.
  const { activeBills, completedActiveBills } = useMemo(() => {
    const inProgress = [];
    const complete = [];
    for (const bill of rawActiveBills) {
      if (isBillComplete(bill)) {
        complete.push(bill);
      } else {
        inProgress.push(bill);
      }
    }
    return { activeBills: inProgress, completedActiveBills: complete };
  }, [rawActiveBills]);

  // Per-section loading flags. We *don't* gate the whole page on these —
  // the layout always renders so the user immediately sees their name,
  // avatar, and the FAB, with inline spinners where data is still fetching.
  //
  // "Loading" means: we don't have data yet AND (the network is still in
  // flight OR we haven't finished reading the disk cache). This prevents
  // a brief flash of a stale "$0.00" while the AsyncStorage read is
  // resolving on cold launch.
  const balanceLoading = !overview && (dashboardLoading || !hydrated);
  // Base the inline loader on the *raw* bill list so a dashboard with only
  // completed bills doesn't flash a "Loading your bills…" spinner where the
  // (now empty) Active Bills section sits.
  const billsLoadingInline =
    rawActiveBills.length === 0 && (dashboardLoading || !hydrated);
  const recentActivity = useMemo(
    () => mapPastBillsToActivityItems(pastBills),
    [pastBills],
  );

  const billsThisWeek = useMemo(() => {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const merged = [...rawActiveBills, ...pastBills];
    return merged.filter((b) => {
      const t = new Date(b.updated_at || b.created_at).getTime();
      return Number.isFinite(t) && now - t < weekMs;
    }).length;
  }, [rawActiveBills, pastBills]);

  const peopleRows = useMemo(
    () => buildPeoplePreviewRows(activeBills, completedActiveBills),
    [activeBills, completedActiveBills],
  );

  const [refreshing, setRefreshing] = useState(false);
  const [peopleTab, setPeopleTab] = useState('friends');

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

  return (
    <View style={styles.root}>
      <TopAppBar insets={insets} user={user} navigation={navigation} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 58, paddingBottom: tabBarHeight + 56 },
        ]}
        showsVerticalScrollIndicator={false}
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
        <NetBalanceCard
          overview={overview}
          isLoading={balanceLoading}
          billsThisWeek={billsThisWeek}
        />
        <YourPeopleSection
          tab={peopleTab}
          onTabChange={setPeopleTab}
          peopleRows={peopleRows}
          recentActivity={recentActivity}
          navigation={navigation}
          activeBills={activeBills}
          completedActiveBills={completedActiveBills}
          onSettle={handleSettle}
          onDelete={handleDeleteBill}
          onOpenBill={handleOpenBill}
          billsLoading={billsLoadingInline}
        />
      </ScrollView>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DESIGN_BG,
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
    backgroundColor: DESIGN_BG,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  headerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  headerAvatarGradientWrap: {
    shadowColor: '#105D4B',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  headerAvatarGradient: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarGradientInitials: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerAvatarImgSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  headerGreetingCol: {
    flex: 1,
    minWidth: 0,
  },
  welcomeBackSmall: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: DESIGN_MUTED,
  },
  headerDisplayName: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: DESIGN_TEXT,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: DESIGN_SURFACE_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F1F1A',
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E25C5C',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
  },

  netCardOuter: {
    marginTop: 18,
    marginBottom: 4,
  },
  netCardGradient: {
    borderRadius: 28,
    paddingVertical: 22,
    paddingHorizontal: 22,
    overflow: 'hidden',
    position: 'relative',
  },
  netOrbTop: {
    position: 'absolute',
    top: -80,
    right: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(79, 209, 167, 0.33)',
    opacity: 0.45,
  },
  netOrbBottom: {
    position: 'absolute',
    bottom: -120,
    left: -40,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: 'rgba(31, 168, 122, 0.2)',
    opacity: 0.6,
  },
  netCardInner: {
    position: 'relative',
    zIndex: 2,
  },
  netCardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  netBalanceLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.7)',
  },
  netEyeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  netAmountRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 6,
  },
  netAmountLeft: {
    flexShrink: 1,
    minWidth: 0,
  },
  netAmountSplit: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  netDollarSym: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 22,
    fontWeight: '800',
    color: 'rgba(255,255,255,0.85)',
  },
  netDollars: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 44,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1.5,
  },
  netCents: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: -0.5,
  },
  netAmountHidden: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 4,
  },
  sparkHeroWrap: {
    marginBottom: 4,
  },
  netWeeklyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(79, 209, 167, 0.18)',
    marginBottom: 10,
  },
  netWeeklyPillText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    color: DESIGN_MINT,
  },

  yourPeopleSection: {
    marginTop: 22,
    paddingBottom: 8,
  },
  yourPeopleHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 4,
  },
  yourPeopleTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    color: DESIGN_TEXT,
  },
  segmentWrap: {
    flexDirection: 'row',
    gap: 6,
    padding: 4,
    marginTop: 12,
    borderRadius: 14,
    backgroundColor: '#EEF2F0',
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 11,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F1F1A',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  segmentBtnText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 13,
    fontWeight: '700',
    color: DESIGN_MUTED,
  },
  segmentBtnTextActive: {
    color: DASHBOARD_GREEN,
  },
  yourPeopleList: {
    marginTop: 14,
    gap: 8,
  },
  yourPeopleListFlat: {
    marginTop: 14,
  },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DESIGN_SURFACE_BORDER,
    shadowColor: '#0F1F1A',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  personAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personAvatarLetter: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  personCardMid: {
    flex: 1,
    minWidth: 0,
  },
  personCardTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: DESIGN_TEXT,
  },
  personCardSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: DESIGN_MUTED,
    marginTop: 2,
  },
  personCardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  personCardAmt: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 14,
    fontWeight: '800',
  },
  personEmptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: DESIGN_SURFACE_BORDER,
    gap: 8,
  },
  personEmptyTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: DESIGN_TEXT,
  },
  personEmptySub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: DESIGN_MUTED,
    textAlign: 'center',
    lineHeight: 18,
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
  sectionTitleRecentActivity: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 15,
    marginTop: -10,
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

  // ── Bill complete card ──────────────────────────────────────────────
  // Same shape as `secondaryCard` so the layout stays calm, but with a
  // mint check-circle and a small "Paid" badge so the user can tell at a
  // glance that the bill is done collecting.
  completedCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    paddingVertical: 18,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  completedIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: MINT_ICON_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedInfo: {
    flex: 1,
    minWidth: 0,
  },
  completedTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },
  completedSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginTop: 3,
  },
  completedBadge: {
    backgroundColor: DASHBOARD_GREEN,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
  },
  completedBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#FFFFFF',
    textTransform: 'uppercase',
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
});
