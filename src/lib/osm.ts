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

/**
 * Prefer direct Overpass (CORS *) so mobile / unblocked browsers skip Vercel.
 * Fall back to same-origin /api/overpass when mirrors are blocked (e.g. adblock).
 */
const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  '/api/overpass',
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

/** Paths / parks — keep light for Vercel Hobby (~10s). */
function buildAccessQuery(bb: string): string {
  return `
[out:json][timeout:8];
(
  way["highway"~"^(footway|path|steps|pedestrian|living_street|track|unclassified|residential|tertiary|secondary|service)$"](${bb});
  way["leisure"~"^(park|nature_reserve)$"](${bb});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${bb});
);
out body geom;
`.trim()
}

/**
 * Building/forest centers (fast). Full footprints often exceed Hobby timeouts
 * in cities; centers still feed sun-blocking as approximate discs.
 */
function buildObstacleCenterQuery(bb: string): string {
  return `
[out:json][timeout:8];
(
  way["building"](${bb});
  way["natural"="wood"](${bb});
  way["landuse"="forest"](${bb});
);
out center tags;
`.trim()
}

async function postOverpass(query: string): Promise<OverpassResponse> {
  let lastError: Error | null = null

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const isProxy = endpoint.startsWith('/')
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(isProxy ? 12_000 : 16_000),
      })
      if (!res.ok) {
        lastError = new Error(`OpenStreetMap request failed (${res.status})`)
        continue
      }
      return (await res.json()) as OverpassResponse
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw lastError ?? new Error('OpenStreetMap request failed')
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
      /^(footway|path|steps|pedestrian|living_street|track|unclassified|residential|tertiary|secondary|service)$/.test(
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

export async function fetchOsmContext(bbox: {
  south: number
  west: number
  north: number
  east: number
}): Promise<{ obstacles: Obstacle[]; accessFeatures: AccessFeature[] }> {
  const { south, west, north, east } = bbox
  const bb = `${south},${west},${north},${east}`

  let lastError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(900 * attempt)

    let accessFeatures: AccessFeature[] = []
    let obstacles: Obstacle[] = []
    let accessOk = false
    let obstaclesOk = false

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
  }

  throw lastError ?? new Error('OpenStreetMap request failed')
}
