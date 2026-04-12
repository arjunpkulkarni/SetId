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
  TextInput,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import { bills as billsApi, assignments as assignmentsApi, receipts as receiptsApi } from '../services/api';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function formatPriceInput(value) {
  const digitsOnly = `${value ?? ''}`.replace(/\D/g, '');
  if (!digitsOnly) return '0.00';
  return (parseInt(digitsOnly, 10) / 100).toFixed(2);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function normalizeItemName(value) {
  return `${value ?? ''}`.replace(/\s+/g, ' ').trim();
}

function isDraftItemId(itemId) {
  return `${itemId}`.startsWith('draft-item-');
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

function QuantityEditor({ quantity, onDecrement, onIncrement }) {
  return (
    <View style={styles.quantityEditor}>
      <TouchableOpacity
        onPress={onDecrement}
        activeOpacity={0.8}
        style={[styles.quantityAction, quantity === 0 && styles.quantityActionDisabled]}
      >
        <MaterialIcons
          name="remove"
          size={16}
          color={quantity === 0 ? colors.outlineVariant : colors.secondary}
        />
      </TouchableOpacity>
      <Text style={styles.quantityValue}>{quantity}</Text>
      <TouchableOpacity
        onPress={onIncrement}
        activeOpacity={0.8}
        style={styles.quantityAction}
      >
        <MaterialIcons name="add" size={16} color={colors.secondary} />
      </TouchableOpacity>
    </View>
  );
}

function BillItemCard({
  item,
  members,
  assignedMemberIds,
  onToggleMember,
  isEditingItems,
  quantity,
  name,
  onNameChange,
  price,
  onPriceChange,
  onDecrementQuantity,
  onIncrementQuantity,
  onRemoveItem,
}) {
  const isUnassigned = assignedMemberIds.length === 0;
  const isZeroQuantity = isEditingItems && quantity === 0;
  const totalPrice = parsePriceValue(price ?? item.total_price);
  const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice;

  return (
    <View
      style={[
        styles.itemCard,
        isUnassigned ? styles.itemCardUnassigned : styles.itemCardNormal,
        isZeroQuantity && styles.itemCardZeroQuantity,
      ]}
    >
      <View style={styles.itemCardHeader}>
        <View style={styles.itemCardInfo}>
          {isEditingItems ? (
            <TextInput
              value={name}
              onChangeText={onNameChange}
              style={styles.itemNameInput}
              placeholder="Item name"
              placeholderTextColor={colors.outlineVariant}
            />
          ) : (
            <Text style={styles.itemName}>{name}</Text>
          )}
          {isUnassigned ? (
            <Text style={styles.itemPriceUnassigned}>
              Unassigned • {formatCurrency(totalPrice)}
            </Text>
          ) : (
            <Text style={styles.itemPrice}>
              {quantity > 1 ? `${quantity} × ${formatCurrency(unitPrice)} = ` : ''}
              {formatCurrency(totalPrice)}
            </Text>
          )}
        </View>
        {isEditingItems ? (
          <QuantityEditor
            quantity={quantity}
            onDecrement={onDecrementQuantity}
            onIncrement={onIncrementQuantity}
          />
        ) : isUnassigned ? (
          <View style={styles.unassignedIcon}>
            <MaterialIcons name="priority-high" size={16} color={colors.onErrorContainer} />
          </View>
        ) : (
          <View style={styles.assignedBadge}>
            <Text style={styles.assignedBadgeText}>{quantity}</Text>
          </View>
        )}
      </View>
      {isZeroQuantity && (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onRemoveItem}
          style={styles.removeItemButton}
        >
          <Text style={styles.removeItemButtonText}>Remove Item</Text>
        </TouchableOpacity>
      )}

      <View style={[styles.itemCardFooter, isEditingItems && styles.itemCardFooterEditing]}>
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

        {isEditingItems && (
          <View style={styles.priceEditorWrap}>
            <Text style={styles.priceEditorLabel}>Price</Text>
            <View style={styles.priceEditorField}>
              <Text style={styles.priceEditorCurrency}>$</Text>
              <TextInput
                value={price}
                onChangeText={onPriceChange}
                keyboardType="decimal-pad"
                style={styles.priceEditorInput}
                placeholder="0.00"
                placeholderTextColor={colors.outlineVariant}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function MembersSummary({ members, items, assignmentMap, itemPrices }) {
  const memberTotals = members.map((m) => {
    let total = 0;
    let itemCount = 0;
    items.forEach((item) => {
      const assignees = assignmentMap[item.id] || [];
      if (assignees.includes(m.id)) {
        total += parsePriceValue(itemPrices[item.id] ?? item.total_price) / assignees.length;
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

function BottomActions({ insets, items, assignmentMap, itemPrices, onSend }) {
  const totalItems = items.length;
  const assignedItems = items.filter((i) => (assignmentMap[i.id] || []).length > 0).length;
  const subtotal = items.reduce((sum, i) => {
    if ((assignmentMap[i.id] || []).length > 0) {
      return sum + parsePriceValue(itemPrices[i.id] ?? i.total_price);
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
  const [savingItemEdits, setSavingItemEdits] = useState(false);
  const [isEditingItems, setIsEditingItems] = useState(false);
  const [nextDraftItemId, setNextDraftItemId] = useState(1);
  const [itemQuantities, setItemQuantities] = useState({});
  const [itemNames, setItemNames] = useState({});
  const [itemPrices, setItemPrices] = useState({});
  const [originalItemSnapshots, setOriginalItemSnapshots] = useState({});
  const [removedItemIds, setRemovedItemIds] = useState({});

  const applyServerItemState = useCallback((nextBill, nextItems, preserveAssignments = false) => {
    setBill(nextBill);
    setItems(nextItems);

    const quantities = {};
    const names = {};
    const prices = {};
    const snapshots = {};

    (nextItems ?? []).forEach((item) => {
      const quantity = typeof item.quantity === 'number' ? item.quantity : 0;
      const name = item.name ?? '';
      const totalPrice = parsePriceValue(item.total_price ?? 0).toFixed(2);
      quantities[item.id] = quantity;
      names[item.id] = name;
      prices[item.id] = totalPrice;
      snapshots[item.id] = {
        name: normalizeItemName(name),
        quantity,
        totalPrice,
      };
    });

    setItemQuantities(quantities);
    setItemNames(names);
    setItemPrices(prices);
    setOriginalItemSnapshots(snapshots);
    setRemovedItemIds({});
    setNextDraftItemId(1);

    if (preserveAssignments) {
      setAssignmentMap((prev) => {
        const nextMap = {};
        (nextItems ?? []).forEach((item) => {
          nextMap[item.id] = prev[item.id] || [];
        });
        return nextMap;
      });
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    if (!billId) return;
    try {
      const res = await billsApi.getSummary(billId);
      const data = res.data;
      setMembers(data.members ?? []);
      applyServerItemState(data.bill, data.items ?? []);

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
  }, [applyServerItemState, billId]);

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

  const handleIncrementQuantity = (itemId) => {
    setItemQuantities((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? 0) + 1,
    }));
  };

  const handleDecrementQuantity = (itemId) => {
    setItemQuantities((prev) => ({
      ...prev,
      [itemId]: Math.max(0, (prev[itemId] ?? 0) - 1),
    }));
  };

  const handleRemoveItem = (itemId) => {
    setRemovedItemIds((prev) => ({
      ...prev,
      [itemId]: true,
    }));
  };

  const handleNameChange = (itemId, value) => {
    setItemNames((prev) => ({
      ...prev,
      [itemId]: value,
    }));
  };

  const handlePriceChange = (itemId, value) => {
    setItemPrices((prev) => ({
      ...prev,
      [itemId]: formatPriceInput(value),
    }));
  };

  const handleAddItem = () => {
    const draftId = `draft-item-${nextDraftItemId}`;
    setNextDraftItemId((prev) => prev + 1);

    const draftItem = {
      id: draftId,
      name: '',
      quantity: 1,
      total_price: 0,
      unit_price: 0,
    };

    setItems((prev) => [draftItem, ...prev]);
    setItemQuantities((prev) => ({
      ...prev,
      [draftId]: 1,
    }));
    setItemNames((prev) => ({
      ...prev,
      [draftId]: '',
    }));
    setItemPrices((prev) => ({
      ...prev,
      [draftId]: '0.00',
    }));
    setAssignmentMap((prev) => ({
      ...prev,
      [draftId]: [],
    }));
    setRemovedItemIds((prev) => {
      if (!prev[draftId]) return prev;
      const next = { ...prev };
      delete next[draftId];
      return next;
    });
  };

  const visibleItems = items.filter((item) => !removedItemIds[item.id]);
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));

  const getCurrentItemDraft = useCallback((item) => ({
    id: `${item.id}`,
    name: normalizeItemName(itemNames[item.id] ?? item.name ?? ''),
    quantity: itemQuantities[item.id] ?? item.quantity ?? 0,
    totalPrice: parsePriceValue(itemPrices[item.id] ?? item.total_price ?? 0).toFixed(2),
  }), [itemNames, itemPrices, itemQuantities]);

  const buildReceiptEditPayload = useCallback(() => {
    const creates = [];
    const updates = [];
    const deletes = [];

    for (const item of items) {
      const current = getCurrentItemDraft(item);
      const isRemoved = removedItemIds[item.id] || current.quantity <= 0;
      const isDraft = isDraftItemId(item.id);

      if (isRemoved) {
        if (!isDraft) {
          deletes.push(current.id);
        }
        continue;
      }

      if (!current.name) {
        throw new Error('Every item needs a name before saving.');
      }
      if (parsePriceValue(current.totalPrice) <= 0) {
        throw new Error('Every item needs a price greater than $0.00 before saving.');
      }
      if (current.quantity <= 0) {
        throw new Error('Every item needs a quantity greater than 0 before saving.');
      }

      if (isDraft) {
        creates.push({
          name: current.name,
          quantity: current.quantity,
          total_price: current.totalPrice,
        });
        continue;
      }

      const original = originalItemSnapshots[item.id];
      const hasChanged = !original
        || current.name !== original.name
        || current.quantity !== original.quantity
        || current.totalPrice !== original.totalPrice;

      if (hasChanged) {
        updates.push({
          id: current.id,
          name: current.name,
          quantity: current.quantity,
          total_price: current.totalPrice,
        });
      }
    }

    return { creates, updates, deletes };
  }, [getCurrentItemDraft, items, originalItemSnapshots, removedItemIds]);

  const handleEditItemsPress = useCallback(async () => {
    if (savingItemEdits) return;

    if (!isEditingItems) {
      setIsEditingItems(true);
      return;
    }

    let payload;
    try {
      payload = buildReceiptEditPayload();
    } catch (err) {
      Alert.alert('Finish edits', err?.message ?? 'Please complete your item edits before saving.');
      return;
    }

    const hasChanges = payload.creates.length > 0
      || payload.updates.length > 0
      || payload.deletes.length > 0;

    if (!hasChanges) {
      setIsEditingItems(false);
      return;
    }

    setSavingItemEdits(true);
    try {
      const res = await receiptsApi.syncItems(billId, payload);
      applyServerItemState(res.data.bill, res.data.items ?? [], true);
      setIsEditingItems(false);
    } catch (err) {
      Alert.alert('Error', err?.error?.message ?? 'Failed to save receipt edits');
    } finally {
      setSavingItemEdits(false);
    }
  }, [applyServerItemState, billId, buildReceiptEditPayload, isEditingItems, savingItemEdits]);

  const handleSend = async () => {
    if (isEditingItems || savingItemEdits) {
      Alert.alert('Save items first', 'Tap Done to save your receipt edits before sending to members.');
      return;
    }

    const assignmentsList = [];
    Object.entries(assignmentMap).forEach(([itemId, memberIds]) => {
      if (!visibleItemIds.has(itemId)) return;
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
              <View style={styles.assignHeader}>
                <Text style={styles.assignTitle}>Assign Items</Text>
                <View style={styles.assignActions}>
                  {isEditingItems && (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={handleAddItem}
                      disabled={savingItemEdits}
                    >
                      <LinearGradient
                        colors={[colors.secondary, colors.secondaryDim]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[
                          styles.addItemButton,
                          shadows.settleButton,
                          savingItemEdits && styles.headerButtonDisabled,
                        ]}
                      >
                        <MaterialIcons name="add" size={18} color={colors.onSecondary} />
                      </LinearGradient>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={handleEditItemsPress}
                    disabled={savingItemEdits}
                  >
                    <LinearGradient
                      colors={[colors.secondary, colors.secondaryDim]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={[
                        styles.editItemsButton,
                        shadows.settleButton,
                        savingItemEdits && styles.headerButtonDisabled,
                      ]}
                    >
                      {savingItemEdits ? (
                        <ActivityIndicator size="small" color={colors.onSecondary} />
                      ) : (
                        <Text style={styles.editItemsButtonText}>
                          {isEditingItems ? 'Done' : 'Edit Items'}
                        </Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              </View>
              {visibleItems.map((item) => (
                <BillItemCard
                  key={item.id}
                  item={item}
                  members={members}
                  assignedMemberIds={assignmentMap[item.id] || []}
                  onToggleMember={handleToggleMember}
                  isEditingItems={isEditingItems}
                  quantity={itemQuantities[item.id] ?? item.quantity ?? 0}
                  name={itemNames[item.id] ?? item.name ?? ''}
                  onNameChange={(value) => handleNameChange(item.id, value)}
                  price={itemPrices[item.id] ?? parsePriceValue(item.total_price ?? 0).toFixed(2)}
                  onPriceChange={(value) => handlePriceChange(item.id, value)}
                  onDecrementQuantity={() => handleDecrementQuantity(item.id)}
                  onIncrementQuantity={() => handleIncrementQuantity(item.id)}
                  onRemoveItem={() => handleRemoveItem(item.id)}
                />
              ))}
            </View>

            {members.length > 0 && visibleItems.length > 0 && (
              <MembersSummary
                members={members}
                items={visibleItems}
                assignmentMap={assignmentMap}
                itemPrices={itemPrices}
              />
            )}
          </>
        )}
      </ScrollView>

      {visibleItems.length > 0 && (
        <BottomActions
          insets={insets}
          items={visibleItems}
          assignmentMap={assignmentMap}
          itemPrices={itemPrices}
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
  assignHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 2,
    gap: 12,
  },
  assignTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.onSurface,
    flexShrink: 1,
  },
  assignActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addItemButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonDisabled: {
    opacity: 0.7,
  },
  editItemsButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editItemsButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    fontWeight: '700',
    color: colors.onSecondary,
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
  itemCardZeroQuantity: {
    backgroundColor: colors.errorContainer,
    borderWidth: 1.5,
    borderColor: '#efb8b6',
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
  itemNameInput: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
    paddingBottom: 4,
    paddingRight: 12,
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
  removeItemButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.error,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.full,
    marginBottom: 14,
  },
  removeItemButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    color: colors.onError,
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
  quantityEditor: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondaryContainer,
    borderRadius: radii.full,
    paddingHorizontal: 6,
    paddingVertical: 4,
    gap: 2,
  },
  quantityAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quantityActionDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  quantityValue: {
    minWidth: 24,
    textAlign: 'center',
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.secondary,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  itemCardFooter: {
    marginTop: 2,
  },
  itemCardFooterEditing: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
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
  priceEditorWrap: {
    minWidth: 120,
    alignItems: 'flex-end',
  },
  priceEditorLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  priceEditorField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    borderRadius: radii.full,
    paddingHorizontal: 12,
    minHeight: 40,
  },
  priceEditorCurrency: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.secondary,
    marginRight: 4,
  },
  priceEditorInput: {
    minWidth: 56,
    paddingVertical: 8,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSurface,
    textAlign: 'right',
  },

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
