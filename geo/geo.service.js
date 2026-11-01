/**
 * Provider-facing layer.
 *
 * One internal function per capability:
 *   - geocode(query)                         → Nominatim /search
 *   - reverseGeocode({lat, lng})             → Nominatim /reverse
 *   - autocomplete(query, biasLatLng?)       → Photon  /api
 *   - directions(origin, destination)        → OSRM    /route
 *   - distanceMatrix(origin, destinations[]) → OSRM    /table
 *
 * Each returns the normalized provider-agnostic shape documented in the
 * README. Raw provider payloads MUST NOT leak past this module — controllers
 * and clients only see the normalized form, which is what lets us swap
 * providers later without breaking the frontend.
 *
 * Base URLs come from env. Defaults point at the public demo servers so
 * `npm start` works out of the box, but production MUST point at a self-
 * hosted or paid OSM host — see README. Each function honours a per-request
 * timeout via AbortController.
 *
 * ── Coordinate-order gotcha ──────────────────────────────────────────────
 * OSRM URLs encode each point as `lng,lat` (longitude FIRST). Nominatim and
 * Photon accept `lat` and `lon` as separate query params. We accept and
 * return `{lat, lng}` everywhere in our normalized shape; the lng-first
 * encoding is confined to buildOsrmCoords() below.
 */

import geoCache from './geo.cache.js';

const NOMINATIM_BASE_URL = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
const PHOTON_BASE_URL    = process.env.PHOTON_BASE_URL    || 'https://photon.komoot.io';
const OSRM_BASE_URL      = process.env.OSRM_BASE_URL      || 'https://router.project-osrm.org';

const REQUEST_TIMEOUT_MS = Number(process.env.GEO_REQUEST_TIMEOUT_MS || 5000);

// Nominatim's usage policy REQUIRES a meaningful User-Agent. Without one,
// requests are blocked. Override via env when you're running your own host.
const USER_AGENT = process.env.GEO_USER_AGENT || 'spotlessdoc-geo/1.0 (contact: support@spotlessdoc.com)';

const COUNTRY_CODES = process.env.GEO_COUNTRY_CODES || 'us';

/** Thrown when a provider returns a non-2xx or the request times out. */
export class UpstreamError extends Error {
  constructor(message, { provider, status, cause } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.provider = provider ?? null;
    this.status = status ?? null;
    if (cause) this.cause = cause;
  }
}

/**
 * Thin fetch wrapper with timeout + UA + JSON parse. Non-2xx becomes
 * UpstreamError so the controller can map it to 502/504 cleanly.
 */
