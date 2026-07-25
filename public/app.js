const POLL_MS = 12000;
const FALLBACK = [51.5074, -0.1278]; // London — used until we have a real spot
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const radiusEl = document.getElementById('radius');

let map, youMarker, ring, layer;
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const age = (ts) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 90 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

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
    fetch(`/api/aircraft?${q}`).then((r) => r.json()),
    fetch(`/api/gliders?${q}`).then((r) => r.json()),
    fetch(`/api/vessels?${q}`).then((r) => r.json()),
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
  const seaErr = errOf(sea);
  const notes = [];
  if (errOf(air) && errOf(ogn)) notes.push('air feeds down');
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
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
}

const zoomFor = (km) => (km <= 5 ? 13 : km <= 10 ? 12 : km <= 20 ? 11 : 9);

function setRadius(km) {
  radiusKm = km;
  ring.setRadius(km * 1000);
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
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);

  youMarker = L.circleMarker(FALLBACK, { radius: 6, color: '#fff', fillColor: '#ff5470', fillOpacity: 1 })
    .addTo(map)
    .bindTooltip('search centre — tap the map to move', { direction: 'top', offset: [0, -6] });
  ring = L.circle(FALLBACK, { radius: radiusKm * 1000, color: '#4ea8ff', fill: false, opacity: .35 }).addTo(map);

  // Drop a pin: tap/click anywhere to search around that point.
  map.on('click', (ev) => setLocation(ev.latlng.lat, ev.latlng.lng));

  document.getElementById('locate').addEventListener('click', locate);
  radiusEl.addEventListener('change', () => setRadius(parseFloat(radiusEl.value)));

  statusEl.textContent = 'locating… (or tap the map to pick a spot)';
  locate();
}

init();
