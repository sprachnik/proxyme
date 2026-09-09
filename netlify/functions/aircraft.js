// GET /api/aircraft?lat=..&lon=..&radiusKm=20
//
// Keyless ADS-B aggregators, tried in order. All serve the same readsb JSON
// shape and include light aircraft, helicopters and MLAT-inferred positions —
// unlike OpenSky, which now needs OAuth and misses most GA traffic.
import { getCache, setCache } from './_store.js';
import { normalizeAdsb } from './_normalize.js';
import { badOrigin, forbidden } from './_origin.js';

const SOURCES = [
  { name: 'adsb.lol',       url: (la, lo, nm) => `https://api.adsb.lol/v2/point/${la}/${lo}/${nm}`,               list: (d) => d.ac },
  { name: 'adsb.fi',        url: (la, lo, nm) => `https://opendata.adsb.fi/api/v2/lat/${la}/lon/${lo}/dist/${nm}`, list: (d) => d.aircraft },
  { name: 'airplanes.live', url: (la, lo, nm) => `https://api.airplanes.live/v2/point/${la}/${lo}/${nm}`,          list: (d) => d.ac },
];

export default async (req) => {
  if (badOrigin(req)) return forbidden();
  const u = new URL(req.url);
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const km = parseFloat(u.searchParams.get('radiusKm') || '20');
  if (Number.isNaN(lat) || Number.isNaN(lon)) return json({ error: 'lat/lon required' }, 400);

  const nm = Math.min(250, Math.max(1, Math.ceil(km / 1.852)));
  const key = `air:${lat.toFixed(2)}:${lon.toFixed(2)}:${nm}`;
  const cached = await getCache(key);
  if (cached) return json(cached);

  let lastErr = 'no aircraft source reachable';
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url(lat, lon, nm), {
        signal: AbortSignal.timeout(5000),
        headers: { accept: 'application/json' },
      });
      if (!r.ok) { lastErr = `${s.name} ${r.status}`; continue; }
      const data = await r.json();
      const out = (s.list(data) || []).map(normalizeAdsb).filter(Boolean);
      await setCache(key, out, 8000);
      return json(out);
    } catch (e) {
      lastErr = `${s.name}: ${e.message || e}`;
    }
  }
  return json({ error: lastErr }, 502);
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
