// Storage seam. MVP = Netlify Blobs. Supabase pass = replace bodies, keep signatures.
import { getStore } from '@netlify/blobs';

const cache = getStore('proxme-cache');

/** Short-TTL response cache (protects API quotas). */
export async function getCache(key) {
  try {
    const v = await cache.get(key, { type: 'json' });
    return v && v.exp > Date.now() ? v.data : null;
  } catch {
    return null; // cache miss/unavailable must never break the request path
  }
}

export async function setCache(key, data, ttlMs = 8000) {
  try {
    await cache.setJSON(key, { data, exp: Date.now() + ttlMs });
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
