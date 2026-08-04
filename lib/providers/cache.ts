import "server-only";

import { logger } from "@/lib/observability/logger";

/**
 * TTL cache for provider reads.
 *
 * Two reasons this exists: latency, and being a good neighbour. MusicBrainz
 * allows one request per second and returned a real 503 during evidence
 * capture even at that pace; the ListenBrainz Labs host is a research surface
 * with no stated allowance at all. Repeating identical lookups against either
 * is avoidable load.
 *
 * Deliberate properties:
 *
 * - **Failures are never cached.** Only a fulfilled value is stored, so a
 *   transient outage cannot pin an error in front of a working provider.
 * - **A cache fault degrades to a live call.** Every cache interaction is
 *   wrapped, so a bug here can slow the app down but cannot break it.
 * - **In-flight requests are shared.** Concurrent callers asking for the same
 *   key await one promise instead of issuing duplicate requests, which matters
 *   most under exactly the burst conditions that trigger a 503.
 */

export interface TtlCacheOptions {
  readonly ttlMs: number;
  readonly maxEntries?: number;
  /** Identifies the cache in logs. */
  readonly name: string;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

export interface TtlCache<T> {
  readonly name: string;
  read(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
  readonly size: number;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createTtlCache<T>(options: TtlCacheOptions): TtlCache<T> {
  const entries = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  function evictIfNeeded(): void {
    if (entries.size <= maxEntries) return;

    // Map preserves insertion order, so the oldest key is the first one.
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }

  return {
    name: options.name,

    get size() {
      return entries.size;
    },

    clear() {
      entries.clear();
      inFlight.clear();
    },

    async read(key: string, load: () => Promise<T>): Promise<T> {
      try {
        const hit = entries.get(key);

        if (hit && hit.expiresAt > Date.now()) {
          logger.debug({ event: "provider.cache_hit", cache: options.name });
          return hit.value;
        }

        if (hit) entries.delete(key);

        const pending = inFlight.get(key);
        if (pending) return await pending;
      } catch {
        // A fault in the cache itself must never deny the caller a live result.
        logger.warn({
          event: "provider.cache_read_failed",
          cache: options.name,
        });
        return load();
      }

      const request = load();
      inFlight.set(key, request);

      try {
        const value = await request;

        try {
          entries.set(key, { value, expiresAt: Date.now() + options.ttlMs });
          evictIfNeeded();
        } catch {
          logger.warn({
            event: "provider.cache_write_failed",
            cache: options.name,
          });
        }

        return value;
      } finally {
        // Rejections are intentionally not stored: only the in-flight entry is
        // cleared, so the next caller retries against the provider.
        inFlight.delete(key);
      }
    },
  };
}

/**
 * TTLs reflect how fast the underlying data actually changes.
 *
 * MusicBrainz canonical identity and discography are edited slowly, so a long
 * window is safe. Labs similarity is derived from listening data and its
 * algorithm can change without notice, so it is held far more briefly.
 */
export const CACHE_TTL_MS = {
  musicBrainzLookup: 6 * 60 * 60 * 1000,
  musicBrainzSearch: 60 * 60 * 1000,
  listenBrainzSimilarity: 30 * 60 * 1000,
} as const;
