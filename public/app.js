const AIR_KM = 50, SEA_KM = 25, POLL_MS = 10000;
const FALLBACK = [51.5074, -0.1278]; // London — used until we have a real spot
const statusEl = document.getElementById('status');

let map, youMarker, seaRing, airRing, layer;
let pollTimer = null;
let here = null; // { lat, lon } current search centre
const markers = new Map(); // id -> Leaflet marker

function icon(kind, heading) {
  return L.divIcon({
    className: '',
    html: `<div class="blip ${kind === 'sea' ? 'sea' : ''}" style="transform:rotate(${heading ?? 0}deg)"></div>`,
    iconSize: [12, 14], iconAnchor: [6, 10],
  });
}

function upsert(e) {
  const m = markers.get(e.id);
  const ll = [e.lat, e.lon];
  const popup =
    `<b>${e.name}</b><br>${e.kind === 'air' ? 'aircraft' : 'vessel'}` +
    `${e.speed != null ? `<br>${Math.round(e.speed)} kn` : ''}` +
    `${e.alt ? `<br>${Math.round(e.alt)} m` : ''}`;
  if (m) {
    m.setLatLng(ll).setIcon(icon(e.kind, e.heading)).bindPopup(popup);
  } else {
    const nm = L.marker(ll, { icon: icon(e.kind, e.heading) }).bindPopup(popup).addTo(layer);
    nm._kind = e.kind;
    markers.set(e.id, nm);
  }
  e._fresh = true;
}

const pick = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
const failed = (r) => r.status === 'rejected' || (r.value && r.value.error);

async function refresh() {
  if (!here) return;
  const { lat, lon } = here;
  const q = (km) => `lat=${lat}&lon=${lon}&radiusKm=${km}`;
  const [air, sea] = await Promise.allSettled([
    fetch(`/api/aircraft?${q(AIR_KM)}`).then((r) => r.json()),
    fetch(`/api/vessels?${q(SEA_KM)}`).then((r) => r.json()),
  ]);

  markers.forEach((m) => (m._fresh = false));
  const entities = [].concat(pick(air), pick(sea));
  entities.forEach(upsert);

  // drop stale markers
  for (const [id, m] of markers) {
    if (!m._fresh) { layer.removeLayer(m); markers.delete(id); }
  }

  const down = [failed(air) && 'air', failed(sea) && 'sea'].filter(Boolean);
  statusEl.textContent =
    `${entities.length} nearby · ${new Date().toLocaleTimeString()}` +
    (down.length ? ` · ${down.join(' & ')} feed unavailable` : '');
}

// Move the search centre. Called by geolocation and by tapping the map.
function setLocation(lat, lon, recenter = false) {
  here = { lat, lon };
  const ll = [lat, lon];
  youMarker.setLatLng(ll);
  seaRing.setLatLng(ll);
  airRing.setLatLng(ll);
  if (recenter) map.setView(ll, map.getZoom());
  refresh();
  if (!pollTimer) pollTimer = setInterval(refresh, POLL_MS);
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
  map = L.map('map').setView(FALLBACK, 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);

  youMarker = L.circleMarker(FALLBACK, { radius: 6, color: '#fff', fillColor: '#ff5470', fillOpacity: 1 })
    .addTo(map)
    .bindTooltip('search centre — tap the map to move', { direction: 'top', offset: [0, -6] });
  seaRing = L.circle(FALLBACK, { radius: SEA_KM * 1000, color: '#2fd6c2', fill: false, opacity: .3 }).addTo(map);
  airRing = L.circle(FALLBACK, { radius: AIR_KM * 1000, color: '#4ea8ff', fill: false, opacity: .3 }).addTo(map);

  // Drop a pin: tap/click anywhere to search around that point.
  map.on('click', (ev) => setLocation(ev.latlng.lat, ev.latlng.lng));

  document.getElementById('locate').addEventListener('click', locate);

  statusEl.textContent = 'locating… (or tap the map to pick a spot)';
  locate();
}

init();
