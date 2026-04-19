import { useState, useEffect, useRef } from 'react';

/**
 * Subscribes once per mount to NetInfo and returns the current connectivity
 * state. We separate `isConnected` (link up) from `isInternetReachable` because
 * captive-portal WiFi and cellular-with-no-data both report isConnected=true
 * but fail every request — that's exactly when we want to show the offline UI.
 *
 * IMPORTANT: NetInfo is require()d lazily inside a try/catch so a TestFlight
 * build that predates this package doesn't crash. If it's missing we assume
 * "always online" — the OfflineBanner simply never shows, but the rest of the
 * app works normally.
 */

let NetInfo = null;
try {
  const mod = require('@react-native-community/netinfo');
  NetInfo = mod?.default ?? mod;
} catch (err) {
  if (__DEV__) {
    console.warn(
      '[useNetworkStatus] NetInfo native module unavailable; assuming online.',
      err?.message ?? err,
    );
  }
}

const DEFAULT_STATE = {
  isConnected: true,
  isInternetReachable: true,
  type: 'unknown',
};

export function useNetworkStatus() {
  const [state, setState] = useState(DEFAULT_STATE);

  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;

    // If NetInfo isn't available, stay in the default "online" state forever.
    // No subscription to clean up.
    if (!NetInfo || typeof NetInfo.addEventListener !== 'function') {
      return () => {
        isMounted.current = false;
      };
    }

    // Seed with the current snapshot so we don't render an "online" UI for
    // the first frame when we're actually offline.
    try {
      NetInfo.fetch?.().then((s) => {
        if (!isMounted.current || !s) return;
        setState({
          isConnected: s.isConnected ?? false,
          isInternetReachable: s.isInternetReachable ?? false,
          type: s.type ?? 'unknown',
        });
      }).catch(() => {});
    } catch {
      // Swallow — initial fetch failing shouldn't break the app.
    }

    let unsubscribe = () => {};
    try {
      unsubscribe = NetInfo.addEventListener((s) => {
        if (!isMounted.current || !s) return;
        setState({
          isConnected: s.isConnected ?? false,
          isInternetReachable: s.isInternetReachable ?? false,
          type: s.type ?? 'unknown',
        });
      });
    } catch (err) {
      if (__DEV__) console.warn('[useNetworkStatus] addEventListener failed', err);
    }

    return () => {
      isMounted.current = false;
      try {
        unsubscribe();
      } catch {}
    };
  }, []);

  // isInternetReachable can be null on first read — treat null as "assume
  // online" so we don't falsely show an offline banner on app launch.
  const isOnline = state.isConnected && state.isInternetReachable !== false;

  return {
    isOnline,
    isConnected: state.isConnected,
    isInternetReachable: state.isInternetReachable,
    type: state.type,
  };
}
