import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getReceipt, claimItems, buildPartyWsUrl, newClientMutationId } from '../services/api';
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
  const [claiming, setClaiming] = useState(null);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);
  const pollRef = useRef(null);
  // Set of client_mutation_ids this tab initiated. Echoed broadcasts that
  // carry one of these are ignored — the tab already has the up-to-date
  // receipt from the POST /claim response and doesn't need to refetch.
  const ownMutationIdsRef = useRef(new Set());
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
    const { action, receipt_item_id, bill_member_id, assignment_id } = data;
    if (!action || !receipt_item_id || !bill_member_id) return;

    setReceipt((prev) => {
      if (!prev) return prev;
      const items = prev.items || [];
      const nextItems = items.map((item) => {
        if (item.id !== receipt_item_id) return item;
        const claimedBy = item.claimed_by || [];
        if (action === 'added') {
          if (claimedBy.some((c) => c.member_id === bill_member_id)) return item;
          return {
            ...item,
            claimed_by: [
              ...claimedBy,
              {
                member_id: bill_member_id,
                // The delta intentionally doesn't ship nickname/amount — we
                // leave them undefined here; a follow-up fetchReceipt on
                // focus or a subsequent claim response will fill them in.
                assignment_id,
                share_type: 'equal',
                amount_owed: '0',
              },
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
            try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
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

  const handleClaim = async (itemId, action) => {
    const mutationId = newClientMutationId();
    ownMutationIdsRef.current.add(mutationId);
    console.log('[API] POST /party/' + token + '/claim', { receipt_item_id: itemId, action, mutationId });
    setClaiming(itemId);
    try {
      const data = await claimItems(
        token,
        [{ receipt_item_id: itemId, action }],
        { clientMutationId: mutationId },
      );
      console.log('[API] ✅ Claim response:', data);
      setReceipt(data);
    } catch (err) {
      ownMutationIdsRef.current.delete(mutationId);
      console.error('[API] ❌ Claim error:', err);
      setError(err.message);
    } finally {
      setClaiming(null);
    }
  };

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
            const isBusy = claiming === item.id;

            return (
              <button
                key={item.id}
                className={`claim-item ${isMine ? 'claimed' : ''}`}
                onClick={() => handleClaim(item.id, isMine ? 'unclaim' : 'claim')}
                disabled={isBusy}
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
            disabled={!hasAnyClaims}
          >
            {hasAnyClaims ? 'Continue to Payment' : 'Select at least one item'}
          </button>
        </div>
      </div>
    </div>
  );
}
