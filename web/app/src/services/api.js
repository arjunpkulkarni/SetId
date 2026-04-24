const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export { API_BASE_URL };

// ── Flow 2: Party (guest invite link) ────────────────────────────

export const joinParty = async (inviteToken, nickname) => {
  const res = await fetch(`${API_BASE_URL}/party/${inviteToken}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw await buildError(res, 'Failed to join party');
  const body = await res.json();
  return body.data ?? body;
};

export const getReceipt = async (inviteToken) => {
  const res = await fetch(`${API_BASE_URL}/party/${inviteToken}/receipt`);
  if (!res.ok) throw await buildError(res, 'Failed to load receipt');
  const body = await res.json();
  return body.data ?? body;
};

// Monotonically-increasing id per tab so the server can echo it in the
// `assignment_update` broadcast and we can drop our own events — prevents
// the "claim → delta arrives → re-fetch → overwrite optimistic state"
// race that made the guest page feel glitchy.
let _webMutationCounter = 0;
const _webInstanceId = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export function newClientMutationId() {
  _webMutationCounter += 1;
  return `${_webInstanceId}:${_webMutationCounter}`;
}

export const claimItems = async (inviteToken, claims, { clientMutationId } = {}) => {
  const res = await fetch(`${API_BASE_URL}/party/${inviteToken}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claims,
      ...(clientMutationId ? { client_mutation_id: clientMutationId } : {}),
    }),
  });
  if (!res.ok) throw await buildError(res, 'Failed to update claims');
  const body = await res.json();
  return body.data ?? body;
};

export const confirmParty = async (inviteToken) => {
  const res = await fetch(`${API_BASE_URL}/party/${inviteToken}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw await buildError(res, 'Failed to confirm payment');
  const body = await res.json();
  return body.data ?? body;
};

export const notifyPaymentComplete = async (inviteToken) => {
  const res = await fetch(`${API_BASE_URL}/party/${inviteToken}/payment-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw await buildError(res, 'Failed to notify payment');
  const body = await res.json();
  return body.data ?? body;
};

export const buildPartyWsUrl = (inviteToken) => {
  const wsBase = API_BASE_URL.replace(/^http/, 'ws');
  return `${wsBase}/party/${inviteToken}/ws`;
};

// ── Flow 3: Public pay link ──────────────────────────────────────

export const getPaymentDetails = async (token) => {
  const res = await fetch(`${API_BASE_URL}/pay/${token}`);
  if (res.status === 410) return { token_expired: true };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (body?.error?.code === 'TOKEN_EXPIRED') return { token_expired: true };
    throw new Error(body?.error?.message || body?.message || 'Failed to fetch payment details');
  }
  const body = await res.json();
  return body.data ?? body;
};

// ── Helpers ──────────────────────────────────────────────────────

async function buildError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  return new Error(body?.error?.message || body?.message || body?.detail || fallback);
}
