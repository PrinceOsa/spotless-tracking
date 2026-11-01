/**
 * geo.service.js tests.
 *
 * Strategy: mock `global.fetch` per test, run the service function, assert
 * (a) the URL we hit looks right, (b) we returned the normalized shape, and
 * (c) the cache is consulted before the second identical call.
 *
 * We import the service through a fresh module path each suite so the
 * module-level cache singleton starts empty. vitest doesn't need any
 * special config for this — the `?cacheBust=` query string ensures a fresh
 * import per `import()`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Always go through a fresh module import to reset the cache singleton.
let svc;
let calls;

async function loadService() {
  // Reset the in-memory cache (and any other module-level singletons) so each
  // test starts clean. vi.resetModules() works whether the test runs under
  // Node or Vite/vitest's transformer.
  vi.resetModules();
  svc = await import('../geo.service.js');
}

function mockFetchOnce(body, { ok = true, status = 200 } = {}) {
  global.fetch = vi.fn(async (url) => {
    calls.push(String(url));
    return {
      ok, status,
      json: async () => body,
    };
  });
}

function mockFetchSequence(sequence) {
  let i = 0;
  global.fetch = vi.fn(async (url) => {
    calls.push(String(url));
    const next = sequence[i++] ?? sequence[sequence.length - 1];
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
    };
  });
}

beforeEach(async () => {
  calls = [];
  await loadService();
});

// ── geocode ────────────────────────────────────────────────────────────────

describe('geocode', () => {
  it('returns normalized lat/lng/displayName/confidence', async () => {
    mockFetchOnce([
      { lat: '33.0198', lon: '-96.6989', display_name: 'Plano, TX', importance: 0.72 },
    ]);
    const r = await svc.geocode('plano tx');
    expect(r).toEqual({
      lat: 33.0198,
      lng: -96.6989,
      displayName: 'Plano, TX',
      confidence: 0.72,
    });
    // hits Nominatim /search
    expect(calls[0]).toContain('/search');
    expect(calls[0]).toContain('q=plano%20tx');
  });

  it('returns null when Nominatim has no match', async () => {
    mockFetchOnce([]);
    const r = await svc.geocode('asdfqwerty12345');
    expect(r).toBe(null);
  });
});

// ── reverse geocode ────────────────────────────────────────────────────────

describe('reverseGeocode', () => {
  it('flattens Nominatim address fields into our shape', async () => {
    mockFetchOnce({
      lat: '33.0198', lon: '-96.6989',
      display_name: '1 Main St, Plano, TX, USA',
      address: {
        road: 'Main St',
        city: 'Plano',
        state: 'Texas',
        postcode: '75024',
        country: 'United States',
      },
    });
    const r = await svc.reverseGeocode({ lat: 33.0198, lng: -96.6989 });
    expect(r.address).toEqual({
      road: 'Main St',
      city: 'Plano',
      state: 'Texas',
      postcode: '75024',
      country: 'United States',
    });
    expect(r.lat).toBe(33.0198);
    expect(r.lng).toBe(-96.6989);
    expect(calls[0]).toContain('/reverse');
  });
});

// ── autocomplete ───────────────────────────────────────────────────────────

describe('autocomplete', () => {
  it('flattens Photon FeatureCollection into suggestions', async () => {
    mockFetchOnce({
      features: [
        {
          geometry: { coordinates: [-96.6989, 33.0198] }, // Photon = [lng, lat]
          properties: { name: '1 Main St', street: 'Main St', city: 'Plano', state: 'Texas', country: 'USA' },
        },
      ],
    });
    const r = await svc.autocomplete('1 main', { lat: 33, lng: -96 });
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]).toMatchObject({
      lat: 33.0198,
      lng: -96.6989,
      primary: '1 Main St',
    });
    expect(r.suggestions[0].secondary).toContain('Plano');
    // bias coords on the URL
    expect(calls[0]).toContain('lat=33');
    expect(calls[0]).toContain('lon=-96');
  });

  it('drops features with no coordinates', async () => {
    mockFetchOnce({
      features: [
        { geometry: { coordinates: [] }, properties: { name: 'no coords' } },
        { geometry: { coordinates: [-96.6989, 33.0198] }, properties: { name: 'ok' } },
      ],
    });
    const r = await svc.autocomplete('something');
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].primary).toBe('ok');
  });
});

// ── directions ─────────────────────────────────────────────────────────────

describe('directions', () => {
  it('sends lng,lat in the URL and returns GeoJSON LineString', async () => {
    mockFetchOnce({
      code: 'Ok',
      routes: [{
        distance: 4321,
        duration: 412,
        geometry: { type: 'LineString', coordinates: [[-96.69, 33.01], [-96.70, 33.02]] },
      }],
    });
    const r = await svc.directions({ lat: 33.01, lng: -96.69 }, { lat: 33.02, lng: -96.70 });
    // OSRM URL ordering is lng,lat — verify the flip happened
    expect(calls[0]).toMatch(/-96\.69,33\.01;-96\.7,33\.02/);
    expect(r.distanceM).toBe(4321);
    expect(r.durationSec).toBe(412);
    expect(r.geometry.type).toBe('LineString');
  });

  it('returns null when OSRM has no route', async () => {
    mockFetchOnce({ code: 'NoRoute', routes: [] });
    const r = await svc.directions({ lat: 33, lng: -96 }, { lat: 34, lng: -97 });
    expect(r).toBe(null);
  });
});

// ── distance matrix ────────────────────────────────────────────────────────

describe('distanceMatrix', () => {
  it('handles multiple destinations and surfaces unreachable as null+status', async () => {
    mockFetchOnce({
      code: 'Ok',
      durations: [[100, 200, null]],
      distances: [[1000, 2000, null]],
    });
    const origin = { lat: 33.0, lng: -96.0 };
    const destinations = [
      { lat: 33.1, lng: -96.1 },
      { lat: 33.2, lng: -96.2 },
      { lat: 33.3, lng: -96.3 },
    ];
    const r = await svc.distanceMatrix(origin, destinations);
    expect(r.results).toHaveLength(3);
    expect(r.results[0]).toMatchObject({ distanceM: 1000, durationSec: 100, status: 'ok' });
    expect(r.results[2]).toMatchObject({ distanceM: null, durationSec: null, status: 'unreachable' });
    // Verify OSRM URL encodes lng,lat for every point and uses sources=0
    expect(calls[0]).toContain('sources=0');
    expect(calls[0]).toContain('-96,33;-96.1,33.1;-96.2,33.2;-96.3,33.3');
  });
});

// ── cache hit/miss ─────────────────────────────────────────────────────────

describe('cache', () => {
  it('serves the second identical geocode call from cache without re-hitting fetch', async () => {
    mockFetchSequence([
      { body: [{ lat: '33.0', lon: '-96.0', display_name: 'X', importance: 0.5 }] },
      { body: [] }, // shouldn't be used; cache should win
    ]);

    const a = await svc.geocode('cached address');
    const b = await svc.geocode('CACHED address ');     // normalized to same key
    const c = await svc.geocode('  cached  address ');  // whitespace collapsed

    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does NOT cache when the service returns null', async () => {
    mockFetchSequence([
      { body: [] },
      { body: [{ lat: '1', lon: '2', display_name: 'now-real', importance: 0.5 }] },
    ]);

    const a = await svc.geocode('miss then hit');
    const b = await svc.geocode('miss then hit');

    expect(a).toBe(null);
    expect(b).not.toBe(null);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ── upstream errors ────────────────────────────────────────────────────────

describe('upstream errors', () => {
  it('throws UpstreamError on non-2xx', async () => {
    mockFetchOnce({}, { ok: false, status: 503 });
    await expect(svc.geocode('any')).rejects.toMatchObject({
      name: 'UpstreamError',
      provider: 'nominatim',
      status: 503,
    });
  });
});
