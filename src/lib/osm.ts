import type { AccessFeature, Obstacle } from './types'
import { sleep } from './geo'

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  geometry?: Array<{ lat: number; lon: number }>
}

interface OverpassResponse {
  elements?: OverpassElement[]
  remark?: string
}

const DEFAULT_BUILDING_H = 8
const METERS_PER_LEVEL = 3
const DEFAULT_TREE_H = 12
const DEFAULT_FOREST_H = 18

/** Hard cap so the loading spinner never hangs on OSM. */
const OSM_BUDGET_MS = 22_000
const PER_REQUEST_MS = 10_000

const DIRECT_MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

/** Serialize all Overpass traffic — parallel races were triggering 429s. */
let overpassQueue: Promise<unknown> = Promise.resolve()

function enqueueOverpass<T>(fn: () => Promise<T>): Promise<T> {
  const run = overpassQueue.then(fn, fn)
  overpassQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function parseHeight(tags: Record<string, string> | undefined, fallback: number): {
  height: number
  estimated: boolean
} {
  if (!tags) return { height: fallback, estimated: true }
  if (tags.height) {
    const n = parseFloat(tags.height.replace(',', '.'))
    if (!Number.isNaN(n) && n > 0) return { height: n, estimated: false }
  }
  if (tags['building:levels']) {
    const levels = parseFloat(tags['building:levels'])
    if (!Number.isNaN(levels) && levels > 0) {
      return { height: levels * METERS_PER_LEVEL, estimated: true }
    }
  }
  return { height: fallback, estimated: true }
}

function wayRing(el: OverpassElement): [number, number][] | null {
  if (!el.geometry || el.geometry.length < 2) return null
  return el.geometry.map((g) => [g.lon, g.lat] as [number, number])
}

function elementCenter(el: OverpassElement): { lat: number; lng: number } | null {
  if (el.center) return { lat: el.center.lat, lng: el.center.lon }
  if (el.lat != null && el.lon != null) return { lat: el.lat, lng: el.lon }
  if (el.geometry && el.geometry.length > 0) {
    let lat = 0
    let lng = 0
    for (const g of el.geometry) {
      lat += g.lat
      lng += g.lon
    }
    const n = el.geometry.length
    return { lat: lat / n, lng: lng / n }
  }
  return null
}

/**
 * One query for paths (full geom) + buildings/woods (centers).
 * Halves request count vs two separate posts (helps avoid 429).
 */
function buildCombinedQuery(bb: string): string {
  return `
[out:json][timeout:10];
(
  way["highway"~"^(footway|path|steps|pedestrian|bridleway|cycleway|living_street|track|unclassified|residential|tertiary|secondary|service)$"](${bb});
  way["leisure"~"^(park|nature_reserve)$"](${bb});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${bb});
);
out body geom;
(
  way["building"](${bb});
  way["natural"="wood"](${bb});
  way["landuse"="forest"](${bb});
);
out center tags;
`.trim()
}

/** Lighter fallback if the combined query is rate-limited or times out. */
function buildAccessOnlyQuery(bb: string): string {
  return `
[out:json][timeout:8];
(
  way["highway"~"^(footway|path|steps|pedestrian|bridleway|cycleway|living_street|track|unclassified|residential|tertiary|secondary|service)$"](${bb});
  way["leisure"~"^(park|nature_reserve)$"](${bb});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${bb});
);
out body geom;
`.trim()
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function postOne(endpoint: string, body: string): Promise<OverpassResponse> {
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    PER_REQUEST_MS,
  )

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After'))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 8_000)
      : 3_500
    const err = new Error(`OpenStreetMap rate limited (429)`) as Error & {
      status?: number
      waitMs?: number
    }
    err.status = 429
    err.waitMs = waitMs
    throw err
  }

  if (!res.ok) {
    const err = new Error(`OpenStreetMap request failed (${res.status})`) as Error & {
      status?: number
    }
    err.status = res.status
    throw err
  }

  const data = (await res.json()) as OverpassResponse
  return data
}

/**
 * Sequential tries with 429 backoff. No parallel races (those caused rate limits).
 */
async function postOverpass(query: string): Promise<OverpassResponse> {
  return enqueueOverpass(async () => {
    const body = `data=${encodeURIComponent(query)}`
    const start = Math.floor(Math.random() * DIRECT_MIRRORS.length)
    const endpoints = [
      '/api/overpass',
      ...DIRECT_MIRRORS.slice(start),
      ...DIRECT_MIRRORS.slice(0, start),
    ]

    let lastError: Error | null = null

    for (const endpoint of endpoints) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await postOne(endpoint, body)
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
          const status = (err as { status?: number }).status
          const waitMs = (err as { waitMs?: number }).waitMs
          if (status === 429) {
            await sleep(waitMs ?? 3_500)
            continue // retry same endpoint once
          }
          break // try next endpoint
        }
      }
      // Small gap before next mirror to stay under rate limits
      await sleep(400)
    }

    throw lastError ?? new Error('OpenStreetMap request failed')
  })
}

