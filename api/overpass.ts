export const config = {
  runtime: 'edge',
  // Hobby plan caps around 10s — keep upstream attempts inside that budget
  maxDuration: 10,
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
  let lastStatus = 502
  let lastText = '{"error":"All Overpass endpoints failed"}'

  // Rotate start so repeated calls don't always hit the same busy mirror
  const start = Math.floor(Math.random() * OVERPASS_ENDPOINTS.length)
  const endpoints = [
    ...OVERPASS_ENDPOINTS.slice(start),
    ...OVERPASS_ENDPOINTS.slice(0, start),
  ]

  // At most two mirrors so we stay within Hobby's ~10s function limit
  for (const endpoint of endpoints.slice(0, 2)) {
    try {
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body,
        signal: AbortSignal.timeout(7_500),
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
      lastText = text
      if (![429, 502, 503, 504].includes(upstream.status)) {
        return new Response(text, {
          status: upstream.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch {
      lastStatus = 504
      lastText = JSON.stringify({ error: `Overpass unreachable: ${endpoint}` })
    }
  }

  return new Response(lastText, {
    status: lastStatus,
    headers: { 'Content-Type': 'application/json' },
  })
}
