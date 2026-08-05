import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect } from 'vite'

const USER_AGENT = 'HighGrounds/1.0 (https://github.com/highgrounds; europe-viewpoint-finder)'

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

async function proxyJson(res: ServerResponse, url: string, init?: RequestInit): Promise<void> {
  try {
    const upstream = await fetch(url, init)
    const text = await upstream.text()
    res.statusCode = upstream.status
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(text)
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Upstream request failed', detail: String(err) }))
  }
}

async function proxyOverpass(res: ServerResponse, body: Buffer): Promise<void> {
  let lastStatus = 502
  let lastText = '{"error":"All Overpass endpoints failed"}'

  for (const endpoint of OVERPASS_ENDPOINTS) {
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
      const text = await upstream.text()
      if (upstream.ok) {
        res.statusCode = 200
        res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Overpass-Endpoint', endpoint)
        res.end(text)
        return
      }
      lastStatus = upstream.status
      lastText = text
      // Retry other mirrors on gateway / overload errors
      if (![429, 502, 503, 504].includes(upstream.status)) {
        res.statusCode = upstream.status
        res.setHeader('Content-Type', 'application/json')
        res.end(text)
        return
      }
    } catch {
      lastStatus = 502
      lastText = JSON.stringify({ error: `Overpass unreachable: ${endpoint}` })
    }
  }

  res.statusCode = lastStatus
  res.setHeader('Content-Type', 'application/json')
  res.end(lastText)
}

export function createProxyMiddleware(middlewares: Connect.Server): void {
  middlewares.use(async (req, res, next) => {
    const url = req.url ?? ''

    if (url.startsWith('/api/elevation')) {
      const qs = url.includes('?') ? url.slice(url.indexOf('?')) : ''
      await proxyJson(res, `https://api.opentopodata.org/v1/eudem25m${qs}`, {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      })
      return
    }

    if (url.startsWith('/api/geocode')) {
      const qs = url.includes('?') ? url.slice(url.indexOf('?')) : ''
      const path = url.startsWith('/api/geocode/reverse') ? '/reverse' : '/search'
      await proxyJson(res, `https://nominatim.openstreetmap.org${path}${qs}`, {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
      })
      return
    }

    if (url.startsWith('/api/overpass') && req.method === 'POST') {
      const body = await readBody(req)
      await proxyOverpass(res, body)
      return
    }

    next()
  })
}
