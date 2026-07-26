# CLAUDE.md — proxme

Proximity tracker: everything with a public feed within ~20 km, on a Leaflet
map. Two deployments, one codebase, no build step, no framework.

## The one rule that matters: two builds, kept in sync

- `docs/` = GitHub Pages build (no backend, browser calls APIs directly).
- `public/` + `netlify/functions/` = Netlify build (functions proxy the
  vehicle feeds).
- **Byte-identical between builds**: `overlays.js`, `style.css`, `data/*`.
  Edit the `docs/` copy, then `cp` to `public/`. Never let them drift.
- **Intentionally different**: `app.js` (vehicle fetching — direct APIs vs
  `/api/*`; the Pages build also owns the AIS websocket + 🔑 key UI) and
  `index.html` (Pages build has the 🔑 button).
- Netlify-only vehicle logic lives in `netlify/functions/` and shares the
  normaliser (`_normalize.js`) that `docs/app.js` duplicates inline.

## Deployment / git

- Repo: `sprachnik/proxyme` (private), default branch `main`. `upstream`
  remote points at the original `sprachnik/proxyme`.
- The `origin` URL carries the `sprachnik@` username and the repo sets
  `credential.helper=!gh auth git-credential` locally — the machine's default
  Git Credential Manager account is `sprachnik`, which cannot see this repo.
- Netlify: `nimble-pothos-0ff3c0.netlify.app`
  (team `jamesasmoores13`, project id `9e547557-454a-44e0-8621-55ad3bd8c766`).
- Owner tests on a phone at the Kent coast — mobile is first-class, verify
  layouts at ≤640 px.

## Local development

| Command | Does |
|---|---|
| `npm run dev` | `netlify dev` on :8888 — `public/` + real functions at `/api/*` |
| `npm run dev:pages` | `docs/` (Pages build) on :8000, no backend |
| `npm run new:fn <name>` | scaffolds `netlify/functions/<name>.js` → `/api/<name>` |
| `npm run sync` | copies the shared files `docs/` → `public/` |
| `npm run check` | `node --check` every JS file **and** assert docs/public parity |
| `npm run deploy:prod` | build + deploy to production |

- Run `npm run check` before every commit — it enforces both the syntax rule
  and the byte-identical rule above.
- Secrets: copy `.env.example` → `.env` (gitignored). Only
  `AISSTREAM_API_KEY` exists; without it `/api/vessels` returns 501 and
  everything else works. One concurrent connection per key, so a local
  `netlify dev` and the deployed site will fight over the same key.
- Functions whose filename starts with `_` are helpers by convention, but
  Netlify still bundles and exposes them (`/.netlify/functions/_store` → 502,
  not 404). Never put anything sensitive there. The new-function template
  lives in `scripts/templates/` for exactly this reason.

## PWA layer

- `manifest.webmanifest` + `sw.js` + `icons/` are shared files (in the
  `SHARED` list in `scripts/sync.mjs`) — edit the `docs/` copy, `npm run sync`.
- All URLs in both are **relative** so one file works at the site root
  (Netlify) and under `/proxyme/` (Pages).
- Icons are generated, not drawn: `npm run icons` runs
  `scripts/make-icons.mjs` (stdlib PNG encoder, no image dependency) and
  syncs. Change the palette constants there, not the PNGs.
- `sw.js` caches the **shell only** — everything the app displays is live, so
  `isLive()` forces `/api/*`, `/.netlify/*` and all cross-origin requests
  straight to the network. Bump `VERSION` when a shell file changes.
- The page does **not** register the worker on localhost — a caching worker
  fights `npm run dev`. Test PWA behaviour against a deploy.
- `netlify.toml` sets `Content-Type: application/manifest+json` (Netlify
  otherwise serves `.webmanifest` as octet-stream, which Chrome may reject)
  and `Cache-Control: no-cache` on `sw.js`.

## Code architecture

- Classic `<script>` tags sharing global lexical scope, in order:
  `leaflet` → `app.js` → `overlays.js`.
- `app.js` (top-level declarations, readable from later scripts): `map`,
  `here` ({lat,lon} search centre), `radiusKm`, `KM(a,b)` haversine,
  `show`/`setVehicle()` (vehicle feed toggles), `wxOn`/`setWeather()`
  (weather layer). It owns the map, pin, ring, vehicle polling (12 s),
  nearest-first panel, and weather (RainViewer radar + wind pills).
