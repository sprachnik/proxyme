// Storage seam. MVP = Netlify Blobs. Supabase pass = replace bodies, keep signatures.
import { getStore } from '@netlify/blobs';

// Lazy + fault-tolerant: outside the Netlify runtime (local node, tests)
// getStore throws — degrade to no caching instead of crashing on import.
let cache;
function store() {
  if (cache === undefined) {
    try { cache = getStore('proxme-cache'); } catch { cache = null; }
  }
  return cache;
}

/** Short-TTL response cache (protects API quotas). */
export async function getCache(key) {
  try {
    const v = await store()?.get(key, { type: 'json' });
    return v && v.exp > Date.now() ? v.data : null;
  } catch {
    return null; // cache miss/unavailable must never break the request path
  }
}

export async function setCache(key, data, ttlMs = 8000) {
  try {
    await store()?.setJSON(key, { data, exp: Date.now() + ttlMs });
  } catch { /* best-effort */ }
}

/**
 * Persist a sighting for history/heatmaps. No-op in MVP.
 *
 * SUPABASE PASS — replace body with:
 *   import { createClient } from '@supabase/supabase-js';
 *   const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
 *   await sb.from('sightings').upsert(
 *     { id: e.id, kind: e.kind, lat: e.lat, lon: e.lon, ts: e.ts, raw: e.raw },
 *     { onConflict: 'id,ts' }
 *   );
 *
 * Suggested table:
 *   create table sightings (
 *     id text, kind text, lat double precision, lon double precision,
 *     ts timestamptz, raw jsonb, primary key (id, ts)
 *   );
 */
export async function recordSighting(_entity) {
  return; // MVP: drop on floor
}
