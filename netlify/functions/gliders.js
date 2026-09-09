// GET /api/gliders?lat=..&lon=..&radiusKm=20
//
// Open Glider Network via live.glidernet.org — gliders, paragliders, hang
// gliders, balloons and tow planes carrying FLARM/OGN trackers, which mostly
// never appear on ADS-B. Keyless HTTP endpoint; the frontend dedupes any
// overlap with the aircraft feed by ICAO hex.
import { getCache, setCache } from './_store.js';
import { normalizeOgn } from './_normalize.js';
import { badOrigin, forbidden } from './_origin.js';

export default async (req) => {
  if (badOrigin(req)) return forbidden();
  const u = new URL(req.url);
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const km = parseFloat(u.searchParams.get('radiusKm') || '20');
  if (Number.isNaN(lat) || Number.isNaN(lon)) return json({ error: 'lat/lon required' }, 400);

  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  const key = `ogn:${lat.toFixed(2)}:${lon.toFixed(2)}:${km}`;
  const cached = await getCache(key);
  if (cached) return json(cached);

  // a=0 unused, b=latMax, c=latMin, d=lonMax, e=lonMin
  const url =
    `https://live.glidernet.org/lxml.php?a=0&b=${lat + dLat}&c=${lat - dLat}` +
    `&d=${lon + dLon}&e=${lon - dLon}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return json({ error: `glidernet ${r.status}` }, 502);
    const xml = await r.text();
    const out = [...xml.matchAll(/<m a="([^"]+)"/g)]
      .map((m) => normalizeOgn(m[1].split(',')))
      .filter(Boolean);
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
