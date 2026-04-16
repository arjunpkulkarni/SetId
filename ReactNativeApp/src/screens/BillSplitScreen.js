import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Share,
  Modal,
  Clipboard,
  RefreshControl,
  AppState,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { colors, radii, shadows } from '../theme';
import { bills as billsApi, assignments as assignmentsApi, receipts as receiptsApi, members as membersApi, paymentMethods as paymentMethodsApi } from '../services/api';
import useBillWebSocket from '../hooks/useBillWebSocket';

function formatCurrency(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return `$${Math.abs(num).toFixed(2)}`;
}

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

/** Round to cents for money math after quantity × unit changes. */
function roundMoney(n) {
  return Math.round(n * 100) / 100;
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

function TopAppBar({ insets, onBack, title, onShare }) {
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
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconButton} activeOpacity={0.7} onPress={onShare}>
            <MaterialIcons name="person-add" size={24} color={colors.secondary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function MerchantHeader({ bill }) {
  const billTitle = bill.title || bill.merchant_name;
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
  const isShared = assignedMemberIds.length > 1;
  const perPersonPrice = isShared ? totalPrice / assignedMemberIds.length : totalPrice;

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
          ) : isShared ? (
            <Text style={styles.itemPrice}>
              {formatCurrency(totalPrice)} · {formatCurrency(perPersonPrice)} each
            </Text>
          ) : (
            <Text style={styles.itemPrice}>
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
            <MaterialIcons name="person" size={16} color={colors.onSurfaceVariant} />
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
        {!isEditingItems && (
          <>
            <View style={styles.chipRowHorizontal}>
              {members.map((m) => (
                <MemberChip
                  key={m.id}
                  member={m}
                  active={assignedMemberIds.includes(m.id)}
                  onPress={() => onToggleMember(item.id, m.id)}
                />
              ))}
            </View>

            {isShared && (
              <View style={styles.sharedRow}>
                <View style={[styles.sharedToggle, styles.sharedToggleActive]}>
                  <MaterialIcons name="group" size={14} color={colors.onSecondary} />
                  <Text style={[styles.sharedToggleText, styles.sharedToggleTextActive]}>
                    Split {assignedMemberIds.length} ways
                  </Text>
                </View>
                <Text style={styles.sharedCount}>
                  {formatCurrency(perPersonPrice)} each
                </Text>
              </View>
            )}
          </>
        )}

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

function MembersSummary({ members, serverAssignments, bill }) {
  const billTotal = parsePriceValue(bill?.total ?? 0);

  // Sum amount_owed from backend assignments per member
  const allItemsSubtotal = serverAssignments.reduce(
    (s, a) => s + parsePriceValue(a.amount_owed), 0,
  );
  const tipAndTax = Math.max(0, billTotal - allItemsSubtotal);

  const memberTotals = members.map((m) => {
    const mAssignments = serverAssignments.filter(
      (a) => String(a.bill_member_id) === String(m.id),
    );
    const subtotal = mAssignments.reduce(
      (s, a) => s + parsePriceValue(a.amount_owed), 0,
    );
    const itemCount = mAssignments.length;
    const tipShare = allItemsSubtotal > 0 ? tipAndTax * (subtotal / allItemsSubtotal) : 0;
    const total = roundMoney(subtotal + tipShare);
    return { ...m, subtotal: roundMoney(subtotal), tipShare: roundMoney(tipShare), total, itemCount };
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
                {m.tipShare > 0 ? ` · incl. ${formatCurrency(m.tipShare)} tip/tax` : ''}
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

function BottomActions({ insets, items, assignmentMap, serverAssignments, onSend, isHost }) {
  const totalLines = items.length;
  const assignedLines = items.filter((i) => (assignmentMap[i.id] || []).length > 0).length;

  const subtotal = serverAssignments.reduce(
    (s, a) => s + parsePriceValue(a.amount_owed), 0,
  );

  return (
    <View style={[styles.bottomActions, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
      <View style={styles.subtotalRow}>
        <Text style={styles.assignedCount}>
          {assignedLines} of {totalLines} items assigned
        </Text>
        <Text style={styles.subtotalText}>Subtotal: {formatCurrency(subtotal)}</Text>
      </View>
      <TouchableOpacity activeOpacity={0.85} onPress={onSend}>
        <LinearGradient
          colors={[colors.secondary, colors.secondaryDim]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.sendButton, shadows.sendButton]}
        >
          <Text style={styles.sendButtonText}>
            {isHost ? 'Next' : 'Submit My Items'}
          </Text>
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
  const [serverAssignments, setServerAssignments] = useState([]);
  // Maps "itemId::memberId" → array of server assignment ids (handles duplicates).
  const serverAssignmentIds = useRef({});
  // Per-key promise chain so clicks on the same chip serialize without dropping.
  const mutationQueueRef = useRef({});
  // Tracks in-flight mutation count so fetchSummary can back off until settled.
  const inFlightMutationsRef = useRef(0);
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
  const [refreshing, setRefreshing] = useState(false);

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

  const lastFetchTime = useRef(0);
  const FETCH_DEBOUNCE_MS = 1000;

  const fetchSummary = useCallback(async (force = false) => {
    if (!billId) return;
    // While a mutation is in flight, the server is mid-update. Fetching would
    // pull a transient state that clobbers the optimistic UI and causes flicker.
    if (!force && inFlightMutationsRef.current > 0) return;

    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTime.current;
    if (!force && timeSinceLastFetch < FETCH_DEBOUNCE_MS) return;

    lastFetchTime.current = now;

    try {
      const [summaryRes, assignRes] = await Promise.all([
        billsApi.getSummary(billId),
        assignmentsApi.list(billId),
      ]);

      // Another mutation started while we were fetching — discard this snapshot
      // UNLESS this was a forced refresh (WebSocket event, focus, resume). Those
      // are authoritative server-originated signals that must not be dropped.
      if (!force && inFlightMutationsRef.current > 0) return;

      const data = summaryRes.data;
      setMembers(data.members ?? []);
      applyServerItemState(data.bill, data.items ?? []);

      const allAssignments = assignRes.data ?? [];
      setServerAssignments(allAssignments);
      const map = {};
      const idMap = {};
      (data.items ?? []).forEach((item) => {
        map[item.id] = [];
      });
      allAssignments.forEach((a) => {
        const itemId = a.receipt_item_id;
        if (!map[itemId]) map[itemId] = [];
        if (!map[itemId].includes(a.bill_member_id)) {
          map[itemId].push(a.bill_member_id);
        }
        const key = `${itemId}::${a.bill_member_id}`;
        if (!idMap[key]) idMap[key] = [];
        idMap[key].push(a.id);
      });
      serverAssignmentIds.current = idMap;
      setAssignmentMap(map);
    } catch (e) {
      // A silent catch here was hiding bugs where the UI would stop updating
      // after a WebSocket event because the follow-up HTTP GET threw. Surface
      // it in dev so regressions are visible instead of manifesting as a
      // mysterious "frontend not updating" symptom.
      if (__DEV__) console.warn('[fetchSummary] failed', e);
    }
  }, [applyServerItemState, billId]);

  useEffect(() => {
    fetchSummary().finally(() => setLoading(false));
  }, [fetchSummary, route?.params?.refresh]);

  const handlePullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSummary();
    setRefreshing(false);
  }, [fetchSummary]);

  // ─── WebSocket: real-time updates ───────────────────────────────────────────
  const wsHandlers = useMemo(() => ({
    onConnected: () => {
      if (__DEV__) console.log('[WS] Connected to bill', billId);
      fetchSummary(true);
    },
    // All server-originated events bypass the 1s user-spam debounce by
    // passing force=true. The debounce only exists to coalesce rapid user
    // actions; server events are authoritative.
    onAssignmentUpdate: (data) => {
      if (__DEV__) console.log('[WS] assignment_update received', data);
      // The backend occasionally emits assignment_update with an empty
      // payload (seen in production logs) so we can't rely on the payload
      // itself — always re-fetch authoritative state.
      fetchSummary(true);
    },
    onMemberJoined: (data) => {
      if (__DEV__) console.log('[WS] member_joined:', data?.nickname ?? data);
      // The server includes the full, updated members array in this event.
      // Apply it immediately so the UI reflects the new joiner even if the
      // follow-up HTTP fetch is slow, flaky, or fails outright (the root
      // cause of the "Jane joined on web but doesn't appear on mobile for
      // 2 minutes" symptom).
      const incoming = Array.isArray(data?.members) ? data.members : null;
      if (incoming) {
        setMembers(incoming);
      }
      fetchSummary(true);
    },
    onPaymentComplete: (data) => {
      if (__DEV__) console.log('[WS] payment_complete:', data);
      fetchSummary(true);
    },
    onAuthError: (code) => {
      if (__DEV__) console.warn('[WS] Auth error, code:', code);
    },
  }), [billId, fetchSummary]);

  const { connected: wsConnected } = useBillWebSocket(billId, wsHandlers);

  // Real-time comes from the WebSocket. Poll only as a safety net when the
  // socket is disconnected (e.g. flaky network / carrier NAT timeout). Keep
  // the interval tight (2s) so the UI catches up quickly once the WS dies —
  // the hook now force-reconnects a half-dead socket within ~45s, but during
  // that window polling is our only lifeline. We intentionally don't pass
  // force=true here so mid-tap optimistic UI is still protected.
  useEffect(() => {
    if (wsConnected) return;
    const poll = setInterval(() => fetchSummary(), 2000);
    return () => clearInterval(poll);
  }, [wsConnected, fetchSummary]);

  // Refresh whenever the screen regains focus (e.g. coming back from
  // ReviewPayment, AddPaymentMethod, or ScanReceipt).
  useFocusEffect(
    useCallback(() => {
      fetchSummary(true);
    }, [fetchSummary]),
  );

  // Refresh when the app returns from background — WebSocket events that
  // fired while suspended are lost, so we need to re-fetch on resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') fetchSummary(true);
    });
    return () => sub.remove();
  }, [fetchSummary]);

  const handleToggleMember = (itemId, memberId) => {
    const key = `${itemId}::${memberId}`;
    const currentList = assignmentMap[itemId] || [];
    const has = currentList.includes(memberId);

    // Optimistic UI update — applied immediately so the tap always feels responsive.
    setAssignmentMap((prev) => {
      const list = prev[itemId] || [];
      return {
        ...prev,
        [itemId]: has
          ? list.filter((id) => id !== memberId)
          : list.includes(memberId) ? list : [...list, memberId],
      };
    });

    inFlightMutationsRef.current += 1;

    // Serialize all mutations for the same (item, member) so rapid taps don't race.
    const prevPromise = mutationQueueRef.current[key] || Promise.resolve();
    const nextPromise = prevPromise.then(async () => {
      try {
        if (has) {
          // Remove every server assignment for this pair (the backend can contain
          // duplicates from prior races; cleaning them up here prevents flicker).
          const ids = serverAssignmentIds.current[key] || [];
          if (ids.length > 0) {
            await Promise.all(
              ids.map((id) => assignmentsApi.delete(billId, id).catch(() => null)),
            );
          }
          serverAssignmentIds.current[key] = [];
        } else {
          const res = await assignmentsApi.create(billId, [
            { receipt_item_id: itemId, bill_member_id: memberId, share_type: 'equal', share_value: 0 },
          ]);
          const payload = res?.data ?? res;
          const createdList = Array.isArray(payload) ? payload : [payload];
          const newIds = createdList
            .filter(Boolean)
            .map((a) => a?.id)
            .filter(Boolean);
          // Record the new ids immediately so the very next tap can delete them
          // without waiting for a fetchSummary round trip.
          serverAssignmentIds.current[key] = [
            ...(serverAssignmentIds.current[key] || []),
            ...newIds,
          ];
        }
      } catch (err) {
        console.warn('[TOGGLE] mutation failed, reverting', err);
        setAssignmentMap((prev) => {
          const list = prev[itemId] || [];
          return {
            ...prev,
            [itemId]: has
              ? list.includes(memberId) ? list : [...list, memberId]
              : list.filter((id) => id !== memberId),
          };
        });
      }
    });

    mutationQueueRef.current[key] = nextPromise.catch(() => {});

    nextPromise.finally(() => {
      inFlightMutationsRef.current = Math.max(0, inFlightMutationsRef.current - 1);
      // Only reconcile with the server once the queue is fully settled so we
      // don't overwrite an optimistic state that a follow-up tap just applied.
      if (inFlightMutationsRef.current === 0) {
        fetchSummary(true);
      }
    });
  };



  const adjustItemQuantity = useCallback(
    (itemId, delta) => {
      setItemQuantities((prevQ) => {
        const item = items.find((i) => i.id === itemId);
        const oldQ = prevQ[itemId] ?? item?.quantity ?? 0;
        const newQ = Math.max(0, oldQ + delta);

        setItemPrices((prevP) => {
          const lineStr =
            prevP[itemId] ?? parsePriceValue(item?.total_price ?? 0).toFixed(2);
          const lineTotal = parsePriceValue(lineStr);
          let newLine = lineTotal;
          if (oldQ > 0 && newQ > 0) {
            const unit = lineTotal / oldQ;
            newLine = roundMoney(unit * newQ);
          } else if (oldQ > 0 && newQ === 0) {
            newLine = lineTotal;
          }
          return { ...prevP, [itemId]: newLine.toFixed(2) };
        });

        return { ...prevQ, [itemId]: newQ };
      });
    },
    [items],
  );

  const handleIncrementQuantity = (itemId) => adjustItemQuantity(itemId, 1);

  const handleDecrementQuantity = (itemId) => adjustItemQuantity(itemId, -1);

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

    // Expand one logical line (name + qty + total) into N quantity=1 creates
    // so each unit gets its own assignable row. Cent-remainders are shifted
    // to the first rows so the sum still matches the original line total.
    const pushSplitCreates = (name, qty, totalPriceStr) => {
      const totalCents = Math.round(parsePriceValue(totalPriceStr) * 100);
      const baseCents = Math.floor(totalCents / qty);
      const remainder = totalCents - baseCents * qty;
      for (let i = 0; i < qty; i++) {
        const cents = baseCents + (i < remainder ? 1 : 0);
        creates.push({
          name,
          quantity: 1,
          total_price: (cents / 100).toFixed(2),
        });
      }
    };

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
        if (current.quantity > 1) {
          pushSplitCreates(current.name, current.quantity, current.totalPrice);
        } else {
          creates.push({
            name: current.name,
            quantity: 1,
            total_price: current.totalPrice,
          });
        }
        continue;
      }

      const original = originalItemSnapshots[item.id];
      const hasChanged = !original
        || current.name !== original.name
        || current.quantity !== original.quantity
        || current.totalPrice !== original.totalPrice;

      if (!hasChanged) continue;

      if (current.quantity > 1) {
        deletes.push(current.id);
        pushSplitCreates(current.name, current.quantity, current.totalPrice);
      } else {
        updates.push({
          id: current.id,
          name: current.name,
          quantity: 1,
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
      Alert.alert('Error', err?.message ?? err?.error?.message ?? 'Failed to save receipt edits');
    } finally {
      setSavingItemEdits(false);
    }
  }, [applyServerItemState, billId, buildReceiptEditPayload, isEditingItems, savingItemEdits]);

  const handleShareBill = async () => {
    try {
      const res = await membersApi.createInviteLink(billId);
      const token = res.data?.token || res.token;
      const billTitle = bill.title || bill.merchant_name || 'this bill';

      if (!token) {
        Alert.alert('Error', 'Could not create invite code');
        return;
      }

      // Use the live website URL for invite links
      const inviteLink = `https://www.settld.live/join/${token}`;

      // Show the link in an alert
      Alert.alert(
        'Invite Friends',
        `Share this link:\n\n${inviteLink}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Share Link',
            onPress: async () => {
              await Share.share({
                message: `Join me to split ${billTitle}!\n\n${inviteLink}`,
                title: `Split ${billTitle} on Settld`,
                url: inviteLink,
              });
            },
          },
        ]
      );
    } catch (err) {
      if (err.message !== 'User did not share') {
        Alert.alert('Error', err?.error?.message ?? 'Failed to create invite code');
      }
    }
  };

  const handleSend = async () => {
    if (isEditingItems || savingItemEdits) {
      Alert.alert('Save items first', 'Tap Done to save your receipt edits before sending to members.');
      return;
    }

    const hasAnyAssignment = Object.values(assignmentMap).some((ids) => ids.length > 0);
    if (!hasAnyAssignment) {
      Alert.alert('No assignments', 'Assign at least one item to a member before continuing.');
      return;
    }

    setSaving(true);
    try {
      const pmRes = await paymentMethodsApi.list();
      const paymentMethods = pmRes.data ?? [];

      if (paymentMethods.length === 0) {
        setSaving(false);
        Alert.alert(
          'Payment Method Required',
          'You need to add a payment method to receive payments from your group.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add Card',
              onPress: () => {
                navigation.navigate('AddPaymentMethod', { billId });
              },
            },
          ],
        );
        return;
      }

      navigation.navigate('ReviewPayment', { billId });
    } catch (err) {
      Alert.alert('Error', err?.error?.message ?? 'Failed to proceed');
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
        onShare={handleShareBill}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 160 },
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
                serverAssignments={serverAssignments}
                bill={bill}
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
          serverAssignments={serverAssignments}
          onSend={handleSend}
          isHost={true}
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    borderStyle: 'dashed',
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
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
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

  chipRowHorizontal: {
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

  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  sharedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  sharedToggleActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.secondary,
  },
  sharedToggleText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  sharedToggleTextActive: {
    color: colors.onSecondary,
  },
  sharedCount: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: colors.secondary,
  },
  splitStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 8,
  },
  splitStepperBtn: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    paddingHorizontal: 4,
  },
  splitStepperBtnDisabled: {
    color: colors.outlineVariant,
  },
  splitStepperCount: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    fontWeight: '700',
    color: colors.onSurface,
    minWidth: 20,
    textAlign: 'center',
  },
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
    gap: 12,
  },
  assignedCount: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
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

  // Virtual Card Modal Styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
    paddingTop: 60, // Account for status bar
  },
  modalTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
  },
  closeButton: {
    padding: 8,
  },
  modalContent: {
    flex: 1,
    paddingHorizontal: 24,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  loadingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: colors.onSurfaceVariant,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  errorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.secondary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radii.full,
    marginTop: 8,
  },
  retryButtonText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSecondary,
  },
  cardVisual: {
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    backgroundColor: colors.secondary,
    borderRadius: 20,
    padding: 30,
    marginVertical: 24,
    ...shadows.settleButton,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  cardTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.9)',
    letterSpacing: 1,
  },
  cardNumber: {
    marginBottom: 24,
  },
  cardNumberLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 8,
  },
  cardNumberContainer: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    padding: 16,
  },
  cardNumberText: {
    fontFamily: 'Courier New',
    fontSize: 20,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 2,
    textAlign: 'center',
  },
  cardNumberNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 8,
  },
  cardDetails: {
    flexDirection: 'row',
    gap: 24,
  },
  cardDetailItem: {
    flex: 1,
  },
  cardDetailLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 4,
  },
  cardDetailValue: {
    fontFamily: 'Courier New',
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 1,
  },
  cardInfo: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 16,
    padding: 20,
    gap: 16,
    marginBottom: 24,
  },
  cardInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardInfoText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    color: colors.onSurface,
    flex: 1,
  },
  cardActions: {
    marginBottom: 24,
  },
  deactivateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
    borderRadius: radii.large,
    paddingVertical: 16,
    gap: 8,
  },
  deactivateButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.onError,
  },
  cardNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.secondaryContainer,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  cardNoteText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.onSecondaryContainer,
    flex: 1,
    lineHeight: 18,
  },
});
