/**
 * Express router for /api/geo. Mounted in server.js.
 *
 * Rate-limits the autocomplete endpoint independently from the others —
 * autocomplete fires on every keystroke (debounced on the frontend; see
 * README) so its budget per IP is bigger than for the rarer geocode and
 * directions calls.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  handleGeocode, handleReverse, handleAutocomplete,
  handleDirections, handleDistanceMatrix,
} from './geo.controller.js';

const router = Router();

// Single shared base limit (per IP per minute) for the "expensive" geo calls.
const baseLimit = rateLimit({
  windowMs: Number(process.env.GEO_RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.GEO_RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

// Higher budget for autocomplete because it's keystroke-driven.
const autocompleteLimit = rateLimit({
  windowMs: Number(process.env.GEO_AUTOCOMPLETE_WINDOW_MS || 60_000),
  max: Number(process.env.GEO_AUTOCOMPLETE_MAX || 240),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many autocomplete requests' },
});

router.get('/geocode',      baseLimit,         handleGeocode);
router.get('/reverse',      baseLimit,         handleReverse);
router.get('/autocomplete', autocompleteLimit, handleAutocomplete);
router.post('/directions',      baseLimit, handleDirections);
router.post('/distance-matrix', baseLimit, handleDistanceMatrix);

export default router;
