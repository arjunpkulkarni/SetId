import axios from 'axios';
import { Platform } from 'react-native';
import { getToken, removeToken } from './authStorage';
import { offlineStorage } from './offlineStorage';

// Always hit production. There's no local uvicorn running on the Expo host;
// auto-detecting the dev host just resolved to the Mac's LAN/Tailscale IP and
// crashed every request with Network Error. If you ever want to point at a
// local backend, set EXPO_PUBLIC_API_URL=http://<your-ip>:8000 when starting
// Expo (`EXPO_PUBLIC_API_URL=... npm start`).
const EXPLICIT_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();

export const BASE_URL = EXPLICIT_BASE || 'https://api.settld.live';

/** WebSocket origin derived from HTTP API base (no separate hardcoded host). */
export function getWebSocketBaseUrl() {
  const base = BASE_URL.replace(/\/$/, '');
  if (base.startsWith('https://')) return base.replace('https://', 'wss://');
  if (base.startsWith('http://')) return base.replace('http://', 'ws://');
  return base;
}

function logAxiosFailure(error) {
  if (!__DEV__) return;
  const cfg = error.config;
  const base = cfg?.baseURL ?? '';
  const path = cfg?.url ?? '';
  const fullUrl = `${base}${path}` || '(unknown URL)';
  const hints = [];
  if (error.code === 'ECONNREFUSED' || error.message === 'Network Error') {
    hints.push('Check uvicorn is running (venv + port 8000).');
  }
  if (Platform.OS !== 'android' && base.includes('localhost')) {
    hints.push('On a physical device, localhost is the phone — use your Mac/PC LAN IP as BASE_URL.');
  }
  if (Platform.OS === 'android' && base.includes('10.0.2.2')) {
    hints.push('Android emulator: 10.0.2.2 maps to host localhost.');
  }
  const body = error.response?.data;
  console.warn('[SPLTR API] request failed', {
    message: error.message,
    code: error.code,
    method: cfg?.method?.toUpperCase(),
    fullUrl,
    status: error.response?.status,
    serverError: body?.error,
    hints:
      error.response?.status && error.response.status < 500
        ? [] // response reached the API; localhost hints are usually irrelevant
        : hints,
  });
}

// Intentionally NO in-memory GET cache here.
//
// We used to keep a 30s in-memory response cache for every GET, which was
// poison for per-bill endpoints like `/bills/:id/summary` and `/assignments`
// — those change every time any participant does anything, and WS-driven
// refetches were silently getting served 30-second-old data, overwriting
// correct state we'd just computed from a live WebSocket frame (e.g. a
// newly joined party member reverting to "not joined").
//
// If you need caching, do it at a layer that supports explicit invalidation:
//   - RTK Query (in `src/store/api.js`) for dashboard + cross-screen caches
//   - AsyncStorage via `offlineStorage` for durable offline fallback (below)

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => {
    // Persist successful GET responses to AsyncStorage so an offline cold
    // start can render something instead of an empty error screen. This is
    // a durable, explicitly-stale-OK fallback — it is NEVER served on a
    // successful network request, only when the GET fails outright (see
    // the error branch below). So it cannot stomp live WS state.
    if (response.config.method === 'get') {
      const cacheKey = `${response.config.baseURL}${response.config.url}`;
      offlineStorage.set(cacheKey, response.data, 24 * 60 * 60 * 1000).catch(() => {});
    }
    return response.data;
  },
  async (error) => {
    // When the network fails on a GET, fall back to AsyncStorage so the UI
    // can render with the last known-good data instead of an error screen.
    // We only do this for network errors (not 4xx/5xx) — those indicate the
    // server has an opinion and we should surface it, not serve stale data.
    const isNetworkError =
      error.message === 'Network Error' ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ECONNREFUSED' ||
      !error.response;

    if (isNetworkError && error.config?.method === 'get') {
      const cacheKey = `${error.config.baseURL}${error.config.url}`;
      try {
        const cached = await offlineStorage.get(cacheKey, { allowStale: true });
        if (cached?.data) {
          if (__DEV__) {
            console.log(`[API] Serving stale cache for ${error.config.url} (offline)`);
          }
          return Promise.resolve(cached.data);
        }
      } catch {
        // fall through to the normal error path
      }
    }

    logAxiosFailure(error);
    if (error.response?.status === 401) {
      await removeToken();
    }
    const data = error.response?.data;
    if (data?.error?.code) {
      return Promise.reject(
        new ApiError(data.error.code, data.error.message ?? 'Request failed'),
      );
    }
    return Promise.reject(
      new ApiError('NETWORK_ERROR', error.message ?? 'Network error'),
    );
  },
);

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
}

export function unwrap(body) {
  if (!body || body.success === false) {
    const err = body?.error ?? {};
    throw new ApiError(err.code ?? 'ERROR', err.message ?? 'Request failed');
  }
  return body.data;
}

