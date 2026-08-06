export const config = {
  // Node runtime: Edge was returning 504 with "No outgoing requests"
  // (outbound Overpass fetch never completed from the Edge isolate).
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

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await request.text()
  if (!body) {
    return Response.json({ error: 'Missing Overpass query body' }, { status: 400 })
  }

  let lastStatus = 502
  let lastText = '{"error":"All Overpass endpoints failed"}'

  const start = Math.floor(Math.random() * OVERPASS_ENDPOINTS.length)
  const endpoints = [
    ...OVERPASS_ENDPOINTS.slice(start),
    ...OVERPASS_ENDPOINTS.slice(0, start),
  ]

  // Try a few mirrors quickly; Hobby may still clamp wall time ~10s
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
        return new Response(text, {
          status: 200,
          headers: {
            'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
            'X-Overpass-Endpoint': endpoint,
          },
        })
      }
      lastStatus = upstream.status
      lastText = text || JSON.stringify({ error: `Overpass ${upstream.status}` })
      if (![429, 502, 503, 504].includes(upstream.status)) {
        return new Response(lastText, {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json' },
        })
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

  return new Response(lastText, {
    status: lastStatus,
    headers: { 'Content-Type': 'application/json' },
  })
}
