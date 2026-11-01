/**
 * Input validators for the geo endpoints.
 *
 * Each function throws a ValidationError (caught by the controller and mapped
 * to HTTP 400) or returns a normalized value. Validators never reach out to a
 * provider or touch the cache — they only check shape and range.
 */

export class ValidationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ValidationError';
    this.details = details ?? null;
  }
}

/** Hard cap on autocomplete / address queries to keep payloads sane. */
const MAX_QUERY_LEN = 256;

/**
 * OSRM's /table endpoint accepts up to ~100 points but we cap lower so the
 * worst-case combinatorial cost (origins x destinations) stays bounded.
 * Override via env GEO_MAX_DESTINATIONS.
 */
export const MAX_DESTINATIONS = Number(process.env.GEO_MAX_DESTINATIONS ?? 25);

export function requireString(name, value, { maxLen = MAX_QUERY_LEN } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${name} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${name} is required`);
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${name} too long`, { maxLen, got: trimmed.length });
  }
  return trimmed;
}

export function requireLat(value, name = 'lat') {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${name} must be a number`);
  if (n < -90 || n > 90) throw new ValidationError(`${name} out of range`, { min: -90, max: 90, got: n });
  return n;
}

export function requireLng(value, name = 'lng') {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ValidationError(`${name} must be a number`);
  if (n < -180 || n > 180) throw new ValidationError(`${name} out of range`, { min: -180, max: 180, got: n });
  return n;
}

/** Accepts `{ lat, lng }`; returns `{ lat, lng }` as numbers in valid range. */
export function requireLatLng(obj, name = 'point') {
  if (!obj || typeof obj !== 'object') throw new ValidationError(`${name} must be an object with lat and lng`);
  return { lat: requireLat(obj.lat, `${name}.lat`), lng: requireLng(obj.lng, `${name}.lng`) };
}

/**
 * Used by /distance-matrix. Length is capped to protect OSRM `/table`.
 * Returns an array of normalized `{ lat, lng }` objects.
 */
export function requireLatLngArray(arr, name = 'destinations') {
  if (!Array.isArray(arr)) throw new ValidationError(`${name} must be an array`);
  if (arr.length === 0) throw new ValidationError(`${name} must not be empty`);
  if (arr.length > MAX_DESTINATIONS) {
    throw new ValidationError(`${name} too large`, { max: MAX_DESTINATIONS, got: arr.length });
  }
  return arr.map((p, i) => requireLatLng(p, `${name}[${i}]`));
}

/** Optional bias coordinates for autocomplete; null when absent. */
export function optionalLatLng(latRaw, lngRaw) {
  if (latRaw == null && lngRaw == null) return null;
  return { lat: requireLat(latRaw), lng: requireLng(lngRaw) };
}
