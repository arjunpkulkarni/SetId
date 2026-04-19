import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, shadows } from '../theme';
import { dashboard as dashboardApi } from '../services/api';

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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ActivityRow({ item, isLast, onPress }) {
  const meta = ACTIVITY_TYPE_META[item.type] || { icon: 'info', positive: true };
  const hasAmount = item.amount != null;
  const positive = meta.positive;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[styles.row, !isLast && styles.rowBorder]}
    >
      <View style={styles.iconWrap}>
        <MaterialIcons name={meta.icon} size={22} color={colors.onSurfaceVariant} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.description}
        </Text>
        {item.bill_title ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {item.bill_title}
          </Text>
        ) : null}
        <Text style={styles.rowTime}>{formatRelativeTime(item.timestamp)}</Text>
      </View>
      <View style={styles.rowRight}>
        {hasAmount && (
          <Text
            style={[
              styles.rowAmount,
              { color: positive ? colors.secondary : colors.error },
            ]}
          >
            {positive ? '+' : '-'}
            {formatCurrency(item.amount)}
          </Text>
        )}
        <Text style={styles.rowType}>{item.type.replace(/_/g, ' ')}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function ActivityScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await dashboardApi.getRecentActivity();
      setActivities(res.data ?? []);
    } catch {
      setActivities([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      fetchActivity().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [fetchActivity]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivity();
    setRefreshing(false);
  }, [fetchActivity]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>Activity</Text>
        <Text style={styles.headerSubtitle}>Your recent bill events</Text>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.secondary} />
        </View>
      ) : activities.length === 0 ? (
        <ScrollView
          contentContainerStyle={[styles.emptyWrap, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />
          }
        >
          <MaterialIcons name="receipt-long" size={56} color={colors.outlineVariant} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyText}>Create a bill or join one to see updates here.</Text>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />
          }
        >
          <View style={[styles.card, shadows.card]}>
            {activities.map((item, i) => (
              <ActivityRow
                key={`${item.type}-${item.timestamp}-${i}`}
                item={item}
                isLast={i === activities.length - 1}
                onPress={() => {
                  if (item.bill_id) {
                    navigation.navigate('BillSplit', { billId: item.bill_id });
                  }
                }}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: colors.onSurface,
  },
  headerSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.surfaceContainerLow,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
  },
  rowSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  rowTime: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.outlineVariant,
    marginTop: 4,
  },
  rowRight: {
    alignItems: 'flex-end',
    maxWidth: 100,
  },
  rowAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
    fontWeight: '700',
  },
  rowType: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  emptyWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 48,
  },
  emptyTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: 16,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 21,
  },
});
