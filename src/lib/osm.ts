import type { AccessFeature, Obstacle } from './types'
import { sleep } from './geo'

interface OverpassElement {
  type: 'node' | 'way' | 'relation'
  id: number
  tags?: Record<string, string>
  lat?: number
  lon?: number
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

/** Lighter queries: skip individual tree nodes (too heavy in cities); use woods/forests. */
function buildQuery(bb: string): string {
  return `
[out:json][timeout:45];
(
  way["building"](${bb});
  way["natural"="wood"](${bb});
  way["landuse"="forest"](${bb});
  way["highway"~"^(footway|path|steps|pedestrian|living_street|track|unclassified|residential|tertiary|secondary|service)$"](${bb});
  way["leisure"~"^(park|nature_reserve)$"](${bb});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${bb});
);
out body geom;
`.trim()
}

async function postOverpass(query: string): Promise<OverpassResponse> {
  const res = await fetch('/api/overpass', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  })

  if (!res.ok) {
    throw new Error(`OpenStreetMap request failed (${res.status})`)
  }

  return (await res.json()) as OverpassResponse
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
    if (!ring) continue

    if (tags.building) {
      const { height, estimated } = parseHeight(tags, DEFAULT_BUILDING_H)
      obstacles.push({
        id: `bldg-${el.id}`,
        kind: 'building',
        ring,
        heightM: height,
        heightEstimated: estimated,
      })
    }

    if (tags.natural === 'wood' || tags.landuse === 'forest') {
      const { height, estimated } = parseHeight(tags, DEFAULT_FOREST_H)
      obstacles.push({
        id: `forest-${el.id}`,
        kind: 'forest',
        ring,
        heightM: height,
        heightEstimated: estimated || !tags.height,
      })
    }

    const highway = tags.highway
    const leisure = tags.leisure
    const landuse = tags.landuse
    const accessTag = tags.access

    if (highway && /^(footway|path|steps|pedestrian|living_street|track|unclassified|residential|tertiary|secondary|service)$/.test(highway)) {
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
  const query = buildQuery(bb)

  let lastError: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) await sleep(1500 * attempt)
      const data = await postOverpass(query)
      return parseElements(data.elements ?? [])
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw lastError ?? new Error('OpenStreetMap request failed')
}
