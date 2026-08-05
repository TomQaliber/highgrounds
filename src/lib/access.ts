import type { AccessFeature, AccessKind, Viewpoint } from './types'
import { closestOnLine, distanceM, pointInRing } from './geo'

const SNAP_M = 70
const CLASSIFY_M = 90

function featureDistance(
  point: { lat: number; lng: number },
  feature: AccessFeature,
): { distanceM: number; snap?: { lat: number; lng: number } } {
  if (feature.isPolygon && feature.geometry.length >= 3) {
    if (pointInRing(point.lng, point.lat, feature.geometry)) {
      return { distanceM: 0, snap: point }
    }
    // distance to boundary
    const onEdge = closestOnLine(point, feature.geometry)
    return { distanceM: onEdge.distanceM, snap: { lat: onEdge.lat, lng: onEdge.lng } }
  }
  const onLine = closestOnLine(point, feature.geometry)
  return { distanceM: onLine.distanceM, snap: { lat: onLine.lat, lng: onLine.lng } }
}

export function classifyAndSnapViewpoints(
  viewpoints: Viewpoint[],
  features: AccessFeature[],
): Viewpoint[] {
  return viewpoints.map((vp) => {
    let bestPublic: { dist: number; snap: { lat: number; lng: number } } | null = null
    let nearestPrivateDist = Infinity
    let nearestPublicDist = Infinity
    let nearestAnyDist = Infinity

    for (const f of features) {
      const { distanceM: d, snap } = featureDistance(vp, f)
      nearestAnyDist = Math.min(nearestAnyDist, d)

      if (f.access === 'private' && f.kind === 'restricted') {
        nearestPrivateDist = Math.min(nearestPrivateDist, d)
      }
      if (f.access === 'public' && (f.kind === 'path' || f.kind === 'park')) {
        nearestPublicDist = Math.min(nearestPublicDist, d)
        if (snap && d <= SNAP_M && (!bestPublic || d < bestPublic.dist)) {
          bestPublic = { dist: d, snap }
        }
      }
      if (f.access === 'private' && f.kind === 'path') {
        nearestPrivateDist = Math.min(nearestPrivateDist, d)
      }
    }

    let access: AccessKind = 'unknown'
    if (nearestPublicDist <= CLASSIFY_M && nearestPublicDist <= nearestPrivateDist) {
      access = 'public'
    } else if (nearestPrivateDist <= CLASSIFY_M && nearestPrivateDist < nearestPublicDist) {
      access = 'private'
    } else if (nearestPublicDist <= CLASSIFY_M) {
      access = 'public'
    } else if (nearestPrivateDist <= CLASSIFY_M) {
      access = 'private'
    }

    // Prefer snapping onto nearby public access if close
    let lat = vp.lat
    let lng = vp.lng
    if (bestPublic && access !== 'private') {
      lat = bestPublic.snap.lat
      lng = bestPublic.snap.lng
      access = 'public'
    }

    return { ...vp, lat, lng, access }
  })
}

export function accessLabel(access: AccessKind): string {
  switch (access) {
    case 'public':
      return 'Public'
    case 'private':
      return 'Private'
    default:
      return 'Unknown'
  }
}

/** Quick check helper used in tests / debug */
export function nearestFeatureDistance(
  point: { lat: number; lng: number },
  features: AccessFeature[],
): number {
  let best = Infinity
  for (const f of features) {
    best = Math.min(best, featureDistance(point, f).distanceM)
  }
  return best === Infinity ? distanceM(point, point) : best
}
