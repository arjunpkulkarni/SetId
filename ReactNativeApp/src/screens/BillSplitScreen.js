import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { bills as billsApi, assignments as assignmentsApi } from '../services/api';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TopAppBar({ insets, onBack, title }) {
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBarInner}>
        <View style={styles.headerLeft}>
          {onBack && (
            <TouchableOpacity onPress={onBack} style={styles.backButton} activeOpacity={0.7}>
              <MaterialIcons name="arrow-back" size={24} color={colors.onSurface} />
            </TouchableOpacity>
          )}
          <Text style={styles.appTitle} numberOfLines={1}>{title || 'Split Bill'}</Text>
        </View>
        <TouchableOpacity style={styles.iconButton} activeOpacity={0.7}>
          <MaterialIcons name="more-vert" size={24} color={colors.onSurface} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MerchantHeader({ bill }) {
  const billTitle = bill.title || bill.merchant_name || 'Untitled Bill';
  const merchant = bill.merchant_name || bill.title;
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
      </View>
    </View>
  );
}

function MemberChip({ member, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
        {member.nickname}
      </Text>
    </TouchableOpacity>
  );
}

function BillItemCard({ item, members, assignedMemberIds, onToggleMember }) {
  const isUnassigned = assignedMemberIds.length === 0;

  return (
    <View style={[styles.itemCard, isUnassigned ? styles.itemCardUnassigned : styles.itemCardNormal]}>
      <View style={styles.itemCardHeader}>
        <View style={styles.itemCardInfo}>
          <Text style={styles.itemName}>{item.name}</Text>
          {isUnassigned ? (
            <Text style={styles.itemPriceUnassigned}>
              Unassigned • {formatCurrency(item.total_price)}
            </Text>
          ) : (
            <Text style={styles.itemPrice}>
              {item.quantity > 1 ? `${item.quantity} × ${formatCurrency(item.unit_price)} = ` : ''}
              {formatCurrency(item.total_price)}
            </Text>
          )}
        </View>
        {isUnassigned ? (
          <View style={styles.unassignedIcon}>
            <MaterialIcons name="priority-high" size={16} color={colors.onErrorContainer} />
          </View>
        ) : (
          <View style={styles.assignedBadge}>
            <Text style={styles.assignedBadgeText}>{assignedMemberIds.length}</Text>
          </View>
        )}
      </View>
      <View style={styles.chipRow}>
        {members.map((m) => (
          <MemberChip
            key={m.id}
            member={m}
            active={assignedMemberIds.includes(m.id)}
            onPress={() => onToggleMember(item.id, m.id)}
          />
        ))}
      </View>
    </View>
  );
}