function parseElements(elements: OverpassElement[]): {
  obstacles: Obstacle[]
  accessFeatures: AccessFeature[]
} {
  const obstacles: Obstacle[] = []
  const accessFeatures: AccessFeature[] = []

  for (const el of elements) {
    const tags = el.tags ?? {}

    if (el.type === 'node' && tags.natural === 'tree' && el.lat != null && el.lon != null) {
      const { height, estimated } = parseHeight(tags, DEFAULT_TREE_H)
      obstacles.push({
        id: `tree-${el.id}`,
        kind: 'tree',
        ring: [],
        heightM: height,
        heightEstimated: estimated,
        center: { lat: el.lat, lng: el.lon },
        radiusM: 4,
      })
      continue
    }

    const ring = wayRing(el)
    const center = elementCenter(el)

    if (tags.building) {
      const { height, estimated } = parseHeight(tags, DEFAULT_BUILDING_H)
      if (ring && ring.length >= 3) {
        obstacles.push({
          id: `bldg-${el.id}`,
          kind: 'building',
          ring,
          heightM: height,
          heightEstimated: estimated,
        })
      } else if (center) {
        obstacles.push({
          id: `bldg-${el.id}`,
          kind: 'building',
          ring: [],
          heightM: height,
          heightEstimated: estimated,
          center,
          radiusM: 14,
        })
      }
    }

    if (tags.natural === 'wood' || tags.landuse === 'forest') {
      const { height, estimated } = parseHeight(tags, DEFAULT_FOREST_H)
      if (ring && ring.length >= 3) {
        obstacles.push({
          id: `forest-${el.id}`,
          kind: 'forest',
          ring,
          heightM: height,
          heightEstimated: estimated || !tags.height,
        })
      } else if (center) {
        obstacles.push({
          id: `forest-${el.id}`,
          kind: 'forest',
          ring: [],
          heightM: height,
          heightEstimated: estimated || !tags.height,
          center,
          radiusM: 40,
        })
      }
    }

    if (!ring) continue

    const highway = tags.highway
    const leisure = tags.leisure
    const landuse = tags.landuse
    const accessTag = tags.access

    if (
      highway &&
      /^(footway|path|steps|pedestrian|bridleway|cycleway|living_street|track|unclassified|residential|tertiary|secondary|service)$/.test(
        highway,
      )
    ) {
      accessFeatures.push({
        id: `path-${el.id}`,
        kind: 'path',
        access: accessTag === 'private' || accessTag === 'no' ? 'private' : 'public',
        geometry: ring,
        isPolygon: false,
        name: tags.name ?? tags.ref ?? null,
      })
    }

    if (
      leisure === 'park' ||
      leisure === 'nature_reserve' ||
      landuse === 'grass' ||
      landuse === 'recreation_ground' ||
      landuse === 'village_green'
    ) {
      accessFeatures.push({
        id: `park-${el.id}`,
        kind: 'park',
        access: accessTag === 'private' || accessTag === 'no' ? 'private' : 'public',
        geometry: ring,
        isPolygon: ring.length >= 3,
      })
    }
  }

  return { obstacles, accessFeatures }
}

async function withBudget<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function fetchOsmContext(bbox: {
  south: number
  west: number
  north: number
  east: number
}): Promise<{ obstacles: Obstacle[]; accessFeatures: AccessFeature[] }> {
  const { south, west, north, east } = bbox
  const bb = `${south},${west},${north},${east}`

  const run = async () => {
    try {
      const data = await postOverpass(buildCombinedQuery(bb))
      const parsed = parseElements(data.elements ?? [])
      if (parsed.accessFeatures.length > 0 || parsed.obstacles.length > 0) {
        return parsed
      }
    } catch {
      /* fall through to lighter query */
    }

    await sleep(1_200)
    const accessData = await postOverpass(buildAccessOnlyQuery(bb))
    const parsed = parseElements(accessData.elements ?? [])
    if (parsed.accessFeatures.length === 0 && parsed.obstacles.length === 0) {
      throw new Error('OpenStreetMap returned no map features')
    }
    return { obstacles: [], accessFeatures: parsed.accessFeatures }
  }

  return withBudget(run(), OSM_BUDGET_MS, 'OpenStreetMap')
}
