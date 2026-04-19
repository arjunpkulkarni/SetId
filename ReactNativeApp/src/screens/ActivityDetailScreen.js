import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import LazyImage from '../components/LazyImage';

const PROFILE_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuA4Q8bK2N4eUmRk0_HtgWnKovg1C-O7rnE-YOCak6s0g_jDIWWg422kEwBvDK6B6splBGWbYH6zOJCIDhXKF8LEun1U_uKD0aUWkgU4eUloundcAQ3YoYXtBql3yONRjv7RgRBx5kkdVZp1EIh9bE9efd5o3cHnEDcmuwsJYEXr1undNZ-QU4uki8rEEUBAeIhDOXx7wrXCCbfiUSNTpvGwETMoNCtdoxySp-72maId718X0-PQ7I-3lCwny0IzohU_CBfFR9Rx';

const PARTICIPANTS = [
  {
    id: '1',
    name: 'Alex M. (You)',
    detail: 'Paid via WealthSplit',
    amount: '$12.50',
    status: 'paid',
    statusLabel: 'Paid',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCptKGjWSMJFxNwkN0IPGEvNIodUKSAnNm_OkzkLqb3su864y9Hibm4CcV1Wrj-Mg-g4e6eFn5LakrqfgLOA8Z0pkvG1pGY1jJL7NJ_cTa2u7VSIP3VMPRFI8_nbo2_rJYGtFQ6YDaQAoJ1lFreavq94IBfdic1w7JgE5CV2AYMYlutYNlkHYFNxlgBb98jPkhEb5G4hB_ibuLvt2RDzwnTOJyufoEDNs4kJWLVHK5JuCCvjyc5fFyTDoF6TJA8Czel7Wohx3d1',
  },
  {
    id: '2',
    name: 'Sarah K.',
    detail: 'Pending request',
    amount: '$10.50',
    status: 'pending',
    statusLabel: 'Pending',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCJoW73q-GF7ia3dUmmdfz0xThHDFpIsstEBfkGbxDT29Ho7ktDlCEEVPzMziwCDUzHh9KPGi3Irp9Bd2HHsS5ObBcI8QDuCQDuw9hw1MTUsAsQMOxGYVquAYT0r2BUE_ShvbBbUJBTWlRyMyApZvAVxcjo2RUkZ2KC1L7u4m2CZejeNTJO6P1FR3eZyDeOgiamy0mobyJesnGvFcX1nC5WPXZ3Kz7aa_nKfz29Hv5Zs7q8FWf8Vx5PK6Fb3KHa5S8eoE4rYv-S',
  },
  {
    id: '3',
    name: 'Jordan L.',
    detail: 'Notification sent 2h ago',
    amount: '$15.50',
    status: 'reminder',
    statusLabel: 'Reminder Sent',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCNfc7LhGRw7TwadH1gzGKU_zAzWaML0bjxAsKj6zomT-bHPAWYYMCXpgPF15UiQXsE7gtm9GGZ3DDjbGnYBDs8tgE6ZvagQS7Qb5MH0HrFMlWmg85unSBWbvQHyJIEHJ2zSrnbIQ5G46PQ9DQPlYivbOr3q3SvT6F7EDp9J7P7aQAZes23mGOzcx7GRnNsXwaRP76PVwU2vJ-fw0UR6c3f-2AMOd0au91gGwQpyUjzGUXju4QBL7tixSxcLTaCRwurMHSaqany',
  },
  {
    id: '4',
    name: 'Mia W.',
    detail: 'Paid via Apple Pay',
    amount: '$8.00',
    status: 'paid',
    statusLabel: 'Paid',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuCCwZ7NRTGP_6fzk9QwotI9Wy1FdaHUfjBsa0VKwxPfcbp9z4EZmgV79atj7VlQfIsrFinpWfVjO76sHATqoiEGOSipEFTHZY7mpQOhIrQEfCTH3lcDFnVoj6Y-T_7jEZjOkchJa0mZSUfHM_t44O8tBoPyPCogwdyFENJ6BRZbvWy8FWNYMx-sXx3gYpx0r5LgpW96i6wb22yBorY3pR7Fawxl3nKc0m7BiJK3GXEzxp9of2B42ZzQcvdb0u7Dj7lIV4gVkOzK',
  },
  {
    id: '5',
    name: 'Ryan C.',
    detail: 'Paid via WealthSplit',
    amount: '$7.50',
    status: 'paid',
    statusLabel: 'Paid',
    avatar:
      'https://lh3.googleusercontent.com/aida-public/AB6AXuD1FWdFvy03jKS03b3w6QCkdRMK5osLRo_4fIK33K0fCGGtB3nkxzQfe8EUKQKZfq6SjVVyD50h1kNz2ZRDkdeKVrwXaafYonXUHYKOJ-AfSgSYi0sYnDM6__JyG5wbHKllD2hw23-lV3JD6P2UBh7RiTUGwbZAdpSuMcmkWDj9SgJc6qdRbWsj_Gm3TRi3sHMcj7nDGss9Yp8bJZwmm0JlUw8CbpmbRil4afdNYGwJi7TUqhbKlN7G7cSp01YxWO7ckH6Ls9HE',
  },
];

