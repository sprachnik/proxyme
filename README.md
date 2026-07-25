# proxme

A lazy "what's moving near me" tracker: everything with a public position feed
within ~20 km of you, on one map. Aircraft (airliners down to light aircraft,
including MLAT-inferred positions), gliders/paragliders/balloons (FLARM via
the Open Glider Network), and boats (AIS). Static frontend (Leaflet + OSM)
with Netlify Functions acting as thin proxies that hide keys, normalise
responses to one shape, and cache.

## Data sources

| Feed | Source | Key needed | Covers |
|---|---|---|---|
| `/api/aircraft` | adsb.lol → adsb.fi → airplanes.live (fallback chain) | no | ADS-B + MLAT: airliners, light aircraft, helicopters |
| `/api/gliders` | live.glidernet.org (Open Glider Network) | no | FLARM/OGN: gliders, paragliders, hang gliders, tow planes, balloons |
| `/api/vessels` | aisstream.io websocket | yes (free) | AIS: ships and boats |

The two air feeds overlap; the frontend dedupes by ICAO hex, plus a
same-spot/same-altitude heuristic for FLARM-only device IDs.

## How it works

- **Frontend** (`public/`): static, no build step. Leaflet map centred on you
  (or a tapped pin), one ring at the chosen radius (5/10/20/50 km, default 20).
  Polls the three functions every 12 s, merges + dedupes, clips to the ring,
  and renders a nearest-first list. Markers are vehicle silhouettes (plane /
  light aircraft / heli / glider / paraglider / balloon / boat), coloured by
  class and rotated to heading. Popups link out to airplanes.live globe,
  Planespotters, FlightAware, VesselFinder, MarineTraffic or a web search
  (new tab). An optional weather overlay (🌦, remembered per browser) adds
  RainViewer rain radar plus a 3×3 Open-Meteo wind/temperature grid across
  the ring — both keyless.
- **Backend** (`netlify/functions/`): thin proxies.
  - `aircraft.js` — keyless ADS-B aggregators, tried in order with a 5 s
    timeout each + short-TTL cache.
  - `gliders.js` — OGN bbox query, parses the lxml marker format.
  - `vessels.js` — opens an AISStream websocket, subscribes to a bbox, drains
    ~6 s, dedupes by MMSI, then merges into a rolling 10-minute history blob
    so sparse AIS transmitters don't flicker off the map between polls.
  - `_normalize.js` — maps all sources to one shape.
  - `_store.js` — storage seam. MVP uses Netlify Blobs for caching (degrades
    to no-cache outside the Netlify runtime); a future Supabase pass swaps
    this file's bodies only.

Normalised shape returned by all functions:

```js
{ id, kind: 'air' | 'sea', sub, lat, lon, alt /* m */, ground,
  heading, speed /* kn */, name, reg, model, src, ts }
```

`sub` is the vehicle class (`plane`, `light`, `heli`, `glider`, `paraglider`,
`balloon`, `boat`, …) and `src` names the feed (`ADS-B`, `MLAT (inferred)`,
`OGN/FLARM`, `AIS`).

## Environment variables

Set via the Netlify dashboard or `netlify env:set`:

| Var | Required | Notes |
|---|---|---|
| `AISSTREAM_API_KEY` | only for boats | Free key from aisstream.io. Without it the sea feed reports itself off and the air feeds still work. |

## GitHub Pages build (`docs/`)

`docs/` is a self-contained static variant with no backend — the browser
calls the sources directly. Differences from the Netlify build:

- **Aircraft**: airplanes.live only (the one keyless aggregator with open
  CORS), so no fallback chain.
- **Gliders**: OGN direct, unchanged.
- **Boats**: a persistent AISStream websocket from the browser — positions
  stream continuously instead of 6 s drains. Needs your own free
  aisstream.io key: tap 🔑 in the HUD; it's stored in `localStorage` only,
  never in the repo.

Enable it under repo **Settings → Pages → Deploy from a branch**, pick the
default branch and the `/docs` folder. The page then lives at
`https://<user>.github.io/proxyme/`.

## Run / deploy

```bash
npm i
npx netlify dev      # local: http://localhost:8888
npx netlify deploy --prod
```

## Notes / licensing

- adsb.lol is ODbL; adsb.fi and airplanes.live are free for non-commercial
  use; OGN data is for non-commercial flight-following.
- AISStream free tier carries attribution/usage strings, and allows **one
  concurrent connection per key** — the 25 s response cache keeps the drain
  cadence polite, but heavy multi-user traffic would need a persistent
  collector instead.
- All fine for an MVP; revisit before monetising.
