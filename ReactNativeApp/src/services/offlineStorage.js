/**
 * Durable cache layer backed by AsyncStorage.
 *
 * In-memory caches (api.js) disappear on app restart. We need a second tier
 * so that when the user opens the app offline / on a bad network, we can
 * still hydrate the UI immediately from the last known-good payload instead
 * of flashing an error or an empty state.
 *
 * Keys are namespaced with CACHE_PREFIX so the cache can be cleared
 * wholesale on logout without nuking the auth token.
 *
 * IMPORTANT: We require() AsyncStorage lazily inside a try/catch. If the
 * native module isn't in the current build (e.g. TestFlight was shipped
 * before this package was added), the app must NOT crash — it should just
 * silently lose its offline cache. Do NOT convert this back to a top-level
 * ES import or a new TestFlight build will be a hard requirement.
 */

const CACHE_PREFIX = 'spltr_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

// No-op stub used when the native module fails to load. Returns shapes that
// match AsyncStorage's real API so downstream code doesn't need branches.
const noopStorage = {
  setItem: async () => {},
  getItem: async () => null,
  removeItem: async () => {},
  getAllKeys: async () => [],
  multiRemove: async () => {},
};

let AsyncStorage = noopStorage;
let storageAvailable = false;

try {
  // Lazy require so a missing native module throws here instead of at
  // module-graph evaluation time (which would crash the whole app).
  const mod = require('@react-native-async-storage/async-storage');
  const candidate = mod?.default ?? mod;
  if (candidate && typeof candidate.setItem === 'function') {
    AsyncStorage = candidate;
    storageAvailable = true;
  } else if (__DEV__) {
    console.warn('[OfflineStorage] AsyncStorage module loaded but has no setItem; using no-op stub.');
  }
} catch (err) {
  if (__DEV__) {
    console.warn(
      '[OfflineStorage] AsyncStorage native module unavailable; offline cache disabled.',
      err?.message ?? err,
    );
  }
}

class OfflineStorage {
  /** True when the native module is linked. Callers can use this to decide
   *  whether to show e.g. an "offline mode unavailable" message. */
  get isAvailable() {
    return storageAvailable;
  }

  async set(key, data, ttl = DEFAULT_TTL) {
    if (!storageAvailable) return;
    try {
      const payload = {
        data,
        timestamp: Date.now(),
        ttl,
      };
      await AsyncStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(payload));
    } catch (err) {
      if (__DEV__) console.warn('[OfflineStorage] set failed', key, err);
    }
  }

  async get(key, { allowStale = false } = {}) {
    if (!storageAvailable) return null;
    try {
      const raw = await AsyncStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (!raw) return null;

      const { data, timestamp, ttl } = JSON.parse(raw);
      const age = Date.now() - timestamp;
      const isStale = age > (ttl ?? DEFAULT_TTL);

      // When offline, we prefer stale data over nothing. Callers opt in.
      if (isStale && !allowStale) return null;

      return { data, timestamp, isStale };
    } catch (err) {
      if (__DEV__) console.warn('[OfflineStorage] get failed', key, err);
      return null;
    }
  }

  async remove(key) {
    if (!storageAvailable) return;
    try {
      await AsyncStorage.removeItem(`${CACHE_PREFIX}${key}`);
    } catch (err) {
      if (__DEV__) console.warn('[OfflineStorage] remove failed', key, err);
    }
  }

  /** Clear everything in our namespace. Safe to call on logout. */
  async clear() {
    if (!storageAvailable) return;
    try {
      const keys = await AsyncStorage.getAllKeys();
      const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
      if (ours.length > 0) {
        await AsyncStorage.multiRemove(ours);
      }
    } catch (err) {
      if (__DEV__) console.warn('[OfflineStorage] clear failed', err);
    }
  }
}

export const offlineStorage = new OfflineStorage();
