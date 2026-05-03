/**
 * Shared payout / Stripe Connect error helpers — retries and user-visible copy.
 */

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalize ApiError, axios-shaped, or generic throws. */
export function normalizePayoutErr(err, defaultMessage) {
  const code = err?.code ?? err?.error?.code ?? 'UNKNOWN';
  const message =
    err?.message
    ?? err?.error?.message
    ?? defaultMessage
    ?? 'Something went wrong. Please try again.';
  return { code, message };
}

/** True when a retry might help (Stripe / network hiccup). */
export function isTransientPayoutFailure(code) {
  return code === 'NETWORK_ERROR' || code === 'STRIPE_ERROR';
}

/**
 * Run `fn` with up to `maxAttempts` tries, backing off between attempts
 * only when the failure looks transient.
 */
export async function withPayoutSetupRetry(
  fn,
  { maxAttempts = 2, delayMs = 700 } = {},
) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const { code } = normalizePayoutErr(e);
      if (!isTransientPayoutFailure(code) || attempt === maxAttempts) {
        throw e;
      }
      if (__DEV__) {
        console.warn(
          `[payout] transient ${code}, retry ${attempt + 1}/${maxAttempts}`,
        );
      }
      await SLEEP(delayMs);
    }
  }
  throw lastErr;
}

/**
 * Stripe RN `createToken` occasionally fails on first tap after CardField mounts.
 * Retry once on generic failure if the error message looks retryable.
 */
export async function createCardTokenWithRetry(createToken, params) {
  const lastAttempt = 2;
  let lastError;
  for (let i = 0; i < lastAttempt; i++) {
    const { token, error: tokenError } = await createToken(params);
    if (!tokenError && token?.id) {
      return { token, error: null };
    }
    lastError = tokenError;
    const msg = String(tokenError?.message ?? '').toLowerCase();
    const retryable =
      i < lastAttempt - 1
      && (/try again|network|timeout|unknown|temporar/i.test(msg)
        || !msg);
    if (!retryable) {
      return { token: null, error: tokenError };
    }
    await SLEEP(350);
  }
  return { token: null, error: lastError };
}

/**
 * US bank account → Connect `tok_...`. Same light retry as card tokenization.
 */
export async function createBankAccountTokenWithRetry(createToken, params) {
  const lastAttempt = 2;
  let lastError;
  for (let i = 0; i < lastAttempt; i++) {
    const { token, error: tokenError } = await createToken(params);
    if (!tokenError && token?.id) {
      return { token, error: null };
    }
    lastError = tokenError;
    const msg = String(tokenError?.message ?? '').toLowerCase();
    const retryable =
      i < lastAttempt - 1
      && (/try again|network|timeout|unknown|temporar/i.test(msg)
        || !msg);
    if (!retryable) {
      return { token: null, error: tokenError };
    }
    await SLEEP(350);
  }
  return { token: null, error: lastError };
}

/**
 * Connect external accounts only accept debit / prepaid — never credit.
 * When Stripe RN populates `token.card.funding`, reject before the API call.
 *
 * @param {object|null|undefined} token — result from `createToken`
 * @returns {string|null} User-visible block reason, or null if OK / unknown type
 */
export function getPayoutFundingBlockReason(token) {
  const funding = token?.card?.funding;
  if (!funding) return null;
  const f = String(funding).toLowerCase();
  if (f === 'credit') {
    return 'Credit cards can\'t be used for payouts. Use a US debit card.';
  }
  if (f !== 'debit' && f !== 'prepaid') {
    return 'Use a US debit card for payouts. Credit cards aren\'t supported.';
  }
  return null;
}