- `overlays.js` is one IIFE (avoids top-level `const` collisions across
  scripts). It builds the ☰ menu + card dock and owns every other layer.
  Each layer = `{ st.<key>, <k>On(), <k>Off(), <k>Refresh() }` registered in
  `LAYERS`, with `start()/stop()` guarding double-starts.
- Vehicle entity shape (all sources normalise to it):
  `{ id, kind:'air'|'sea', sub, lat, lon, alt /*m*/, ground, heading,
  speed /*kn*/, name, reg, model, src, ts }`. `sub` drives silhouette + colour.

## UI owned by overlays.js (not app.js)

`overlays.js` injects HUD controls next to 🌦 with `insertAdjacentHTML`, which
is why these live in the *shared* file and not in the two `app.js` copies:

- **☰ layers menu** (`#layersWrap`).
- **🏠 default pin** (`#homeWrap`): postcode / place / `lat,lon` search that
  moves the pin *and* saves it. `geocode()` uses postcodes.io for anything
  postcode-shaped (full or outcode) and only falls back to Nominatim for free
  text — a malformed postcode returns null rather than becoming a place
  search. Stored under `home` as `{lat, lon, label}`; `app.js` owns
  `savedHome()`/`setHome()` because `init()` needs it before overlays load.
- **Collapsible nearest list**: `#panel` is rewritten wholesale by `app.js`
  every poll, so the header lives *outside* it — overlays wraps both in
  `#panelWrap` and repaints the count from a `MutationObserver`. Defaults to
  collapsed at ≤640 px, remembered in `panel_open`.

## Loading states

- `busyCard(k, note)` paints a placeholder card + spins the menu row; `card()`
  clears both, so a layer signals "done" simply by rendering. `start(k)` calls
  `busyCard` *before* running the layer, so feedback is instant even when the
  feed takes 20 s.
- Every key in `LAYERS` must have an entry in `CARDS` and must call `card()`
  on **every** exit path (including failures) or the row spins forever. This
  is why `wiki` gained a card.

## Hard-won invariants (each fixed a real bug — do not regress)

1. **Stale-response guard**: every async refresh re-checks its toggle after
   *every* `await` (`if (!st.x) return;` / `if (!wxOn) return;`) before
   touching cards or layers — otherwise toggled-off cards resurrect
   (`card()` recreates by id). `satOn` additionally bails after the TLE
   download; every `on()` does `clearInterval` before `setInterval`.
2. **`#layersMenu[hidden] { display:none }`** must exist — the menu's
   `display:flex` rule otherwise overrides the `hidden` attribute and the
   menu can never close.
3. Outside-tap close uses **capture-phase `pointerdown`** on `document` —
   Leaflet stops propagation of map presses, and on touch it swallows
   synthetic clicks entirely.
4. Card dock is **z-index 900**, below the HUD (1000) whose stacking context
   contains the menu (1100) — cards must never paint over the open menu.
5. Aircraft class uses emitter `category` **falling back to ICAO type
   designator / description** (`inferSub`) — MLAT (Mode-S-only) targets never
   send a category; without the fallback every ride helicopter shows as
   "plane".
6. OGN vs ADS-B dedupe: by hex, **plus** a same-spot/±300 m-altitude
   heuristic — FLARM device IDs are not ICAO hexes.
7. Wind pills anchor above their point, sea pills below — so neither covers
   the pin and they can't stack at the centre.
8. Mobile (≤640 px): card dock becomes a horizontal strip pinned under the
   HUD by a `ResizeObserver` (HUD height varies as it wraps); menu becomes a
   fixed two-column sheet and auto-closes after a toggle.
9. **Never drop a tap because a fetch is in flight.** `infraRefresh()` used to
   `return` on `infraBusy`, so a chip tapped during a 30 s Overpass query did
   nothing at all — the card never even repainted. Queue with `infraPending`
   and repaint optimistically before the refresh.
10. **Geolocation is never requested on load without a gesture.** Chrome
   suppresses prompts not tied to a user action; in an installed PWA the
   dialog then silently never appears and the app looks blocked. `locate()`
   checks `navigator.permissions` first and only auto-locates when already
   `granted`; 📍 passes `byTap` to force the real request.
11. The Leaflet zoom control sits top-left under the HUD. `placeUi()` publishes
   `--hud-bottom` and `style.css` pads `.leaflet-top.leaflet-left` by it; at
   ≤640 px the control moves bottom-right instead, because the card strip
   takes that space.

