import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
  RefreshControl,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import {
  receipts as receiptsApi,
  members as membersApi,
  stripeConnect,
} from '../services/api';
import useBillWebSocket from '../hooks/useBillWebSocket';
import { useBillData } from '../hooks/useBillData';
import {
  TopAppBar,
  MerchantHeader,
  BillItemCard,
  MembersSummary,
  EmptyItems,
  BottomActions,
} from '../components/BillSplit';

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

// ─── Utility functions ──────────────────────────────────────────────────────────

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function BillSplitScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;
  
  // Use the custom hook for bill data management
  const {
    bill,
    members,
    items,
    setItems,
    assignmentMap,
    setAssignmentMap,
    serverAssignments,
    loading,
    refreshing,
    isEditingItems,
    setIsEditingItems,
    savingItemEdits,
    setSavingItemEdits,
    nextDraftItemId,
    setNextDraftItemId,
    itemQuantities,
    setItemQuantities,
    itemNames,
    setItemNames,
    itemPrices,
    setItemPrices,
    originalItemSnapshots,
    setOriginalItemSnapshots,
    removedItemIds,
    setRemovedItemIds,
    fetchSummary,
    handlePullToRefresh,
    handleToggleMember,
    applyServerItemState,
    applyMemberJoined,
    applyAssignmentDelta,
  } = useBillData(billId);

  const [saving, setSaving] = useState(false);


  // ─── WebSocket: real-time updates ───────────────────────────────────────────
  //
  // We connect as soon as we have a `billId` — the hook is reentrant and the
  // handshake happily runs in parallel with the initial REST load. Gating
  // the WS behind `loading` + a 500ms timer used to delay the "connected"
  // state by 1-2s on cold open, which is how new members appeared to join
  // the party "slowly" even though the backend broadcast fired instantly.
  const wsHandlers = useMemo(() => ({
    onConnected: () => {
      if (__DEV__) console.log('[WS] Connected to bill', billId);
      // Intentionally NO fetchSummary here. The initial useBillData load
      // already seeded state; re-fetching again at the "connected" moment
      // is a wasted round-trip that also delays the user-visible "ready"
      // moment. Any state drift while the socket was opening will be
      // corrected by the next broadcast or focus refetch.
    },
    onAssignmentUpdate: (data) => {
      if (__DEV__) console.log('[WS] assignment_update received', data);
      // Apply the delta directly. This used to fire `fetchSummary(true)` —
      // which does two REST round-trips AND overwrites the optimistic
      // toggle state with whatever the server returned, producing the
      // "checkboxes flicker 500ms after tapping" feel. Echo suppression
      // for self-originated events is handled inside `applyAssignmentDelta`.
      applyAssignmentDelta(data);
    },
    onMemberJoined: (data) => {
      if (__DEV__) console.log('[WS] member_joined:', data?.nickname ?? data);
      // Apply the payload directly — the server ships the full updated
      // members list in the WS frame, so splicing it into local state is
      // instant. Refetch only as a fallback if the payload is malformed.
      if (Array.isArray(data?.members) && data.members.length > 0) {
        applyMemberJoined(data);
      } else {
        fetchSummary(true);
      }
    },
    onPaymentComplete: (data) => {
      if (__DEV__) console.log('[WS] payment_complete:', data);
      fetchSummary(true);
    },
    onAuthError: (code) => {
      if (__DEV__) console.warn('[WS] Auth error, code:', code);
    },
  }), [billId, fetchSummary, applyMemberJoined, applyAssignmentDelta]);

  const { connected: wsConnected } = useBillWebSocket(billId, wsHandlers);



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
      // Gate: the HOST needs a Connect account with payouts enabled and a
      // debit card on file as the payout destination. Customer-side PMs
      // are for charging guests; Connect external accounts are how the
      // host receives those charges. Daily payouts (not instant) — so we
      // don't require `has_instant_external_account` here.
      const statusRes = await stripeConnect.getStatus();
      const s = statusRes?.data ?? {};
      const ready = !!(
        s.connected
        && s.payouts_enabled
        && s.external_account_last4
      );

      if (!ready) {
        setSaving(false);
        Alert.alert(
          'Add a payout method',
          "You need a payout method on file before we can send you your share. Takes about a minute.",
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Add',
              onPress: () => navigation.navigate('SetupPayouts'),
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

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24 },

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
