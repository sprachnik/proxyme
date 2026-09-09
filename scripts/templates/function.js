// GET /api/__NAME__?lat=..&lon=..&radiusKm=20
//
// TODO: describe the upstream source and any quirks worth remembering, then
// add a row to the source table in CLAUDE.md.
import { getCache, setCache } from './_store.js';
import { badOrigin, forbidden } from './_origin.js';

const TTL_MS = 8000; // protects the upstream quota; raise for slow-moving data

export default async (req) => {
  if (badOrigin(req)) return forbidden();
  const u = new URL(req.url);
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const km = parseFloat(u.searchParams.get('radiusKm') || '20');
  if (Number.isNaN(lat) || Number.isNaN(lon)) return json({ error: 'lat/lon required' }, 400);

  const key = `__NAME__:${lat.toFixed(2)}:${lon.toFixed(2)}:${km}`;
  const cached = await getCache(key);
  if (cached) return json(cached);

  try {
    const r = await fetch(`https://example.invalid/?lat=${lat}&lon=${lon}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return json({ error: `__NAME__ ${r.status}` }, 502);
    const data = await r.json();

    const out = data; // TODO: normalise. Vehicle feeds use _normalize.js shapes.
    await setCache(key, out, TTL_MS);
    return json(out);
  } catch (e) {
    return json({ error: String(e) }, 502);
  }
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
