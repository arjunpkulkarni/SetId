import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  InputAccessoryView,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, shadows } from '../theme';
import {
  assignments as assignmentsApi,
  bills as billsApi,
  receipts as receiptsApi,
  members as membersApi,
  stripeConnect,
} from '../services/api';
import useBillWebSocket from '../hooks/useBillWebSocket';
import { newClientMutationId, useBillData } from '../hooks/useBillData';
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

function cleanMoneyText(value) {
  const cleaned = `${value ?? ''}`.replace(/[^0-9.]/g, '');
  const [whole, ...rest] = cleaned.split('.');
  const decimals = rest.join('').slice(0, 2);
  return rest.length > 0 ? `${whole}.${decimals}` : whole;
}

function normalizeTipMode(value) {
  return value === 'no_tip' ? 'no_tip' : 'proportional';
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

/** iOS decimal pad has no "Done" key — accessory bar dismisses keyboard. */
const TIP_AMOUNT_INPUT_ACCESSORY_ID = 'settldTipAmountAccessory';

// ─── Utility functions ──────────────────────────────────────────────────────────

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function BillSplitScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const billId = route?.params?.billId;
  const shouldShowTipConfirmation = !!route?.params?.showTipConfirmation;
  
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
  const [autoSplitting, setAutoSplitting] = useState(false);
  const [showTipConfirm, setShowTipConfirm] = useState(false);
  const [tipMode, setTipMode] = useState(null);
  const [tipInput, setTipInput] = useState('');
  const [savingTip, setSavingTip] = useState(false);
  const tipPromptShownRef = useRef(false);

  useEffect(() => {
    if (!bill || !shouldShowTipConfirmation || tipPromptShownRef.current) return;

    const detectedTip = parsePriceValue(bill.tip);
    setTipInput(detectedTip > 0 ? detectedTip.toFixed(2) : '');
    setTipMode(detectedTip > 0 ? normalizeTipMode(bill.tip_split_mode) : null);
    setShowTipConfirm(true);
    tipPromptShownRef.current = true;
    navigation.setParams?.({ showTipConfirmation: false });
  }, [bill, navigation, shouldShowTipConfirmation]);


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
              // Pass ONLY `message` (with the URL embedded). If we pass
              // `url` as well, iOS's share sheet hands both to iMessage
              // which then composes two bubbles: the `message` body +
              // a standalone link card for the `url`. Recipients see
              // the invite link twice. Embedding the URL in the
              // message text yields a single bubble with one preview.
              await Share.share({
                message: `Join me to split ${billTitle}!\n\n${inviteLink}`,
                title: `Split ${billTitle} on Settld`,
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

  const handleConfirmTip = useCallback(async () => {
    if (!tipMode) {
      Alert.alert('Choose a tip option', 'Select how the tip should be handled.');
      return;
    }

    const tipAmount = tipMode === 'no_tip' ? 0 : parsePriceValue(tipInput);
    if (tipMode !== 'no_tip' && tipAmount <= 0) {
      Alert.alert('Enter tip amount', 'Add the tip amount the host paid.');
      return;
    }

    Keyboard.dismiss();
    setSavingTip(true);
    try {
      await billsApi.update(billId, {
        tip: tipAmount.toFixed(2),
        tip_split_mode: tipMode,
      });
      await fetchSummary(true);
      setShowTipConfirm(false);
    } catch (err) {
      Alert.alert('Could not save tip', err?.message ?? err?.error?.message ?? 'Please try again.');
    } finally {
      setSavingTip(false);
    }
  }, [billId, fetchSummary, tipInput, tipMode]);

  const handleEvenSplit = useCallback(() => {
    if (isEditingItems || savingItemEdits) {
      Alert.alert('Save items first', 'Tap Done to save receipt edits before splitting evenly.');
      return;
    }

    if (members.length === 0 || visibleItems.length === 0) {
      Alert.alert('Nothing to split', 'Add receipt items and members before using even split.');
      return;
    }

    Alert.alert(
      'Even split receipt?',
      'This will replace current item assignments and split every receipt item evenly across all members.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Even Split',
          onPress: async () => {
            setAutoSplitting(true);
            try {
              await assignmentsApi.autoSplit(
                billId,
                members.map((m) => m.id),
                { clientMutationId: newClientMutationId() },
              );
              await fetchSummary(true);
            } catch (err) {
              Alert.alert('Could not split evenly', err?.message ?? err?.error?.message ?? 'Please try again.');
            } finally {
              setAutoSplitting(false);
            }
          },
        },
      ],
    );
  }, [billId, fetchSummary, isEditingItems, members, savingItemEdits, visibleItems]);

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

  const detectedTip = parsePriceValue(bill.tip);
  const canEvenSplit = members.length > 1;
  const tipOptions = detectedTip > 0
    ? [
        { mode: 'proportional', label: 'Split proportionally', helper: 'Guests share tip based on their item subtotal.' },
        { mode: 'no_tip', label: 'No tip', helper: 'Set tip to $0.00.' },
      ]
    : [
        { mode: 'proportional', label: 'Add tip and split proportionally', helper: 'Guests share tip based on their item subtotal.' },
        { mode: 'no_tip', label: 'No tip', helper: 'No tip was paid.' },
      ];

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
          { paddingTop: insets.top + 72, paddingBottom: insets.bottom + 300 },
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

        {visibleItems.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => navigation.navigate('ReceiptSetupTip', { billId })}
            style={styles.receiptSetupLink}
          >
            <MaterialIcons name="tune" size={18} color={colors.secondary} />
            <Text style={styles.receiptSetupLinkText}>Tip & party size</Text>
            <MaterialIcons name="chevron-right" size={20} color={colors.onSurfaceVariant} />
          </TouchableOpacity>
        ) : null}

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
                  {canEvenSplit && (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={handleEvenSplit}
                      disabled={autoSplitting || isEditingItems || savingItemEdits}
                    >
                      <View
                        style={[
                          styles.evenSplitButton,
                          (autoSplitting || isEditingItems || savingItemEdits) && styles.headerButtonDisabled,
                        ]}
                      >
                        {autoSplitting ? (
                          <ActivityIndicator size="small" color={colors.secondary} />
                        ) : (
                          <>
                            <MaterialIcons name="call-split" size={16} color={colors.secondary} />
                            <Text style={styles.evenSplitButtonText}>Even Split</Text>
                          </>
                        )}
                      </View>
                    </TouchableOpacity>
                  )}
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
                  serverAssignments={serverAssignments}
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
          bill={bill}
          members={members}
          onSend={handleSend}
          isHost={true}
        />
      )}

      <Modal
        visible={showTipConfirm}
        animationType="fade"
        transparent
        onRequestClose={() => Keyboard.dismiss()}
      >
        <KeyboardAvoidingView
          style={styles.tipModalKeyboardRoot}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        >
          {Platform.OS === 'ios' && (
            <InputAccessoryView nativeID={TIP_AMOUNT_INPUT_ACCESSORY_ID}>
              <View style={styles.tipInputAccessory}>
                <TouchableOpacity
                  onPress={() => Keyboard.dismiss()}
                  style={styles.tipInputAccessoryBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
                >
                  <Text style={styles.tipInputAccessoryBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </InputAccessoryView>
          )}
          <View style={styles.tipModalBackdrop}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={[
                styles.tipModalScrollContent,
                { paddingBottom: Math.max(insets.bottom, 40) },
              ]}
            >
              <View style={styles.tipModalCard}>
                <View style={styles.tipModalIcon}>
                  <MaterialIcons name="payments" size={24} color={colors.onSecondaryContainer} />
                </View>
                <Text style={styles.tipModalTitle}>
                  {detectedTip > 0 ? `Tip detected: ${formatCurrency(detectedTip)}` : 'Was tip paid?'}
                </Text>
                <Text style={styles.tipModalSubtitle}>
                  Confirm this now so guests know exactly what they are covering.
                </Text>

                <View style={styles.tipOptions}>
                  {tipOptions.map((option) => {
                    const selected = tipMode === option.mode;
                    return (
                      <TouchableOpacity
                        key={option.mode}
                        activeOpacity={0.85}
                        onPress={() => {
                          setTipMode(option.mode);
                          if (option.mode === 'no_tip') setTipInput('0.00');
                        }}
                        style={[styles.tipOption, selected && styles.tipOptionSelected]}
                      >
                        <View style={[styles.tipOptionRadio, selected && styles.tipOptionRadioSelected]}>
                          {selected && <View style={styles.tipOptionRadioDot} />}
                        </View>
                        <View style={styles.tipOptionCopy}>
                          <Text style={styles.tipOptionLabel}>{option.label}</Text>
                          <Text style={styles.tipOptionHelper}>{option.helper}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {tipMode && tipMode !== 'no_tip' && (
                  <View style={styles.tipAmountWrap}>
                    <Text style={styles.tipAmountLabel}>Tip amount</Text>
                    <TextInput
                      value={tipInput}
                      onChangeText={(value) => setTipInput(cleanMoneyText(value))}
                      keyboardType="decimal-pad"
                      inputAccessoryViewID={
                        Platform.OS === 'ios' ? TIP_AMOUNT_INPUT_ACCESSORY_ID : undefined
                      }
                      placeholder="0.00"
                      placeholderTextColor={colors.outline}
                      style={styles.tipAmountInput}
                    />
                  </View>
                )}

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={handleConfirmTip}
                  disabled={savingTip}
                  style={[styles.tipConfirmButton, savingTip && styles.headerButtonDisabled]}
                >
                  {savingTip ? (
                    <ActivityIndicator size="small" color={colors.onSecondary} />
                  ) : (
                    <Text style={styles.tipConfirmButtonText}>Confirm tip</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

  receiptSetupLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 20,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  receiptSetupLinkText: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    fontWeight: '600',
    color: colors.onSurface,
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
  evenSplitButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.secondary,
    backgroundColor: colors.surfaceContainerLowest,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  evenSplitButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
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

  tipModalKeyboardRoot: {
    flex: 1,
  },
  tipModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.42)',
  },
  tipModalScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  tipInputAccessory: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tipInputAccessoryBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  tipInputAccessoryBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    fontWeight: '700',
    color: colors.secondary,
  },
  tipModalCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 28,
    padding: 24,
    ...shadows.card,
  },
  tipModalIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  tipModalTitle: {
    fontFamily: 'Manrope_800ExtraBold',
    fontSize: 23,
    fontWeight: '800',
    color: colors.onSurface,
    letterSpacing: -0.5,
  },
  tipModalSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
    marginTop: 6,
  },
  tipOptions: {
    gap: 10,
    marginTop: 20,
  },
  tipOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLowest,
  },
  tipOptionSelected: {
    borderColor: colors.secondary,
    backgroundColor: colors.surfaceContainerLow,
  },
  tipOptionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  tipOptionRadioSelected: {
    borderColor: colors.secondary,
  },
  tipOptionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.secondary,
  },
  tipOptionCopy: {
    flex: 1,
  },
  tipOptionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSurface,
  },
  tipOptionHelper: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.onSurfaceVariant,
    lineHeight: 17,
    marginTop: 2,
  },
  tipAmountWrap: {
    marginTop: 18,
  },
  tipAmountLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    marginBottom: 8,
  },
  tipAmountInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    backgroundColor: colors.surfaceContainerLow,
  },
  tipConfirmButton: {
    minHeight: 54,
    borderRadius: radii.full,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  tipConfirmButtonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
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
