import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { BASE_URL } from '../services/api';
import { getToken, removeToken } from '../services/authStorage';
import { offlineStorage } from '../services/offlineStorage';

/** AsyncStorage key for the combined dashboard payload. Bumping this prefix
 *  forces every client to re-fetch (use if the server contract changes). */
export const DASHBOARD_CACHE_KEY = 'dashboard_v1';
/** Accept a cached payload up to 24h old on cold open — RTK Query refetches
 *  in the background anyway, so showing slightly stale numbers for 200ms
 *  is strictly better than a blank screen. */
const DASHBOARD_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * RTK Query API slice — the cache, deduplication, and revalidation story.
 *
 * Why: the manual useState+useEffect+useRef dance in BillSplitScreen was
 * carrying 20+ lines of debounce / in-flight / dedup logic per endpoint.
 * RTKQ gives us:
 *   - automatic request deduping (2 screens reading the same bill = 1 HTTP)
 *   - cache invalidation via tags (a mutation can invalidate a query)
 *   - subscription-based refetching (polling, focus, reconnect)
 *   - per-endpoint `keepUnusedDataFor` so cold-open returns instant data
 *
 * The legacy `services/api.js` axios client stays around for auth flows and
 * non-cached mutations we haven't migrated yet — they can coexist.
 */

const baseQuery = fetchBaseQuery({
  baseUrl: BASE_URL,
  prepareHeaders: async (headers) => {
    const token = await getToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    headers.set('Content-Type', 'application/json');
    return headers;
  },
});

// Wrap baseQuery so a 401 auto-clears the stored token (mirrors axios
// interceptor behavior — otherwise the user gets stuck showing stale UI
// with an invalid token until they manually log out).
const baseQueryWithAuth = async (args, api, extraOptions) => {
  const result = await baseQuery(args, api, extraOptions);
  if (result.error?.status === 401) {
    await removeToken();
  }
  return result;
};

/** Tag types used by `providesTags` / `invalidatesTags`. Keep this list small
 *  and focused — over-tagging causes cascade refetches. */
const TAG_TYPES = [
  'Bill',
  'BillSummary',
  'Assignment',
  'Member',
  'Dashboard',
  'PaymentMethod',
];

export const api = createApi({
  reducerPath: 'api',
  baseQuery: baseQueryWithAuth,
  tagTypes: TAG_TYPES,
  // Keep cached data for 5 minutes after the last subscriber unmounts so
  // re-entering a screen is instant.
  keepUnusedDataFor: 300,
  // Refetch stale data when the app regains focus or reconnects — this
  // replaces the `AppState.addEventListener('change', ...)` pattern in the
  // legacy code.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (builder) => ({
    // ─── Dashboard ─────────────────────────────────────────────────────
    //
    // Preferred endpoint: one round-trip returns both the balance overview
    // and the active bill list. We persist the last-good payload to
    // AsyncStorage via `onQueryStarted` so a cold app launch can hydrate
    // instantly from disk while the background refetch runs.
    getDashboard: builder.query({
      query: () => '/dashboard',
      transformResponse: (response) => ({
        overview: response.data?.overview ?? null,
        activeBills: response.data?.active_bills ?? [],
      }),
      providesTags: (result) => {
        const billTags = result?.activeBills
          ? result.activeBills.map((b) => ({ type: 'Bill', id: b.id }))
          : [];
        return [
          { type: 'Dashboard', id: 'SUMMARY' },
          { type: 'Bill', id: 'LIST' },
          ...billTags,
        ];
      },
      async onQueryStarted(_arg, { queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          // Write-through to AsyncStorage so the next cold start is instant.
          offlineStorage.set(DASHBOARD_CACHE_KEY, data, DASHBOARD_CACHE_TTL);
        } catch {
          // Network errors are handled by the UI; we just skip persisting.
        }
      },
    }),

    // ─── Legacy granular endpoints ────────────────────────────────────
    // Kept so screens that haven't migrated to `getDashboard` keep working.
    getDashboardOverview: builder.query({
      query: () => '/dashboard/overview',
      transformResponse: (response) => response.data,
      providesTags: ['Dashboard'],
    }),
    getActiveBills: builder.query({
      query: () => '/dashboard/active-bills',
      transformResponse: (response) => response.data ?? [],
      providesTags: (result) =>
        result
          ? [
              ...result.map((b) => ({ type: 'Bill', id: b.id })),
              { type: 'Bill', id: 'LIST' },
            ]
          : [{ type: 'Bill', id: 'LIST' }],
    }),

    // ─── Bill Summary + Assignments ────────────────────────────────────
    getBillSummary: builder.query({
      query: (billId) => `/bills/${billId}/summary`,
      transformResponse: (response) => response.data,
      providesTags: (result, error, billId) => [
        { type: 'BillSummary', id: billId },
        { type: 'Member', id: billId },
      ],
    }),
    getAssignments: builder.query({
      query: (billId) => `/bills/${billId}/assignments`,
      transformResponse: (response) => response.data ?? [],
      providesTags: (result, error, billId) => [
        { type: 'Assignment', id: billId },
      ],
    }),
    createAssignment: builder.mutation({
      query: ({ billId, assignments }) => ({
        url: `/bills/${billId}/assignments`,
        method: 'POST',
        body: { assignments },
      }),
      // Optimistic update lives in the component — we just invalidate so
      // the authoritative state eventually replaces it.
      invalidatesTags: (result, error, { billId }) => [
        { type: 'Assignment', id: billId },
        { type: 'BillSummary', id: billId },
      ],
    }),
    deleteAssignment: builder.mutation({
      query: ({ billId, assignmentId }) => ({
        url: `/bills/${billId}/assignments/${assignmentId}`,
        method: 'DELETE',
      }),
      invalidatesTags: (result, error, { billId }) => [
        { type: 'Assignment', id: billId },
        { type: 'BillSummary', id: billId },
      ],
    }),

    // ─── Payment Methods ───────────────────────────────────────────────
    getPaymentMethods: builder.query({
      query: () => '/payment-methods',
      transformResponse: (response) => response.data ?? [],
      providesTags: ['PaymentMethod'],
    }),
  }),
});

/**
 * Seed the dashboard query cache from AsyncStorage before the first network
 * response arrives. Call this once at app boot (before rendering the
 * authenticated tree). If there's no cached payload we no-op and the
 * dashboard will show its normal skeleton.
 *
 * Returns the hydrated payload (or null) so callers can do extra work.
 */
export async function hydrateDashboardFromCache(dispatch) {
  try {
    const cached = await offlineStorage.get(DASHBOARD_CACHE_KEY, {
      allowStale: true,
    });
    if (!cached?.data) return null;

    // `upsertQueryData` injects data into the RTK Query cache without
    // triggering a network request — the next subscriber sees it
    // immediately. The real refetch still runs because refetchOnFocus /
    // refetchOnMountOrArgChange are on for `useGetDashboardQuery`.
    dispatch(
      api.util.upsertQueryData('getDashboard', undefined, cached.data),
    );
    return cached.data;
  } catch {
    return null;
  }
}

export const {
  useGetDashboardQuery,
  useGetDashboardOverviewQuery,
  useGetActiveBillsQuery,
  useGetBillSummaryQuery,
  useGetAssignmentsQuery,
  useCreateAssignmentMutation,
  useDeleteAssignmentMutation,
  useGetPaymentMethodsQuery,
} = api;