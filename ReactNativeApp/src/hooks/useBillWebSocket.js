import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { getToken } from '../services/authStorage';
import { getWebSocketBaseUrl } from '../services/api';

const MAX_RECONNECT_DELAY = 30000;

export default function useBillWebSocket(billId, handlers = {}) {
  const ws = useRef(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef(null);
  const isMounted = useRef(true);
  const pingTimer = useRef(null);
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

      const url = `${WS_BASE}/bills/${billId}/ws?token=${token}`;
      console.log(`[WS] Connecting to: ${url.replace(/token=[^&]*/, 'token=***')}`);
      const wsBase = getWebSocketBaseUrl();
      const url = `${wsBase}/bills/${billId}/ws?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);

      socket.onopen = () => {
        if (!isMounted.current) {
          socket.close();
          return;
        }
        console.log(`[WS] Socket opened successfully for bill ${billId}`);
        reconnectAttempt.current = 0;
        setConnected(true);
        handlersRef.current.onConnected?.();

        clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const { event: eventType, data } = msg;

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
            default:
              break;
          }
        } catch {
          // ignore malformed messages
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
