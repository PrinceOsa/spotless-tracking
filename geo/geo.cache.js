/**
 * Caching layer for the geo module.
 *
 * Strategy: a small set of named LRU caches, one per response shape, so each
 * can have its own TTL without leaking eviction pressure across kinds. The
 * factory is exported so tests can construct a fresh instance and inspect
 * hit/miss behaviour without touching the singleton.
 *
 * Storage is in-process memory. TODO: when the geo module is folded into the
 * main Spotless Doc backend, swap LRUCache for the project's Redis client so
 * cache survives restarts and is shared across pm2 workers. The cache API
 * exposed here (getOrFetch, set, get, clear, stats) is deliberately small so
 * the swap is a one-file change.
 */

import { LRUCache } from 'lru-cache';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

// Per-kind defaults. Geocode results are effectively static — addresses don't
// move — so we cache them longest. Autocomplete suggestions can shift as OSM
// data updates and as the typing context changes. Routing depends on the
// network but for now is OSRM-only (no live traffic) so a short TTL is fine.
const DEFAULT_TTLS = {
  geocode:        30 * ONE_DAY_MS,
  reverse:        30 * ONE_DAY_MS,
  autocomplete:        ONE_DAY_MS,
  directions:      5 * 60 * 1000,
  distanceMatrix:  5 * 60 * 1000,
};

const DEFAULT_MAX = {
  geocode:        5000,
  reverse:        5000,
  autocomplete:  10000,
  directions:    2000,
  distanceMatrix: 2000,
};

/** Normalize a string before using it as a cache key. */
export function normalizeQuery(q) {
  return String(q ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Build a cache for one shape. ttlMs and maxEntries are overridable via env
 * but every kind has a sane built-in default.
 */
function buildKindCache(kind, overrides = {}) {
  const ttl = Number(overrides.ttlMs ?? DEFAULT_TTLS[kind]);
  const max = Number(overrides.maxEntries ?? DEFAULT_MAX[kind]);
  return new LRUCache({ max, ttl });
}

export function createGeoCache(overrides = {}) {
  const caches = {
    geocode:        buildKindCache('geocode',        overrides.geocode),
    reverse:        buildKindCache('reverse',        overrides.reverse),
    autocomplete:   buildKindCache('autocomplete',   overrides.autocomplete),
    directions:     buildKindCache('directions',     overrides.directions),
    distanceMatrix: buildKindCache('distanceMatrix', overrides.distanceMatrix),
  };

  // Telemetry counters — handy for the smoke test and for production
  // visibility. Reset only on process restart.
  const stats = {
    geocode:        { hit: 0, miss: 0 },
    reverse:        { hit: 0, miss: 0 },
    autocomplete:   { hit: 0, miss: 0 },
    directions:     { hit: 0, miss: 0 },
    distanceMatrix: { hit: 0, miss: 0 },
  };

  function get(kind, key) {
    const v = caches[kind].get(key);
    if (v === undefined) stats[kind].miss += 1;
    else stats[kind].hit += 1;
    return v;
  }

  function set(kind, key, value) {
    caches[kind].set(key, value);
  }

  /**
   * The hot path. If we've seen this exact key before, return the cached
   * value without calling the producer. Otherwise call producer(), cache the
   * result, and return it. Producer errors propagate — they are NOT cached,
   * so a transient upstream failure doesn't poison the entry.
   */
  async function getOrFetch(kind, key, producer) {
    const cached = caches[kind].get(key);
    if (cached !== undefined) {
      stats[kind].hit += 1;
      return cached;
    }
    stats[kind].miss += 1;
    const value = await producer();
    if (value !== undefined && value !== null) {
      caches[kind].set(key, value);
    }
    return value;
  }

  function clear(kind) {
    if (kind) caches[kind].clear();
    else for (const c of Object.values(caches)) c.clear();
  }

  function getStats() {
    return JSON.parse(JSON.stringify(stats));
  }

  return { get, set, getOrFetch, clear, getStats, normalizeQuery };
}

// Singleton wired with env overrides. Each `*_TTL_MS` / `*_MAX_ENTRIES` env
// var is optional — leave unset to take the defaults above.
const envCache = createGeoCache({
  geocode:        { ttlMs: process.env.GEO_CACHE_GEOCODE_TTL_MS,        maxEntries: process.env.GEO_CACHE_GEOCODE_MAX },
  reverse:        { ttlMs: process.env.GEO_CACHE_REVERSE_TTL_MS,        maxEntries: process.env.GEO_CACHE_REVERSE_MAX },
  autocomplete:   { ttlMs: process.env.GEO_CACHE_AUTOCOMPLETE_TTL_MS,   maxEntries: process.env.GEO_CACHE_AUTOCOMPLETE_MAX },
  directions:     { ttlMs: process.env.GEO_CACHE_DIRECTIONS_TTL_MS,     maxEntries: process.env.GEO_CACHE_DIRECTIONS_MAX },
  distanceMatrix: { ttlMs: process.env.GEO_CACHE_DISTANCE_MATRIX_TTL_MS, maxEntries: process.env.GEO_CACHE_DISTANCE_MATRIX_MAX },
});

export default envCache;