async function getJson(url, { provider } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json', 'Accept-Language': 'en' },
    });
    if (!res.ok) {
      throw new UpstreamError(`${provider} responded ${res.status}`, { provider, status: res.status });
    }
    return await res.json();
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err?.name === 'AbortError') {
      throw new UpstreamError(`${provider} timeout after ${REQUEST_TIMEOUT_MS}ms`, { provider, status: 504, cause: err });
    }
    throw new UpstreamError(`${provider} request failed: ${err.message}`, { provider, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

// ── Coordinate helpers (OSRM only) ────────────────────────────────────────

/**
 * OSRM wants coordinates as `{lng},{lat};{lng},{lat};...`. This is the
 * single place in the codebase where we do that flip — keep it here.
 */
function buildOsrmCoords(points) {
  return points.map(p => `${p.lng},${p.lat}`).join(';');
}

// ── Nominatim: geocode + reverse ──────────────────────────────────────────

export async function geocode(query) {
  const key = geoCache.normalizeQuery(query);
  return geoCache.getOrFetch('geocode', key, async () => {
    const url = `${NOMINATIM_BASE_URL}/search`
      + `?q=${encodeURIComponent(query)}`
      + `&format=json&limit=1&addressdetails=1`
      + `&countrycodes=${encodeURIComponent(COUNTRY_CODES)}`;
    const data = await getJson(url, { provider: 'nominatim' });
    if (!Array.isArray(data) || data.length === 0) return null;
    const r = data[0];
    return {
      lat: Number(r.lat),
      lng: Number(r.lon),
      displayName: r.display_name,
      // Nominatim's importance is 0..1; we expose it as a normalized
      // confidence so callers don't depend on Nominatim's term.
      confidence: typeof r.importance === 'number' ? r.importance : null,
    };
  });
}

export async function reverseGeocode({ lat, lng }) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  return geoCache.getOrFetch('reverse', key, async () => {
    const url = `${NOMINATIM_BASE_URL}/reverse`
      + `?lat=${lat}&lon=${lng}`
      + `&format=json&addressdetails=1`;
    const data = await getJson(url, { provider: 'nominatim' });
    if (!data || !data.lat) return null;
    const a = data.address ?? {};
    return {
      lat: Number(data.lat),
      lng: Number(data.lon),
      displayName: data.display_name,
      address: {
        road:     a.road ?? a.pedestrian ?? null,
        city:     a.city ?? a.town ?? a.village ?? a.hamlet ?? null,
        state:    a.state ?? null,
        postcode: a.postcode ?? null,
        country:  a.country ?? null,
      },
    };
  });
}

// ── Photon: autocomplete ──────────────────────────────────────────────────

export async function autocomplete(query, bias = null, { limit = 5 } = {}) {
  const normQuery = geoCache.normalizeQuery(query);
  const cacheKey = bias
    ? `${normQuery}|${bias.lat.toFixed(3)},${bias.lng.toFixed(3)}|${limit}`
    : `${normQuery}|${limit}`;
  return geoCache.getOrFetch('autocomplete', cacheKey, async () => {
    let url = `${PHOTON_BASE_URL}/api`
      + `?q=${encodeURIComponent(query)}`
      + `&limit=${limit}`;
    if (bias) url += `&lat=${bias.lat}&lon=${bias.lng}`;
    const data = await getJson(url, { provider: 'photon' });
    const features = Array.isArray(data?.features) ? data.features : [];
    const suggestions = features.map(f => {
      const [lng, lat] = f.geometry?.coordinates ?? [null, null];
      const p = f.properties ?? {};
      // "primary" / "secondary" line up with a typical typeahead row
      // (street on top, city/state below) without forcing the frontend
      // to know about Photon's field names.
      const primary = p.name ?? p.street ?? p.city ?? '';
      const secondaryParts = [p.city, p.state, p.country].filter(Boolean);
      return {
        lat, lng,
        displayName: [primary, ...secondaryParts].filter(Boolean).join(', '),
        primary,
        secondary: secondaryParts.join(', '),
      };
    }).filter(s => s.lat != null && s.lng != null);
    return { suggestions };
  });
}

// ── OSRM: directions ──────────────────────────────────────────────────────

export async function directions(origin, destination) {
  const cacheKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}|${destination.lat.toFixed(5)},${destination.lng.toFixed(5)}`;
  return geoCache.getOrFetch('directions', cacheKey, async () => {
    const coords = buildOsrmCoords([origin, destination]);
    const url = `${OSRM_BASE_URL}/route/v1/driving/${coords}`
      + `?overview=full&geometries=geojson&steps=false`;
    const data = await getJson(url, { provider: 'osrm' });
    if (data?.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
      return null;
    }
    const r = data.routes[0];
    return {
      origin, destination,
      distanceM: r.distance,
      durationSec: r.duration,
      geometry: r.geometry, // GeoJSON LineString with [lng,lat] pairs — the
                            // frontend's mapping lib (MapLibre/Leaflet) expects
                            // this exact shape.
    };
  });
}

// ── OSRM: distance matrix ─────────────────────────────────────────────────

export async function distanceMatrix(origin, destinations) {
  // Cache the (origin, destinations) pair as a stable key.
  const destKey = destinations.map(d => `${d.lat.toFixed(5)},${d.lng.toFixed(5)}`).join(';');
  const cacheKey = `${origin.lat.toFixed(5)},${origin.lng.toFixed(5)}|${destKey}`;
  return geoCache.getOrFetch('distanceMatrix', cacheKey, async () => {
    const points = [origin, ...destinations];
    const coords = buildOsrmCoords(points);
    // sources=0 fixes the origin; destinations are all the other indices.
    const destIdx = destinations.map((_, i) => i + 1).join(';');
    const url = `${OSRM_BASE_URL}/table/v1/driving/${coords}`
      + `?sources=0&destinations=${destIdx}`
      + `&annotations=duration,distance`;
    const data = await getJson(url, { provider: 'osrm' });
    if (data?.code !== 'Ok' || !Array.isArray(data.durations) || !Array.isArray(data.distances)) {
      return null;
    }
    // OSRM returns 2D arrays even with one source — pull row 0.
    const durations = data.durations[0] ?? [];
    const distances = data.distances[0] ?? [];
    const results = destinations.map((dest, i) => {
      const durationSec = durations[i];
      const distanceM = distances[i];
      const reachable = Number.isFinite(durationSec) && Number.isFinite(distanceM);
      return {
        destination: dest,
        distanceM: reachable ? distanceM : null,
        durationSec: reachable ? durationSec : null,
        status: reachable ? 'ok' : 'unreachable',
      };
    });
    return { origin, results };
  });
}
