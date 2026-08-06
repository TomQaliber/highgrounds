# High Grounds

Europe-focused web app that finds elevated, accessible viewpoints near a location or address, marks them on a map with the nearest address and public/private status, and lets you scrub through daytime to see the sun’s direction and whether buildings or trees block the view.

## Features

- Search by address or use device location
- EU-DEM elevation sampling and local high-ground detection
- Walkable path / track pins from **OpenFreeMap vector tiles** (same data as the basemap)
- Daytime timeline with sun azimuth overlay and line-of-sight scoring

## Stack

- Vite + React + TypeScript
- MapLibre GL (OpenFreeMap basemap)
- SunCalc
- Proxied APIs: OpenTopoData (`eudem25m`), Nominatim

## Local vs Vercel

Locally, Vite middleware serves `/api/*`. On Vercel, elevation and geocode use serverless functions in `api/`.

Path candidates are read from basemap tiles in the browser (`querySourceFeatures`), so they work the same on Vercel and locally — no Overpass required.

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

Deploy as a Vite app (output `dist`). Elevation and geocode use `/api/*` functions.

```bash
npx vercel
```

## Notes & limits

- **Europe only** for v1 (EU-DEM coverage). Outside that bbox the UI shows a clear message.
- OpenTopoData public API: ~1 request/second, 100 points/request — neighborhood scans take a short while.
- Path pins depend on vector tiles loaded at ~zoom 14+; names/access tags are best-effort from the basemap.
- Building/tree sun-blocking is limited without a separate obstacle source — verify views on site.
- Access classification is best-effort; it is not legal advice.

## Attribution

Map data © OpenStreetMap contributors. Elevation © EU-DEM / Copernicus via OpenTopoData. Basemap via OpenFreeMap.
