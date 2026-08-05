import type { LatLng, LosScore, Obstacle, Viewpoint } from './types'
import { destinationPoint, distanceM, pointInRing } from './geo'
import { sunStateAt } from './sun'
import { aspectAlignment } from './candidates'

const RAY_MAX_M = 2500
const RAY_STEP_M = 30
const EYE_HEIGHT_M = 1.6
const SUN_DISK_DEG = 0.53
const PARTIAL_MARGIN_DEG = 1.5
/** Minutes after sunrise / before sunset — typical “watch the sun” window */
const EVENT_OFFSET_MS = 18 * 60 * 1000

function obstacleHitsPoint(obstacle: Obstacle, point: LatLng): boolean {
  if (obstacle.center && obstacle.radiusM != null) {
    return distanceM(obstacle.center, point) <= obstacle.radiusM
  }
  if (obstacle.ring.length >= 3) {
    return pointInRing(point.lng, point.lat, obstacle.ring)
  }
  return false
}

/**
 * Approximate line-of-sight: walk toward the sun; if an obstacle's angular
 * height exceeds the sun altitude, the view is blocked.
 */
export function scoreLineOfSight(
  viewpoint: LatLng & { elevation: number },
  date: Date,
  obstacles: Obstacle[],
): LosScore {
  const sun = sunStateAt(date, viewpoint)
  if (sun.altitudeDeg < -0.3) return 'night'
  if (sun.altitudeDeg < 0) return 'partial'

  let worstClearance = Infinity

  for (let d = RAY_STEP_M; d <= RAY_MAX_M; d += RAY_STEP_M) {
    const sample = destinationPoint(viewpoint, sun.azimuthDeg, d)
    for (const obs of obstacles) {
      if (!obstacleHitsPoint(obs, sample)) continue
      const angleDeg = (Math.atan2(obs.heightM - EYE_HEIGHT_M, d) * 180) / Math.PI
      const clearance = sun.altitudeDeg - angleDeg
      worstClearance = Math.min(worstClearance, clearance)
    }
    if (sun.altitudeDeg > 25 && d > 800) break
  }

  if (worstClearance === Infinity) return 'clear'
  if (worstClearance < -SUN_DISK_DEG) return 'blocked'
  if (worstClearance < PARTIAL_MARGIN_DEG) return 'partial'
  return 'clear'
}

/** Max obstacle elevation angle (degrees) looking along a compass bearing. */
export function maxObstacleAngle(
  viewpoint: LatLng,
  bearingDeg: number,
  obstacles: Obstacle[],
): number {
  let maxAngle = 0
  for (let d = RAY_STEP_M; d <= RAY_MAX_M; d += RAY_STEP_M) {
    const sample = destinationPoint(viewpoint, bearingDeg, d)
    for (const obs of obstacles) {
      if (!obstacleHitsPoint(obs, sample)) continue
      const angleDeg = (Math.atan2(obs.heightM - EYE_HEIGHT_M, d) * 180) / Math.PI
      maxAngle = Math.max(maxAngle, angleDeg)
    }
  }
  return maxAngle
}

/** Horizon openness → LOS-like score (lower obstacle angle = clearer sunrise/sunset). */
export function scoreHorizonOpenness(maxAngleDeg: number): LosScore {
  if (maxAngleDeg < 2.5) return 'clear'
  if (maxAngleDeg < 8) return 'partial'
  return 'blocked'
}

export function scoreSunriseSunset(
  viewpoint: LatLng & { elevation: number; aspectDeg?: number | null },
  day: Date,
  obstacles: Obstacle[],
): { sunriseLos: LosScore; sunsetLos: LosScore } {
  const base = sunStateAt(day, viewpoint)
  const sunriseWatch = new Date(base.sunrise.getTime() + EVENT_OFFSET_MS)
  const sunsetWatch = new Date(base.sunset.getTime() - EVENT_OFFSET_MS)

  const sunriseTimed = scoreLineOfSight(viewpoint, sunriseWatch, obstacles)
  const sunsetTimed = scoreLineOfSight(viewpoint, sunsetWatch, obstacles)

  const sunriseAz = sunStateAt(sunriseWatch, viewpoint).azimuthDeg
  const sunsetAz = sunStateAt(sunsetWatch, viewpoint).azimuthDeg
  const sunriseHorizon = scoreHorizonOpenness(maxObstacleAngle(viewpoint, sunriseAz, obstacles))
  const sunsetHorizon = scoreHorizonOpenness(maxObstacleAngle(viewpoint, sunsetAz, obstacles))

  let sunriseLos = worseScore(sunriseTimed, sunriseHorizon)
  let sunsetLos = worseScore(sunsetTimed, sunsetHorizon)

  // Hillside aspect: facing the sun helps; facing the opposite way (ridge toward sun) hurts
  sunriseLos = applyAspect(sunriseLos, viewpoint.aspectDeg, sunriseAz)
  sunsetLos = applyAspect(sunsetLos, viewpoint.aspectDeg, sunsetAz)

  return { sunriseLos, sunsetLos }
}

/** If the slope faces away from the sun, the hill mass is more likely to block that view. */
function applyAspect(
  score: LosScore,
  aspectDeg: number | null | undefined,
  sunAzimuthDeg: number,
): LosScore {
  if (aspectDeg == null || score === 'night' || score === 'blocked') return score
  const align = aspectAlignment(aspectDeg, sunAzimuthDeg)
  if (align < -0.4) {
    return worseScore(score, 'blocked')
  }
  if (align < 0) {
    return worseScore(score, 'partial')
  }
  return score
}

function worseScore(a: LosScore, b: LosScore): LosScore {
  const rank: Record<LosScore, number> = { clear: 0, partial: 1, night: 2, blocked: 3 }
  return rank[a] >= rank[b] ? a : b
}

export function scoreViewpoints(
  viewpoints: Viewpoint[],
  date: Date,
  obstacles: Obstacle[],
): Viewpoint[] {
  return viewpoints.map((vp) => {
    const { sunriseLos, sunsetLos } = scoreSunriseSunset(vp, date, obstacles)
    return {
      ...vp,
      los: scoreLineOfSight(vp, date, obstacles),
      sunriseLos,
      sunsetLos,
      nearbyHeightsEstimated: obstacles.some((o) => o.heightEstimated),
    }
  })
}

/** Update only the scrubber-time LOS; keep sunrise/sunset scores. */
export function scoreViewpointsAtTime(
  viewpoints: Viewpoint[],
  date: Date,
  obstacles: Obstacle[],
): Viewpoint[] {
  return viewpoints.map((vp) => ({
    ...vp,
    los: scoreLineOfSight(vp, date, obstacles),
  }))
}

export function isGoodSunSpot(score: LosScore | undefined): boolean {
  return score === 'clear' || score === 'partial'
}

export function losRank(score: LosScore | undefined): number {
  switch (score) {
    case 'clear':
      return 0
    case 'partial':
      return 1
    case 'night':
      return 2
    case 'blocked':
      return 3
    default:
      return 4
  }
}
