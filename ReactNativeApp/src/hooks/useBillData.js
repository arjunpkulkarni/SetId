import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { bills as billsApi, assignments as assignmentsApi, receipts as receiptsApi } from '../services/api';

function parsePriceValue(value) {
  const num = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function normalizeItemName(value) {
  return `${value ?? ''}`.replace(/\s+/g, ' ').trim();
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

export function useBillData(billId) {
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
  const [refreshing, setRefreshing] = useState(false);
  
  // Item editing state
  const [isEditingItems, setIsEditingItems] = useState(false);
  const [savingItemEdits, setSavingItemEdits] = useState(false);
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

  const lastFetchTime = useRef(0);
  const FETCH_DEBOUNCE_MS = 1000;

  const fetchSummary = useCallback(async (force = false) => {
    if (!billId) return;
    
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
      if (__DEV__) console.warn('[fetchSummary] failed', e);
    }
  }, [applyServerItemState, billId]);

  const handlePullToRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchSummary();
    setRefreshing(false);
  }, [fetchSummary]);

  // Initial load
  useEffect(() => {
    fetchSummary().finally(() => setLoading(false));
  }, [fetchSummary]);

  // Refresh when the screen regains focus
  useFocusEffect(
    useCallback(() => {
      fetchSummary(true);
    }, [fetchSummary]),
  );

  // Refresh when the app returns from background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') fetchSummary(true);
    });
    return () => sub.remove();
  }, [fetchSummary]);

  const handleToggleMember = useCallback((itemId, memberId) => {
    const key = `${itemId}::${memberId}`;
    const currentList = assignmentMap[itemId] || [];
    const has = currentList.includes(memberId);

    // Optimistic UI update
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

    const prevPromise = mutationQueueRef.current[key] || Promise.resolve();
    const nextPromise = prevPromise.then(async () => {
      try {
        if (has) {
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
      if (inFlightMutationsRef.current === 0) {
        fetchSummary(true);
      }
    });
  }, [assignmentMap, billId, fetchSummary]);

  return {
    // State
    bill,
    members,
    items,
    setItems,
    assignmentMap,
    setAssignmentMap,
    serverAssignments,
    loading,
    refreshing,
    
    // Item editing state
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
    
    // Actions
    fetchSummary,
    handlePullToRefresh,
    handleToggleMember,
    applyServerItemState,
  };
}