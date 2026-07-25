// proxme — static GitHub Pages build. No backend: the browser talks straight
// to airplanes.live (ADS-B + MLAT, CORS-open), live.glidernet.org (OGN/FLARM)
// and aisstream.io (AIS over a persistent websocket). Boats need your own
// free aisstream.io key — 🔑 in the HUD stores it in localStorage only.
const POLL_MS = 12000;
const VESSEL_TTL_MS = 10 * 60 * 1000;
const FALLBACK = [51.5074, -0.1278]; // London — used until we have a real spot
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const radiusEl = document.getElementById('radius');

let map, youMarker, ring, layer;
let pollTimer = null;
let here = null; // { lat, lon } current search centre
let radiusKm = 20;
const markers = new Map(); // id -> Leaflet marker

/* ---------------- normalisers (same shape as the Netlify build) ---------- */

const CATEGORY_SUB = {
  A1: 'light', A2: 'light', A7: 'heli',
  B1: 'glider', B2: 'balloon', B4: 'ultralight', B6: 'drone',
};

function normalizeAdsb(ac) {
  if (ac.lat == null || ac.lon == null) return null;
  const ground = ac.alt_baro === 'ground';
  const altFt = ground ? 0 : ac.alt_geom ?? ac.alt_baro ?? null;
  const srcType = ac.type || '';
  return {
    id: String(ac.hex || '').toLowerCase(),
    kind: 'air',
    sub: CATEGORY_SUB[ac.category] || 'plane',
    lat: ac.lat,
    lon: ac.lon,
    alt: altFt != null ? Math.round(altFt * 0.3048) : null,
    ground,
    heading: ac.track ?? ac.true_heading ?? ac.mag_heading ?? null,
    speed: ac.gs ?? null,
    name: (ac.flight || '').trim() || ac.r || ac.hex,
    reg: ac.r || null,
    model: ac.desc || ac.t || null,
    src: srcType.includes('mlat') ? 'MLAT (inferred)'
      : srcType.includes('tisb') ? 'TIS-B (inferred)'
      : 'ADS-B',
    ts: Date.now() - Math.round((ac.seen_pos ?? ac.seen ?? 0) * 1000),
  };
}

const OGN_TYPES = {
  1: 'glider', 2: 'towplane', 3: 'heli', 4: 'parachute', 5: 'dropplane',
  6: 'hangglider', 7: 'paraglider', 8: 'light', 9: 'plane',
  11: 'balloon', 12: 'airship', 13: 'drone',
};

