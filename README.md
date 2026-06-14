# proxme

A simple, visual web app that shows nearby transponders on a map: **aircraft
(ADS-B via OpenSky)** and **vessels (AIS via AISStream)** around your GPS
location. Static frontend (Leaflet + OSM) with Netlify Functions acting as thin
proxies that hide API keys, normalise responses to one shape, and cache.

## How it works

- **Frontend** (`public/`): static, no build step. Leaflet map centred on you,
  with range rings. One marker per transponder, coloured + rotated by heading.
  Polls the two functions every 10s.
- **Backend** (`netlify/functions/`): thin proxies.
  - `aircraft.js` — OpenSky `/states/all` bbox query + short-TTL cache.
  - `vessels.js` — opens an AISStream websocket, subscribes to a bbox, drains
    ~6s, dedupes by MMSI, closes, returns JSON (fits the 10s function limit).
  - `_normalize.js` — maps both sources to one shape.
  - `_store.js` — storage seam. MVP uses Netlify Blobs for caching; a future
    Supabase pass swaps this file's bodies only.

Normalised shape returned by both functions:

```js
{ id, kind: 'air' | 'sea', lat, lon, alt, heading, speed, name, ts, raw }
```

## Environment variables

Set via the Netlify dashboard or `netlify env:set`:

| Var | Required | Notes |
|---|---|---|
| `AISSTREAM_API_KEY` | yes (vessels) | Free key from aisstream.io |
| `OPENSKY_TOKEN` | optional | Bearer token; lifts OpenSky to 4k req/day |

## Run / deploy

```bash
npm i
npx netlify dev      # local: http://localhost:8888
npx netlify deploy --prod
```

## Notes / licensing

- OpenSky data licence is **non-commercial**.
- AISStream free tier carries attribution/usage strings.
- Both are fine for an MVP; revisit before monetising.
