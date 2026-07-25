// proxme overlays — satellites overhead, sea state, air & pollen, sun & moon,
// earthquakes. All keyless client-side feeds (CelesTrak, Open-Meteo, USGS) or
// pure astronomy math. Loaded after app.js and shares its top-level bindings
// (map, here, radiusKm, KM) via the page's global lexical scope; wrapped in an
// IIFE so nothing here collides with app.js declarations.
(() => {
  const RAD = Math.PI / 180;
  const OV_KEY = 'overlays';
  const st = Object.assign(
    { sat: false, marine: false, air: false, sun: false, quake: false },
    JSON.parse(localStorage.getItem(OV_KEY) || '{}')
  );
  const save = () => localStorage.setItem(OV_KEY, JSON.stringify(st));
  const H = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtT = (d) => (d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
  const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const inMin = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const dest = (lat, lon, brgDeg, dKm) => {
    const R = 6371, br = brgDeg * RAD, la1 = lat * RAD, lo1 = lon * RAD, dr = dKm / R;
    const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(br));
    const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la1), Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
    return [la2 / RAD, lo2 / RAD];
  };

  /* ============ compact sun/moon astronomy (suncalc-derived) ============ */
  const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545, e = 23.4397 * RAD;
  const toDays = (d) => d.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const rightAsc = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const decl = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const azimuth = (Hr, phi, dec) => Math.atan2(Math.sin(Hr), Math.cos(Hr) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const altitude = (Hr, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(Hr));
  const sidereal = (d, lw) => RAD * (280.16 + 360.9856235 * d) - lw;
  const solarM = (d) => RAD * (357.5291 + 0.98560028 * d);
  const eclipticL = (M) => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
  const sunCoords = (d) => { const M = solarM(d), Le = eclipticL(M); return { dec: decl(Le, 0), ra: rightAsc(Le, 0) }; };

  function sunPos(date, lat, lng) {
    const lw = -lng * RAD, phi = lat * RAD, d = toDays(date), c = sunCoords(d), Hr = sidereal(d, lw) - c.ra;
    return { az: azimuth(Hr, phi, c.dec) / RAD + 180, alt: altitude(Hr, phi, c.dec) / RAD };
  }

  function sunTimes(date, lat, lng) {
    const lw = -lng * RAD, phi = lat * RAD, d = toDays(date);
    const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    const ds = 0.0009 + lw / (2 * Math.PI) + n;
    const M = solarM(ds), Le = eclipticL(M), dec = decl(Le, 0);
    const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * Le);
    const at = (ang) => {
      const cosH = (Math.sin(ang * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (cosH < -1 || cosH > 1) return {}; // polar day/night
      const w = Math.acos(cosH);
      const Jset = J2000 + 0.0009 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * Le);
      return { rise: fromJulian(Jnoon - (Jset - Jnoon)), set: fromJulian(Jset) };
    };
    const s = at(-0.833), g = at(6);
    return { sunrise: s.rise, sunset: s.set, goldenStart: g.set, goldenEnd: g.rise };
  }

  const moonCoords = (d) => {
    const Lm = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
    const l = Lm + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
    return { ra: rightAsc(l, b), dec: decl(l, b), dist: dt };
  };
  function moonPos(date, lat, lng) {
    const lw = -lng * RAD, phi = lat * RAD, d = toDays(date), c = moonCoords(d), Hr = sidereal(d, lw) - c.ra;
    return { az: azimuth(Hr, phi, c.dec) / RAD + 180, alt: altitude(Hr, phi, c.dec) / RAD };
  }
  function moonIllum(date) {
    const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra),
      Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI };
  }
  const PHASES = [
    [0.03, '🌑 new moon'], [0.22, '🌒 waxing crescent'], [0.28, '🌓 first quarter'],
    [0.47, '🌔 waxing gibbous'], [0.53, '🌕 full moon'], [0.72, '🌖 waning gibbous'],
    [0.78, '🌗 last quarter'], [0.97, '🌘 waning crescent'], [1.01, '🌑 new moon'],
  ];
  const phaseName = (p) => PHASES.find(([lim]) => p < lim)[1];

  // Low-precision sun position in ECI km (Vallado) — for the satellite
  // Earth-shadow test.
  function sunEci(date) {
    const t = (date.valueOf() / dayMs - 0.5 + J1970 - J2000) / 36525;
    const M = ((357.5291092 + 35999.05034 * t) % 360) * RAD;
    const Ls = (280.46 + 36000.771 * t) % 360;
    const lam = (Ls + 1.914666471 * Math.sin(M) + 0.019994643 * Math.sin(2 * M)) * RAD;
    const eps = (23.439291 - 0.0130042 * t) * RAD;
    const r = (1.000140612 - 0.016708617 * Math.cos(M) - 0.000139589 * Math.cos(2 * M)) * 149597870.7;
    return { x: r * Math.cos(lam), y: r * Math.cos(eps) * Math.sin(lam), z: r * Math.sin(eps) * Math.sin(lam) };
  }

  /* ============ UI: layers menu + card dock ============ */
  const wxBtn = document.getElementById('wx');
  wxBtn.insertAdjacentHTML('afterend', `
    <span id="layersWrap">
      <button id="layersBtn" type="button" title="More overlays">☰</button>
      <div id="layersMenu" hidden>
        <label><input type="checkbox" data-l="sat"> 🛰 satellites overhead</label>
        <label><input type="checkbox" data-l="marine"> 🌊 sea state</label>
        <label><input type="checkbox" data-l="air"> 🌿 air &amp; pollen</label>
        <label><input type="checkbox" data-l="sun"> 🌗 sun &amp; moon</label>
        <label><input type="checkbox" data-l="quake"> 🌍 earthquakes</label>
      </div>
    </span>`);
  const menu = document.getElementById('layersMenu');
  document.getElementById('layersBtn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('#layersWrap')) menu.hidden = true;
  });

  const dock = document.createElement('div');
  dock.id = 'ovcards';
  document.body.appendChild(dock);
  function card(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'ovcard'; dock.appendChild(el); }
    return el;
  }
  const dropCard = (id) => document.getElementById(id)?.remove();

  /* ============ 1. satellites overhead ============ */
  const SAT_ELEV_DEG = 20;
  let satRecs = null, satGroup = null, satTimer = null;
  const satMarkers = new Map();

  const loadSatLib = () => window.satellite ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js';
    s.onload = res; s.onerror = () => rej(new Error('satellite.js failed to load'));
    document.head.appendChild(s);
  });

  async function loadTles() {
    const KEY = 'tle_cache';
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && Date.now() - c.ts < 6 * 3600 * 1000) return c.text;
    } catch {}
    let text = '';
    for (const grp of ['visual', 'stations']) {
      const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${grp}&FORMAT=tle`);
      if (r.ok) text += await r.text() + '\n';
    }
    if (!text) throw new Error('CelesTrak unreachable');
    try { localStorage.setItem(KEY, JSON.stringify({ ts: Date.now(), text })); } catch {}
    return text;
  }

  function parseTles(text) {
    const sat = window.satellite, lines = text.split(/\r?\n/), out = new Map();
    for (let i = 0; i + 2 < lines.length; i++) {
      if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
        try {
          const rec = sat.twoline2satrec(lines[i + 1], lines[i + 2]);
          out.set(String(rec.satnum), { name: lines[i].trim(), rec });
        } catch {}
        i += 2;
      }
    }
    return [...out.values()];
  }

  const satIcon = (visible) => L.divIcon({
    className: '',
    html: `<div class="satic${visible ? ' vis' : ''}"><svg viewBox="0 0 24 24" width="20" height="20">
      <rect x="9" y="9" width="6" height="6" rx="1"/>
      <rect x="1" y="10" width="6" height="4" rx="1"/><rect x="17" y="10" width="6" height="4" rx="1"/>
      </svg></div>`,
    iconSize: [20, 20], iconAnchor: [10, 10],
  });

  function satTick() {
    if (!here || !satRecs || !window.satellite) return;
    const sat = window.satellite, now = new Date(), gmst = sat.gstime(now);
    const obs = { latitude: here.lat * RAD, longitude: here.lon * RAD, height: 0 };
    const s = sunEci(now), smag = Math.hypot(s.x, s.y, s.z);
    const sh = { x: s.x / smag, y: s.y / smag, z: s.z / smag };
    const darkHere = sunPos(now, here.lat, here.lon).alt < -6;
    const fresh = new Set();
    for (const { name, rec } of satRecs) {
      let pv;
      try { pv = sat.propagate(rec, now); } catch { continue; }
      if (!pv?.position) continue;
      const la = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, gmst));
      if (la.elevation < SAT_ELEV_DEG * RAD) continue;
      const gd = sat.eciToGeodetic(pv.position, gmst);
      const p = pv.position, dot = p.x * sh.x + p.y * sh.y + p.z * sh.z;
      const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
      const sunlit = dot > 0 || Math.sqrt(Math.max(0, r2 - dot * dot)) > 6371;
      const visible = sunlit && darkHere;
      const id = String(rec.satnum);
      const ll = [sat.degreesLat(gd.latitude), sat.degreesLong(gd.longitude)];
      const popup =
        `<b>${H(name)}</b> <span class="sub">satellite</span><br>` +
        `${Math.round(gd.height)} km up · ${Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z).toFixed(1)} km/s<br>` +
        `elev ${Math.round(la.elevation / RAD)}° · look ${compass(la.azimuth / RAD)}<br>` +
        (visible ? '👁 sunlit in a dark sky — look up!' : sunlit ? 'sunlit, but your sky is too bright' : 'in Earth\'s shadow') + '<br>' +
        `<span class="links"><a href="https://www.n2yo.com/satellite/?s=${id}" target="_blank" rel="noopener">n2yo</a> · ` +
        `<a href="https://heavens-above.com/satinfo.aspx?satid=${id}" target="_blank" rel="noopener">heavens-above</a></span>`;
      const m = satMarkers.get(id);
      if (m) m.setLatLng(ll).setIcon(satIcon(visible)).bindPopup(popup);
      else satMarkers.set(id, L.marker(ll, { icon: satIcon(visible) }).bindPopup(popup).addTo(satGroup));
      fresh.add(id);
    }
    for (const [id, m] of satMarkers) {
      if (!fresh.has(id)) { satGroup.removeLayer(m); satMarkers.delete(id); }
    }

    // A satellite 20° up is hundreds of km away on the ground — its marker
    // is off-screen at ring zoom. The card is the primary UI; tap to fly out.
    const rows = [...fresh].map((id) => {
      const m = satMarkers.get(id);
      const t = m.getPopup().getContent();
      const name = t.match(/<b>(.*?)<\/b>/)[1];
      const look = t.match(/elev (\d+)° · look (\w+)/) || [];
      const vis = t.includes('look up!');
      return `<div class="r satrow" data-sat="${id}"><span>🛰 ${name}</span>` +
        `<span>${look[2] || ''} ${look[1] || ''}°${vis ? ' 👁' : ''}</span></div>`;
    });
    const el = card('ovc-sat');
    el.innerHTML = '<h4>🛰 satellites overhead</h4>' +
      (rows.length ? rows.join('') : `<div>none above ${SAT_ELEV_DEG}° right now</div>`);
    el.onclick = (ev) => {
      const row = ev.target.closest('.satrow');
      const m = row && satMarkers.get(row.dataset.sat);
      if (m) { map.flyTo(m.getLatLng(), 7); m.openPopup(); }
    };
  }

  async function satOn() {
    satGroup = satGroup || L.layerGroup().addTo(map);
    try {
      await loadSatLib();
      satRecs = satRecs || parseTles(await loadTles());
      satTick();
      satTimer = setInterval(satTick, 5000);
    } catch (err) {
      card('ovc-sat').innerHTML = `<h4>satellites</h4><div>${H(err.message)}</div>`;
    }
  }
  function satOff() {
    clearInterval(satTimer); satTimer = null;
    satMarkers.clear(); satGroup?.clearLayers(); dropCard('ovc-sat');
  }

  /* ============ 2. sea state (Open-Meteo Marine) ============ */
  let marineGroup = null, marineTimer = null;

  async function marineRefresh() {
    if (!here || !marineGroup) return;
    const dLat = radiusKm / 111, dLon = radiusKm / (111 * Math.cos(here.lat * RAD));
    const pts = [[0, 0], [-0.75, 0], [0.75, 0], [0, -0.75], [0, 0.75]]
      .map(([fy, fx]) => [here.lat + fy * dLat, here.lon + fx * dLon]);
    try {
      const url = 'https://marine-api.open-meteo.com/v1/marine' +
        `?latitude=${pts.map((p) => p[0].toFixed(3)).join(',')}` +
        `&longitude=${pts.map((p) => p[1].toFixed(3)).join(',')}` +
        '&current=wave_height,wave_direction,wave_period,sea_surface_temperature&timezone=UTC';
      const r = await fetch(url);
      if (!r.ok) return;
      let d = await r.json();
      if (!Array.isArray(d)) d = [d];
      marineGroup.clearLayers();
      let any = false;
      d.forEach((f, i) => {
        const c = f.current;
        if (!c || c.wave_height == null || !pts[i]) return;
        any = true;
        const bits = [`${c.wave_height.toFixed(1)}<small>m</small>`];
        if (c.wave_period != null) bits.push(`${Math.round(c.wave_period)}<small>s</small>`);
        if (c.sea_surface_temperature != null) bits.push(`${Math.round(c.sea_surface_temperature)}<small>°C</small>`);
        const rot = c.wave_direction != null ? (c.wave_direction + 180) % 360 : 0;
        const html =
          `<div class="wxwrap"><div class="wx sea">` +
          `<svg class="wxa" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)"><path d="M12 3 L17.5 14 L12 11.2 L6.5 14 Z" fill="#6fe3d2"/></svg>` +
          `<span>${bits.join('')}</span></div></div>`;
        L.marker(pts[i], {
          icon: L.divIcon({ className: '', html, iconSize: [110, 26], iconAnchor: [55, 13] }),
          interactive: false,
        }).addTo(marineGroup);
      });
      if (any) dropCard('ovc-marine');
      else card('ovc-marine').innerHTML = '<h4>🌊 sea state</h4><div>no sea within the ring</div>';
    } catch {}
  }
  function marineOn() {
    marineGroup = marineGroup || L.layerGroup().addTo(map);
    marineRefresh();
    marineTimer = setInterval(marineRefresh, 15 * 60 * 1000);
  }
  function marineOff() {
    clearInterval(marineTimer); marineTimer = null;
    marineGroup?.clearLayers(); dropCard('ovc-marine');
  }

  /* ============ 3. air quality, UV & pollen (Open-Meteo AQ) ============ */
  let airTimer = null;
  const AQI_BANDS = [
    [20, 'good', '#6fe3a1'], [40, 'fair', '#c9e36f'], [60, 'moderate', '#f0e641'],
    [80, 'poor', '#ffa050'], [100, 'very poor', '#ff5050'], [1e9, 'extreme', '#b04aff'],
  ];
  const UV_WORD = (u) => (u < 3 ? 'low' : u < 6 ? 'moderate' : u < 8 ? 'high' : u < 11 ? 'very high' : 'extreme');
  const pollenWord = (v, lo, hi) => (v < lo ? 'low' : v < hi ? 'moderate' : 'high');

  async function airRefresh() {
    if (!here) return;
    try {
      const url = 'https://air-quality-api.open-meteo.com/v1/air-quality' +
        `?latitude=${here.lat.toFixed(3)}&longitude=${here.lon.toFixed(3)}` +
        '&current=european_aqi,pm2_5,pm10,ozone,uv_index,grass_pollen,birch_pollen,ragweed_pollen&timezone=UTC';
      const r = await fetch(url);
      if (!r.ok) return;
      const c = (await r.json()).current;
      if (!c) return;
      const rows = [];
      if (c.european_aqi != null) {
        const [, word, colr] = AQI_BANDS.find(([lim]) => c.european_aqi <= lim);
        rows.push(`<div class="r"><span>air quality</span><span class="aqi" style="background:${colr}">${Math.round(c.european_aqi)} ${word}</span></div>`);
      }
      if (c.pm2_5 != null) rows.push(`<div class="r"><span>PM2.5</span><span>${c.pm2_5.toFixed(1)} µg/m³</span></div>`);
      if (c.uv_index != null) rows.push(`<div class="r"><span>UV</span><span>${c.uv_index.toFixed(1)} · ${UV_WORD(c.uv_index)}</span></div>`);
      const pol = [
        ['grass', c.grass_pollen, 30, 60], ['birch', c.birch_pollen, 90, 180], ['ragweed', c.ragweed_pollen, 10, 50],
      ].filter(([, v]) => v != null && v > 0);
      for (const [nm, v, lo, hi] of pol) rows.push(`<div class="r"><span>${nm} pollen</span><span>${pollenWord(v, lo, hi)} (${Math.round(v)})</span></div>`);
      if (!pol.length) rows.push('<div class="r"><span>pollen</span><span>none detected</span></div>');
      card('ovc-air').innerHTML = '<h4>🌿 air & pollen</h4>' + rows.join('');
    } catch {}
  }
  function airOn() { airRefresh(); airTimer = setInterval(airRefresh, 30 * 60 * 1000); }
  function airOff() { clearInterval(airTimer); airTimer = null; dropCard('ovc-air'); }

  /* ============ 4. sun & moon (no API — astronomy math) ============ */
  let sunTimer = null, sunRay = null, moonRay = null;

  function sunRefresh() {
    if (!here) return;
    const now = new Date();
    const sp = sunPos(now, here.lat, here.lon);
    const t = sunTimes(now, here.lat, here.lon);
    const mp = moonPos(now, here.lat, here.lon);
    const mi = moonIllum(now);
    const rows = [];
    if (sp.alt > 0) {
      rows.push(`<div class="r"><span>☀ up · ${compass(sp.az)} · ${Math.round(sp.alt)}°</span><span>${t.sunset ? `sets ${fmtT(t.sunset)}` : ''}</span></div>`);
      if (t.sunset) rows.push(`<div class="r"><span>sunset</span><span>${inMin(t.sunset - now)}</span></div>`);
      if (t.goldenStart && now < t.sunset) {
        rows.push(`<div class="r"><span>golden hour</span><span>${now >= t.goldenStart ? 'now ✨' : fmtT(t.goldenStart)}</span></div>`);
      }
    } else {
      const nextRise = t.sunrise && now < t.sunrise ? t.sunrise
        : sunTimes(new Date(now.valueOf() + dayMs), here.lat, here.lon).sunrise;
      rows.push(`<div class="r"><span>☀ down</span><span>${nextRise ? `rises ${fmtT(nextRise)} (${inMin(nextRise - now)})` : ''}</span></div>`);
    }
    rows.push(`<div class="r"><span>${phaseName(mi.phase)}</span><span>${Math.round(mi.fraction * 100)}% lit</span></div>`);
    rows.push(`<div class="r"><span>moon</span><span>${mp.alt > 0 ? `up · ${compass(mp.az)} · ${Math.round(mp.alt)}°` : 'below horizon'}</span></div>`);
    card('ovc-sun').innerHTML = '<h4>🌗 sun & moon</h4>' + rows.join('');

    // bearing rays from the search centre when the body is up
    const ray = (old, alt, az, colr, dash) => {
      if (old) map.removeLayer(old);
      if (alt <= 0) return null;
      return L.polyline([[here.lat, here.lon], dest(here.lat, here.lon, az, radiusKm * 0.9)],
        { color: colr, weight: 2, opacity: 0.7, dashArray: dash, interactive: false }).addTo(map);
    };
    sunRay = ray(sunRay, sp.alt, sp.az, '#ffcf4d', null);
    moonRay = ray(moonRay, mp.alt, mp.az, '#c9d4e4', '6 6');
  }
  function sunOn() { sunRefresh(); sunTimer = setInterval(sunRefresh, 60 * 1000); }
  function sunOff() {
    clearInterval(sunTimer); sunTimer = null;
    if (sunRay) { map.removeLayer(sunRay); sunRay = null; }
    if (moonRay) { map.removeLayer(moonRay); moonRay = null; }
    dropCard('ovc-sun');
  }

  /* ============ 5. earthquakes (USGS, last 24 h) ============ */
  let quakeGroup = null, quakeTimer = null;

  async function quakeRefresh() {
    if (!here || !quakeGroup) return;
    try {
      const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
      if (!r.ok) return;
      const d = await r.json();
      const netKm = Math.max(500, radiusKm * 10); // quakes are rare — cast a wider net
      quakeGroup.clearLayers();
      let n = 0;
      for (const f of d.features || []) {
        const [lon, lat, depth] = f.geometry.coordinates;
        const dist = KM(here, { lat, lon });
        if (dist > netKm) continue;
        n++;
        const mag = f.properties.mag ?? 0;
        const ago = Math.round((Date.now() - f.properties.time) / 60000);
        L.circleMarker([lat, lon], {
          radius: 4 + mag * 2.2,
          color: '#fff', weight: 1,
          fillColor: mag < 2 ? '#b9c2cc' : mag < 4 ? '#ffa050' : '#ff5050',
          fillOpacity: 0.85,
        }).bindPopup(
          `<b>M${mag.toFixed(1)}</b> <span class="sub">earthquake</span><br>${H(f.properties.place || '')}` +
          `<br>${Math.round(depth)} km deep · ${ago < 90 ? `${ago}m` : `${Math.round(ago / 60)}h`} ago · ${Math.round(dist)} km away` +
          `<br><span class="links"><a href="${H(f.properties.url)}" target="_blank" rel="noopener">USGS details</a></span>`
        ).addTo(quakeGroup);
      }
      if (n) dropCard('ovc-quake');
      else card('ovc-quake').innerHTML = `<h4>🌍 earthquakes</h4><div>none within ${netKm} km in 24 h</div>`;
    } catch {}
  }
  function quakeOn() {
    quakeGroup = quakeGroup || L.layerGroup().addTo(map);
    quakeRefresh();
    quakeTimer = setInterval(quakeRefresh, 5 * 60 * 1000);
  }
  function quakeOff() {
    clearInterval(quakeTimer); quakeTimer = null;
    quakeGroup?.clearLayers(); dropCard('ovc-quake');
  }

  /* ============ toggle engine ============ */
  const LAYERS = {
    sat: [satOn, satOff], marine: [marineOn, marineOff], air: [airOn, airOff],
    sun: [sunOn, sunOff], quake: [quakeOn, quakeOff],
  };

  function setLayer(k, on) {
    if (st[k] === on) return;
    st[k] = on; save();
    (on ? LAYERS[k][0] : LAYERS[k][1])();
  }

  menu.querySelectorAll('input[data-l]').forEach((cb) => {
    cb.checked = st[cb.dataset.l];
    cb.addEventListener('change', () => setLayer(cb.dataset.l, cb.checked));
  });

  // restore saved layers once a location exists; re-run location-sensitive
  // overlays when the pin or radius moves
  let lastKey = null;
  setInterval(() => {
    if (!here) return;
    const key = `${here.lat.toFixed(4)}:${here.lon.toFixed(4)}:${radiusKm}`;
    if (key === lastKey) return;
    const first = lastKey === null;
    lastKey = key;
    if (first) {
      for (const k of Object.keys(LAYERS)) if (st[k]) LAYERS[k][0]();
    } else {
      if (st.marine) marineRefresh();
      if (st.air) airRefresh();
      if (st.sun) sunRefresh();
      if (st.quake) quakeRefresh();
    }
  }, 3000);
})();
