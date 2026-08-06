import type { Map } from 'maplibre-gl'
import type { AccessFeature, LatLng } from './types'
import { bboxFromCenter, distanceM } from './geo'

/** OpenMapTiles / OpenFreeMap liberty vector source id */
export const TILE_SOURCE_ID = 'openmaptiles'
export const TRANSPORT_LAYER = 'transportation'
export const TRANSPORT_NAME_LAYER = 'transportation_name'

/** Classes that are typically walkable (OpenMapTiles `class` field). */
const WALKABLE_CLASSES = new Set(['path', 'track', 'service', 'pedestrian'])

/** Prefer these when ranking / labeling. */
const PREFERRED_CLASSES = new Set(['path', 'track', 'pedestrian'])

type Ring = [number, number][]

function asRings(geometry: { type: string; coordinates?: unknown } | null | undefined): Ring[] {
  if (!geometry) return []
  if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates as Ring]
  }
  if (geometry.type === 'MultiLineString' && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates as Ring[]
  }
  return []
}

function lineKey(ring: Ring, className: string): string {
  if (ring.length === 0) return className
  const a = ring[0]
  const b = ring[ring.length - 1]
  return [
    className,
    a[0].toFixed(5),
    a[1].toFixed(5),
    b[0].toFixed(5),
    b[1].toFixed(5),
    ring.length,
  ].join('|')
}

function midpoint(ring: Ring): LatLng | null {
  if (ring.length === 0) return null
  const mid = ring[Math.floor(ring.length / 2)]
  return { lng: mid[0], lat: mid[1] }
}

function nearestName(
  point: LatLng,
  names: Array<{ lat: number; lng: number; name: string }>,
  maxM = 90,
): string | null {
  let best: string | null = null
  let bestD = maxM
  for (const n of names) {
    const d = distanceM(point, n)
    if (d < bestD) {
      bestD = d
      best = n.name
    }
  }
  return best
}

/**
 * Read walkable path/track geometries from loaded OpenFreeMap vector tiles.
 * Requires the map to be styled + zoomed (~14+) over the search area with tiles loaded.
 */
export function extractWalkablePathsFromMap(
  map: Map,
  center: LatLng,
  radiusM: number,
): AccessFeature[] {
  if (!map.getSource(TILE_SOURCE_ID)) return []

  const nameHits: Array<{ lat: number; lng: number; name: string }> = []
  try {
    const rawNames = map.querySourceFeatures(TILE_SOURCE_ID, {
      sourceLayer: TRANSPORT_NAME_LAYER,
    })
    for (const f of rawNames) {
      const name = (f.properties?.name ?? f.properties?.name_en) as string | undefined
      if (!name) continue
      const rings = asRings(f.geometry)
      const mid = rings[0] ? midpoint(rings[0]) : null
      if (mid) nameHits.push({ ...mid, name })
    }
  } catch {
    /* name layer optional */
  }

  let raw: Array<{
    geometry?: { type: string; coordinates?: unknown } | null
    properties?: Record<string, unknown> | null
  }> = []
  try {
    raw = map.querySourceFeatures(TILE_SOURCE_ID, {
      sourceLayer: TRANSPORT_LAYER,
    })
  } catch {
    return []
  }

  const seen = new Set<string>()
  const out: AccessFeature[] = []
  let idx = 0

  for (const f of raw) {
    const className = String(f.properties?.class ?? '')
    if (!WALKABLE_CLASSES.has(className)) continue

    const rings = asRings(f.geometry)
    for (const ring of rings) {
      if (ring.length < 2) continue

      const mid = midpoint(ring)
      if (!mid || distanceM(center, mid) > radiusM + 120) {
        const anyInside = ring.some(([lng, lat]) => distanceM(center, { lat, lng }) <= radiusM + 80)
        if (!anyInside) continue
      }

      const key = lineKey(ring, className)
      if (seen.has(key)) continue
      seen.add(key)

      const propName = typeof f.properties?.name === 'string' ? f.properties.name : null
      const name = propName || (mid ? nearestName(mid, nameHits) : null)

      out.push({
        id: `tile-${className}-${idx++}`,
        kind: 'path',
        access: 'public',
        geometry: ring,
        isPolygon: false,
        name: name || (PREFERRED_CLASSES.has(className) ? `${className} way` : null),
      })
    }
  }

  return out
}

export function fitMapToSearchArea(map: Map, center: LatLng, radiusM: number): void {
  const bbox = bboxFromCenter(center, radiusM)
  map.fitBounds(
    [
      [bbox.west, bbox.south],
      [bbox.east, bbox.north],
    ],
    {
      padding: 48,
      maxZoom: 15,
      duration: 0,
    },
  )
  // Path classes often appear only from z14 in OpenMapTiles
  if (map.getZoom() < 14) {
    map.jumpTo({ center: [center.lng, center.lat], zoom: 14 })
  }
}

export function waitForMapIdle(map: Map, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      map.off('idle', onIdle)
      resolve()
    }
    const onIdle = () => done()
    const timer = setTimeout(done, timeoutMs)
    map.once('idle', onIdle)
    requestAnimationFrame(() => map.triggerRepaint())
  })
}
