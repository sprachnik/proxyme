// Harvest NASA FIRMS active-fire detections (last 24 h) over the British
// Isles into data/fires.min.json — [[lat, lon, frpMW, tsMinutes], …].
// Keyless: reads the public regional CSVs, not the keyed area API. Run by
// .github/workflows/fires.yml every 6 h; writes both build copies directly.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BOX = { latMin: 49, latMax: 61.5, lonMin: -11.5, lonMax: 3 }; // UK + Ireland
const FEEDS = [
  'suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv',
  'noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv',
  'noaa-21-viirs-c2/csv/J2_VIIRS_C2_Europe_24h.csv',
  'modis-c6.1/csv/MODIS_C6_1_Europe_24h.csv',
];

const rows = [];
let okFeeds = 0;
for (const path of FEEDS) {
  let text;
  try {
    const r = await fetch(`https://firms.modaps.eosdis.nasa.gov/data/active_fire/${path}`,
      { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    text = await r.text();
  } catch (e) {
    console.error(`  skip  ${path} (${e.message})`); // a partial harvest is fine
    continue;
  }
  okFeeds++;
  const lines = text.trim().split('\n');
  const col = Object.fromEntries(lines[0].split(',').map((h, i) => [h, i]));
  for (const line of lines.slice(1)) {
    const f = line.split(',');
    const lat = +f[col.latitude], lon = +f[col.longitude];
    if (!(lat >= BOX.latMin && lat <= BOX.latMax && lon >= BOX.lonMin && lon <= BOX.lonMax)) continue;
    // drop low-confidence pixels (sun glint etc.) — VIIRS flags words, MODIS 0-100
    const conf = f[col.confidence];
    if (conf === 'l' || conf === 'low' || (/^\d+$/.test(conf) && +conf < 30)) continue;
    const frp = +f[col.frp];
    const hhmm = f[col.acq_time].padStart(4, '0');
    const ts = Date.parse(`${f[col.acq_date]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`);
    if (!Number.isFinite(frp) || !Number.isFinite(ts)) continue;
    rows.push([+lat.toFixed(4), +lon.toFixed(4), +frp.toFixed(1), Math.round(ts / 60000)]);
  }
  console.log(`  ok    ${path}`);
}
if (!okFeeds) {
  console.error('all feeds unreachable — keeping the previous harvest');
  process.exit(1);
}

// deterministic order + exact-duplicate drop, so commit-only-on-change works
rows.sort((a, b) => a[3] - b[3] || a[0] - b[0] || a[1] - b[1]);
const uniq = rows.filter((r, i) => i === 0 || JSON.stringify(r) !== JSON.stringify(rows[i - 1]));
const out = JSON.stringify(uniq);
for (const dir of ['docs', 'public']) writeFileSync(join(root, dir, 'data', 'fires.min.json'), out);
console.log(`${uniq.length} detections → data/fires.min.json (${out.length} bytes)`);
