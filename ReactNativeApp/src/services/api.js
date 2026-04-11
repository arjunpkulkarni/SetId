import axios from 'axios';
import { Platform } from 'react-native';
import { getToken, removeToken } from './auth';

// Android emulator uses 10.0.2.2 to reach host localhost
const DEV_BASE =
  Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';

const BASE_URL = __DEV__ ? DEV_BASE : 'https://api.spltr.app'; // TODO: replace with prod URL

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: attach JWT ──────────────────────────────────────────
client.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: unwrap envelope & handle 401 ───────────────────────
client.interceptors.response.use(
  (response) => response.data,
  async (error) => {
    if (error.response?.status === 401) {
      await removeToken();
    }
    const apiError = error.response?.data ?? {
      status: 'error',
      error: { code: 'NETWORK_ERROR', message: error.message },
    };
    return Promise.reject(apiError);
  },
);

// ─── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  signup: (email, password, fullName) =>
    client.post('/auth/signup', { email, password, full_name: fullName }),

  login: (email, password) =>
    client.post('/auth/login', { email, password }),

  appleSignIn: (identityToken, authorizationCode, userInfo) =>
    client.post('/auth/apple', {
      identity_token: identityToken,
      authorization_code: authorizationCode,
      user_info: userInfo,
    }),

  getMe: () => client.get('/auth/me'),

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

  getSummary: (billId) => client.get(`/bills/${billId}/summary`),

  getActivity: (billId) => client.get(`/bills/${billId}/activity`),
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
  upload: (billId, file) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`/bills/${billId}/receipt/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  get: (billId) => client.get(`/bills/${billId}/receipt`),

  parse: (billId) => client.post(`/bills/${billId}/receipt/parse`),

  listItems: (billId) => client.get(`/bills/${billId}/receipt/items`),

  updateItem: (billId, itemId, fields) =>
    client.patch(`/bills/${billId}/receipt/items/${itemId}`, fields),
};

// ─── Assignments ─────────────────────────────────────────────────────────────
export const assignments = {
  list: (billId) => client.get(`/bills/${billId}/assignments`),

  create: (billId, assignmentsList) =>
    client.post(`/bills/${billId}/assignments`, { assignments: assignmentsList }),

  update: (billId, assignmentId, fields) =>
    client.patch(`/bills/${billId}/assignments/${assignmentId}`, fields),

  delete: (billId, assignmentId) =>
    client.delete(`/bills/${billId}/assignments/${assignmentId}`),

  autoSplit: (billId, memberIds) =>
    client.post(`/bills/${billId}/assignments/auto-split`, {
      member_ids: memberIds,
    }),

  recalculate: (billId) => client.post(`/bills/${billId}/recalculate`),

  getBalanceBreakdown: (billId) =>
    client.get(`/bills/${billId}/balance-breakdown`),

  getMemberBalances: (billId) =>
    client.get(`/bills/${billId}/member-balances`),
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
};

// ─── Notifications ───────────────────────────────────────────────────────────
export const notifications = {
  list: (unreadOnly = false) =>
    client.get('/notifications', { params: { unread_only: unreadOnly } }),

  markRead: (notificationId) =>
    client.patch(`/notifications/${notificationId}/read`),
};

// ─── Health ──────────────────────────────────────────────────────────────────
export const health = () => client.get('/health');

export default client;
