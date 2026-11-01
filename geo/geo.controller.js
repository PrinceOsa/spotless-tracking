/**
 * Request handlers for /api/geo/*.
 *
 * Controllers validate input, call the service layer, and map known errors
 * to clean HTTP status codes. They never touch a provider directly and they
 * never leak provider payloads — that's what geo.service.js is for.
 */

import * as service from './geo.service.js';
import { UpstreamError } from './geo.service.js';
import {
  ValidationError,
  requireString, requireLat, requireLng,
  requireLatLng, requireLatLngArray, optionalLatLng,
} from './geo.validation.js';

/**
 * Wraps an async controller so thrown errors land in one place and never
 * reach Express's default HTML error page with a stack trace.
 */
function asHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message, details: err.details });
        return;
      }
      if (err instanceof UpstreamError) {
        // 504 if it was our own timeout; 502 for anything else we got back
        // from the provider. Either way, no stack and no provider URL.
        const status = err.status === 504 ? 504 : 502;
        console.warn(`[Geo] upstream ${err.provider} failed: ${err.message}`);
        res.status(status).json({ error: 'Upstream geo provider unavailable', provider: err.provider });
        return;
      }
      console.error('[Geo] unexpected error:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  };
}

// GET /api/geo/geocode?q=<address>
export const handleGeocode = asHandler(async (req, res) => {
  const q = requireString('q', req.query.q);
  const result = await service.geocode(q);
  if (!result) {
    res.status(404).json({ error: 'No match', q });
    return;
  }
  res.json(result);
});

// GET /api/geo/reverse?lat=<>&lng=<>
export const handleReverse = asHandler(async (req, res) => {
  const lat = requireLat(req.query.lat);
  const lng = requireLng(req.query.lng);
  const result = await service.reverseGeocode({ lat, lng });
  if (!result) {
    res.status(404).json({ error: 'No address found for coordinates', lat, lng });
    return;
  }
  res.json(result);
});

// GET /api/geo/autocomplete?q=<>&lat=<>&lng=<>
export const handleAutocomplete = asHandler(async (req, res) => {
  const q = requireString('q', req.query.q);
  const bias = optionalLatLng(req.query.lat, req.query.lng);
  const result = await service.autocomplete(q, bias);
  res.json(result);
});

// POST /api/geo/directions  body: { origin, destination }
export const handleDirections = asHandler(async (req, res) => {
  const origin = requireLatLng(req.body?.origin, 'origin');
  const destination = requireLatLng(req.body?.destination, 'destination');
  const result = await service.directions(origin, destination);
  if (!result) {
    res.status(404).json({ error: 'No route found between points', origin, destination });
    return;
  }
  res.json(result);
});

// POST /api/geo/distance-matrix  body: { origin, destinations }
export const handleDistanceMatrix = asHandler(async (req, res) => {
  const origin = requireLatLng(req.body?.origin, 'origin');
  const destinations = requireLatLngArray(req.body?.destinations, 'destinations');
  const result = await service.distanceMatrix(origin, destinations);
  if (!result) {
    res.status(404).json({ error: 'OSRM returned no matrix', origin });
    return;
  }
  res.json(result);
});
