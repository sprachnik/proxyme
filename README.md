# proxme

Everything with a public position or nearby-data feed, within ~20 km of you,
on one map. Started as a "lazy flight tracker"; now it tracks aircraft (down
to light aircraft and MLAT-inferred positions), gliders, boats, satellites,
trains, tides, weather, wildlife, power cuts, heritage and more — almost all
of it from **keyless** public APIs, with a couple of open datasets harvested
into the repo.

Two deployments from one codebase:

| Build | Folder | Backend | Live at |
|---|---|---|---|
| GitHub Pages | `docs/` | none — browser calls sources directly | `https://<user>.github.io/proxyme/` |
| Netlify | `public/` + `netlify/functions/` | thin proxy functions (key hiding, caching, fallback chains) | `netlify deploy` |

## Using it

Open the page, allow location (or tap the map to drop a pin anywhere).
Toolbar: 📍 re-locate · radius picker (5/10/20/50 km, default 20) ·
🔑 AISStream key for boats (Pages build) · ☰ everything else.

The ☰ menu is grouped into five sections; every toggle is remembered per
browser. Overlays render as cards in a dock (top-right on desktop, a
swipeable strip under the toolbar on mobile) plus map markers where relevant.

### Vehicles (core feeds, on by default)

| Toggle | Source | Key | Notes |
|---|---|---|---|
| ✈️ aircraft | Pages: airplanes.live · Netlify: adsb.lol → adsb.fi → airplanes.live | no | ADS-B + MLAT; class inferred from emitter category *and* ICAO type designator (MLAT targets send no category) |
| 🪂 gliders & FLARM | Open Glider Network (live.glidernet.org) | no | gliders, paragliders, hang gliders, balloons; deduped against ADS-B by hex + same-spot heuristic |
| 🚢 boats | aisstream.io | free key | Pages: persistent browser websocket, key kept in localStorage. Netlify: 6 s drains merged with a 10-min history blob |
| 🚉 train departures | Huxley community Darwin proxy | no | live boards for the 3 nearest stations; station coords are a static harvest (`data/stations.min.json`). Community demo instance — treat as personal-use |

Vehicles get silhouette markers rotated to heading, popups with reg / model /
altitude / speed / distance / data source / fix age, out-links (airplanes.live
globe, Planespotters, FlightAware, VesselFinder, MarineTraffic, search), and a
nearest-first list panel (tap to fly to the target).

### Sky

| Toggle | Source | Notes |
|---|---|---|
| 🌦 rain radar & wind | RainViewer + Open-Meteo | radar upscaled beyond its native z7; wind/temp pills at centre + N/S/E/W |
| 🛰 satellites | CelesTrak TLEs + satellite.js in-browser | overhead list with look direction, 👁 naked-eye flag (Earth-shadow test), ground tracks, bearing rays, next ISS/Tiangong passes; opt-in full ~16k active catalog (two-tier propagation keeps phones smooth) |
| 🌗 sun, moon & aurora | astronomy math (no API) + NOAA SWPC | sunset countdown, golden hour, moon phase, sun/moon bearing rays, Kp index |

### Water

| Toggle | Source | Notes |
|---|---|---|
| 🌊 sea & tides | Open-Meteo Marine | wave pills at wet ring points; next high/low water derived from the hourly sea-level series |
| 💧 rivers & floods | Environment Agency (England) | live gauge levels for nearest stations + active flood alerts |

### Ground

| Toggle | Source | Notes |
|---|---|---|
| 🌿 air, pollen & UV | Open-Meteo AQ + Sensor.Community | European AQI band, PM2.5, UV, grass/birch/ragweed pollen, citizen sensors |
| ⚡ grid electricity | carbonintensity.org.uk via postcodes.io | live regional carbon + generation mix (GB) |
| 🌍 earthquakes | USGS | last 24 h within max(500 km, 10× ring) |
| 🔌 power cuts | UK Power Networks open data | live faults (London/SE/East): active / planned / restored, restoration estimates |

### Nearby

| Toggle | Source | Notes |
|---|---|---|
| 🏗 infrastructure | OpenStreetMap via Overpass (3 mirrors, 24 h cache) | chips: defibs, lifeboats, wrecks, bunkers, lighthouses, EV chargers, turbines, masts, water taps, toilets |
| 📖 wikipedia | Wikipedia geosearch | nearby articles |
| 🚨 street crime | police.uk | last published month, 1-mile area, category breakdown |
| 🍽 food hygiene | Food Standards Agency | rating-coloured dots, average + lowest-rated callout |
| 🦊 wildlife | iNaturalist | latest 50 verifiable observations, photo popups, research-grade flags |
| 🏛 heritage | planning.data.gov.uk | chips: listed buildings, scheduled monuments, conservation areas, parks, ancient woodland; queried within 6 km (their spatial API crawls on bigger boxes), 24 h cache |
| 🔵 blue plaques | openplaques.org CC0 harvest | `data/plaques.min.json` — 17,332 geolocated UK plaques, loaded only when toggled, nearest 200 mapped |

