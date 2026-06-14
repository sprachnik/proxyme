const AIR_KM = 50, SEA_KM = 25, POLL_MS = 10000;
const statusEl = document.getElementById('status');

let map, youMarker, layer;
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

async function refresh(lat, lon) {
  const q = (km) => `lat=${lat}&lon=${lon}&radiusKm=${km}`;
  const [air, sea] = await Promise.allSettled([
    fetch(`/api/aircraft?${q(AIR_KM)}`).then((r) => r.json()),
    fetch(`/api/vessels?${q(SEA_KM)}`).then((r) => r.json()),
  ]);

  markers.forEach((m) => (m._fresh = false));
  const entities = []
    .concat(Array.isArray(air.value) ? air.value : [])
    .concat(Array.isArray(sea.value) ? sea.value : []);
  entities.forEach(upsert);

  // drop stale markers
  for (const [id, m] of markers) {
    if (!m._fresh) { layer.removeLayer(m); markers.delete(id); }
  }
  statusEl.textContent = `${entities.length} nearby · ${new Date().toLocaleTimeString()}`;
}

function start(lat, lon) {
  map = L.map('map').setView([lat, lon], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
  youMarker = L.circleMarker([lat, lon], { radius: 6, color: '#fff', fillColor: '#ff5470', fillOpacity: 1 }).addTo(map);
  L.circle([lat, lon], { radius: SEA_KM * 1000, color: '#2fd6c2', fill: false, opacity: .3 }).addTo(map);
  L.circle([lat, lon], { radius: AIR_KM * 1000, color: '#4ea8ff', fill: false, opacity: .3 }).addTo(map);

  refresh(lat, lon);
  setInterval(() => refresh(lat, lon), POLL_MS);
}

navigator.geolocation.getCurrentPosition(
  (p) => start(p.coords.latitude, p.coords.longitude),
  () => { statusEl.textContent = 'location denied — using London'; start(51.5074, -0.1278); },
  { enableHighAccuracy: true, timeout: 8000 }
);
