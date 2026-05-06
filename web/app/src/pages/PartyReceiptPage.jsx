import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  getReceipt,
  claimItems,
  buildPartyWsUrl,
  newClientMutationId,
} from '../services/api';
import { formatCurrency } from '../utils/formatters';
import LoadingSpinner from '../components/LoadingSpinner';
import './PartyReceiptPage.css';

export default function PartyReceiptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const memberName = location.state?.memberName || 'You';
  const billTitle = location.state?.billTitle;
  const basePath = location.pathname.startsWith('/join') ? '/join' : '/party';

  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  // Set of client_mutation_ids this tab initiated. Echoed broadcasts that
  // carry one of these are ignored — the tab already has authoritative
  // state from the optimistic apply (or the later broadcast from the
  // other side for remote claims).
  const ownMutationIdsRef = useRef(new Set());
  // Per-item mutation queue so rapid taps on the same item serialize
  // server-side without racing. Different items run in parallel.
  const mutationQueueRef = useRef({});
  // Live receipt ref so the WS handler can patch state without triggering
  // a re-render through the effect's dependency list.
  const receiptRef = useRef(null);
  useEffect(() => {
    receiptRef.current = receipt;
  }, [receipt]);

  const fetchReceipt = useCallback(async () => {
    console.log('[API] GET /party/' + token + '/receipt');
    try {
      const data = await getReceipt(token);
      console.log('[API] ✅ Receipt response:', data);
      setReceipt(data);
      setError(null);
    } catch (err) {
      console.error('[API] ❌ Receipt error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchReceipt(); }, [fetchReceipt]);

  /** Apply a compact assignment delta directly to the current receipt,
   *  mirroring the `claim_by` list the server would return. Echo-suppressed
   *  for events this tab originated (identified by `client_mutation_id`). */
  const applyAssignmentDelta = useCallback((data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    if (data.client_mutation_id && ownMutationIdsRef.current.has(data.client_mutation_id)) {
      ownMutationIdsRef.current.delete(data.client_mutation_id);
      return;
    }
    if (data.action === 'full_sync') {
      fetchReceipt();
      return;
    }
    const { action, receipt_item_id, bill_member_id, assignment_id, item_assignments } = data;
    if (!action || !receipt_item_id) return;

    setReceipt((prev) => {
      if (!prev) return prev;
      const items = prev.items || [];
      const nextItems = items.map((item) => {
        if (item.id !== receipt_item_id) return item;
        // Authoritative path: the broadcast shipped the full post-mutation
        // assignment list for this item. Rebuild `claimed_by` from it so
        // per-person amounts reflect equal-split sibling recalcs.
        if (Array.isArray(item_assignments)) {
          const serverClaims = item_assignments.map((a) => ({
            member_id: a.bill_member_id,
            nickname: a.member_nickname,
            name: a.member_nickname,
            assignment_id: a.id,
            share_type: a.share_type,
            amount_owed: a.amount_owed,
          }));
          // Preserve any still-in-flight optimistic claim by THIS guest
          // that hasn't reached the server yet. Without this, a concurrent
          // claim from another guest whose broadcast arrives BEFORE our
          // POST commits would briefly wipe our chip off the item.
          const serverNicks = new Set(serverClaims.map((c) => c.nickname));
          const preservedOptimistic = (item.claimed_by || []).filter(
            (c) => c.optimistic && !serverNicks.has(c.nickname) && !serverNicks.has(c.name),
          );
          return {
            ...item,
            claimed_by: [...serverClaims, ...preservedOptimistic],
          };
        }
        // Legacy compact delta fallback — chip-only update, amounts may
        // drift until the next fetchReceipt.
        if (!bill_member_id) return item;
        const claimedBy = item.claimed_by || [];
        if (action === 'added') {
          if (claimedBy.some((c) => c.member_id === bill_member_id)) return item;
          return {
            ...item,
            claimed_by: [
              ...claimedBy,
              { member_id: bill_member_id, assignment_id, share_type: 'equal', amount_owed: '0' },
            ],
          };
        }
        if (action === 'removed') {
          return {
            ...item,
            claimed_by: claimedBy.filter((c) =>
              assignment_id ? c.assignment_id !== assignment_id : c.member_id !== bill_member_id,
            ),
          };
        }
        return item;
      });
      return { ...prev, items: nextItems };
    });
  }, [fetchReceipt]);

  // WebSocket for real-time updates; polls as a fallback ONLY while we
  // don't have an open socket.
  useEffect(() => {
    let ws;
    const wsConnectedRef = { current: false };
    const wsUrl = buildPartyWsUrl(token);

    const startPolling = () => {
      if (pollRef.current) return;
      console.log('[WS] ⏱️ Starting 5s polling fallback');
      pollRef.current = setInterval(() => {
        // Re-check the ref each tick — the original code captured
        // `wsConnected` via closure and kept polling forever even after
        // the WS opened.
        if (!wsConnectedRef.current) fetchReceipt();
      }, 5000);
    };

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    console.log('[WS] Attempting to connect:', wsUrl);

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = (event) => {
        console.log('[WS] ✅ Connected:', event);
        wsRef.current = ws;
        wsConnectedRef.current = true;
        stopPolling();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { type, data } = msg;

          // Server-originated heartbeat. Mirror it back so our
          // bidirectional liveness check on the server side stays happy.
          if (type === 'ping') {
            try {
              ws.send(JSON.stringify({ type: 'pong' }));
            } catch (err) {
              console.warn('[WS] Failed to send pong:', err);
            }
            return;
          }
          if (type === 'pong') return;

          if (type === 'assignment_update') {
            applyAssignmentDelta(data);
            return;
          }
          if (type === 'member_joined' || type === 'payment_complete') {
            // These don't fit cleanly into a delta — fetch once.
            fetchReceipt();
            return;
          }
        } catch (err) {
          console.error('[WS] ❌ Failed to parse message:', err, event.data);
        }
      };

      ws.onerror = (event) => {
        console.error('[WS] ❌ Error:', event);
      };

      ws.onclose = (event) => {
        console.log('[WS] 🔌 Closed:', { code: event.code, reason: event.reason });
        wsRef.current = null;
        wsConnectedRef.current = false;
        startPolling();
      };
    } catch (err) {
      console.error('[WS] ❌ Failed to create WebSocket:', err);
      startPolling();
    }

    // Start polling IMMEDIATELY as fallback until the WS opens. Once
    // `onopen` fires it clears the interval; if the WS never opens we
    // keep polling forever.
    startPolling();

    return () => {
      console.log('[WS] Cleanup — closing WebSocket and clearing poll');
      stopPolling();
      ws?.close();
    };
  }, [token, fetchReceipt, applyAssignmentDelta]);

  // Optimistic equal-split recalc. Mirrors what the server does in
  // `_recalculate_equal_splits_for_item` so the UI can update synchronously
  // on tap without waiting for the network round-trip.
  const optimisticallyToggleClaim = useCallback((itemId, action) => {
    setReceipt((prev) => {
      if (!prev) return prev;
      const items = prev.items || [];
      const nextItems = items.map((item) => {
        if (item.id !== itemId) return item;
        const total = parseFloat(item.total_price || item.unit_price || 0) || 0;
        const claimedBy = item.claimed_by || [];
        const meIdx = claimedBy.findIndex(
          (c) => c.nickname === memberName || c.name === memberName,
        );

        let nextClaimedBy;
        if (action === 'claim') {
          if (meIdx >= 0) return item;
          nextClaimedBy = [
            ...claimedBy,
            {
              nickname: memberName,
              name: memberName,
              share_type: 'equal',
              amount_owed: '0',
              optimistic: true,
            },
          ];
        } else {
          if (meIdx < 0) return item;
          nextClaimedBy = [
            ...claimedBy.slice(0, meIdx),
            ...claimedBy.slice(meIdx + 1),
          ];
        }

        const count = nextClaimedBy.length;
        const per = count > 0 ? (total / count).toFixed(2) : '0';
        nextClaimedBy = nextClaimedBy.map((c) => ({ ...c, amount_owed: per }));
        return { ...item, claimed_by: nextClaimedBy };
      });
      return { ...prev, items: nextItems };
    });
  }, [memberName]);

  const handleClaim = useCallback((itemId, action) => {
    const mutationId = newClientMutationId();
    ownMutationIdsRef.current.add(mutationId);

    // Apply the optimistic update IMMEDIATELY — the chip flips and the
    // per-person amounts recompute before React yields. The network call
    // runs in the background; the WS broadcast reconciles if our math
    // diverges from the server (which it shouldn't for equal splits).
    optimisticallyToggleClaim(itemId, action);

    const prev = mutationQueueRef.current[itemId] || Promise.resolve();
    const next = prev.then(async () => {
      try {
        await claimItems(
          token,
          [{ receipt_item_id: itemId, action }],
          { clientMutationId: mutationId },
        );
        // Deliberately NOT applying the POST response here. The response
        // is the full receipt snapshot at commit time; blindly setReceipt
        // would clobber any subsequent optimistic tap. The WS broadcast
        // carries the same authoritative per-item state and is applied
        // (or skipped as our own echo) in `applyAssignmentDelta`.
      } catch (err) {
        ownMutationIdsRef.current.delete(mutationId);
        console.error('[API] ❌ Claim error:', err);
        setError(err.message);
        // Revert to server truth — simpler than trying to invert our
        // optimistic op when multiple mutations may have stacked.
        fetchReceipt();
      }
    });
    mutationQueueRef.current[itemId] = next.catch(() => {});
  }, [token, optimisticallyToggleClaim, fetchReceipt]);

  const handleContinue = () => {
    navigate(`${basePath}/${token}/pay`, {
      state: { memberName, billTitle: title },
    });
  };

  if (loading) return <LoadingSpinner message="Loading receipt..." />;

  if (error && !receipt) {
    return (
      <div className="receipt-page">
        <div className="receipt-page-container">
          <header className="brand-header"><span className="brand">settld</span></header>
          <div className="centered-state">
            <div className="state-icon error-bg"><span className="state-emoji">!</span></div>
            <h1 className="state-title error-color">Could Not Load Receipt</h1>
            <p className="state-desc">{error}</p>
            <button className="action-btn" onClick={fetchReceipt}>Try Again</button>
          </div>
        </div>
      </div>
    );
  }

  const items = receipt?.items || [];
  const title = billTitle || receipt?.bill_title || receipt?.bill_name || receipt?.title || receipt?.name || 'Your Bill';
  const guestPaymentsOpen = receipt?.bill?.guest_pay_unlocked !== false;
  const myClaimedItems = items.filter(item =>
    item.claimed_by?.some(c => c.name === memberName || c.nickname === memberName)
  );
  const hasAnyClaims = myClaimedItems.length > 0;

  return (
    <div className="receipt-page">
      <div className="receipt-page-container">
        <header className="brand-header"><span className="brand">settld</span></header>

        <div className="receipt-hero">
          <div className="receipt-hero-icon"><span style={{ fontSize: 28 }}>🧾</span></div>
          <h1 className="receipt-hero-title">{title}</h1>
          <p className="receipt-hero-subtitle">
            Hi <strong>{memberName}</strong> — tap items you had
          </p>
        </div>

        {error && (
          <div className="receipt-inline-error" role="alert">{error}</div>
        )}

        {!guestPaymentsOpen && (
          <div className="receipt-inline-error" role="status" style={{ marginBottom: 12 }}>
            The host has not opened payments yet. You can keep picking items; the Pay button will unlock when they are ready.
          </div>
        )}

        <div className="items-card">
          {items.map((item) => {
            const myClaim = item.claimed_by?.find(
              c => c.name === memberName || c.nickname === memberName
            );
            const isMine = !!myClaim;
            const claimCount = item.claimed_by?.length || 0;
            const fullPrice = parseFloat(item.total_price || item.unit_price || 0);

            // Show what I owe (split amount) vs the full item price
            const myAmount = myClaim ? parseFloat(myClaim.amount_owed || 0) : null;
            const isSplit = claimCount > 1;

            const othersText = item.claimed_by
              ?.filter(c => c.name !== memberName && c.nickname !== memberName)
              .map(c => c.name || c.nickname)
              .join(', ');

            return (
              <button
                key={item.id}
                className={`claim-item ${isMine ? 'claimed' : ''}`}
                onClick={() => handleClaim(item.id, isMine ? 'unclaim' : 'claim')}
                aria-pressed={isMine}
              >
                <div className="claim-item-left">
                  <span className={`claim-check ${isMine ? 'checked' : ''}`}>
                    {isMine ? '✓' : ''}
                  </span>
                  <div className="claim-item-info">
                    <span className="claim-item-name">{item.name}</span>
                    {claimCount > 0 && (
                      <span className="claim-item-people">
                        {isMine && othersText ? `You, ${othersText}` : isMine ? 'You' : othersText}
                        {isSplit ? ` · split ${claimCount} ways` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="claim-item-prices">
                  {isMine && isSplit ? (
                    <>
                      <span className="claim-item-my-price">{formatCurrency(myAmount)}</span>
                      <span className="claim-item-full-price">{formatCurrency(fullPrice)}</span>
                    </>
                  ) : (
                    <span className="claim-item-price">{formatCurrency(fullPrice)}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="receipt-footer-sticky">
          <button
            className="action-btn continue-btn"
            onClick={handleContinue}
            disabled={!hasAnyClaims || !guestPaymentsOpen}
          >
            {!guestPaymentsOpen
              ? 'Waiting for host to allow payments'
              : hasAnyClaims
                ? 'Continue to Payment'
                : 'Select at least one item'}
          </button>
        </div>
      </div>
    </div>
  );
}
