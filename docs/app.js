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

// Mode-S-only aircraft (MLAT positions) never transmit a category, so fall
// back to the ICAO type designator / model description.
const HELI_TYPES = new Set([
  'R22', 'R44', 'R66', 'B06', 'B06T', 'B47G', 'B407', 'B412', 'B429', 'B505',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'AS50', 'AS55',
  'AS65', 'A109', 'A119', 'A139', 'A149', 'A169', 'A189', 'S76', 'S92',
  'H500', 'H269', 'H47', 'H60', 'UH1', 'MD52', 'MD60', 'G2CA', 'EXPL',
  'LYNX', 'GAZL', 'PUMA', 'TIGR', 'EH10', 'NH90', 'V22',
]);
const LIGHT_TYPES = new Set([
  'C120', 'C140', 'C150', 'C152', 'C162', 'C170', 'C172', 'C175', 'C177',
  'C180', 'C182', 'C185', 'C206', 'C210', 'P28A', 'P28B', 'P28R', 'P28T',
  'PA18', 'PA24', 'PA25', 'PA30', 'PA32', 'PA34', 'PA38', 'PA46', 'J3',
  'BE33', 'BE35', 'BE36', 'BE55', 'BE58', 'BE76', 'DA40', 'DA42', 'DA62',
  'DV20', 'SR20', 'SR22', 'M20P', 'M20T', 'M20J', 'RV4', 'RV6', 'RV7',
  'RV8', 'RV9', 'RV10', 'RV12', 'RV14', 'AA5', 'CH7A', 'CH7B', 'BL8',
  'TB9', 'TB10', 'TB20', 'DR40', 'DR30', 'G115', 'AT3', 'SIRA', 'EUPA',
  'TECN', 'P208', 'P210', 'VL3', 'CRUZ', 'SAVG', 'EV97', 'FK9', 'ULAC',
  'PNR2', 'PNR3', 'JAB4', 'AQUI', 'SLG2', 'SLG4', 'NG5', 'WT9', 'ECHO',
]);

function inferSub(t, desc) {
  const d = String(desc || '').toUpperCase();
  if (HELI_TYPES.has(t) ||
      /HELICOPTER|ROBINSON|EUROCOPTER|AEROSPATIALE|SIKORSKY|AGUSTA|LEONARDO AW|BELL \d|MD HELI|SCHWEIZER|ENSTROM|GUIMBAL|ROTORWAY|GYROPLANE|AUTOGYRO|GYROCOPTER/.test(d)) return 'heli';
  if (/GLIDER|SAILPLANE/.test(d)) return 'glider';
  if (/BALLOON/.test(d)) return 'balloon';
  if (/AIRSHIP|ZEPPELIN/.test(d)) return 'airship';
  if (LIGHT_TYPES.has(t) || /MICROLIGHT|ULTRALIGHT/.test(d)) return 'light';
  return null;
}

