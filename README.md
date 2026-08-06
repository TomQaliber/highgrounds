# High Grounds

Europe-focused web app that finds elevated, accessible viewpoints near a location or address, marks them on a map with the nearest address and public/private status, and lets you scrub through daytime to see the sun’s direction and whether buildings or trees block the view.

## Features

- Search by address or use device location
- EU-DEM elevation sampling and local high-ground detection
- OpenStreetMap context for footpaths/parks, buildings, and trees
- Public / private / unknown access badges (inferred from OSM tags — always verify on site)
- Daytime timeline with sun azimuth overlay and line-of-sight scoring

## Stack

- Vite + React + TypeScript
- MapLibre GL (OpenFreeMap basemap)
- SunCalc
- Proxied APIs: OpenTopoData (`eudem25m`), Nominatim, Overpass (via `/api/*`)

## Local vs Vercel

Locally, Vite middleware serves `/api/*`. On Vercel, the same paths are Edge/serverless functions in `api/`.

**Overpass / OSM context** goes through same-origin `/api/overpass` first (then direct mirrors as fallback). That keeps local and production behavior aligned and avoids adblockers that often block `overpass-*.de` on non-localhost sites.

Vercel Hobby functions are short-lived (~10s), so OSM queries are kept light (paths + building *centers*). Full building footprints may still time out on busy mirrors — the UI warning is dismissible when that happens.

## Develop

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). API calls go through Vite middleware under `/api/*`.

## Production

```bash
npm run build
npm run start
```

`npm run start` serves `dist/` and the same `/api` proxies via `server/prod.mjs`.

### Vercel

Yes — deploy as a Vite app. Static assets come from `dist/`; `/api/*` is handled by serverless functions in `api/` (same elevation, geocode, and Overpass proxies).

```bash
npx vercel
```

Or connect the GitHub repo in the Vercel dashboard (framework: Vite, output: `dist`).

**Note:** Overpass requests can be slow. The Overpass function allows up to 60s (`maxDuration`). On the Vercel Hobby plan the limit is lower (~10s), so OSM context may time out more often there — Pro is safer for this app.

## Notes & limits

- **Europe only** for v1 (EU-DEM coverage). Outside that bbox the UI shows a clear message.
- OpenTopoData public API: ~1 request/second, 100 points/request — neighborhood scans take a short while.
- Building/tree heights often use defaults when OSM lacks `height` / `building:levels`.
- Access classification is best-effort from OSM; it is not legal advice.

## Attribution

Map data © OpenStreetMap contributors. Elevation © EU-DEM / Copernicus via OpenTopoData. Basemap via OpenFreeMap.