## Architecture

- **No build step.** Plain HTML/CSS/JS, Leaflet from CDN. Classic scripts
  share top-level scope: `app.js` owns the map, vehicle feeds and weather;
  `overlays.js` (IIFE) owns the ☰ menu and every other layer, reading
  `map` / `here` / `radiusKm` etc. from `app.js`.
- **`docs/` and `public/` are siblings, not source→build.** `overlays.js`,
  `style.css` and `data/` are byte-identical copies; `app.js` differs only in
  how vehicles are fetched (direct APIs vs `/api/*` functions). Keep them in
  sync — see `CLAUDE.md`.
- **Netlify functions** (`netlify/functions/`): `aircraft.js` (aggregator
  fallback chain), `gliders.js` (OGN), `vessels.js` (AISStream drain +
  history), `_normalize.js`, `_store.js` (Netlify Blobs cache seam),
  `_origin.js` (origin guard every function calls first).
- **Normalised vehicle shape** everywhere:
  `{ id, kind: 'air'|'sea', sub, lat, lon, alt /* m */, ground, heading,
  speed /* kn */, name, reg, model, src, ts }`.
- **Static harvests** in `data/`: `stations.min.json` (2,606 GB stations,
  `[[crs, name, lat, lon], …]`) and `plaques.min.json`
  (`[[id, lat, lon, text], …]`). Regeneration steps in `CLAUDE.md`.

## Setup

**GitHub Pages**: Settings → Pages → deploy from branch, `/docs` folder.
Aircraft, gliders and every overlay work with zero configuration; boats need
a free aisstream.io key entered via 🔑 (stored in localStorage only).

**Netlify**: `npm i && npm run dev` (serves `public/` plus the real functions
at `/api/*` on :8888). Copy `.env.example` → `.env` for `AISSTREAM_API_KEY`
(boats only — everything else is keyless). Deploy with `npm run deploy:prod`.

**Pages build locally**: `npm run dev:pages` → :8000, no backend.

### Adding an endpoint

```
npm run new:fn tides     # → netlify/functions/tides.js, live at /api/tides
```

The scaffold already has param validation, the Blobs cache seam and the JSON
helper wired up; fill in the fetch and the normaliser. Then wire it into
`public/app.js` or `public/overlays.js` (see the layer template in
`CLAUDE.md`).

### Before committing

```
npm run check
```

Syntax-checks every JS file and asserts `docs/` and `public/` have not
drifted on the files that must stay byte-identical. `npm run sync` fixes
drift by copying the `docs/` copies over.

## Licensing / usage notes

This project's own code is MIT — see `LICENSE`. That does **not** relicense
the harvested datasets or the upstream feeds, which keep their own terms:

- `data/stations.min.json` is **ODbL 1.0** (share-alike). Derived from
  [davwheat/uk-railway-stations](https://github.com/davwheat/uk-railway-stations),
  itself derived from Trainline EU's open dataset and their sources —
  attribution is owed to all three, and any modified redistribution of the
  data must be published under ODbL.
- `data/plaques.min.json` is a CC0 harvest of openplaques.org.
- adsb.lol is ODbL; adsb.fi & airplanes.live free for non-commercial use;
  OGN is non-commercial flight-following; AISStream free tier allows **one
  concurrent connection per key**.
- OpenStreetMap data © OSM contributors (ODbL); police.uk / EA / FSA /
  planning.data / UKPN under the Open Government Licence; iNaturalist
  observations carry per-record licences.
- Huxley is a community proxy for National Rail Darwin — fine for a personal
  page, get a Rail Data Marketplace token before anything bigger.
- All fine for a personal, non-commercial deployment; revisit every line of
  this list before monetising.

### Running your own copy

The `/api/*` functions are unauthenticated. `_origin.js` rejects requests
carrying a *foreign* browser `Origin` (allowlist from Netlify's injected
`URL` / `DEPLOY_PRIME_URL`, plus optional `ALLOWED_ORIGINS`), which stops
another site hotlinking them — it is not authentication, so deploy with your
own `AISSTREAM_API_KEY` rather than pointing at someone else's instance. The
free tier's one-connection-per-key limit means a shared endpoint locks its
owner out of their own boats.