function normalizeAdsb(ac) {
  if (ac.lat == null || ac.lon == null) return null;
  const ground = ac.alt_baro === 'ground';
  const altFt = ground ? 0 : ac.alt_geom ?? ac.alt_baro ?? null;
  const srcType = ac.type || '';
  return {
    id: String(ac.hex || '').toLowerCase(),
    kind: 'air',
    sub: CATEGORY_SUB[ac.category] || inferSub(ac.t, ac.desc || ac.t) || 'plane',
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

// Top-view silhouettes on a 24×24 grid, nose pointing north; rotated by heading.
const SHAPES = {
  plane: 'M12 2 L13.6 9 L22 13.2 L22 15.2 L13.4 12.6 L13 17.6 L16 20 L16 21.6 L12 20.6 L8 21.6 L8 20 L11 17.6 L10.6 12.6 L2 15.2 L2 13.2 L10.4 9 Z',
  light: 'M12 2.6 C12.7 2.6 13.1 3.3 13.1 4.2 L13.1 8.2 L22 9.6 L22 12 L13.1 11.4 L12.8 16.8 L15.8 18.4 L15.8 20 L12 19.2 L8.2 20 L8.2 18.4 L11.2 16.8 L10.9 11.4 L2 12 L2 9.6 L10.9 8.2 L10.9 4.2 C10.9 3.3 11.3 2.6 12 2.6 Z',
  glider: 'M12 3.4 C12.5 3.4 12.8 3.8 12.8 4.4 L12.8 8.4 L23 9.2 L23 10.8 L12.7 11 L12.4 17.4 L14.8 18.6 L14.8 19.8 L12 19.2 L9.2 19.8 L9.2 18.6 L11.6 17.4 L11.3 11 L1 10.8 L1 9.2 L11.2 8.4 L11.2 4.4 C11.2 3.8 11.5 3.4 12 3.4 Z',
  para: 'M3 10.5 Q12 2.5 21 10.5 L19.4 12.4 Q12 6.6 4.6 12.4 Z M10.3 14.8 A1.8 1.8 0 1 0 13.9 14.8 A1.8 1.8 0 1 0 10.3 14.8 Z',
  hang: 'M12 5 L21.5 13 L12 9.8 L2.5 13 Z M11.3 10.8 L12.7 10.8 L12.4 16.2 L11.6 16.2 Z',
  boat: 'M12 2.5 C14.8 5.2 16 8.4 16 12.2 L16 18.6 C16 20 15 21 13.6 21 L10.4 21 C9 21 8 20 8 18.6 L8 12.2 C8 8.4 9.2 5.2 12 2.5 Z',
};

function shapeSvg(sub, c) {
  const p = (d) => `<path d="${d}" fill="${c}" stroke="rgba(0,0,0,.45)" stroke-width="1" stroke-linejoin="round"/>`;
  switch (sub) {
    case 'heli':
      return `<path d="M5.5 3.5 L18.5 16.5 M18.5 3.5 L5.5 16.5" stroke="${c}" stroke-width="1.7" stroke-linecap="round" fill="none"/>` +
        `<rect x="11.25" y="13" width="1.5" height="8.5" rx=".75" fill="${c}" stroke="rgba(0,0,0,.45)" stroke-width=".7"/>` +
        `<ellipse cx="12" cy="10" rx="3.4" ry="5.6" fill="${c}" stroke="rgba(0,0,0,.45)"/>`;
    case 'balloon': case 'airship':
      return `<circle cx="12" cy="9" r="6.4" fill="${c}" stroke="rgba(0,0,0,.45)"/><path d="M10 17.5 h4 v3.5 h-4 Z" fill="${c}" stroke="rgba(0,0,0,.45)"/>`;
    case 'drone':
      return `<path d="M7 7 L17 17 M17 7 L7 17" stroke="${c}" stroke-width="2"/>` +
        ['7 7', '17 7', '7 17', '17 17'].map((xy) => `<circle cx="${xy.split(' ')[0]}" cy="${xy.split(' ')[1]}" r="3" fill="${c}" stroke="rgba(0,0,0,.45)"/>`).join('');
    case 'glider': return p(SHAPES.glider);
    case 'paraglider': case 'parachute': return p(SHAPES.para);
    case 'hangglider': return p(SHAPES.hang);
    case 'light': case 'ultralight': case 'towplane': case 'dropplane': return p(SHAPES.light);
    case 'boat': return p(SHAPES.boat);
    default: return p(SHAPES.plane);
  }
}

function icon(e) {
  const fixed = e.sub === 'balloon' || e.sub === 'airship' || e.sub === 'drone';
  const rot = fixed ? 0 : e.heading ?? 0;
  const html =
    `<div class="vic" style="transform:rotate(${rot}deg)">` +
    `<svg viewBox="0 0 24 24" width="22" height="22">${shapeSvg(e.sub, color(e))}</svg></div>`;
  return L.divIcon({ className: '', html, iconSize: [22, 22], iconAnchor: [11, 11] });
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

// "Tell me more" links per target — all open in a new tab.
function links(e) {
  const a = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  const g = (q) => a(`https://www.google.com/search?q=${encodeURIComponent(q)}`, 'search');
  const out = [];
  if (e.kind === 'sea') {
    out.push(a(`https://www.vesselfinder.com/vessels/details/${e.id}`, 'VesselFinder'));
    out.push(a(`https://www.marinetraffic.com/en/ais/details/ships/mmsi:${e.id}`, 'MarineTraffic'));
    out.push(g(`${e.name && e.name !== e.id ? `"${e.name}" ` : ''}MMSI ${e.id}`));
  } else {
    const hex = e.id.startsWith('ogn:') ? null : e.id;
    if (hex) {
      out.push(a(`https://globe.airplanes.live/?icao=${hex}`, 'live track'));
      out.push(a(`https://www.planespotters.net/hex/${hex.toUpperCase()}`, 'photos'));
    }
    const flt = String(e.name || '').replace(/\s+/g, '');
    if (flt) out.push(a(`https://www.flightaware.com/live/flight/${encodeURIComponent(flt)}`, 'FlightAware'));
    out.push(g(`${e.reg || e.name || hex} aircraft`));
  }
  return `<span class="links">${out.join(' · ')}</span>`;
}

function popupHtml(e) {
  const rows = [
    `<b>${esc(e.name)}</b> <span class="sub">${esc(e.sub)}</span>`,
    e.reg && e.reg !== e.name ? `reg ${esc(e.reg)}` : '',
    e.model ? esc(e.model) : '',
    e.kind === 'air' ? fmtAlt(e) : '',
    e.speed != null ? `${Math.round(e.speed)} kn` : '',
    here ? `${e._dist.toFixed(1)} km away` : '',
    `<span class="src">${esc(e.src)} · ${age(e.ts)}</span>`,
    links(e),
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

/* ---------------- weather overlay (optional, keyless) --------------------- */
/* Rain radar tiles from RainViewer + a 3×3 wind/temperature grid from
   Open-Meteo across the search ring. Toggled with 🌦, state remembered. */

let wxOn = localStorage.getItem('wx_on') === '1';
let radarLayer = null;
let wxLayer = null;
let wxTimer = null;

async function radarRefresh() {
  try {
    const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const d = await r.json();
    if (!wxOn) return; // toggled off while the fetch was in flight
    const last = d.radar?.past?.slice(-1)[0];
    if (!last) return;
    // Radar data only exists at low zooms — 512px tiles + maxNativeZoom make
    // Leaflet upscale real radar instead of showing placeholder tiles.
    const url = `${d.host}${last.path}/512/{z}/{x}/{y}/2/1_1.png`;
    if (radarLayer) radarLayer.setUrl(url);
    else radarLayer = L.tileLayer(url, {
      opacity: 0.5, tileSize: 512, zoomOffset: -1, maxNativeZoom: 8,
      attribution: 'rain © RainViewer',
    }).addTo(map);
  } catch {}
}

async function windRefresh() {
  if (!here || !wxLayer) return;

  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((here.lat * Math.PI) / 180));
  // centre + N/S/E/W at 0.65R — a full grid crowds the map with pills
  const pts = [[0, 0], [-0.65, 0], [0.65, 0], [0, -0.65], [0, 0.65]]
    .map(([fy, fx]) => [here.lat + fy * dLat, here.lon + fx * dLon]);
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${pts.map((p) => p[0].toFixed(3)).join(',')}` +
      `&longitude=${pts.map((p) => p[1].toFixed(3)).join(',')}` +
      '&current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timezone=UTC';
    const r = await fetch(url);
    if (!r.ok) return;
    let d = await r.json();
    if (!wxOn) return; // toggled off while the fetch was in flight
    if (!Array.isArray(d)) d = [d];
    wxLayer.clearLayers();
    d.forEach((f, i) => {
      const c = f.current;
      if (!c || !pts[i]) return;
      // wind_direction is where the wind comes FROM; point the arrow downwind
      const html =
        `<div class="wxwrap"><div class="wx">` +
        `<svg class="wxa" viewBox="0 0 24 24" style="transform:rotate(${(c.wind_direction_10m + 180) % 360}deg)">` +
        `<path d="M12 3 L17.5 14 L12 11.2 L6.5 14 Z" fill="#8ed0ff"/></svg>` +
        `<span>${Math.round(c.wind_speed_10m)}<small>kn</small>${Math.round(c.temperature_2m)}<small>°C</small></span>` +
        `</div></div>`;
      L.marker(pts[i], {
        icon: L.divIcon({ className: '', html, iconSize: [110, 26], iconAnchor: [55, 44] }),
        interactive: false,
      }).addTo(wxLayer);
    });
  } catch {}
}

function setWeather(on) {
  wxOn = on;
  localStorage.setItem('wx_on', on ? '1' : '0');
  document.getElementById('wx').classList.toggle('on', on);
  if (on) {
    if (!wxLayer) wxLayer = L.layerGroup().addTo(map);
    radarRefresh();
    windRefresh();
    if (!wxTimer) wxTimer = setInterval(() => { if (wxOn) { radarRefresh(); windRefresh(); } }, 10 * 60 * 1000);
  } else {
    if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
    if (wxLayer) wxLayer.clearLayers();
  }
}

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
  if (wxOn) windRefresh();
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
}

const zoomFor = (km) => (km <= 5 ? 13 : km <= 10 ? 12 : km <= 20 ? 11 : 9);

function setRadius(km) {
  radiusKm = km;
  ring.setRadius(km * 1000);
  aisSubscribe();
  if (wxOn) windRefresh();
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

  const pinIcon = L.divIcon({
    className: '',
    html: '<div class="youpin"><svg viewBox="0 0 24 36" width="24" height="36">' +
      '<path d="M12 0 C5.4 0 0 5.4 0 12 c0 8.6 12 24 12 24 s12 -15.4 12 -24 C24 5.4 18.6 0 12 0 Z" fill="#ff5470" stroke="#fff" stroke-width="1.6"/>' +
      '<circle cx="12" cy="11.6" r="4.2" fill="#fff"/></svg></div>',
    iconSize: [24, 36], iconAnchor: [12, 35],
  });
  youMarker = L.marker(FALLBACK, { icon: pinIcon })
    .addTo(map)
    .bindTooltip('search centre — tap the map to move', { direction: 'top', offset: [0, -32] });
  ring = L.circle(FALLBACK, { radius: radiusKm * 1000, color: '#4ea8ff', fill: false, opacity: .35 }).addTo(map);

  // Drop a pin: tap/click anywhere to search around that point.
  map.on('click', (ev) => setLocation(ev.latlng.lat, ev.latlng.lng));

  document.getElementById('locate').addEventListener('click', locate);
  document.getElementById('aiskey').addEventListener('click', setAisKey);
  document.getElementById('wx').addEventListener('click', () => setWeather(!wxOn));
  radiusEl.addEventListener('change', () => setRadius(parseFloat(radiusEl.value)));
  if (wxOn) setWeather(true);

  statusEl.textContent = 'locating… (or tap the map to pick a spot)';
  locate();
}

init();