const STATUS_CONFIG = {
  paid: { color: colors.secondary, icon: 'check-circle' },
  pending: { color: colors.outline, icon: 'schedule' },
  reminder: { color: colors.tertiary, icon: 'mail' },
};

const COLLECTED = 45.0;
const REMAINING = 9.5;
const TOTAL = 54.5;
const PROGRESS = Math.round((COLLECTED / TOTAL) * 100);

function TopAppBar({ insets }) {
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBarInner}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarContainer}>
            <LazyImage source={{ uri: PROFILE_URL }} style={styles.profileAvatar} fallbackIcon="person" />
          </View>
          <Text style={styles.appTitle}>WealthSplit</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} activeOpacity={0.7}>
          <MaterialIcons name="notifications-none" size={24} color={colors.onSurface} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function BillHeader() {
  return (
    <View style={styles.billHeader}>
      <View style={styles.billHeaderLeft}>
        <Text style={styles.billTitle}>Dinner at Serafina</Text>
        <Text style={styles.billSubtitle}>Shared between 6 participants</Text>
      </View>
      <View style={styles.billHeaderRight}>
        <Text style={styles.billTotal}>$54.50</Text>
        <Text style={styles.billTotalLabel}>TOTAL BILL</Text>
      </View>
    </View>
  );
}

