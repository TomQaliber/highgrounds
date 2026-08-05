import { USER_AGENT } from './_shared'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const body = await request.text()
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
        signal: AbortSignal.timeout(55_000),
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
      lastStatus = 502
      lastText = JSON.stringify({ error: `Overpass unreachable: ${endpoint}` })
    }
  }

  return new Response(lastText, {
    status: lastStatus,
    headers: { 'Content-Type': 'application/json' },
  })
}
