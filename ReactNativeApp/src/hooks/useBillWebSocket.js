import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { getToken } from '../services/authStorage';
import { getWebSocketBaseUrl } from '../services/api';

const MAX_RECONNECT_DELAY = 30000;
// Mobile carriers and consumer NATs silently drop idle TCP flows after 60–120s.
// RN's WebSocket doesn't notice a half-dead socket — readyState stays OPEN
// forever. We detect this at the app layer by tracking the last inbound frame
// and forcing a reconnect when the server has been silent too long.
const PING_INTERVAL_MS = 20000;
const LIVENESS_TIMEOUT_MS = 45000;

export default function useBillWebSocket(billId, handlers = {}) {
  const ws = useRef(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef(null);
  const isMounted = useRef(true);
  const pingTimer = useRef(null);
  const lastFrameAt = useRef(0);
  const [connected, setConnected] = useState(false);

  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const connect = useCallback(async () => {
    if (!billId || !isMounted.current) return;

    try {
      const token = await getToken();
      if (!token || !isMounted.current) {
        console.warn(`[WS] No token available for bill ${billId}`);
        return;
      }

      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        console.log(`[WS] Already connected to bill ${billId}`);
        return;
      }

      const wsBase = getWebSocketBaseUrl();
      const url = `${wsBase}/bills/${billId}/ws?token=${encodeURIComponent(token)}`;
      console.log(`[WS] Connecting to: ${url.replace(/token=[^&]*/, 'token=***')}`);
      const socket = new WebSocket(url);

      socket.onopen = () => {
        if (!isMounted.current) {
          socket.close();
          return;
        }
        console.log(`[WS] Socket opened successfully for bill ${billId}`);
        reconnectAttempt.current = 0;
        lastFrameAt.current = Date.now();
        setConnected(true);
        handlersRef.current.onConnected?.();

        clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (socket.readyState !== WebSocket.OPEN) return;

          const silentMs = Date.now() - lastFrameAt.current;
          if (silentMs > LIVENESS_TIMEOUT_MS) {
            console.warn(
              `[WS] No traffic for ${silentMs}ms on bill ${billId} — forcing reconnect`,
            );
            try {
              socket.close(4000, 'liveness timeout');
            } catch {}
            return;
          }

          try {
            socket.send(JSON.stringify({ type: 'ping' }));
          } catch {}
        }, PING_INTERVAL_MS);
      };

      socket.onmessage = (event) => {
        lastFrameAt.current = Date.now();
        try {
          const msg = JSON.parse(event.data);
          // Backend envelope key is `type` (as of the ws_manager refactor).
          // Accept legacy `event` too so this keeps working if the server ever
          // flips back.
          const eventType = msg.type ?? msg.event;
          const { data } = msg;

          if (__DEV__) {
            console.log(`[WS] received ${eventType}`, data);
          }

          switch (eventType) {
            case 'assignment_update':
              handlersRef.current.onAssignmentUpdate?.(data);
              break;
            case 'member_joined':
              handlersRef.current.onMemberJoined?.(data);
              break;
            case 'payment_complete':
              handlersRef.current.onPaymentComplete?.(data);
              break;
            case 'pong':
              break;
            case 'ping':
              // Server-originated heartbeat. Mirror it back so the peer's
              // liveness check stays happy, and do NOT log as "unknown".
              try {
                socket.send(JSON.stringify({ type: 'pong' }));
              } catch {}
              break;
            default:
              if (__DEV__) {
                console.log(`[WS] unknown event type: ${eventType}`);
              }
              break;
          }
        } catch (err) {
          if (__DEV__) {
            console.warn('[WS] failed to parse message', err, event.data);
          }
        }
      };

      socket.onerror = (error) => {
        console.warn(`[WS] Socket error for bill ${billId}:`, error);
      };

      socket.onclose = (e) => {
        console.log(`[WS] Socket closed for bill ${billId}, code: ${e.code}, reason: ${e.reason}`);
        clearInterval(pingTimer.current);
        ws.current = null;
        setConnected(false);

        if (!isMounted.current) return;

        if (e.code === 4001 || e.code === 4003) {
          console.warn(`[WS] Auth error, not reconnecting. Code: ${e.code}`);
          handlersRef.current.onAuthError?.(e.code);
          return;
        }

        console.log(`[WS] Will attempt to reconnect...`);
        scheduleReconnect();
      };

      ws.current = socket;
    } catch {
      scheduleReconnect();
    }
  }, [billId]);

  const scheduleReconnect = useCallback(() => {
    if (!isMounted.current) return;
    clearTimeout(reconnectTimer.current);

    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempt.current),
      MAX_RECONNECT_DELAY,
    );
    reconnectAttempt.current += 1;

    reconnectTimer.current = setTimeout(() => {
      if (isMounted.current) {
        connect();
      }
    }, delay);
  }, [connect]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isMounted.current) {
        if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
          reconnectAttempt.current = 0;
          connect();
        }
      }
    });

    return () => sub.remove();
  }, [connect]);

  useEffect(() => {
    isMounted.current = true;
    connect();

    return () => {
      isMounted.current = false;
      clearTimeout(reconnectTimer.current);
      clearInterval(pingTimer.current);
      if (ws.current) {
        ws.current.close();
        ws.current = null;
      }
    };
  }, [connect]);

  return { ws, connected };
}
