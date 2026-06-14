// OpenSky /states/all returns arrays. Index map:
// 0 icao24, 1 callsign, 5 lon, 6 lat, 7 baro_alt, 8 on_ground,
// 9 velocity(m/s), 10 true_track(deg), 13 geo_alt
export function normalizeAircraft(s) {
  if (s[5] == null || s[6] == null) return null; // no position fix
  return {
    id: s[0],
    kind: 'air',
    lat: s[6],
    lon: s[5],
    alt: s[13] ?? s[7] ?? null,
    heading: s[10] ?? null,
    speed: s[9] != null ? s[9] * 1.94384 : null, // m/s → knots
    name: (s[1] || '').trim() || s[0],
    ts: (s[4] ?? Math.floor(Date.now() / 1000)) * 1000,
    raw: s,
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
    lat,
    lon,
    alt: 0,
    heading,
    speed: p.Sog ?? null, // already knots
    name: (m.ShipName || '').trim() || String(m.MMSI),
    ts: m.time_utc ? Date.parse(m.time_utc) : Date.now(),
    raw: msg,
  };
}