function MembersSummary({ members, items, assignmentMap }) {
  const memberTotals = members.map((m) => {
    let total = 0;
    let itemCount = 0;
    items.forEach((item) => {
      const assignees = assignmentMap[item.id] || [];
      if (assignees.includes(m.id)) {
        total += parseFloat(item.total_price ?? 0) / assignees.length;
        itemCount++;
      }
    });
    return { ...m, total, itemCount };
  });

  return (
    <View style={styles.membersSection}>
      <Text style={styles.membersTitle}>Members</Text>
      {memberTotals.map((m) => (
        <View key={m.id} style={styles.memberRow}>
          <View style={styles.memberLeft}>
            <View style={styles.memberAvatarWrap}>
              <MaterialIcons name="person" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View>
              <Text style={styles.memberName}>{m.nickname}</Text>
              <Text style={styles.memberItemCount}>
                {m.itemCount} {m.itemCount === 1 ? 'Item' : 'Items'}
              </Text>
            </View>
          </View>
          <Text style={styles.memberAmount}>{formatCurrency(m.total)}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyItems({ onScanReceipt, billId }) {
  return (
    <View style={styles.emptySection}>
      <View style={styles.emptyIconCircle}>
        <MaterialIcons name="receipt-long" size={36} color={colors.outlineVariant} />
      </View>
      <Text style={styles.emptyTitle}>No items yet</Text>
      <Text style={styles.emptySubtext}>Scan a receipt to automatically add items</Text>
      <TouchableOpacity activeOpacity={0.85} onPress={onScanReceipt}>
        <LinearGradient
          colors={[colors.secondary, colors.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.scanButton, shadows.settleButton]}
        >
          <MaterialIcons name="document-scanner" size={20} color={colors.onSecondary} />
          <Text style={styles.scanButtonText}>Scan Receipt</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

function BottomActions({ insets, items, assignmentMap, onSend }) {
  const totalItems = items.length;
  const assignedItems = items.filter((i) => (assignmentMap[i.id] || []).length > 0).length;
  const subtotal = items.reduce((sum, i) => {
    if ((assignmentMap[i.id] || []).length > 0) {
      return sum + parseFloat(i.total_price ?? 0);
    }
    return sum;
  }, 0);

  return (
    <View style={[styles.bottomActions, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <View style={styles.subtotalRow}>
        <Text style={styles.assignedCount}>{assignedItems} of {totalItems} Items Assigned</Text>
        <Text style={styles.subtotalText}>Subtotal: {formatCurrency(subtotal)}</Text>
      </View>
      <TouchableOpacity activeOpacity={0.85} onPress={onSend}>
        <LinearGradient
          colors={[colors.secondary, colors.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.sendButton, shadows.sendButton]}
        >
          <Text style={styles.sendButtonText}>Send to Members</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function BillSplitScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;

  const [bill, setBill] = useState(null);
  const [members, setMembers] = useState([]);
  const [items, setItems] = useState([]);
  const [assignmentMap, setAssignmentMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSummary = useCallback(async () => {
    if (!billId) return;
    try {
      const res = await billsApi.getSummary(billId);
      const data = res.data;
      setBill(data.bill);
      setMembers(data.members ?? []);
      setItems(data.items ?? []);

      const map = {};
      (data.items ?? []).forEach((item) => {
        map[item.id] = [];
      });
      (data.bill?.assignments ?? []).forEach?.((a) => {
        if (!map[a.receipt_item_id]) map[a.receipt_item_id] = [];
        map[a.receipt_item_id].push(a.bill_member_id);
      });
      setAssignmentMap(map);
    } catch {
      // keep whatever state we have
    }
  }, [billId]);

  useEffect(() => {
    fetchSummary().finally(() => setLoading(false));
  }, [fetchSummary, route?.params?.refresh]);

  const handleToggleMember = (itemId, memberId) => {
    setAssignmentMap((prev) => {
      const current = prev[itemId] || [];
      const has = current.includes(memberId);
      return {
        ...prev,
        [itemId]: has ? current.filter((id) => id !== memberId) : [...current, memberId],
      };
    });
  };

  const handleSend = async () => {
    const assignmentsList = [];
    Object.entries(assignmentMap).forEach(([itemId, memberIds]) => {
      memberIds.forEach((memberId) => {
        assignmentsList.push({
          receipt_item_id: itemId,
          bill_member_id: memberId,
          share_type: 'equal',
          share_value: 0,
        });
      });
    });

    if (assignmentsList.length === 0) {
      Alert.alert('No assignments', 'Assign at least one item to a member before continuing.');
      return;
    }

    setSaving(true);
    try {
      await assignmentsApi.create(billId, assignmentsList);
      navigation.navigate('ReviewPayment', { billId });
    } catch (err) {
      Alert.alert('Error', err?.error?.message ?? 'Failed to save assignments');
    } finally {
      setSaving(false);
    }
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
        <Text style={styles.errorText}>Bill not found</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 16 }}>
          <Text style={styles.linkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TopAppBar
        insets={insets}
        onBack={navigation?.canGoBack?.() ? navigation.goBack : null}
        title={bill.title || bill.merchant_name}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 160 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <MerchantHeader bill={bill} />

        {items.length === 0 ? (
          <EmptyItems
            billId={billId}
            onScanReceipt={() => navigation.navigate('ScanReceipt', { billId })}
          />
        ) : (
          <>
            <View style={styles.assignSection}>
              <Text style={styles.assignTitle}>Assign Items</Text>
              {items.map((item) => (
                <BillItemCard
                  key={item.id}
                  item={item}
                  members={members}
                  assignedMemberIds={assignmentMap[item.id] || []}
                  onToggleMember={handleToggleMember}
                />
              ))}
            </View>

            {members.length > 0 && (
              <MembersSummary
                members={members}
                items={items}
                assignmentMap={assignmentMap}
              />
            )}
          </>
        )}
      </ScrollView>

      {items.length > 0 && (
        <BottomActions
          insets={insets}
          items={items}
          assignmentMap={assignmentMap}
          onSend={handleSend}
        />
      )}
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
  errorText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.onSurfaceVariant,
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
    flex: 1,
  },
  backButton: {
    padding: 4,
    marginRight: 4,
  },
  appTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
    flex: 1,
  },
  iconButton: {
    padding: 8,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

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

  emptySection: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
  },
  emptySubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: radii.full,
    marginTop: 8,
  },
  scanButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSecondary,
  },

  assignSection: { marginBottom: 32 },
  assignTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
    marginBottom: 16,
    paddingHorizontal: 2,
  },

  itemCard: {
    padding: 20,
    borderRadius: radii.xl,
    marginBottom: 12,
  },
  itemCardNormal: {
    backgroundColor: colors.surfaceContainerLowest,
  },
  itemCardUnassigned: {
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: colors.outlineVariant,
    opacity: 0.95,
  },
  itemCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  itemCardInfo: { flex: 1 },
  itemName: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 2,
  },
  itemPrice: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
  },
  itemPriceUnassigned: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.error,
  },
  unassignedIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignedBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: radii.full,
  },
  chipActive: { backgroundColor: colors.secondary },
  chipInactive: { backgroundColor: colors.surfaceContainerHigh },
  chipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    fontWeight: '600',
  },
  chipTextActive: { color: colors.onSecondary },
  chipTextInactive: { color: colors.onSurfaceVariant },

  membersSection: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    padding: 24,
    marginBottom: 16,
  },
  membersTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 20,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
  },
  memberItemCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 1,
  },
  memberAmount: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
  },

  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    ...Platform.select({
      ios: {},
      android: { backgroundColor: 'rgba(255, 255, 255, 0.95)' },
    }),
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  assignedCount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
  },
  subtotalText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  sendButton: {
    paddingVertical: 18,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSecondary,
  },
});
