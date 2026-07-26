const POLL_MS = 12000;
const FALLBACK = [51.5074, -0.1278]; // London — used until we have a real spot
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const radiusEl = document.getElementById('radius');

let map, youMarker, ring, layer;
// which vehicle feeds are on — toggled from the ☰ menu (overlays.js)
const VEH_KEY = 'vehicles';
const show = Object.assign({ air: true, ogn: true, sea: true },
  JSON.parse(localStorage.getItem(VEH_KEY) || '{}'));
function setVehicle(k, on) {
  show[k] = on;
  localStorage.setItem(VEH_KEY, JSON.stringify(show));
  refresh();
}

// Default pin, set from the 🏠 popover in overlays.js. When one is saved it
// wins over geolocation at startup: GPS is slow to fix and wrong indoors, and
// this app is usually pointed at one favourite spot. 📍 still overrides.
const HOME_KEY = 'home';
function savedHome() {
  try {
    const h = JSON.parse(localStorage.getItem(HOME_KEY) || 'null');
    return h && Number.isFinite(h.lat) && Number.isFinite(h.lon) ? h : null;
  } catch { return null; }
}
function setHome(h) {
  if (h) localStorage.setItem(HOME_KEY, JSON.stringify(h));
  else localStorage.removeItem(HOME_KEY);
}
// Guidance that must outlive refresh(), which rewrites #status every poll.
let locHint = '';
let pollTimer = null;
let here = null; // { lat, lon } current search centre
let radiusKm = 20;
const markers = new Map(); // id -> Leaflet marker

// Colour per vehicle class; anything airborne we don't recognise falls back to plane-blue.
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

const fmtAlt = (e) =>
  e.ground ? 'on ground'
    : e.alt != null ? `${Math.round(e.alt / 0.3048).toLocaleString()} ft (${Math.round(e.alt)} m)` : '';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const age = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

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

const pick = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
const errOf = (r) => (r.status === 'rejected' ? String(r.reason) : r.value && r.value.error) || null;

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

async function refresh() {
  if (!here) return;
  const { lat, lon } = here;
  const q = `lat=${lat}&lon=${lon}&radiusKm=${radiusKm}`;
  const [air, ogn, sea] = await Promise.allSettled([
    show.air ? fetch(`/api/aircraft?${q}`).then((r) => r.json()) : Promise.resolve([]),
    show.ogn ? fetch(`/api/gliders?${q}`).then((r) => r.json()) : Promise.resolve([]),
    show.sea ? fetch(`/api/vessels?${q}`).then((r) => r.json()) : Promise.resolve([]),
  ]);

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
  for (const e of pick(sea)) byId.set(e.id, e);

  // The APIs search a box/wider circle — clip to the ring we actually show.
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
  const seaErr = show.sea && errOf(sea);
  const notes = [];
  if (locHint) notes.push(locHint);
  if (show.air && errOf(air) && (!show.ogn || errOf(ogn))) notes.push('air feeds down');
  if (seaErr) notes.push(seaErr.includes('AISSTREAM_API_KEY') ? 'sea off (no API key)' : 'sea feed down');
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
  if (wxOn) windRefresh();
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
}

const zoomFor = (km) => (km <= 5 ? 13 : km <= 10 ? 12 : km <= 20 ? 11 : 9);

function setRadius(km) {
  radiusKm = km;
  ring.setRadius(km * 1000);
  if (wxOn) windRefresh();
  if (here) { map.setView([here.lat, here.lon], zoomFor(km)); refresh(); }
}

async function locate(byTap = false) {
  if (!navigator.geolocation) {
    statusEl.textContent = 'no geolocation — tap the map to pick a spot';
    if (!here) setLocation(...FALLBACK, true);
    return;
  }
  // Chrome suppresses permission prompts that aren't tied to a user gesture,
  // and in an installed PWA that means the dialog silently never appears —
  // the app just looks blocked. So on a cold start only auto-locate when
  // permission already exists; otherwise wait for a real tap on 📍.
  if (!byTap && navigator.permissions) {
    let state = null;
    try { state = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
    if (state === 'prompt' || state === 'denied') {
      locHint = state === 'denied'
        ? 'location blocked — allow it in app settings'
        : 'tap 📍 to use your location';
      statusEl.textContent = locHint;
      if (!here) setLocation(...FALLBACK, true);
      return;
    }
  }
  statusEl.textContent = 'locating…';
  navigator.geolocation.getCurrentPosition(
    (p) => { locHint = ''; setLocation(p.coords.latitude, p.coords.longitude, true); },
    (err) => {
      locHint = err.code === 1
        ? 'location blocked — allow it in app settings (Android: long-press the icon → App info → Permissions)'
        : 'location unavailable — tap the map to pick a spot';
      statusEl.textContent = locHint;
      if (!here) setLocation(...FALLBACK, true); // show *something* so it's not a blank map
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function init() {
  map = L.map('map').setView(FALLBACK, zoomFor(radiusKm));
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
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

  document.getElementById('locate').addEventListener('click', () => locate(true));
  document.getElementById('wx').addEventListener('click', () => setWeather(!wxOn));
  radiusEl.addEventListener('change', () => setRadius(parseFloat(radiusEl.value)));
  if (wxOn) setWeather(true);

  const home = savedHome();
  if (home) {
    statusEl.textContent = `${home.label || 'default pin'} · loading…`;
    setLocation(home.lat, home.lon, true);
  } else {
    statusEl.textContent = 'locating… (or tap the map to pick a spot)';
    locate();
  }
}

init();
