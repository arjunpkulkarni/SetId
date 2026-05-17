/**
 * UX-only: after the host submits payout onboarding successfully, Stripe often
 * lags flipping `payouts_enabled`. We briefly paint a success state so the
 * screen doesn't feel stuck — polls/refetch still reconcile real status.
 */

let optimisticDeadlineMs = 0;

/** How long to treat verification as “done” in the UI after a successful POST. */
const OPTIMISTIC_WINDOW_MS = 45 * 60 * 1000;

export function markPayoutVerificationSubmittedOptimistically() {
  optimisticDeadlineMs = Date.now() + OPTIMISTIC_WINDOW_MS;
}

export function clearPayoutOptimisticVerificationUi() {
  optimisticDeadlineMs = 0;
}

export function isPayoutOptimisticVerificationUiActive() {
  return Date.now() < optimisticDeadlineMs;
}

/** Safe to show the green “submitted” treatment when Stripe still reports pending. */
export function shouldShowOptimisticPayoutVerificationDone(status) {
  return (
    isPayoutOptimisticVerificationUiActive() &&
    !!status?.connected &&
    !!status?.details_submitted &&
    !status?.payouts_enabled
  );
}