## External source quirks (all keyless unless noted; CORS verified)

| Source | Quirk |
|---|---|
| airplanes.live | the only ADS-B aggregator with CORS `*` → Pages build uses it alone; adsb.lol/adsb.fi are Netlify-function-only |
| OpenSky | do not go back to it — OAuth-gated, misses GA/MLAT |
| AISStream | free key, **1 concurrent connection per key**; Netlify drain caches 25 s |
| OGN lxml | `b`=latMax `c`=latMin `d`=lonMax `e`=lonMin; field 8 speed is km/h; type code table in `_normalize.js` |
| RainViewer | radar data ends ~z7; serve 512px tiles with `zoomOffset:-1, maxNativeZoom:8` or you get "zoom not supported" placeholder tiles |
| Open-Meteo (forecast/marine/AQ) | multi-point = comma lists → response becomes an array; marine hourly `sea_level_height_msl` powers tide extrema |
| CelesTrak | groups `visual`+`stations` default (~180); `active` (~16k, ~2.7 MB) behind the "include Starlink & co" checkbox — full sweep 1×/min for >5° candidates, fast tick propagates candidates only |
| Overpass | POST form-encoded; overpass-api.de flakes — mirror chain incl. kumi.systems; 24 h localStorage cache |
| FSA ratings | needs `x-api-version: 2` header (preflight is allowed) |
| police.uk | 4xx = outside England & Wales; other failures are transient — word the card accordingly |
| planning.data.gov.uk | spatial `intersects` **times out beyond ~6 km boxes** — clamp to 6 km, cache 24 h |
| Huxley (`huxley2.azurewebsites.net`) | community demo Darwin proxy — soft-fail wording, low refresh (2 min); official route needs a Rail Data Marketplace token |
| UKPN live faults | opendatasoft `within_distance(geopoint, geom'POINT(lon lat)', Xkm)`; London/SE/East only |
| carbonintensity.org.uk | postcode-district keyed → reverse geocode via postcodes.io **`/outcodes?radius=25000`** (plain `/postcodes` returns null near coasts/airfields) |
| openplaques.org | API has **no CORS** — data is a CC0 harvest instead (see below) |

## Static harvests (`docs/data/` + `public/data/` copies)

- `stations.min.json` — `[[crs, name, lat, lon], …]`, 2,606 stations. Source:
  `https://raw.githubusercontent.com/davwheat/uk-railway-stations/main/stations.json`
  (fields `stationName/lat/long/crsCode`), rounded to 5 dp.
- `plaques.min.json` — `[[id, lat, lon, text≤90ch], …]`, 17,332 plaques.
  Source: dump links on https://openplaques.org/data
  (`open-plaques-United-Kingdom-<date>.json` on S3); filter to records with
  coordinates, minify. Popup links to `openplaques.org/plaques/{id}`.

## localStorage keys

`vehicles`, `wx_on`, `overlays` (per-layer booleans), `aisstream_key`,
`sat_all`, `tle_cache_*`, `infra_cats`, `heritage_sets`, `op:*` (Overpass
cache), `her:*` (heritage cache).

## Testing

- E2E via Playwright scripts (session scratchpad, not committed): serve
  `docs/` with a tiny node http server, Chromium at
  `/opt/pw-browsers/chromium-*/chrome-linux/chrome`, fake geolocation
  (Manston 51.342,1.346 / Ramsgate 51.352,1.42), pre-seed localStorage
  toggles via `addInitScript`, assert card text / marker counts / zero
  `pageerror`s.
- **Sandbox quirks** (not app bugs): the browser has no direct egress —
  `page.route` + node `fetch` tunnels requests, and node needs
  `undici` `EnvHttpProxyAgent` + `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`
  for some hosts (police.uk, celestrak). OSM tiles 403/503 through the
  tunnel. `route.fulfill` bypasses browser CORS — so **verify CORS with
  `curl -H "Origin: https://sprachnik.github.io"`**, never with Playwright.
- `node --check <file>` every touched JS file before committing.

## Style

- Match existing formatting: 2-space indent, single quotes, semicolons,
  ~100-col lines, terse comments only where behaviour is non-obvious.
- Escape all remote strings with `esc()`/`H()` before injecting into HTML.
- New overlay layers follow the existing template: group + timer + refresh
  with stale guards + card + `LAYERS` entry + menu row + watcher hook.
