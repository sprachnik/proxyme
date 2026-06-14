// GET /api/aircraft?lat=..&lon=..&radiusKm=50
import { getCache, setCache } from './_store.js';
import { normalizeAircraft } from './_normalize.js';

const bbox = (lat, lon, km) => {
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  return { lamin: lat - dLat, lamax: lat + dLat, lomin: lon - dLon, lomax: lon + dLon };
};

export default async (req) => {
  const u = new URL(req.url);
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const km = parseFloat(u.searchParams.get('radiusKm') || '50');
  if (Number.isNaN(lat) || Number.isNaN(lon)) return json({ error: 'lat/lon required' }, 400);

  const b = bbox(lat, lon, km);
  const key = `air:${b.lamin.toFixed(2)}:${b.lomin.toFixed(2)}:${b.lamax.toFixed(2)}:${b.lomax.toFixed(2)}`;
  const cached = await getCache(key);
  if (cached) return json(cached);

  // Anonymous works (≈400 req/day). Set OPENSKY_TOKEN for 4k/day.
  const url = `https://opensky-network.org/api/states/all?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}`;
  const headers = process.env.OPENSKY_TOKEN
    ? { Authorization: `Bearer ${process.env.OPENSKY_TOKEN}` }
    : {};

  try {
    const r = await fetch(url, { headers });
    if (!r.ok) return json({ error: `opensky ${r.status}` }, 502);
    const data = await r.json();
    const out = (data.states || []).map(normalizeAircraft).filter(Boolean);
    await setCache(key, out, 8000);
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
