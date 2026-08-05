export const config = {
  runtime: 'edge',
}

const USER_AGENT =
  'HighGrounds/1.0 (https://github.com/TomQaliber/highgrounds; europe-viewpoint-finder)'

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  try {
    const upstream = await fetch(
      `https://api.opentopodata.org/v1/eudem25m${url.search}`,
      {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      },
    )
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return Response.json(
      { error: 'Upstream request failed', detail: String(err) },
      { status: 502 },
    )
  }
}