/** Phone OTP (Twilio Verify) + backend JWT + profile APIs. */
export const authApi = {
  sendOtp: (phone, intent) =>
    client.post('/auth/send-otp', {
      phone,
      ...(intent ? { intent } : {}),
    }),

  verifyOtp: (phone, code, firstName = '', intent) =>
    client.post('/auth/verify-otp', {
      phone,
      code,
      first_name: firstName ?? '',
      ...(intent ? { intent } : {}),
    }),

  signInWithApple: ({ identityToken, authorizationCode, userInfo }) =>
    client.post('/auth/apple', {
      identity_token: identityToken,
      authorization_code: authorizationCode ?? null,
      user_info: userInfo ?? null,
    }),

  getMe: () => client.get('/auth/me'),

  createProfile: (fullName) =>
    client.post('/auth/create-profile', { full_name: fullName }),

  logout: () => client.post('/auth/logout'),
};

// ─── Dashboard ───────────────────────────────────────────────────────────────
export const dashboard = {
  getOverview: () => client.get('/dashboard/overview'),
  getActiveBills: () => client.get('/dashboard/active-bills'),
  getRecentActivity: () => client.get('/dashboard/recent-activity'),
  getOutstandingBalance: () => client.get('/dashboard/outstanding-balance'),
};

// ─── Bills ───────────────────────────────────────────────────────────────────
export const bills = {
  list: (status) =>
    client.get('/bills', { params: status ? { status } : undefined }),

  get: (billId) => client.get(`/bills/${billId}`),

  create: ({ title, merchantName, currency, notes }) =>
    client.post('/bills', {
      title,
      merchant_name: merchantName,
      currency,
      notes,
    }),

  update: (billId, fields) => client.patch(`/bills/${billId}`, fields),

  delete: (billId) => client.delete(`/bills/${billId}`),

  cleanupEmptyDrafts: () => client.post('/bills/cleanup-empty-drafts'),

  getSummary: (billId) => client.get(`/bills/${billId}/summary`),

  getActivity: (billId) => client.get(`/bills/${billId}/activity`),

  getBalanceBreakdown: (billId) =>
    client.get(`/bills/${billId}/balance-breakdown`),

  getMemberBalances: (billId) =>
    client.get(`/bills/${billId}/member-balances`),
};

// ─── Members ─────────────────────────────────────────────────────────────────
export const members = {
  list: (billId) => client.get(`/bills/${billId}/members`),

  add: (billId, { userId, email, nickname }) =>
    client.post(`/bills/${billId}/members`, {
      user_id: userId,
      email,
      nickname,
    }),

  update: (billId, memberId, fields) =>
    client.patch(`/bills/${billId}/members/${memberId}`, fields),

  remove: (billId, memberId) =>
    client.delete(`/bills/${billId}/members/${memberId}`),

  createInviteLink: (billId) =>
    client.post(`/bills/${billId}/invite-link`),
};

