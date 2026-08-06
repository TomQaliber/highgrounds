import type { IncomingMessage, ServerResponse } from 'node:http'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

const USER_AGENT =
  'HighGrounds/1.0 (https://github.com/TomQaliber/highgrounds; europe-viewpoint-finder)'

const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

type VercelRequest = IncomingMessage & {
  method?: string
  body?: unknown
}

type VercelResponse = ServerResponse & {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
  send: (body: string) => void
}

/** Rebuild x-www-form-urlencoded body from Vercel’s parsed or raw request body. */
function getFormBody(req: VercelRequest): string {
  const body = req.body
  if (typeof body === 'string') return body
  if (body && typeof body === 'object' && 'data' in body) {
    const data = (body as { data: unknown }).data
    return `data=${encodeURIComponent(String(data ?? ''))}`
  }
  if (body && typeof body === 'object') {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      params.set(key, String(value ?? ''))
    }
    return params.toString()
  }
  return ''
}

function sendJson(res: VercelResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }

  const body = getFormBody(req)
  if (!body) {
    sendJson(res, 400, { error: 'Missing Overpass query body' })
    return
  }

  let lastStatus = 502
  let lastText = '{"error":"All Overpass endpoints failed"}'

  const start = Math.floor(Math.random() * OVERPASS_ENDPOINTS.length)
  const endpoints = [
    ...OVERPASS_ENDPOINTS.slice(start),
    ...OVERPASS_ENDPOINTS.slice(0, start),
  ]

  for (const endpoint of endpoints.slice(0, 3)) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body,
        signal: controller.signal,
      })
      const text = await upstream.text()
      if (upstream.ok) {
        res.statusCode = 200
        res.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') ?? 'application/json',
        )
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Overpass-Endpoint', endpoint)
        res.end(text)
        return
      }
      lastStatus = upstream.status
      lastText = text || JSON.stringify({ error: `Overpass ${upstream.status}` })
      if (![429, 502, 503, 504].includes(upstream.status)) {
        sendJson(res, upstream.status, lastText)
        return
      }
    } catch (err) {
      lastStatus = 504
      lastText = JSON.stringify({
        error: `Overpass unreachable: ${endpoint}`,
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      clearTimeout(timer)
    }
  }

  sendJson(res, lastStatus, lastText)
}