// live.glidernet.org lxml marker, split on commas:
// 0 lat, 1 lon, 2 CN, 3 reg, 4 alt(m), 5 hh:mm:ss, 6 age(s), 7 track,
// 8 speed(km/h), 9 climb, 10 type, 11 receiver, 12 hex, 13 uid
function normalizeOgn(f) {
  const lat = parseFloat(f[0]);
  const lon = parseFloat(f[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ogAge = parseInt(f[6], 10) || 0;
  if (ogAge > 600) return null;
  const hex = String(f[12] || '0').toLowerCase();
  const speedKmh = parseFloat(f[8]);
  return {
    id: hex !== '0' ? hex : `ogn:${f[13]}`,
    kind: 'air',
    sub: OGN_TYPES[parseInt(f[10], 10)] || 'glider',
    lat,
    lon,
    alt: parseInt(f[4], 10) || 0,
    ground: false,
    heading: parseFloat(f[7]) || null,
    speed: Number.isFinite(speedKmh) ? +(speedKmh / 1.852).toFixed(1) : null,
    name: (f[3] || f[2] || '').trim() || String(f[13]),
    reg: f[3] || null,
    model: null,
    src: 'OGN/FLARM',
    ts: Date.now() - ogAge * 1000,
  };
}

function normalizeVessel(msg) {
  const m = msg.MetaData || {};
  const p = msg.Message?.PositionReport || {};
  const lat = m.latitude ?? p.Latitude;
  const lon = m.longitude ?? p.Longitude;
  if (lat == null || lon == null) return null;
  const heading =
    p.TrueHeading != null && p.TrueHeading !== 511 ? p.TrueHeading : p.Cog ?? null;
  return {
    id: String(m.MMSI ?? p.UserID),
    kind: 'sea',
    sub: 'boat',
    lat,
    lon,
    alt: 0,
    ground: false,
    heading,
    speed: p.Sog ?? null,
    name: (m.ShipName || '').trim() || String(m.MMSI),
    reg: null,
    model: null,
    src: 'AIS',
    ts: m.time_utc ? Date.parse(m.time_utc) : Date.now(),
  };
}

/* ---------------- data feeds --------------------------------------------- */

const bounds = (lat, lon, km) => {
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
  return { latMin: lat - dLat, latMax: lat + dLat, lonMin: lon - dLon, lonMax: lon + dLon };
};

async function fetchAircraft(lat, lon, km) {
  const nm = Math.min(250, Math.max(1, Math.ceil(km / 1.852)));
  const r = await fetch(`https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`);
  if (!r.ok) throw new Error(`airplanes.live ${r.status}`);
  return ((await r.json()).ac || []).map(normalizeAdsb).filter(Boolean);
}

async function fetchGliders(lat, lon, km) {
  const b = bounds(lat, lon, km);
  const r = await fetch(
    `https://live.glidernet.org/lxml.php?a=0&b=${b.latMax}&c=${b.latMin}&d=${b.lonMax}&e=${b.lonMin}`
  );
  if (!r.ok) throw new Error(`glidernet ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<m a="([^"]+)"/g)]
    .map((m) => normalizeOgn(m[1].split(',')))
    .filter(Boolean);
}

/* AIS: one persistent websocket, resubscribed when the centre/radius moves. */
const vessels = new Map(); // id -> entity, pruned by TTL
let ws = null;
let wsLive = false;
let wsRetryMs = 8000;

const aisKey = () => localStorage.getItem('aisstream_key') || '';

function aisSubscribe() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !here) return;
  const b = bounds(here.lat, here.lon, radiusKm);
  ws.send(JSON.stringify({
    APIKey: aisKey(),
    BoundingBoxes: [[[b.latMin, b.lonMin], [b.latMax, b.lonMax]]],
    FilterMessageTypes: ['PositionReport'],
  }));
}

function aisConnect() {
  if (!aisKey() || ws) return;
  ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  ws.onopen = () => { wsLive = true; wsRetryMs = 8000; aisSubscribe(); };
  ws.onmessage = async (ev) => {
    try {
      const txt = typeof ev.data === 'string' ? ev.data : await ev.data.text();
      const v = normalizeVessel(JSON.parse(txt));
      if (v) vessels.set(v.id, v);
    } catch {}
  };
  ws.onclose = () => {
    ws = null;
    wsLive = false;
    setTimeout(aisConnect, wsRetryMs);
    wsRetryMs = Math.min(wsRetryMs * 2, 120000); // back off on bad key/outage
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function setAisKey() {
  const v = prompt(
    'AISStream API key for boats (free at aisstream.io).\nStored only in this browser.',
    aisKey()
  );
  if (v === null) return;
  localStorage.setItem('aisstream_key', v.trim());
  vessels.clear();
  wsRetryMs = 8000;
  if (ws) { const old = ws; ws = null; try { old.onclose = null; old.close(); } catch {} }
  wsLive = false;
  aisConnect();
  refresh();
}

/* ---------------- rendering ---------------------------------------------- */

const COLORS = {
  plane: '#4ea8ff', light: '#ffb347', heli: '#ff5470',
  glider: '#9d7bff', paraglider: '#9d7bff', hangglider: '#9d7bff',
  towplane: '#9d7bff', parachute: '#9d7bff', balloon: '#ffd35e',
  airship: '#ffd35e', drone: '#ffd35e', ultralight: '#ffb347',
  dropplane: '#ffb347', boat: '#2fd6c2',
};
const GLIDERY = new Set(['glider', 'paraglider', 'hangglider', 'towplane', 'parachute', 'balloon', 'airship', 'drone']);

function color(e) { return COLORS[e.sub] || (e.kind === 'sea' ? '#2fd6c2' : '#4ea8ff'); }

function icon(e) {
  const c = color(e);
  let shape;
  if (e.kind === 'sea') {
    shape = `<div class="shape boat" style="background:${c}"></div>`;
  } else if (e.sub === 'balloon' || e.sub === 'parachute' || e.sub === 'drone' || e.sub === 'airship') {
    shape = `<div class="shape dot" style="background:${c}"></div>`;
  } else {
    shape = `<div class="shape blip" style="border-bottom-color:${c};transform:rotate(${e.heading ?? 0}deg)"></div>`;
  }
  return L.divIcon({ className: '', html: shape, iconSize: [14, 14], iconAnchor: [7, 9] });
}

const KM = (a, b) => {
  const R = 6371, d = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * d) / 2) ** 2 +
    Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(((b.lon - a.lon) * d) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const age = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

const fmtAlt = (e) =>
  e.ground ? 'on ground'
    : e.alt != null ? `${Math.round(e.alt / 0.3048).toLocaleString()} ft (${Math.round(e.alt)} m)` : '';

function popupHtml(e) {
  const rows = [
    `<b>${esc(e.name)}</b> <span class="sub">${esc(e.sub)}</span>`,
    e.reg && e.reg !== e.name ? `reg ${esc(e.reg)}` : '',
    e.model ? esc(e.model) : '',
    e.kind === 'air' ? fmtAlt(e) : '',
    e.speed != null ? `${Math.round(e.speed)} kn` : '',
    here ? `${e._dist.toFixed(1)} km away` : '',
    `<span class="src">${esc(e.src)} · ${age(e.ts)}</span>`,
  ];
  return rows.filter(Boolean).join('<br>');
}

function upsert(e) {
  const m = markers.get(e.id);
  const ll = [e.lat, e.lon];
  if (m) {
    m.setLatLng(ll).setIcon(icon(e)).bindPopup(popupHtml(e));
    m._fresh = true;
  } else {
    const nm = L.marker(ll, { icon: icon(e) }).bindPopup(popupHtml(e)).addTo(layer);
    nm._fresh = true;
    markers.set(e.id, nm);
  }
}

function renderPanel(entities) {
  panelEl.innerHTML = entities.slice(0, 12).map((e) => `
    <div class="row" data-id="${esc(e.id)}">
      <i style="background:${color(e)}"></i>
      <span class="nm">${esc(e.name)}</span>
      <span class="meta">${esc(e.sub)}${e.kind === 'air' && e.alt != null && !e.ground ? ` · ${Math.round(e.alt / 0.3048).toLocaleString()}ft` : ''}${e.ground ? ' · ground' : ''}</span>
      <span class="dist">${e._dist.toFixed(1)}km</span>
    </div>`).join('') || '<div class="row empty">nothing in range right now</div>';
}

panelEl.addEventListener('click', (ev) => {
  const row = ev.target.closest('.row');
  const m = row && markers.get(row.dataset.id);
  if (m) { map.panTo(m.getLatLng()); m.openPopup(); }
});

/* ---------------- main loop ---------------------------------------------- */

const pick = (r) => (r.status === 'fulfilled' ? r.value : []);

async function refresh() {
  if (!here) return;
  const { lat, lon } = here;
  const [air, ogn] = await Promise.allSettled([
    fetchAircraft(lat, lon, radiusKm),
    fetchGliders(lat, lon, radiusKm),
  ]);

  const now = Date.now();
  for (const [id, v] of vessels) if (now - v.ts > VESSEL_TTL_MS) vessels.delete(id);

  // Merge: ADS-B wins on shared ICAO hex; OGN adds FLARM-only traffic.
  // FLARM device IDs aren't ICAO hexes, so also drop OGN entries that sit
  // right on top of an ADS-B aircraft (same spot, similar altitude).
  const byId = new Map();
  const adsbList = pick(air);
  for (const e of adsbList) byId.set(e.id, e);
  for (const e of pick(ogn)) {
    if (byId.has(e.id)) continue;
    if (e.id.startsWith('ogn:') &&
        adsbList.some((a) => KM(a, e) < 0.5 && Math.abs((a.alt ?? e.alt) - e.alt) < 300)) continue;
    byId.set(e.id, e);
  }
  for (const v of vessels.values()) byId.set(v.id, v);

  const entities = [...byId.values()]
    .map((e) => ((e._dist = KM(here, e)), e))
    .filter((e) => e._dist <= radiusKm)
    .sort((a, b) => a._dist - b._dist);

  markers.forEach((m) => (m._fresh = false));
  entities.forEach(upsert);
  for (const [id, m] of markers) {
    if (!m._fresh) { layer.removeLayer(m); markers.delete(id); }
  }
  renderPanel(entities);

  const nAir = entities.filter((e) => e.kind === 'air' && !GLIDERY.has(e.sub)).length;
  const nGlide = entities.filter((e) => GLIDERY.has(e.sub)).length;
  const nSea = entities.filter((e) => e.kind === 'sea').length;
  const notes = [];
  if (air.status === 'rejected' && ogn.status === 'rejected') notes.push('air feeds down');
  if (!aisKey()) notes.push('boats off — tap 🔑 for a free aisstream.io key');
  else if (!wsLive) notes.push('sea connecting…');
  statusEl.textContent =
    `${nAir} aircraft · ${nGlide} gliders · ${nSea} boats` +
    (notes.length ? ` · ${notes.join(' · ')}` : '');
}

// Move the search centre. Called by geolocation and by tapping the map.
function setLocation(lat, lon, recenter = false) {
  here = { lat, lon };
  const ll = [lat, lon];
  youMarker.setLatLng(ll);
  ring.setLatLng(ll);
  if (recenter) map.setView(ll, zoomFor(radiusKm));
  aisConnect();
  aisSubscribe(); // retarget the AIS bbox at the new centre
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
}

const zoomFor = (km) => (km <= 5 ? 13 : km <= 10 ? 12 : km <= 20 ? 11 : 9);

function setRadius(km) {
  radiusKm = km;
  ring.setRadius(km * 1000);
  aisSubscribe();
  if (here) { map.setView([here.lat, here.lon], zoomFor(km)); refresh(); }
}

function locate() {
  if (!navigator.geolocation) {
    statusEl.textContent = 'no geolocation — tap the map to pick a spot';
    if (!here) setLocation(...FALLBACK, true);
    return;
  }
  statusEl.textContent = 'locating…';
  navigator.geolocation.getCurrentPosition(
    (p) => setLocation(p.coords.latitude, p.coords.longitude, true),
    (err) => {
      statusEl.textContent =
        err.code === 1
          ? 'location blocked — tap the map to pick a spot (or allow location in your browser, then tap 📍)'
          : 'location unavailable — tap the map to pick a spot';
      if (!here) setLocation(...FALLBACK, true); // show *something* so it's not a blank map
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function init() {
  map = L.map('map').setView(FALLBACK, zoomFor(radiusKm));
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap · air: airplanes.live · gliders: OGN · sea: aisstream.io',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);

  youMarker = L.circleMarker(FALLBACK, { radius: 6, color: '#fff', fillColor: '#ff5470', fillOpacity: 1 })
    .addTo(map)
    .bindTooltip('search centre — tap the map to move', { direction: 'top', offset: [0, -6] });
  ring = L.circle(FALLBACK, { radius: radiusKm * 1000, color: '#4ea8ff', fill: false, opacity: .35 }).addTo(map);

  // Drop a pin: tap/click anywhere to search around that point.
  map.on('click', (ev) => setLocation(ev.latlng.lat, ev.latlng.lng));

  document.getElementById('locate').addEventListener('click', locate);
  document.getElementById('aiskey').addEventListener('click', setAisKey);
  radiusEl.addEventListener('change', () => setRadius(parseFloat(radiusEl.value)));

  statusEl.textContent = 'locating… (or tap the map to pick a spot)';
  locate();
}

init();
