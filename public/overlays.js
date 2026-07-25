// proxme overlays — satellites overhead, sea state, air & pollen, sun & moon,
// earthquakes. All keyless client-side feeds (CelesTrak, Open-Meteo, USGS) or
// pure astronomy math. Loaded after app.js and shares its top-level bindings
// (map, here, radiusKm, KM) via the page's global lexical scope; wrapped in an
// IIFE so nothing here collides with app.js declarations.
(() => {
  const RAD = Math.PI / 180;
  const OV_KEY = 'overlays';
  const st = Object.assign(
    { sat: false, marine: false, air: false, sun: false, quake: false,
      gauges: false, carbon: false, infra: false, wiki: false, crime: false, food: false,
      trains: false, wildlife: false, power: false, heritage: false, plaques: false },
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
        <div class="sec">vehicles</div>
        <label><input type="checkbox" data-v="air"> ✈️ aircraft</label>
        <label><input type="checkbox" data-v="ogn"> 🪂 gliders &amp; FLARM</label>
        <label><input type="checkbox" data-v="sea"> 🚢 boats (AIS)</label>
        <label><input type="checkbox" data-l="trains"> 🚉 train departures</label>
        <div class="sec">sky</div>
        <label><input type="checkbox" data-wx> 🌦 rain radar &amp; wind</label>
        <label><input type="checkbox" data-l="sat"> 🛰 satellites</label>
        <label><input type="checkbox" data-l="sun"> 🌗 sun, moon &amp; aurora</label>
        <div class="sec">water</div>
        <label><input type="checkbox" data-l="marine"> 🌊 sea &amp; tides</label>
        <label><input type="checkbox" data-l="gauges"> 💧 rivers &amp; floods</label>
        <div class="sec">ground</div>
        <label><input type="checkbox" data-l="air"> 🌿 air, pollen &amp; UV</label>
        <label><input type="checkbox" data-l="carbon"> ⚡ grid electricity</label>
        <label><input type="checkbox" data-l="quake"> 🌍 earthquakes</label>
        <label><input type="checkbox" data-l="power"> 🔌 power cuts</label>
        <div class="sec">nearby</div>
        <label><input type="checkbox" data-l="infra"> 🏗 infrastructure</label>
        <label><input type="checkbox" data-l="wiki"> 📖 wikipedia</label>
        <label><input type="checkbox" data-l="crime"> 🚨 street crime</label>
        <label><input type="checkbox" data-l="food"> 🍽 food hygiene</label>
        <label><input type="checkbox" data-l="wildlife"> 🦊 wildlife</label>
        <label><input type="checkbox" data-l="heritage"> 🏛 heritage</label>
        <label><input type="checkbox" data-l="plaques"> 🔵 blue plaques</label>
      </div>
    </span>`);
  const menu = document.getElementById('layersMenu');
  document.getElementById('layersBtn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  // capture-phase pointerdown: Leaflet stops propagation of map presses, so
  // a bubble-phase document listener (or click) never hears them
  document.addEventListener('pointerdown', (ev) => {
    if (!ev.target.closest('#layersWrap')) menu.hidden = true;
  }, true);

  const dock = document.createElement('div');
  dock.id = 'ovcards';
  document.body.appendChild(dock);
  function card(id) {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('div'); el.id = id; el.className = 'ovcard'; dock.appendChild(el); }
    return el;
  }
  const dropCard = (id) => document.getElementById(id)?.remove();
  const poiIcon = (emoji) => L.divIcon({
    className: '', html: `<div class="poi">${emoji}</div>`, iconSize: [22, 22], iconAnchor: [11, 11],
  });
  const dLonKm = () => radiusKm / (111 * Math.cos(here.lat * RAD));

  /* ============ 1. satellites overhead ============ */
  // Default set: the ~180 naked-eye-bright objects + space stations. That is
  // deliberate — of ~10k active satellites only these are worth looking up
  // for. "include Starlink & co" opts into the full CelesTrak active catalog
  // (heavier: ~2 MB of TLEs, propagated every 10 s instead of 5 s).
  const SAT_ELEV_DEG = 20;
  const SAT_MAX_MARKERS = 40;
  let satRecs = null, satGroup = null, satTracks = null, satTimer = null;
  let satAll = localStorage.getItem('sat_all') === '1';
  let satCand = null, satCandTs = 0; // near-horizon candidate cache for the big catalog
  let satPasses = null, satPassTs = 0; // upcoming ISS/station pass predictions
  const satMarkers = new Map();

  const loadSatLib = () => window.satellite ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js';
    s.onload = res; s.onerror = () => rej(new Error('satellite.js failed to load'));
    document.head.appendChild(s);
  });

  async function loadTles() {
    const groups = satAll ? ['active'] : ['visual', 'stations'];
    const KEY = `tle_cache_${groups.join('_')}`;
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (c && Date.now() - c.ts < 6 * 3600 * 1000) return c.text;
    } catch {}
    let text = '';
    for (const grp of groups) {
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

  // ground point of a satellite at time t
  function satGround(sat, rec, t) {
    try {
      const pv = sat.propagate(rec, t);
      if (!pv?.position) return null;
      const gd = sat.eciToGeodetic(pv.position, sat.gstime(t));
      return [sat.degreesLat(gd.latitude), sat.degreesLong(gd.longitude)];
    } catch { return null; }
  }

  function satTick() {
    if (!here || !satRecs || !window.satellite) return;
    const sat = window.satellite, now = new Date(), gmst = sat.gstime(now);
    const obs = { latitude: here.lat * RAD, longitude: here.lon * RAD, height: 0 };
    const s = sunEci(now), smag = Math.hypot(s.x, s.y, s.z);
    const sh = { x: s.x / smag, y: s.y / smag, z: s.z / smag };
    const darkHere = sunPos(now, here.lat, here.lon).alt < -6;

    // 16k-object catalog: sweep everything only once a minute (elev > 5°),
    // then propagate just those candidates on the fast tick
    let pool = satRecs;
    if (satAll && satRecs.length > 2000) {
      if (!satCand || now.valueOf() - satCandTs > 60000) {
        satCand = satRecs.filter(({ rec }) => {
          try {
            const pv = sat.propagate(rec, now);
            if (!pv?.position) return false;
            return sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, gmst)).elevation > 5 * RAD;
          } catch { return false; }
        });
        satCandTs = now.valueOf();
      }
      pool = satCand;
    }

    const up = [];
    for (const { name, rec } of pool) {
      let pv;
      try { pv = sat.propagate(rec, now); } catch { continue; }
      if (!pv?.position) continue;
      const la = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, gmst));
      if (la.elevation < SAT_ELEV_DEG * RAD) continue;
      const gd = sat.eciToGeodetic(pv.position, gmst);
      const p = pv.position, dot = p.x * sh.x + p.y * sh.y + p.z * sh.z;
      const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
      const sunlit = dot > 0 || Math.sqrt(Math.max(0, r2 - dot * dot)) > 6371;
      up.push({
        id: String(rec.satnum), name, rec,
        ll: [sat.degreesLat(gd.latitude), sat.degreesLong(gd.longitude)],
        alt: gd.height, speed: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
        elev: la.elevation / RAD, az: la.azimuth / RAD,
        visible: sunlit && darkHere, sunlit,
      });
    }
    up.sort((a, b) => b.elev - a.elev);

    // markers + ground tracks (−5 to +10 min) for the highest few
    const shown = up.slice(0, SAT_MAX_MARKERS);
    const fresh = new Set();
    satTracks.clearLayers();
    for (const o of shown) {
      const popup =
        `<b>${H(o.name)}</b> <span class="sub">satellite</span><br>` +
        `${Math.round(o.alt)} km up · ${o.speed.toFixed(1)} km/s<br>` +
        `elev ${Math.round(o.elev)}° · look ${compass(o.az)}<br>` +
        (o.visible ? '👁 sunlit in a dark sky — look up!' : o.sunlit ? 'sunlit, but your sky is too bright' : 'in Earth\'s shadow') + '<br>' +
        `<span class="links"><a href="https://www.n2yo.com/satellite/?s=${o.id}" target="_blank" rel="noopener">n2yo</a> · ` +
        `<a href="https://heavens-above.com/satinfo.aspx?satid=${o.id}" target="_blank" rel="noopener">heavens-above</a></span>`;
      const m = satMarkers.get(o.id);
      if (m) m.setLatLng(o.ll).setIcon(satIcon(o.visible)).bindPopup(popup);
      else satMarkers.set(o.id, L.marker(o.ll, { icon: satIcon(o.visible) }).bindPopup(popup).addTo(satGroup));
      fresh.add(o.id);
      const pts = [];
      for (let dt = -5; dt <= 10; dt++) {
        const g = satGround(sat, o.rec, new Date(now.valueOf() + dt * 60000));
        if (g) pts.push(g);
      }
      if (pts.length > 1) {
        L.polyline(pts, {
          color: o.visible ? '#ffd35e' : '#8fa3bd', weight: 1.5, opacity: 0.55,
          dashArray: '4 6', interactive: false,
        }).addTo(satTracks);
      }
    }
    for (const [id, m] of satMarkers) {
      if (!fresh.has(id)) { satGroup.removeLayer(m); satMarkers.delete(id); }
    }

    // bearing rays from the pin: sats sit far outside the ring by nature,
    // so show which way to look without leaving ring zoom
    for (const o of up.slice(0, 5)) {
      L.polyline([[here.lat, here.lon], dest(here.lat, here.lon, o.az, radiusKm * 0.85)], {
        color: o.visible ? '#ffd35e' : '#9fb0c8', weight: 1.5, opacity: 0.5,
        dashArray: '2 5', interactive: false,
      }).addTo(satTracks);
    }

    // A satellite 20° up is hundreds of km away on the ground — its marker
    // is off-screen at ring zoom. The card is the primary UI; tap to fly out.
    // upcoming station passes (ISS/Tiangong) — recompute every 30 min
    if (!satPasses || Date.now() - satPassTs > 30 * 60 * 1000) {
      satPasses = predictPasses();
      satPassTs = Date.now();
    }

    const LIST_N = 10;
    const rows = up.slice(0, LIST_N).map((o) =>
      `<div class="r satrow" data-sat="${o.id}"><span>🛰 ${H(o.name)}</span>` +
      `<span>${compass(o.az)} ${Math.round(o.elev)}°${o.visible ? ' 👁' : ''}</span></div>`);
    if (up.length > LIST_N) rows.push(`<div class="r"><span></span><span>+${up.length - LIST_N} more overhead</span></div>`);
    for (const p of satPasses || []) {
      rows.push(`<div class="r"><span>next ${H(p.name.split(' ')[0].split('(')[0])} pass</span>` +
        `<span>${fmtT(p.start)} ${compass(p.startAz)}→${compass(p.endAz ?? p.startAz)} ${Math.round(p.maxEl)}°${p.visible ? ' 👁' : ''}</span></div>`);
    }
    const el = card('ovc-sat');
    el.innerHTML =
      `<h4>🛰 ${up.length ? `${up.length} overhead` : 'satellites'} · tracking ${satRecs.length.toLocaleString()}</h4>` +
      (rows.length ? rows.join('') : `<div>none above ${SAT_ELEV_DEG}° right now</div>`) +
      `<label class="r satall"><span>include Starlink &amp; co (heavy)</span>` +
      `<input type="checkbox" id="satAllCb"${satAll ? ' checked' : ''}></label>`;
    el.onclick = (ev) => {
      const row = ev.target.closest('.satrow');
      const m = row && satMarkers.get(row.dataset.sat);
      if (m) { map.flyTo(m.getLatLng(), 7); m.openPopup(); }
    };
    el.onchange = (ev) => {
      if (ev.target.id !== 'satAllCb') return;
      satAll = ev.target.checked;
      localStorage.setItem('sat_all', satAll ? '1' : '0');
      satRecs = null; satCand = null;
      satOff();
      if (st.sat) satOn();
    };
  }

  // minute-step forward search for ISS/Tiangong passes in the next 24 h
  function predictPasses() {
    if (!here || !satRecs || !window.satellite) return [];
    const sat = window.satellite;
    const targets = satRecs.filter((o) => /ISS \(ZARYA\)|TIANHE|TIANGONG|CSS/.test(o.name)).slice(0, 2);
    const obs = { latitude: here.lat * RAD, longitude: here.lon * RAD, height: 0 };
    const passes = [];
    for (const { name, rec } of targets) {
      let pass = null;
      for (let m = 0; m <= 24 * 60; m++) {
        const t = new Date(Date.now() + m * 60000);
        let pv;
        try { pv = sat.propagate(rec, t); } catch { break; }
        if (!pv?.position) continue;
        const la = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, sat.gstime(t)));
        const el = la.elevation / RAD;
        if (el > 10) {
          if (!pass) pass = { name, start: t, startAz: la.azimuth / RAD, maxEl: el, visible: false };
          if (el > pass.maxEl) pass.maxEl = el;
          const p = pv.position, s2 = sunEci(t), sm = Math.hypot(s2.x, s2.y, s2.z);
          const dot = (p.x * s2.x + p.y * s2.y + p.z * s2.z) / sm;
          const r2 = p.x * p.x + p.y * p.y + p.z * p.z;
          const sunlit = dot > 0 || Math.sqrt(Math.max(0, r2 - dot * dot)) > 6371;
          if (sunlit && sunPos(t, here.lat, here.lon).alt < -6) pass.visible = true;
        } else if (pass) {
          pass.endAz = la.azimuth / RAD;
          passes.push(pass); pass = null;
          if (passes.length >= 4) break;
        }
      }
    }
    return passes.sort((a, b) => a.start - b.start).slice(0, 3);
  }

  async function satOn() {
    satGroup = satGroup || L.layerGroup().addTo(map);
    satTracks = satTracks || L.layerGroup().addTo(map);
    card('ovc-sat').innerHTML = '<h4>🛰 satellites</h4><div>loading orbits…</div>';
    try {
      await loadSatLib();
      satRecs = satRecs || parseTles(await loadTles());
      if (!st.sat) return; // toggled off while orbits were downloading
      satTick();
      clearInterval(satTimer);
      // the full active catalog is ~16k objects — tick slower to stay smooth
      satTimer = setInterval(satTick, satAll ? 10000 : 5000);
    } catch (err) {
      card('ovc-sat').innerHTML = `<h4>🛰 satellites</h4><div>${H(err.message)}</div>`;
    }
  }
  function satOff() {
    clearInterval(satTimer); satTimer = null;
    satMarkers.clear(); satGroup?.clearLayers(); satTracks?.clearLayers();
    dropCard('ovc-sat');
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
        '&current=wave_height,wave_direction,wave_period,sea_surface_temperature' +
        '&hourly=sea_level_height_msl&forecast_days=2&timezone=UTC';
      const r = await fetch(url);
      if (!r.ok) return;
      let d = await r.json();
      if (!st.marine) return; // toggled off while the fetch was in flight
      if (!Array.isArray(d)) d = [d];
      marineGroup.clearLayers();
      let best = null, bestHourly = null;
      d.forEach((f, i) => {
        const c = f.current;
        if (!c || c.wave_height == null || !pts[i]) return;
        if (!best) { best = c; bestHourly = f.hourly; }
        const bits = [`${c.wave_height.toFixed(1)}<small>m</small>`];
        if (c.wave_period != null) bits.push(`${Math.round(c.wave_period)}<small>s</small>`);
        if (c.sea_surface_temperature != null) bits.push(`${Math.round(c.sea_surface_temperature)}<small>°C</small>`);
        const rot = c.wave_direction != null ? (c.wave_direction + 180) % 360 : 0;
        const html =
          `<div class="wxwrap"><div class="wx sea">` +
          `<svg class="wxa" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)"><path d="M12 3 L17.5 14 L12 11.2 L6.5 14 Z" fill="#6fe3d2"/></svg>` +
          `<span>${bits.join('')}</span></div></div>`;
        L.marker(pts[i], {
          icon: L.divIcon({ className: '', html, iconSize: [110, 26], iconAnchor: [55, -14] }),
          interactive: false,
        }).addTo(marineGroup);
      });
      // summary card so the layer visibly does something even when the
      // map pills sit at the ring edge, off-screen on a phone
      if (best) {
        const rows = [`<div class="r"><span>waves</span><span>${best.wave_height.toFixed(1)} m${best.wave_period != null ? ` · ${Math.round(best.wave_period)} s` : ''}</span></div>`];
        if (best.wave_direction != null) rows.push(`<div class="r"><span>from</span><span>${compass(best.wave_direction)}</span></div>`);
        if (best.sea_surface_temperature != null) rows.push(`<div class="r"><span>sea temp</span><span>${best.sea_surface_temperature.toFixed(1)} °C</span></div>`);
        for (const t of nextTides(bestHourly)) {
          rows.push(`<div class="r"><span>${t.kind === 'high' ? '▲ high tide' : '▽ low tide'}</span>` +
            `<span>${fmtT(t.when)} · ${t.h.toFixed(1)} m</span></div>`);
        }
        card('ovc-marine').innerHTML = '<h4>🌊 sea & tides</h4>' + rows.join('');
      } else {
        card('ovc-marine').innerHTML = '<h4>🌊 sea & tides</h4><div>no sea within the ring</div>';
      }
    } catch {}
  }
  // Next high/low water from the hourly sea-level series: local extrema,
  // refined with a parabolic fit through the three surrounding hours.
  function nextTides(hourly) {
    const ts = hourly?.time, hs = hourly?.sea_level_height_msl;
    if (!ts || !hs) return [];
    const now = Date.now(), out = [];
    for (let i = 1; i < hs.length - 1 && out.length < 4; i++) {
      const [a, b, c] = [hs[i - 1], hs[i], hs[i + 1]];
      if (a == null || b == null || c == null) continue;
      const isMax = b >= a && b > c, isMin = b <= a && b < c;
      if (!isMax && !isMin) continue;
      const denom = a - 2 * b + c;
      const off = denom ? Math.max(-1, Math.min(1, 0.5 * (a - c) / denom)) : 0;
      const when = new Date(Date.parse(ts[i] + 'Z') + off * 3600000);
      if (when.valueOf() < now) continue;
      const h = b - 0.25 * (a - c) * off;
      // keep the first upcoming high and the first upcoming low
      if (!out.some((o) => o.kind === (isMax ? 'high' : 'low'))) {
        out.push({ kind: isMax ? 'high' : 'low', when, h });
      }
    }
    return out.sort((x, y) => x.when - y.when);
  }

  function marineOn() {
    marineGroup = marineGroup || L.layerGroup().addTo(map);
    marineRefresh();
    clearInterval(marineTimer);
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
      if (!c || !st.air) return; // drop stale responses after toggle-off
      const rows = [];
      if (c.european_aqi != null) {
        const [, word, colr] = AQI_BANDS.find(([lim]) => c.european_aqi <= lim);
        rows.push(`<div class="r"><span>air quality</span><span class="aqi" style="background:${colr}">${Math.round(c.european_aqi)} ${word}</span></div>`);
      }
      if (c.pm2_5 != null) rows.push(`<div class="r"><span>PM2.5</span><span>${c.pm2_5.toFixed(1)} µg/m³</span></div>`);
      if (c.uv_index != null) rows.push(`<div class="r"><span>UV</span><span>${c.uv_index.toFixed(1)} · ${UV_WORD(c.uv_index)}</span></div>`);
      try {
        const sr = await fetch(`https://data.sensor.community/airrohr/v1/filter/area=${here.lat.toFixed(3)},${here.lon.toFixed(3)},${Math.min(25, radiusKm)}`);
        if (sr.ok) {
          const sd = await sr.json();
          const seen = new Set(), vals = [];
          for (const s0 of sd) {
            if (seen.has(s0.sensor?.id)) continue;
            seen.add(s0.sensor?.id);
            for (const v of s0.sensordatavalues || []) if (v.value_type === 'P2') vals.push(parseFloat(v.value));
          }
          if (vals.length) rows.push(`<div class="r"><span>citizen sensors (${seen.size})</span><span>PM2.5 ${(vals.reduce((x, y) => x + y, 0) / vals.length).toFixed(1)}</span></div>`);
        }
      } catch {}
      if (!st.air) return;
      const pol = [
        ['grass', c.grass_pollen, 30, 60], ['birch', c.birch_pollen, 90, 180], ['ragweed', c.ragweed_pollen, 10, 50],
      ].filter(([, v]) => v != null && v > 0);
      for (const [nm, v, lo, hi] of pol) rows.push(`<div class="r"><span>${nm} pollen</span><span>${pollenWord(v, lo, hi)} (${Math.round(v)})</span></div>`);
      if (!pol.length) rows.push('<div class="r"><span>pollen</span><span>none detected</span></div>');
      card('ovc-air').innerHTML = '<h4>🌿 air & pollen</h4>' + rows.join('');
    } catch {}
  }
  function airOn() { airRefresh(); clearInterval(airTimer);
    airTimer = setInterval(airRefresh, 30 * 60 * 1000); }
  function airOff() { clearInterval(airTimer); airTimer = null; dropCard('ovc-air'); }

  /* ============ 4. sun & moon (astronomy math) + aurora (NOAA SWPC) ===== */
  let sunTimer = null, sunRay = null, moonRay = null;
  let kpVal = null, kpTs = 0;

  async function kpRefresh() {
    try {
      const r = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json');
      if (!r.ok) return;
      const d = await r.json();
      const last = d[d.length - 1];
      kpVal = last?.estimated_kp ?? last?.kp_index ?? null;
      kpTs = Date.now();
      if (st.sun) sunRefresh();
    } catch {}
  }

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
    if (kpVal != null) {
      rows.push(`<div class="r${kpVal >= 5 ? ' warn' : ''}"><span>aurora</span>` +
        `<span>${kpVal >= 6 ? 'likely — check N horizon!' : kpVal >= 5 ? 'possible' : 'quiet'} · Kp ${(+kpVal).toFixed(1)}</span></div>`);
    }
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
  function sunOn() {
    sunRefresh(); kpRefresh();
    clearInterval(sunTimer);
    sunTimer = setInterval(() => {
      sunRefresh();
      if (Date.now() - kpTs > 30 * 60 * 1000) kpRefresh();
    }, 60 * 1000);
  }
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
      if (!st.quake) return; // drop stale responses after toggle-off
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
    clearInterval(quakeTimer);
    quakeTimer = setInterval(quakeRefresh, 5 * 60 * 1000);
  }
  function quakeOff() {
    clearInterval(quakeTimer); quakeTimer = null;
    quakeGroup?.clearLayers(); dropCard('ovc-quake');
  }


  /* ============ 6. rivers & floods (Environment Agency, keyless) ========= */
  let gaugeGroup = null, gaugeTimer = null;

  async function gaugesRefresh() {
    if (!here || !gaugeGroup) return;
    try {
      const base = 'https://environment.data.gov.uk/flood-monitoring';
      const dist = Math.max(10, Math.round(radiusKm));
      const q = `lat=${here.lat.toFixed(3)}&long=${here.lon.toFixed(3)}&dist=${dist}`;
      const [stR, flR] = await Promise.all([
        fetch(`${base}/id/stations?${q}&parameter=level`, { signal: AbortSignal.timeout(15000) }),
        fetch(`${base}/id/floods?${q}`, { signal: AbortSignal.timeout(15000) }),
      ]);
      if (!st.gauges) return;
      const stations = stR.ok ? (await stR.json()).items || [] : [];
      const floods = flR.ok ? (await flR.json()).items || [] : [];
      const near = stations
        .filter((g) => g.lat && g.long)
        .map((g) => ((g._d = KM(here, { lat: g.lat, lon: g.long })), g))
        .sort((a, b) => a._d - b._d).slice(0, 8);
      const readings = await Promise.all(near.slice(0, 5).map((g) =>
        fetch(`${base}/id/stations/${encodeURIComponent(g.stationReference)}/readings?latest`)
          .then((r) => (r.ok ? r.json() : null)).then((j) => j?.items?.[0]?.value).catch(() => null)));
      if (!st.gauges) return;
      gaugeGroup.clearLayers();
      const rows = [];
      near.forEach((g, i) => {
        const lvl = i < 5 ? readings[i] : null;
        const name = g.label || g.riverName || g.stationReference;
        L.marker([g.lat, g.long], { icon: poiIcon('💧') }).bindPopup(
          `<b>${H(name)}</b> <span class="sub">water gauge</span><br>` +
          `${g.riverName ? H(g.riverName) + '<br>' : ''}` +
          `${lvl != null ? `level ${(+lvl).toFixed(2)} m<br>` : ''}` +
          `${g._d.toFixed(1)} km away<br>` +
          `<span class="links"><a href="https://check-for-flooding.service.gov.uk/station/${encodeURIComponent(g.RLOIid || '')}" target="_blank" rel="noopener">history</a></span>`
        ).addTo(gaugeGroup);
        if (i < 3) rows.push(`<div class="r"><span>${H(String(name).slice(0, 17))}</span><span>${lvl != null ? (+lvl).toFixed(2) + ' m' : '—'}</span></div>`);
      });
      const warn = floods.slice(0, 2).map((f) =>
        `<div class="r warn"><span>⚠ ${H((f.description || 'flood alert').slice(0, 22))}</span><span>${H(f.severity || '')}</span></div>`);
      card('ovc-gauges').innerHTML = '<h4>💧 rivers & floods</h4>' +
        (warn.length ? warn.join('') : '<div class="r"><span>flood alerts</span><span>none</span></div>') +
        (rows.length ? rows.join('') : '<div>no gauges in range (England only)</div>');
    } catch {}
  }
  function gaugesOn() {
    gaugeGroup = gaugeGroup || L.layerGroup().addTo(map);
    gaugesRefresh();
    clearInterval(gaugeTimer);
    gaugeTimer = setInterval(gaugesRefresh, 15 * 60 * 1000);
  }
  function gaugesOff() { clearInterval(gaugeTimer); gaugeTimer = null; gaugeGroup?.clearLayers(); dropCard('ovc-gauges'); }

  /* ============ 7. grid electricity (carbonintensity.org.uk) ============= */
  let carbonTimer = null;
  const CI_COLORS = { 'very low': '#6fe3a1', low: '#c9e36f', moderate: '#f0e641', high: '#ffa050', 'very high': '#ff5050' };

  async function carbonRefresh() {
    if (!here) return;
    try {
      const pr = await fetch(`https://api.postcodes.io/outcodes?lon=${here.lon.toFixed(4)}&lat=${here.lat.toFixed(4)}&radius=25000`, { signal: AbortSignal.timeout(15000) });
      const out = pr.ok ? (await pr.json()).result?.[0]?.outcode : null;
      if (!st.carbon) return;
      if (!out) {
        card('ovc-carbon').innerHTML = '<h4>⚡ grid electricity</h4><div>GB only (no postcode nearby)</div>';
        return;
      }
      const cr = await fetch(`https://api.carbonintensity.org.uk/regional/postcode/${encodeURIComponent(out)}`, { signal: AbortSignal.timeout(15000) });
      if (!cr.ok || !st.carbon) return;
      const d = (await cr.json()).data?.[0];
      const cur = d?.data?.[0];
      if (!cur || !st.carbon) return;
      const mix = (cur.generationmix || []).filter((m) => m.perc > 0.5).sort((a, b) => b.perc - a.perc);
      card('ovc-carbon').innerHTML = '<h4>⚡ grid electricity</h4>' +
        `<div class="r"><span>carbon now</span><span class="aqi" style="background:${CI_COLORS[cur.intensity.index] || '#c9e36f'}">${cur.intensity.forecast} g · ${H(cur.intensity.index)}</span></div>` +
        mix.slice(0, 4).map((m) => `<div class="r"><span>${H(m.fuel)}</span><span>${Math.round(m.perc)}%</span></div>`).join('') +
        `<div class="r"><span class="src">${H(d.shortname)} region · ${H(out)}</span></div>`;
    } catch {}
  }
  function carbonOn() { carbonRefresh(); clearInterval(carbonTimer); carbonTimer = setInterval(carbonRefresh, 30 * 60 * 1000); }
  function carbonOff() { clearInterval(carbonTimer); carbonTimer = null; dropCard('ovc-carbon'); }

  /* ============ 8. infrastructure (OpenStreetMap via Overpass) =========== */
  const INFRA_CATS = {
    defib:    { label: 'defibs',      emoji: '✚',  match: (t) => t.emergency === 'defibrillator',            q: 'node["emergency"="defibrillator"]' },
    lifeboat: { label: 'lifeboats',   emoji: '🛟', match: (t) => /lifeboat_station|water_rescue/.test(t.emergency || ''), q: 'nwr["emergency"~"lifeboat_station|water_rescue"]' },
    wreck:    { label: 'wrecks',      emoji: '⚓', match: (t) => t.historic === 'wreck',                     q: 'nwr["historic"="wreck"]' },
    bunker:   { label: 'bunkers',     emoji: '🪖', match: (t) => /pillbox|bunker/.test(t.historic || '') || t.military === 'bunker', q: 'nwr["historic"~"pillbox|bunker"];nwr["military"="bunker"]' },
    light:    { label: 'lighthouses', emoji: '💡', match: (t) => t.man_made === 'lighthouse',                q: 'nwr["man_made"="lighthouse"]' },
    ev:       { label: 'EV charge',   emoji: '🔌', match: (t) => t.amenity === 'charging_station',           q: 'node["amenity"="charging_station"]' },
    turbine:  { label: 'turbines',    emoji: '🌀', match: (t) => t['generator:source'] === 'wind',           q: 'node["generator:source"="wind"]' },
    mast:     { label: 'masts',       emoji: '📡', match: (t) => /^(mast|communications_tower)$/.test(t.man_made || ''), q: 'node["man_made"~"^(mast|communications_tower)$"]' },
    water:    { label: 'water taps',  emoji: '🚰', match: (t) => t.amenity === 'drinking_water',             q: 'node["amenity"="drinking_water"]' },
    toilets:  { label: 'toilets',     emoji: '🚻', match: (t) => t.amenity === 'toilets',                    q: 'node["amenity"="toilets"]' },
  };
  const OP_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];
  let infraGroup = null, infraBusy = false;
  const infraCats = () => {
    try {
      return JSON.parse(localStorage.getItem('infra_cats') || 'null') || ['defib', 'lifeboat', 'wreck', 'bunker', 'light'];
    } catch { return ['defib']; }
  };

  function renderInfraCard(counts, note) {
    const cats = infraCats();
    const chips = Object.entries(INFRA_CATS).map(([k, c]) =>
      `<span class="chip${cats.includes(k) ? ' on' : ''}" data-cat="${k}">${c.emoji} ${c.label}${counts && counts[k] ? ` · ${counts[k]}` : ''}</span>`).join('');
    const el = card('ovc-infra');
    el.innerHTML = `<h4>🏗 infrastructure</h4><div class="chips">${chips}</div>` +
      (note ? `<div class="src">${H(note)}</div>` : '<div class="src">OpenStreetMap · tap chips to choose</div>');
    el.onclick = (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const k = chip.dataset.cat, cur = infraCats();
      localStorage.setItem('infra_cats', JSON.stringify(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
      infraRefresh();
    };
  }

  async function infraRefresh() {
    if (!here || !infraGroup || infraBusy) return;
    const cats = infraCats();
    infraGroup.clearLayers();
    if (!cats.length) { renderInfraCard(null, 'pick a category'); return; }
    const b = `(${(here.lat - radiusKm / 111).toFixed(3)},${(here.lon - dLonKm()).toFixed(3)},${(here.lat + radiusKm / 111).toFixed(3)},${(here.lon + dLonKm()).toFixed(3)})`;
    const sel = cats.flatMap((k) => INFRA_CATS[k].q.split(';')).map((q) => `${q}${b};`).join('');
    const cacheKey = `op:${[...cats].sort().join('.')}:${here.lat.toFixed(2)}:${here.lon.toFixed(2)}:${radiusKm}`;
    let data = null;
    try {
      const c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (c && Date.now() - c.ts < 24 * 3600 * 1000) data = c.d;
    } catch {}
    if (!data) {
      infraBusy = true;
      renderInfraCard(null, 'searching OpenStreetMap…');
      for (const mirror of OP_MIRRORS) {
        try {
          const r = await fetch(mirror, {
            method: 'POST',
            body: 'data=' + encodeURIComponent(`[out:json][timeout:25];(${sel});out center 400;`),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(30000),
          });
          if (r.ok) { data = await r.json(); break; }
        } catch {}
      }
      infraBusy = false;
      if (data) {
        data = { elements: (data.elements || []).slice(0, 400) };
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), d: data })); } catch {}
      }
    }
    if (!st.infra) return;
    if (!data) { renderInfraCard(null, 'OpenStreetMap busy — try again in a minute'); return; }
    infraGroup.clearLayers();
    const counts = {};
    for (const el of data.elements || []) {
      const t = el.tags || {};
      const k = cats.find((c) => INFRA_CATS[c].match(t));
      if (!k) continue;
      counts[k] = (counts[k] || 0) + 1;
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (lat == null) continue;
      L.marker([lat, lon], { icon: poiIcon(INFRA_CATS[k].emoji) }).bindPopup(
        `<b>${H(t.name || INFRA_CATS[k].label.replace(/s$/, ''))}</b> <span class="sub">${H(k)}</span><br>` +
        [t.operator, t['addr:street'], t.description && t.description.slice(0, 90)].filter(Boolean).map(H).join('<br>') +
        `<br><span class="links"><a href="https://www.openstreetmap.org/${el.type}/${el.id}" target="_blank" rel="noopener">OSM</a> · ` +
        `<a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" rel="noopener">directions</a></span>`
      ).addTo(infraGroup);
    }
    renderInfraCard(counts);
  }
  function infraOn() { infraGroup = infraGroup || L.layerGroup().addTo(map); infraRefresh(); }
  function infraOff() { infraGroup?.clearLayers(); dropCard('ovc-infra'); }

  /* ============ 9. wikipedia nearby ====================================== */
  let wikiGroup = null;

  async function wikiRefresh() {
    if (!here || !wikiGroup) return;
    try {
      const rad = Math.min(10000, radiusKm * 1000);
      const r = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=geosearch' +
        `&gscoord=${here.lat.toFixed(4)}|${here.lon.toFixed(4)}&gsradius=${rad}&gslimit=40&format=json&origin=*`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return;
      const items = (await r.json()).query?.geosearch || [];
      if (!st.wiki) return;
      wikiGroup.clearLayers();
      for (const it of items) {
        L.marker([it.lat, it.lon], { icon: poiIcon('📖') }).bindPopup(
          `<b>${H(it.title)}</b> <span class="sub">wikipedia</span><br>${(it.dist / 1000).toFixed(1)} km away<br>` +
          `<span class="links"><a href="https://en.wikipedia.org/?curid=${it.pageid}" target="_blank" rel="noopener">read article</a></span>`
        ).addTo(wikiGroup);
      }
    } catch {}
  }
  function wikiOn() { wikiGroup = wikiGroup || L.layerGroup().addTo(map); wikiRefresh(); }
  function wikiOff() { wikiGroup?.clearLayers(); }

  /* ============ 10. street crime (police.uk, last published month) ======= */
  let crimeGroup = null;

  async function crimeRefresh() {
    if (!here || !crimeGroup) return;
    try {
      const r = await fetch(`https://data.police.uk/api/crimes-street/all-crime?lat=${here.lat.toFixed(4)}&lng=${here.lon.toFixed(4)}`,
        { signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        if (st.crime) {
          card('ovc-crime').innerHTML = '<h4>🚨 street crime</h4><div>' +
            (r.status >= 400 && r.status < 500 ? 'England &amp; Wales only' : 'feed unavailable — will retry') + '</div>';
        }
        return;
      }
      const items = await r.json();
      if (!st.crime) return;
      crimeGroup.clearLayers();
      const byCat = {};
      for (const c of items) byCat[c.category] = (byCat[c.category] || 0) + 1;
      for (const c of items.slice(0, 150)) {
        const la = parseFloat(c.location?.latitude), lo = parseFloat(c.location?.longitude);
        if (!Number.isFinite(la)) continue;
        L.circleMarker([la, lo], { radius: 4, color: '#fff', weight: 0.5, fillColor: '#ff5050', fillOpacity: 0.7 })
          .bindPopup(
            `<b>${H(c.category.replace(/-/g, ' '))}</b> <span class="sub">${H(c.month || '')}</span><br>` +
            `${H(c.location?.street?.name || '')}<br>` +
            `<span class="src">${H(c.outcome_status?.category || 'no outcome yet')}</span>`
          ).addTo(crimeGroup);
      }
      const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 5);
      card('ovc-crime').innerHTML =
        `<h4>🚨 street crime · ${items.length} in ${H(items[0]?.month || 'last month')}</h4>` +
        (top.map(([k, n]) => `<div class="r"><span>${H(k.replace(/-/g, ' '))}</span><span>${n}</span></div>`).join('') ||
          '<div>none reported</div>') +
        '<div class="r"><span class="src">1-mile area · police.uk</span></div>';
    } catch {}
  }
  function crimeOn() { crimeGroup = crimeGroup || L.layerGroup().addTo(map); crimeRefresh(); }
  function crimeOff() { crimeGroup?.clearLayers(); dropCard('ovc-crime'); }

  /* ============ 11. food hygiene (Food Standards Agency) ================= */
  let foodGroup = null;
  const FHRS_COLORS = { 5: '#6fe3a1', 4: '#c9e36f', 3: '#f0e641', 2: '#ffa050', 1: '#ff5050', 0: '#ff5050' };

  async function foodRefresh() {
    if (!here || !foodGroup) return;
    try {
      const miles = Math.max(1, Math.min(5, Math.round(radiusKm / 1.609)));
      const r = await fetch('https://api.ratings.food.gov.uk/Establishments' +
        `?latitude=${here.lat.toFixed(4)}&longitude=${here.lon.toFixed(4)}&maxDistanceLimit=${miles}&sortOptionKey=distance&pageSize=150`,
        { headers: { 'x-api-version': '2' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return;
      const items = (await r.json()).establishments || [];
      if (!st.food) return;
      foodGroup.clearLayers();
      let rated = 0, sum = 0, worst = null;
      for (const e of items) {
        const la = parseFloat(e.geocode?.latitude), lo = parseFloat(e.geocode?.longitude);
        const rv = parseInt(e.RatingValue, 10);
        if (Number.isFinite(rv)) {
          rated++; sum += rv;
          if (!worst || rv < worst.rv) worst = { rv, name: e.BusinessName };
        }
        if (!Number.isFinite(la)) continue;
        L.circleMarker([la, lo], {
          radius: 5, color: '#111', weight: 0.5,
          fillColor: Number.isFinite(rv) ? FHRS_COLORS[rv] : '#9aa7b8', fillOpacity: 0.9,
        }).bindPopup(
          `<b>${H(e.BusinessName)}</b> <span class="sub">${H(e.BusinessType || '')}</span><br>` +
          `hygiene rating: <b>${H(e.RatingValue)}</b>${e.RatingDate ? ' · ' + H(String(e.RatingDate).slice(0, 10)) : ''}<br>` +
          `<span class="links"><a href="https://ratings.food.gov.uk/business/${e.FHRSID}" target="_blank" rel="noopener">full report</a></span>`
        ).addTo(foodGroup);
      }
      card('ovc-food').innerHTML =
        `<h4>🍽 food hygiene · ${items.length} nearby</h4>` +
        (rated ? `<div class="r"><span>average rating</span><span>${(sum / rated).toFixed(1)} / 5</span></div>` : '') +
        (worst && worst.rv <= 2 ? `<div class="r warn"><span>lowest: ${H(String(worst.name).slice(0, 18))}</span><span>${worst.rv} ★</span></div>` : '') +
        '<div class="r"><span class="src">Food Standards Agency</span></div>';
    } catch {}
  }
  function foodOn() { foodGroup = foodGroup || L.layerGroup().addTo(map); foodRefresh(); }
  function foodOff() { foodGroup?.clearLayers(); dropCard('ovc-food'); }


  /* ============ 12. train departures (Huxley community Darwin proxy) ===== */
  // Station coordinates are a static harvest (data/stations.min.json).
  // Huxley's public demo instance is keyless but community-run — errors are
  // reported softly and never break the layer.
  let stationList = null, trainGroup = null, trainTimer = null;

  async function trainsRefresh() {
    if (!here || !trainGroup) return;
    try {
      if (!stationList) {
        const r = await fetch('data/stations.min.json');
        stationList = await r.json();
      }
      const near = stationList
        .map(([crs, name, lat, lon]) => ({ crs, name, lat, lon, d: KM(here, { lat, lon }) }))
        .filter((x) => x.d <= Math.max(30, radiusKm))
        .sort((a, b) => a.d - b.d).slice(0, 3);
      if (!st.trains) return;
      if (!near.length) {
        card('ovc-trains').innerHTML = '<h4>🚉 trains</h4><div>no stations within range</div>';
        trainGroup.clearLayers();
        return;
      }
      const boards = await Promise.all(near.map((x) =>
        fetch(`https://huxley2.azurewebsites.net/departures/${x.crs}/5`, { signal: AbortSignal.timeout(15000) })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      if (!st.trains) return;
      trainGroup.clearLayers();
      const fmtSvc = (t) =>
        `${H(t.std || '')} ${H(t.destination?.[0]?.locationName || '')}` +
        `${t.platform ? ` · P${H(t.platform)}` : ''} · ` +
        `<i>${t.isCancelled ? 'cancelled' : H(t.etd || '')}</i>`;
      near.forEach((x, i) => {
        const svcs = boards[i]?.trainServices || [];
        L.marker([x.lat, x.lon], { icon: poiIcon('🚉') }).bindPopup(
          `<b>${H(x.name)}</b> <span class="sub">${x.d.toFixed(1)} km</span><br>` +
          (svcs.slice(0, 5).map(fmtSvc).join('<br>') || 'no departures listed') +
          `<br><span class="links"><a href="https://www.realtimetrains.co.uk/search/simple/gb-nr:${x.crs}" target="_blank" rel="noopener">RealTimeTrains</a></span>`
        ).addTo(trainGroup);
      });
      const main = near[0], mainSvcs = boards[0]?.trainServices || [];
      card('ovc-trains').innerHTML =
        `<h4>🚉 ${H(main.name)} · ${main.d.toFixed(1)} km</h4>` +
        (mainSvcs.slice(0, 5).map((t) => `<div class="r"><span>${H(t.std || '')} ${H((t.destination?.[0]?.locationName || '').slice(0, 15))}</span>` +
          `<span>${t.isCancelled ? '✖' : H(t.etd || '')}${t.platform ? ` · P${H(t.platform)}` : ''}</span></div>`).join('') ||
          (boards[0] ? '<div>no departures listed</div>' : '<div>departure board busy — will retry</div>')) +
        (near.length > 1 ? `<div class="r"><span class="src">also: ${near.slice(1).map((x) => H(x.name)).join(' · ')}</span></div>` : '');
    } catch {}
  }
  function trainsOn() {
    trainGroup = trainGroup || L.layerGroup().addTo(map);
    trainsRefresh();
    clearInterval(trainTimer);
    trainTimer = setInterval(trainsRefresh, 2 * 60 * 1000);
  }
  function trainsOff() { clearInterval(trainTimer); trainTimer = null; trainGroup?.clearLayers(); dropCard('ovc-trains'); }

  /* ============ 13. wildlife (iNaturalist) =============================== */
  let wildGroup = null, wildTimer = null;

  async function wildlifeRefresh() {
    if (!here || !wildGroup) return;
    try {
      const r = await fetch('https://api.inaturalist.org/v1/observations' +
        `?lat=${here.lat.toFixed(4)}&lng=${here.lon.toFixed(4)}&radius=${Math.min(50, radiusKm)}` +
        '&order=desc&order_by=observed_on&per_page=50&verifiable=true&photos=true',
        { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return;
      const d = await r.json();
      if (!st.wildlife) return;
      wildGroup.clearLayers();
      const rows = [];
      (d.results || []).forEach((o, i) => {
        const [la, lo] = String(o.location || '').split(',').map(parseFloat);
        if (!Number.isFinite(la)) return;
        const name = o.taxon?.preferred_common_name || o.taxon?.name || 'observation';
        const when = o.time_observed_at || o.observed_on;
        const photo = (o.photos || [])[0]?.url;
        L.marker([la, lo], { icon: poiIcon('🦊') }).bindPopup(
          `<b>${H(name)}</b> <span class="sub">${H(o.taxon?.name || '')}</span><br>` +
          (photo ? `<img src="${H(photo.replace('square', 'small'))}" style="width:150px;border-radius:6px" loading="lazy"><br>` : '') +
          `${when ? age(Date.parse(when)) : ''} · by ${H(o.user?.login || '?')}` +
          `${o.quality_grade === 'research' ? ' · ✓ research grade' : ''}<br>` +
          `<span class="links"><a href="${H(o.uri)}" target="_blank" rel="noopener">iNaturalist</a></span>`
        ).addTo(wildGroup);
        if (i < 3 && when) rows.push(`<div class="r"><span>${H(name.slice(0, 18))}</span><span>${age(Date.parse(when))}</span></div>`);
      });
      card('ovc-wildlife').innerHTML =
        `<h4>🦊 wildlife · ${(d.total_results || 0).toLocaleString()} logged here</h4>` +
        (rows.join('') || '<div>no recent observations</div>') +
        '<div class="r"><span class="src">latest 50 shown · iNaturalist</span></div>';
    } catch {}
  }
  function wildlifeOn() {
    wildGroup = wildGroup || L.layerGroup().addTo(map);
    wildlifeRefresh();
    clearInterval(wildTimer);
    wildTimer = setInterval(wildlifeRefresh, 10 * 60 * 1000);
  }
  function wildlifeOff() { clearInterval(wildTimer); wildTimer = null; wildGroup?.clearLayers(); dropCard('ovc-wildlife'); }

  /* ============ 14. power cuts (UK Power Networks live faults) =========== */
  let powerGroup = null, powerTimer = null;

  async function powerRefresh() {
    if (!here || !powerGroup) return;
    try {
      const km = Math.max(25, radiusKm);
      const r = await fetch('https://ukpowernetworks.opendatasoft.com/api/explore/v2.1/catalog/datasets/ukpn-live-faults/records' +
        `?where=${encodeURIComponent(`within_distance(geopoint, geom'POINT(${here.lon.toFixed(4)} ${here.lat.toFixed(4)})', ${km}km)`)}&limit=40`,
        { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return;
      const d = await r.json();
      if (!st.power) return;
      powerGroup.clearLayers();
      let active = 0, planned = 0, restored = 0;
      for (const f of d.results || []) {
        if (!f.geopoint) continue;
        const type = f.powercuttype || f.incidenttypename || '?';
        const isRestored = /restored/i.test(type);
        const isPlanned = /planned/i.test(type) && !/unplanned/i.test(type);
        if (isRestored) restored++; else if (isPlanned) planned++; else active++;
        L.circleMarker([f.geopoint.lat, f.geopoint.lon], {
          radius: 7, color: '#fff', weight: 1,
          fillColor: isRestored ? '#9aa7b8' : isPlanned ? '#ffa050' : '#ff5050', fillOpacity: 0.85,
        }).bindPopup(
          `<b>${H(type)} power cut</b><br>` +
          `${f.nocustomeraffected ? `${f.nocustomeraffected} customers · ` : ''}${H((f.postcodesaffected || '').split(';').slice(0, 3).join(', '))}<br>` +
          `${H((f.incidentcategorycustomerfriendlydescription || f.mainmessage || '').slice(0, 160))}<br>` +
          (f.estimatedrestorationdate && !isRestored ? `est. restore ${fmtT(new Date(f.estimatedrestorationdate))}<br>` : '') +
          `<span class="src">${H(f.incidentreference || '')} · UKPN</span>`
        ).addTo(powerGroup);
      }
      card('ovc-power').innerHTML = '<h4>🔌 power cuts</h4>' +
        `<div class="r${active ? ' warn' : ''}"><span>live cuts</span><span>${active}</span></div>` +
        `<div class="r"><span>planned</span><span>${planned}</span></div>` +
        `<div class="r"><span>restored recently</span><span>${restored}</span></div>` +
        `<div class="r"><span class="src">within ${km} km · UKPN region (London/SE/East)</span></div>`;
    } catch {}
  }
  function powerOn() {
    powerGroup = powerGroup || L.layerGroup().addTo(map);
    powerRefresh();
    clearInterval(powerTimer);
    powerTimer = setInterval(powerRefresh, 5 * 60 * 1000);
  }
  function powerOff() { clearInterval(powerTimer); powerTimer = null; powerGroup?.clearLayers(); dropCard('ovc-power'); }

  /* ============ 15. heritage (planning.data.gov.uk) ====================== */
  const HERITAGE_SETS = {
    'listed-building-outline': { label: 'listed', emoji: '🏠' },
    'scheduled-monument': { label: 'monuments', emoji: '🗿' },
    'conservation-area': { label: 'conservation', emoji: '🏘' },
    'park-and-garden': { label: 'parks', emoji: '🌳' },
    'ancient-woodland': { label: 'woodland', emoji: '🌲' },
  };
  let herGroup = null;
  const herSets = () => {
    try {
      return JSON.parse(localStorage.getItem('heritage_sets') || 'null') || ['scheduled-monument', 'listed-building-outline'];
    } catch { return ['scheduled-monument']; }
  };

  function renderHerCard(counts, note) {
    const sets = herSets();
    const chips = Object.entries(HERITAGE_SETS).map(([k, c]) =>
      `<span class="chip${sets.includes(k) ? ' on' : ''}" data-set="${k}">${c.emoji} ${c.label}${counts && counts[k] ? ` · ${counts[k]}` : ''}</span>`).join('');
    const el = card('ovc-heritage');
    el.innerHTML = `<h4>🏛 heritage</h4><div class="chips">${chips}</div>` +
      `<div class="src">${H(note || 'planning.data.gov.uk · tap chips to choose')}</div>`;
    el.onclick = (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const k = chip.dataset.set, cur = herSets();
      localStorage.setItem('heritage_sets', JSON.stringify(cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
      heritageRefresh();
    };
  }

  async function heritageRefresh() {
    if (!here || !herGroup) return;
    const sets = herSets();
    herGroup.clearLayers();
    if (!sets.length) { renderHerCard(null, 'pick a category'); return; }
    try {
      // their spatial queries crawl on big envelopes — 6 km is fast (and the
      // 100-entity cap fills long before that anyway)
      const hkm = Math.min(6, radiusKm);
      const dLat = hkm / 111, dLon = hkm / (111 * Math.cos(here.lat * RAD));
      const wkt = `POLYGON((${here.lon - dLon} ${here.lat - dLat},${here.lon + dLon} ${here.lat - dLat},` +
        `${here.lon + dLon} ${here.lat + dLat},${here.lon - dLon} ${here.lat + dLat},${here.lon - dLon} ${here.lat - dLat}))`;
      const cacheKey = `her:${[...sets].sort().join('.')}:${here.lat.toFixed(2)}:${here.lon.toFixed(2)}:${hkm}`;
      let entities = null;
      try {
        const c = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (c && Date.now() - c.ts < 24 * 3600 * 1000) entities = c.d;
      } catch {}
      if (!entities) {
        renderHerCard(null, 'searching…');
        const u = 'https://www.planning.data.gov.uk/entity.json?geometry_relation=intersects&limit=100' +
          sets.map((x) => `&dataset=${x}`).join('') + `&geometry=${encodeURIComponent(wkt)}`;
        const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) { renderHerCard(null, 'service busy — try again shortly'); return; }
        entities = ((await r.json()).entities || []).map((e) => ({
          n: e.name, d: e.dataset, p: e.point, u: e['documentation-url'] || '',
        }));
        try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), d: entities })); } catch {}
      }
      if (!st.heritage) return;
      const counts = {};
      for (const e of entities) {
        const m = /POINT ?\(([-\d.]+) ([-\d.]+)\)/.exec(e.p || '');
        if (!m) continue;
        counts[e.d] = (counts[e.d] || 0) + 1;
        L.marker([parseFloat(m[2]), parseFloat(m[1])], { icon: poiIcon(HERITAGE_SETS[e.d]?.emoji || '🏛') }).bindPopup(
          `<b>${H(e.n || HERITAGE_SETS[e.d]?.label || 'entity')}</b> <span class="sub">${H(e.d)}</span><br>` +
          (e.u ? `<span class="links"><a href="${H(e.u)}" target="_blank" rel="noopener">Historic England</a></span>` : '')
        ).addTo(herGroup);
      }
      renderHerCard(counts, `within ${Math.round(Math.min(6, radiusKm))} km` + (entities.length >= 100 ? ' · first 100' : ''));
    } catch { renderHerCard(null, 'service busy — try again shortly'); }
  }
  function heritageOn() { herGroup = herGroup || L.layerGroup().addTo(map); heritageRefresh(); }
  function heritageOff() { herGroup?.clearLayers(); dropCard('ovc-heritage'); }

  /* ============ 16. blue plaques (openplaques.org CC0 harvest) =========== */
  let plaqueData = null, plaqueGroup = null;

  async function plaquesRefresh() {
    if (!here || !plaqueGroup) return;
    try {
      if (!plaqueData) {
        card('ovc-plaques').innerHTML = '<h4>🔵 blue plaques</h4><div>loading…</div>';
        const r = await fetch('data/plaques.min.json');
        plaqueData = await r.json();
      }
      if (!st.plaques) return;
      plaqueGroup.clearLayers();
      const near = plaqueData
        .map(([id, la, lo, txt]) => ({ id, la, lo, txt, d: KM(here, { lat: la, lon: lo }) }))
        .filter((p) => p.d <= radiusKm)
        .sort((a, b) => a.d - b.d);
      for (const p of near.slice(0, 200)) {
        L.marker([p.la, p.lo], { icon: poiIcon('🔵') }).bindPopup(
          `<b>${H(p.txt)}${p.txt.length >= 90 ? '…' : ''}</b><br>${p.d.toFixed(1)} km away<br>` +
          `<span class="links"><a href="https://openplaques.org/plaques/${p.id}" target="_blank" rel="noopener">full plaque</a></span>`
        ).addTo(plaqueGroup);
      }
      card('ovc-plaques').innerHTML =
        `<h4>🔵 blue plaques · ${near.length} in ring</h4>` +
        near.slice(0, 3).map((p) => `<div class="r"><span>${H(p.txt.slice(0, 20))}</span><span>${p.d.toFixed(1)}km</span></div>`).join('') +
        `<div class="r"><span class="src">openplaques.org (CC0 harvest)${near.length > 200 ? ' · nearest 200 mapped' : ''}</span></div>`;
    } catch {}
  }
  function plaquesOn() { plaqueGroup = plaqueGroup || L.layerGroup().addTo(map); plaquesRefresh(); }
  function plaquesOff() { plaqueGroup?.clearLayers(); dropCard('ovc-plaques'); }

  /* ============ toggle engine ============ */
  const LAYERS = {
    sat: [satOn, satOff], marine: [marineOn, marineOff], air: [airOn, airOff],
    sun: [sunOn, sunOff], quake: [quakeOn, quakeOff],
    gauges: [gaugesOn, gaugesOff], carbon: [carbonOn, carbonOff],
    infra: [infraOn, infraOff], wiki: [wikiOn, wikiOff],
    crime: [crimeOn, crimeOff], food: [foodOn, foodOff],
    trains: [trainsOn, trainsOff], wildlife: [wildlifeOn, wildlifeOff],
    power: [powerOn, powerOff], heritage: [heritageOn, heritageOff],
    plaques: [plaquesOn, plaquesOff],
  };

  const started = {};
  const start = (k) => { if (!started[k]) { started[k] = true; LAYERS[k][0](); } };
  const stop = (k) => { if (started[k]) { started[k] = false; LAYERS[k][1](); } };

  function setLayer(k, on) {
    if (st[k] === on) return;
    st[k] = on; save();
    (on ? start : stop)(k);
  }

  // vehicle feeds live in app.js — rows drive its setVehicle()
  menu.querySelectorAll('input[data-v]').forEach((cb) => {
    cb.checked = show[cb.dataset.v];
    cb.addEventListener('change', () => {
      setVehicle(cb.dataset.v, cb.checked);
      if (window.innerWidth <= 640) menu.hidden = true;
    });
  });

  // weather lives in app.js — the menu row just drives its setWeather()
  const wxCb = menu.querySelector('input[data-wx]');
  wxCb.checked = wxOn;
  wxCb.addEventListener('change', () => {
    setWeather(wxCb.checked);
    if (window.innerWidth <= 640) menu.hidden = true;
  });

  menu.querySelectorAll('input[data-l]').forEach((cb) => {
    cb.checked = st[cb.dataset.l];
    cb.addEventListener('change', () => {
      setLayer(cb.dataset.l, cb.checked);
      // on phones the menu covers the card strip — close it so the result shows
      if (window.innerWidth <= 640) menu.hidden = true;
    });
  });

  // mobile: pin the card strip and the layers sheet just below the HUD,
  // whatever height it wraps to
  const hudEl = document.getElementById('hud');
  function placeUi() {
    const mobile = window.innerWidth <= 640;
    const top = `${hudEl.getBoundingClientRect().bottom + 8}px`;
    dock.style.top = mobile ? top : '';
    menu.style.top = mobile ? top : '';
  }
  new ResizeObserver(placeUi).observe(hudEl);
  window.addEventListener('resize', placeUi);
  placeUi();

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
      for (const k of Object.keys(LAYERS)) if (st[k]) start(k);
    } else {
      satCand = null; satPasses = null; // both are location-specific
      if (st.marine) marineRefresh();
      if (st.air) airRefresh();
      if (st.sun) sunRefresh();
      if (st.quake) quakeRefresh();
      if (st.gauges) gaugesRefresh();
      if (st.carbon) carbonRefresh();
      if (st.infra) infraRefresh();
      if (st.wiki) wikiRefresh();
      if (st.crime) crimeRefresh();
      if (st.food) foodRefresh();
      if (st.trains) trainsRefresh();
      if (st.wildlife) wildlifeRefresh();
      if (st.power) powerRefresh();
      if (st.heritage) heritageRefresh();
      if (st.plaques) plaquesRefresh();
    }
  }, 3000);
})();
