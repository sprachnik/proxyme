// All sources normalise to one shape:
// { id, kind: 'air'|'sea', sub, lat, lon, alt(m), ground, heading, speed(kn),
//   name, reg, model, src, ts }

// ADS-B emitter category → rough vehicle class.
const CATEGORY_SUB = {
  A1: 'light', A2: 'light', A7: 'heli',
  B1: 'glider', B2: 'balloon', B4: 'ultralight', B6: 'drone',
};

// adsb.lol / adsb.fi / airplanes.live aircraft object (readsb schema).
export function normalizeAdsb(ac) {
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

// OGN device type codes (live.glidernet.org lxml field 10).
const OGN_TYPES = {
  1: 'glider', 2: 'towplane', 3: 'heli', 4: 'parachute', 5: 'dropplane',
  6: 'hangglider', 7: 'paraglider', 8: 'light', 9: 'plane',
  11: 'balloon', 12: 'airship', 13: 'drone',
};

// One <m a="..."/> marker from live.glidernet.org, already split on commas:
// 0 lat, 1 lon, 2 CN, 3 registration, 4 alt(m), 5 hh:mm:ss UTC, 6 age(s),
// 7 track, 8 speed(km/h), 9 climb(m/s), 10 type, 11 receiver, 12 hex, 13 uid
export function normalizeOgn(f) {
  const lat = parseFloat(f[0]);
  const lon = parseFloat(f[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const age = parseInt(f[6], 10) || 0;
  if (age > 600) return null; // fix too old to plot
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
    ts: Date.now() - age * 1000,
  };
}

// AISStream PositionReport. lat/lon + MMSI + ShipName live on MetaData;
// Cog/Sog/TrueHeading on Message.PositionReport.
export function normalizeVessel(msg) {
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
    speed: p.Sog ?? null, // already knots
    name: (m.ShipName || '').trim() || String(m.MMSI),
    reg: null,
    model: null,
    src: 'AIS',
    ts: m.time_utc ? Date.parse(m.time_utc) : Date.now(),
  };
}
