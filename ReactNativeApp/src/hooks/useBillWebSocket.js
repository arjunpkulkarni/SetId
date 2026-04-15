import { useEffect, useRef, useCallback } from 'react';
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

  const connect = useCallback(async () => {
    if (!billId || !isMounted.current) return;

    try {
      const token = await getToken();
      if (!token || !isMounted.current) return;

      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        return;
      }

      const wsBase = getWebSocketBaseUrl();
      const url = `${wsBase}/bills/${billId}/ws?token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(url);

      socket.onopen = () => {
        if (!isMounted.current) {
          socket.close();
          return;
        }
        reconnectAttempt.current = 0;
        handlers.onConnected?.();

        // Keep-alive ping every 30s
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
              handlers.onAssignmentUpdate?.(data);
              break;
            case 'member_joined':
              handlers.onMemberJoined?.(data);
              break;
            case 'payment_complete':
              handlers.onPaymentComplete?.(data);
              break;
            default:
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };

      socket.onerror = () => {
        // onclose will fire after this, which handles reconnect
      };

      socket.onclose = (e) => {
        clearInterval(pingTimer.current);
        ws.current = null;

        if (!isMounted.current) return;

        // Don't reconnect on auth errors
        if (e.code === 4001 || e.code === 4003) {
          handlers.onAuthError?.(e.code);
          return;
        }

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

  // Reconnect when app comes back to foreground
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

  // Main connect / disconnect lifecycle
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

  return ws;
}
