import { useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { runDemoPerfUiFlow } from './demoPerfNavigation';

const AUTO_RUN = process.env.EXPO_PUBLIC_DEMO_AUTO_RUN === '1';

/**
 * When EXPO_PUBLIC_DEMO_AUTO_RUN=1, drives the receipt scan demo without
 * manual login or taps. Shell script waits for console line DEMO_PERF_UI_COMPLETE.
 */
export default function DemoPerfController() {
  const { user, token, isLoading } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (!AUTO_RUN || isLoading || !user || !token || started.current) return;
    started.current = true;

    const t = setTimeout(() => {
      runDemoPerfUiFlow()
        .then(() => {
          if (__DEV__) console.log('[DEMO_PERF] UI flow started');
        })
        .catch((err) => {
          console.error('DEMO_PERF_UI_FAILED', err?.message ?? err);
        });
    }, 1500);

    return () => clearTimeout(t);
  }, [user, token, isLoading]);

  return null;
}
