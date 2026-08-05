/**
 * Production static server with the same API proxies used in Vite middleware.
 * Usage: node server/prod.mjs   (after npm run build)
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT) || 4173
const USER_AGENT = 'HighGrounds/1.0 (https://github.com/highgrounds; europe-viewpoint-finder)'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function readReq(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function proxy(res, url, init) {
  try {
    const upstream = await fetch(url, init)
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    })
    res.end(buf)
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: String(err) }))
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let filePath = path.join(DIST, urlPath === '/' ? '/index.html' : urlPath)
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html')
  }
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/'

  if (url.startsWith('/api/elevation')) {
    const qs = url.includes('?') ? url.slice(url.indexOf('?')) : ''
    await proxy(res, `https://api.opentopodata.org/v1/eudem25m${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    })
    return
  }

  if (url.startsWith('/api/geocode')) {
    const qs = url.includes('?') ? url.slice(url.indexOf('?')) : ''
    const apiPath = url.startsWith('/api/geocode/reverse') ? '/reverse' : '/search'
    await proxy(res, `https://nominatim.openstreetmap.org${apiPath}${qs}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    })
    return
  }

  if (url.startsWith('/api/overpass') && req.method === 'POST') {
    const body = await readReq(req)
    const endpoints = [
      'https://overpass-api.de/api/interpreter',
      'https://lz4.overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
    ]
    let lastStatus = 502
    let lastBuf = Buffer.from('{"error":"All Overpass endpoints failed"}')
    for (const endpoint of endpoints) {
      try {
        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body,
          signal: AbortSignal.timeout(90_000),
        })
        const buf = Buffer.from(await upstream.arrayBuffer())
        if (upstream.ok) {
          res.writeHead(200, {
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
          })
          res.end(buf)
          return
        }
        lastStatus = upstream.status
        lastBuf = buf
        if (![429, 502, 503, 504].includes(upstream.status)) {
          res.writeHead(upstream.status, { 'Content-Type': 'application/json' })
          res.end(buf)
          return
        }
      } catch {
        lastStatus = 502
      }
    }
    res.writeHead(lastStatus, { 'Content-Type': 'application/json' })
    res.end(lastBuf)
    return
  }

  serveStatic(req, res)
})

server.listen(PORT, () => {
  console.log(`High Grounds listening on http://localhost:${PORT}`)
})
