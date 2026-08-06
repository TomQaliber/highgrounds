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
const OSM_BUDGET_MS = 18_000
const PER_REQUEST_MS = 7_000

const DIRECT_MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

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

/** Paths / parks — include field tracks, bridleways, and cycleways. */
function buildAccessQuery(bb: string): string {
  return `
[out:json][timeout:6];
(
  way["highway"~"^(footway|path|steps|pedestrian|bridleway|cycleway|living_street|track|unclassified|residential|tertiary|secondary|service)$"](${bb});
  way["leisure"~"^(park|nature_reserve)$"](${bb});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${bb});
);
out body geom;
`.trim()
}

function buildObstacleCenterQuery(bb: string): string {
  return `
[out:json][timeout:6];
(
  way["building"](${bb});
  way["natural"="wood"](${bb});
  way["landuse"="forest"](${bb});
);
out center tags;
`.trim()
}

/** AbortController + timer — more reliable on iOS than AbortSignal.timeout(). */
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

async function postOne(endpoint: string, body: string, ms: number): Promise<OverpassResponse> {
  const res = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
    ms,
  )
  if (!res.ok) {
    throw new Error(`OpenStreetMap request failed (${res.status})`)
  }
  return (await res.json()) as OverpassResponse
}

/**
 * Race same-origin proxy + one direct mirror. First success wins.
 * Prevents endless spinning when a mirror hangs without aborting.
 */
async function postOverpass(query: string): Promise<OverpassResponse> {
  const body = `data=${encodeURIComponent(query)}`
  const mirror = DIRECT_MIRRORS[Math.floor(Math.random() * DIRECT_MIRRORS.length)]!

  const attempts = [
    postOne('/api/overpass', body, PER_REQUEST_MS),
    postOne(mirror, body, PER_REQUEST_MS),
  ]

  try {
    return await Promise.any(attempts)
  } catch {
    // Promise.any AggregateError — try one more mirror sequentially
    for (const endpoint of DIRECT_MIRRORS) {
      if (endpoint === mirror) continue
      try {
        return await postOne(endpoint, body, PER_REQUEST_MS)
      } catch {
        /* try next */
      }
    }
    throw new Error('OpenStreetMap request failed')
  }
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
    let accessFeatures: AccessFeature[] = []
    let obstacles: Obstacle[] = []
    let accessOk = false
    let obstaclesOk = false
    let lastError: Error | null = null

    try {
      const accessData = await postOverpass(buildAccessQuery(bb))
      accessFeatures = parseElements(accessData.elements ?? []).accessFeatures
      accessOk = true
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    try {
      const obstacleData = await postOverpass(buildObstacleCenterQuery(bb))
      obstacles = parseElements(obstacleData.elements ?? []).obstacles
      obstaclesOk = true
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    if (accessOk || obstaclesOk) {
      return { obstacles, accessFeatures }
    }

    // One short retry of access only
    await sleep(400)
    try {
      const accessData = await postOverpass(buildAccessQuery(bb))
      accessFeatures = parseElements(accessData.elements ?? []).accessFeatures
      return { obstacles: [], accessFeatures }
    } catch (err) {
      throw lastError ?? (err instanceof Error ? err : new Error(String(err)))
    }
  }

  return withBudget(run(), OSM_BUDGET_MS, 'OpenStreetMap')
}