function ProgressCard() {
  return (
    <View style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>Collection Progress</Text>
        <Text style={styles.progressPercent}>{PROGRESS}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${PROGRESS}%` }]} />
      </View>
      <View style={styles.progressFooter}>
        <View style={styles.progressStat}>
          <Text style={styles.progressStatAmount}>${COLLECTED.toFixed(2)}</Text>
          <Text style={styles.progressStatLabel}> collected</Text>
        </View>
        <View style={styles.progressStat}>
          <Text style={styles.progressStatAmountError}>${REMAINING.toFixed(2)}</Text>
          <Text style={styles.progressStatLabel}> remaining</Text>
        </View>
      </View>
    </View>
  );
}

function ParticipantCard({ participant }) {
  const config = STATUS_CONFIG[participant.status];

  return (
    <View style={styles.participantCard}>
      <View style={styles.participantLeft}>
        <View style={styles.participantAvatarWrap}>
          <LazyImage source={{ uri: participant.avatar }} style={styles.participantAvatar} fallbackIcon="person" />
        </View>
        <View>
          <Text style={styles.participantName}>{participant.name}</Text>
          <Text style={styles.participantDetail}>{participant.detail}</Text>
        </View>
      </View>
      <View style={styles.participantRight}>
        <Text style={styles.participantAmount}>{participant.amount}</Text>
        <View style={styles.statusBadge}>
          <MaterialIcons name={config.icon} size={12} color={config.color} />
          <Text style={[styles.statusText, { color: config.color }]}>
            {participant.statusLabel}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ParticipantSection() {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Participant{'\n'}Status</Text>
        <TouchableOpacity activeOpacity={0.85} style={styles.nudgeButton}>
          <MaterialIcons name="campaign" size={16} color={colors.onSecondary} />
          <Text style={styles.nudgeText}>Nudge{'\n'}Pending</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.participantList}>
        {PARTICIPANTS.map((p) => (
          <ParticipantCard key={p.id} participant={p} />
        ))}
      </View>
    </View>
  );
}

function CashCallout({ onMarkPaid }) {
  return (
    <View style={styles.cashCallout}>
      <Text style={styles.cashTitle}>Did someone pay in cash?</Text>
      <Text style={styles.cashDesc}>
        You can manually mark participants as paid if they settled outside of the app.
      </Text>
      <TouchableOpacity activeOpacity={0.8} onPress={onMarkPaid} style={styles.markPaidButton}>
        <Text style={styles.markPaidText}>Mark Others as Paid</Text>
      </TouchableOpacity>
    </View>
  );
}

function BottomNavBar({ insets }) {
  const NAV = [
    { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', active: false },
    { key: 'activity', label: 'Activity', icon: 'receipt-long', active: true },
    { key: 'profile', label: 'Profile', icon: 'person', active: false },
  ];

  return (
    <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {NAV.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={[styles.navItem, item.active && styles.navItemActive]}
          activeOpacity={0.7}
        >
          <MaterialIcons
            name={item.icon}
            size={24}
            color={item.active ? colors.secondary : colors.outlineVariant}
          />
          <Text style={[styles.navLabel, item.active && styles.navLabelActive]}>
            {item.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function ActivityDetailScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <TopAppBar insets={insets} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <BillHeader />
        <ProgressCard />
        <ParticipantSection />
        <CashCallout onMarkPaid={() => navigation.navigate('FundsCollected')} />
      </ScrollView>

      <BottomNavBar insets={insets} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Top Bar
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.secondaryContainer,
  },
  profileAvatar: {
    width: 32,
    height: 32,
  },
  appTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
  },
  iconButton: {
    padding: 8,
  },

  // Scroll
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
  },

  // Bill Header
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 20,
    paddingTop: 16,
  },
  billHeaderLeft: {
    flex: 1,
    marginRight: 16,
  },
  billTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
    lineHeight: 34,
  },
  billSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    marginTop: 6,
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
    textTransform: 'uppercase',
    marginTop: 2,
  },

  // Progress Card
  progressCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 32,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  progressLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  progressPercent: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  progressTrack: {
    height: 12,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: 12,
    backgroundColor: colors.secondary,
    borderRadius: 6,
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
  },
  progressStatAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
  },
  progressStatAmountError: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.error,
  },
  progressStatLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: colors.outline,
  },

  // Section
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
    lineHeight: 26,
  },
  nudgeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.secondary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.full,
  },
  nudgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSecondary,
    lineHeight: 17,
  },

  // Participant List
  participantList: {
    gap: 12,
  },
  participantCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  participantLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  participantAvatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.surfaceContainerHigh,
  },
  participantAvatar: {
    width: 48,
    height: 48,
  },
  participantName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 2,
  },
  participantDetail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  participantRight: {
    alignItems: 'flex-end',
  },
  participantAmount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // Cash Callout
  cashCallout: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.xl,
    padding: 24,
    borderLeftWidth: 4,
    borderLeftColor: colors.secondary,
    marginBottom: 16,
  },
  cashTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 8,
  },
  cashDesc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
    marginBottom: 16,
  },
  markPaidButton: {
    backgroundColor: colors.surfaceContainerLowest,
    paddingVertical: 14,
    borderRadius: radii.xl,
    alignItems: 'center',
  },
  markPaidText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
  },

  // Bottom Nav
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(255, 255, 255, 0.95)' },
    }),
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    ...shadows.ambient,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 16,
  },
  navItemActive: {
    backgroundColor: 'rgba(0, 108, 92, 0.08)',
  },
  navLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 4,
    color: colors.outlineVariant,
  },
  navLabelActive: {
    color: colors.secondary,
  },
});
