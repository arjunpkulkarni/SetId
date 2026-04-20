import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../services/api';

const WS_BASE = API_BASE_URL.replace(/^http/, 'ws');
const MAX_RETRIES = 8;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;
const PING_INTERVAL_MS = 25000;
const STALE_THRESHOLD_MS = 35000;
const LAST_RESORT_RETRY_MS = 60000;

export default function usePaymentWebSocket(billId, token, onUpdate) {
  const wsRef = useRef(null);
  const retriesRef = useRef(0);
  const cancelledRef = useRef(false);
  const pingTimerRef = useRef(null);
  const staleTimerRef = useRef(null);
  const lastMsgAtRef = useRef(Date.now());
  const lastResortRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (pingTimerRef.current) { clearInterval(pingTimerRef.current); pingTimerRef.current = null; }
    if (staleTimerRef.current) { clearInterval(staleTimerRef.current); staleTimerRef.current = null; }
    if (lastResortRef.current) { clearTimeout(lastResortRef.current); lastResortRef.current = null; }
  }, []);

  const connect = useCallback(() => {
    if (!billId || !token || cancelledRef.current) return;

    const url = `${WS_BASE}/bills/${billId}/ws?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      retriesRef.current = 0;
      lastMsgAtRef.current = Date.now();

      pingTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL_MS);

      staleTimerRef.current = setInterval(() => {
        if (Date.now() - lastMsgAtRef.current > STALE_THRESHOLD_MS) {
          ws.close(4000, 'Stale connection');
        }
      }, STALE_THRESHOLD_MS);
    };

    ws.onmessage = (event) => {
      if (cancelledRef.current) return;
      lastMsgAtRef.current = Date.now();
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong' || msg.type === 'ping') return;
        if (msg.type === 'assignment_update' || msg.type === 'payment_update') {
          onUpdate(msg);
        }
      } catch {
        // ignore malformed
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      wsRef.current = null;
      clearTimers();
      if (cancelledRef.current) return;
      if (retriesRef.current < MAX_RETRIES) {
        const raw = BASE_DELAY_MS * Math.pow(2, retriesRef.current);
        const capped = Math.min(raw, MAX_DELAY_MS);
        const jittered = capped * (0.5 + Math.random() * 0.5);
        retriesRef.current += 1;
        setTimeout(() => {
          if (!cancelledRef.current) connect();
        }, jittered);
      } else {
        lastResortRef.current = setTimeout(() => {
          if (!cancelledRef.current && !wsRef.current) {
            retriesRef.current = 0;
            connect();
          }
        }, LAST_RESORT_RETRY_MS);
      }
    };
  }, [billId, token, onUpdate, clearTimers]);

  useEffect(() => {
    cancelledRef.current = false;
    retriesRef.current = 0;
    connect();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !wsRef.current && !cancelledRef.current) {
        retriesRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelledRef.current = true;
      clearTimers();
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearTimers]);
}