// ─── Receipts ────────────────────────────────────────────────────────────────
export const receipts = {
  upload: (billId, file, options = {}) => {
    const { append = false } = options;
    const form = new FormData();
    form.append('file', file);
    return client.post(`/bills/${billId}/receipt/upload`, form, {
      params: { append },
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  get: (billId) => client.get(`/bills/${billId}/receipt`),

  parse: (billId) =>
    client.post(`/bills/${billId}/receipt/parse`, null, { params: { sync: true } }),

  listItems: (billId) => client.get(`/bills/${billId}/receipt/items`),

  syncItems: (billId, payload) =>
    client.post(`/bills/${billId}/receipt/items/sync`, payload),

  updateItem: (billId, itemId, fields) =>
    client.patch(`/bills/${billId}/receipt/items/${itemId}`, fields),
};

// ─── Assignments ─────────────────────────────────────────────────────────────
//
// `clientMutationId` (optional) is echoed back in the `assignment_update`
// WebSocket broadcast so the originating client can ignore its own event
// (see `useBillData.applyAssignmentDelta`). This is how we keep the
// optimistic UI from being clobbered 50-200ms later by the server's own
// broadcast.
export const assignments = {
  list: (billId) => client.get(`/bills/${billId}/assignments`),

  create: (billId, assignmentsList, { clientMutationId } = {}) =>
    client.post(`/bills/${billId}/assignments`, {
      assignments: assignmentsList,
      ...(clientMutationId ? { client_mutation_id: clientMutationId } : {}),
    }),

  update: (billId, assignmentId, fields, { clientMutationId } = {}) =>
    client.patch(`/bills/${billId}/assignments/${assignmentId}`, {
      ...fields,
      ...(clientMutationId ? { client_mutation_id: clientMutationId } : {}),
    }),

  delete: (billId, assignmentId, { clientMutationId } = {}) =>
    client.delete(`/bills/${billId}/assignments/${assignmentId}`, {
      params: clientMutationId ? { client_mutation_id: clientMutationId } : undefined,
    }),

  autoSplit: (billId, memberIds, { clientMutationId } = {}) =>
    client.post(`/bills/${billId}/assignments/auto-split`, {
      member_ids: memberIds,
      ...(clientMutationId ? { client_mutation_id: clientMutationId } : {}),
    }),

  recalculate: (billId) => client.post(`/bills/${billId}/recalculate`),
};

// ─── Payments ────────────────────────────────────────────────────────────────
export const payments = {
  createIntent: ({ billId, memberId, amount, currency }) =>
    client.post('/payments/create-intent', {
      bill_id: billId,
      member_id: memberId,
      amount,
      currency,
    }),

  get: (paymentId) => client.get(`/payments/${paymentId}`),

  confirm: (paymentId) => client.post(`/payments/${paymentId}/confirm`),

  listForBill: (billId) => client.get(`/bills/${billId}/payments`),
};

// ─── Payment Methods ─────────────────────────────────────────────────────────
export const paymentMethods = {
  list: () => client.get('/payment-methods'),

  createSetupIntent: () => client.post('/payment-methods/setup-intent'),

  attachPaymentMethod: (paymentMethodId) =>
    client.post('/payment-methods/attach', { payment_method_id: paymentMethodId }),

  setDefault: (paymentMethodId) =>
    client.post('/payment-methods/set-default', { payment_method_id: paymentMethodId }),

  delete: (paymentMethodId) =>
    client.delete(`/payment-methods/${paymentMethodId}`),
};

// ─── Invites ─────────────────────────────────────────────────────────────────
export const invites = {
  share: (billId) => client.post(`/bills/${billId}/share`),

  join: (billId, token) =>
    client.post(`/bills/${billId}/join`, { token }),

  getInfo: (token) => client.get(`/invites/${token}`),
};

// ─── Users ───────────────────────────────────────────────────────────────────
export const users = {
  getMyProfile: () => client.get('/users/me'),

  updateMyProfile: (fields) => client.patch('/users/me', fields),

  search: (query) => client.get('/users/search', { params: { q: query } }),

  invite: (email) => client.post('/users/invite', { email }),

  getProfile: (userId) => client.get(`/users/${userId}`),

  deleteAccount: () => client.delete('/users/me'),
};

// ─── Notifications ───────────────────────────────────────────────────────────
export const notifications = {
  list: (unreadOnly = false) =>
    client.get('/notifications', { params: { unread_only: unreadOnly } }),

  markRead: (notificationId) =>
    client.patch(`/notifications/${notificationId}/read`),
};

// ─── Virtual Cards ───────────────────────────────────────────────────────────
export const virtualCards = {
  get: (billId) => client.get(`/bills/${billId}/virtual-card`),
  
  getEphemeralKey: (billId) => client.post(`/bills/${billId}/virtual-card/ephemeral-key`),
  
  deactivate: (billId) => client.post(`/bills/${billId}/virtual-card/deactivate`),
};

// ─── Stripe Connect (host payouts) ───────────────────────────────────────────
// Host-side endpoints for Custom-account onboarding + automatic daily
// payouts to a debit card. Nothing here is used by guests paying bills —
// guests go through `paymentMethods` / the existing PaymentIntent flow.
// There is no "cash out" endpoint: Stripe runs payouts automatically on
// the account's daily schedule.
export const stripeConnect = {
  /** Fetch current Connect account status. Returns: {
   *  connected, charges_enabled, payouts_enabled, details_submitted,
   *  has_instant_external_account, external_account_last4,
   *  external_account_brand, requirements_due, disabled_reason }.
   *  Safe to call even when the user has never onboarded — returns
   *  `connected: false`. */
  getStatus: () => client.get('/stripe/connect/status'),

  /** Submit the in-app KYC form + tokenized debit card in one call.
   *  Payload:
   *    {
   *      individual: { first_name, last_name, email, phone,
   *                    dob_day, dob_month, dob_year,
   *                    address_line1, address_city, address_state, address_postal_code,
   *                    ssn_last_4 },
   *      card_token: 'tok_xxx',  // from stripe.createToken on the client
   *    }
   *  Replaces the old `/onboard` → Stripe-hosted redirect flow. */
  setupPayouts: (payload) => client.post('/stripe/connect/setup', payload),

  /** Swap the user's payout card without re-submitting identity info.
   *  Used by the "Change payout method" flow after initial setup.
   *  Payload: { card_token: 'tok_xxx' }. */
  updatePayoutCard: ({ card_token }) =>
    client.post('/stripe/connect/external-account', { card_token }),

  /** Pending-balance in cents — the amount that will go out in the next
   *  scheduled daily payout. Returns `{ available_cents, currency }`. */
  getBalance: () => client.get('/stripe/connect/balance'),

  /** Last 20 payouts for the current user (history / next-arrival). */
  listPayouts: () => client.get('/stripe/connect/payouts'),
};

// ─── Health ──────────────────────────────────────────────────────────────────
export const health = () => client.get('/health');

export default client;
