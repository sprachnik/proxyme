// GET /api/vessels?lat=..&lon=..&radiusKm=25
import WebSocket from 'ws';
import { getCache, setCache } from './_store.js';
import { normalizeVessel } from './_normalize.js';

const DRAIN_MS = 6000;

const box = (lat, lon, km) => {
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  // AISStream wants [[ [latMin,lonMin], [latMax,lonMax] ]]
  return [[[lat - dLat, lon - dLon], [lat + dLat, lon + dLon]]];
};

export default async (req) => {
  const u = new URL(req.url);
  const lat = parseFloat(u.searchParams.get('lat'));
  const lon = parseFloat(u.searchParams.get('lon'));
  const km = parseFloat(u.searchParams.get('radiusKm') || '25');
  if (Number.isNaN(lat) || Number.isNaN(lon)) return json({ error: 'lat/lon required' }, 400);
  if (!process.env.AISSTREAM_API_KEY) return json({ error: 'AISSTREAM_API_KEY not set' }, 500);

  const key = `sea:${lat.toFixed(2)}:${lon.toFixed(2)}:${km}`;
  const cached = await getCache(key);
  if (cached) return json(cached);

  const seen = new Map();
  try {
    await drain(lat, lon, km, seen);
  } catch (e) {
    if (seen.size === 0) return json({ error: String(e) }, 502);
  }
  const out = [...seen.values()];
  await setCache(key, out, 8000);
  return json(out);
};

function drain(lat, lon, km, seen) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(); }, DRAIN_MS);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        // If auth fails, AISStream has historically also accepted "Apikey".
        APIKey: process.env.AISSTREAM_API_KEY,
        BoundingBoxes: box(lat, lon, km),
        FilterMessageTypes: ['PositionReport'],
      }));
    });
    ws.on('message', (buf) => {
      try {
        const v = normalizeVessel(JSON.parse(buf.toString()));
        if (v) seen.set(v.id, v); // dedupe / keep latest by MMSI
      } catch {}
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
