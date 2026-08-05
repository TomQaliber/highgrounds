import type { AccessFeature, ElevationPoint, Viewpoint } from './types'
import { distanceM, metersPerDegree } from './geo'

const MAX_CANDIDATES = 16
const PATH_SAMPLE_M = 80
const DEDUPE_M = 85
const RESERVED_PATH_SLOTS = 6

export interface TerrainCell extends ElevationPoint {
  aspectDeg: number | null
  slopeDeg: number
  row: number
  col: number
}

function buildTerrainGrid(samples: ElevationPoint[]): {
  grid: (TerrainCell | null)[][]
  rows: number
  cols: number
  mean: number
  cellM: number
} {
  const lats = samples.map((s) => s.lat)
  const lngs = samples.map((s) => s.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const midLat = (minLat + maxLat) / 2
  const { mPerDegLat, mPerDegLng } = metersPerDegree(midLat)

  const cellM = 75
  const cols = Math.max(3, Math.ceil(((maxLng - minLng) * mPerDegLng) / cellM) + 1)
  const rows = Math.max(3, Math.ceil(((maxLat - minLat) * mPerDegLat) / cellM) + 1)

  const elevGrid: (ElevationPoint | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  )

  for (const s of samples) {
    const c = Math.min(cols - 1, Math.max(0, Math.round(((s.lng - minLng) * mPerDegLng) / cellM)))
    const r = Math.min(rows - 1, Math.max(0, Math.round(((s.lat - minLat) * mPerDegLat) / cellM)))
    const cur = elevGrid[r][c]
    if (!cur || s.elevation > cur.elevation) elevGrid[r][c] = s
  }

  const mean =
    samples.reduce((acc, s) => acc + s.elevation, 0) / Math.max(samples.length, 1)

  const grid: (TerrainCell | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  )

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = elevGrid[r][c]
      if (!cell) continue

      let aspectDeg: number | null = null
      let slopeDeg = 0
      if (r > 0 && r < rows - 1 && c > 0 && c < cols - 1) {
        const e = elevGrid[r][c + 1]?.elevation
        const w = elevGrid[r][c - 1]?.elevation
        const n = elevGrid[r + 1]?.[c]?.elevation
        const s = elevGrid[r - 1]?.[c]?.elevation
        if (e != null && w != null && n != null && s != null) {
          const dzdx = (e - w) / (2 * cellM) // rise toward east
          const dzdy = (n - s) / (2 * cellM) // rise toward north
          // Aspect = direction the slope faces (downhill azimuth from north)
          aspectDeg = ((Math.atan2(dzdx, -dzdy) * 180) / Math.PI + 360) % 360
          slopeDeg = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
        }
      }

      grid[r][c] = {
        ...cell,
        aspectDeg,
        slopeDeg,
        row: r,
        col: c,
      }
    }
  }

  return { grid, rows, cols, mean, cellM }
}

/** 1 when aspect faces target bearing, -1 when opposite */
export function aspectAlignment(aspectDeg: number, targetBearingDeg: number): number {
  const delta = Math.min(
    Math.abs(aspectDeg - targetBearingDeg) % 360,
    360 - (Math.abs(aspectDeg - targetBearingDeg) % 360),
  )
  return Math.cos((delta * Math.PI) / 180)
}

function toViewpoint(
  id: string,
  cell: Pick<TerrainCell, 'lat' | 'lng' | 'elevation' | 'aspectDeg'>,
  mean: number,
  kind: Viewpoint['kind'],
): Viewpoint {
  return {
    id,
    lat: cell.lat,
    lng: cell.lng,
    elevation: cell.elevation,
    prominence: cell.elevation - mean,
    address: null,
    access: kind === 'path' ? 'public' : 'unknown',
    los: 'clear',
    aspectDeg: cell.aspectDeg,
    kind,
  }
}

/**
 * Local peaks + sun-facing hillside flanks (not only summits).
 * East-facing slopes favor sunrise; west-facing favor sunset.
 */
export function findTerrainCandidates(samples: ElevationPoint[], maxPeaks = 8): Viewpoint[] {
  if (samples.length < 9) return []
  const { grid, rows, cols, mean } = buildTerrainGrid(samples)
  const out: Viewpoint[] = []

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const cell = grid[r][c]
      if (!cell) continue

      let isPeak = true
      let maxNeighbor = -Infinity
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const n = grid[r + dr][c + dc]
          if (!n) continue
          maxNeighbor = Math.max(maxNeighbor, n.elevation)
          if (n.elevation > cell.elevation) isPeak = false
        }
      }

      if (isPeak && maxNeighbor > -Infinity && cell.elevation - maxNeighbor >= 0.3) {
        if (cell.elevation >= mean - 1) {
          out.push(toViewpoint(`peak-${r}-${c}`, cell, mean, 'peak'))
        }
      }

      // Flank: meaningful slope facing roughly E (sunrise) or W (sunset), above local mean
      if (
        cell.aspectDeg != null &&
        cell.slopeDeg >= 2.5 &&
        cell.elevation >= mean + 1.5
      ) {
        const faceEast = aspectAlignment(cell.aspectDeg, 90)
        const faceWest = aspectAlignment(cell.aspectDeg, 270)
        if (faceEast > 0.35) {
          out.push(toViewpoint(`flank-e-${r}-${c}`, cell, mean, 'flank'))
        } else if (faceWest > 0.35) {
          out.push(toViewpoint(`flank-w-${r}-${c}`, cell, mean, 'flank'))
        }
      }
    }
  }

  if (out.length === 0) {
    const sorted = [...samples].sort((a, b) => b.elevation - a.elevation)
    return sorted.slice(0, maxPeaks).map((s, i) =>
      toViewpoint(`high-${i}`, { ...s, aspectDeg: null }, mean, 'peak'),
    )
  }

  return dedupeViewpoints(out, DEDUPE_M)
    .sort((a, b) => b.prominence - a.prominence || b.elevation - a.elevation)
    .slice(0, maxPeaks + 6)
}

function nearestElevation(samples: ElevationPoint[], lat: number, lng: number): number | null {
  let best: ElevationPoint | null = null
  let bestD = Infinity
  for (const s of samples) {
    const d = distanceM(s, { lat, lng })
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  if (!best || bestD > 120) return null
  return best.elevation
}

/**
 * Sample walkable OSM ways and keep elevated / sun-facing points — catches hillside
 * roads that are not local peaks (e.g. a lane on the sunrise side of a ridge).
 */
export function candidatesFromPaths(
  features: AccessFeature[],
  samples: ElevationPoint[],
  maxKeep = 14,
): Viewpoint[] {
  if (!samples.length) return []
  const mean = samples.reduce((a, s) => a + s.elevation, 0) / samples.length
  const out: Viewpoint[] = []
  let idx = 0

  const paths = features.filter((f) => f.kind === 'path' && f.access === 'public')

  for (const path of paths) {
    if (path.geometry.length < 2) continue
    let traveled = 0
    let nextSampleAt = 0

    for (let i = 0; i < path.geometry.length - 1; i++) {
      const a = { lng: path.geometry[i][0], lat: path.geometry[i][1] }
      const b = { lng: path.geometry[i + 1][0], lat: path.geometry[i + 1][1] }
      const segLen = distanceM(a, b)
      if (segLen < 1) continue

      while (nextSampleAt <= traveled + segLen) {
        const t = (nextSampleAt - traveled) / segLen
        const lat = a.lat + (b.lat - a.lat) * t
        const lng = a.lng + (b.lng - a.lng) * t
        const elev = nearestElevation(samples, lat, lng)
        nextSampleAt += PATH_SAMPLE_M
        if (elev == null) continue
        // Mid-slope roads can sit slightly below the local DEM mean
        if (elev < mean - 6) continue
        out.push({
          id: `path-${path.id}-${idx++}`,
          lat,
          lng,
          elevation: elev,
          prominence: elev - mean,
          address: null,
          access: 'public',
          los: 'clear',
          kind: 'path',
          aspectDeg: null,
          placeName: path.name ?? null,
        })
      }
      traveled += segLen
    }
  }

  const withAspect = attachAspects(out, samples)

  // Keep a mix: highest paths + best east-facing + best west-facing (sunrise/sunset sides)
  const byElev = [...withAspect].sort((a, b) => b.elevation - a.elevation)
  const byEast = [...withAspect].sort(
    (a, b) =>
      aspectAlignment(b.aspectDeg ?? 0, 90) * 4 +
      b.prominence -
      (aspectAlignment(a.aspectDeg ?? 0, 90) * 4 + a.prominence),
  )
  const byWest = [...withAspect].sort(
    (a, b) =>
      aspectAlignment(b.aspectDeg ?? 0, 270) * 4 +
      b.prominence -
      (aspectAlignment(a.aspectDeg ?? 0, 270) * 4 + a.prominence),
  )

  const picked = [
    ...byElev.slice(0, Math.ceil(maxKeep / 2)),
    ...byEast.slice(0, Math.ceil(maxKeep / 3)),
    ...byWest.slice(0, Math.ceil(maxKeep / 3)),
  ]

  return dedupeViewpoints(picked, DEDUPE_M).slice(0, maxKeep)
}

export function mergeCandidates(...groups: Viewpoint[][]): Viewpoint[] {
  const flat = groups.flat()
  const paths = flat.filter((v) => v.kind === 'path')
  const terrain = flat.filter((v) => v.kind !== 'path')

  const rankedPaths = dedupeViewpoints(
    [...paths].sort((a, b) => b.elevation - a.elevation || b.prominence - a.prominence),
    DEDUPE_M,
  )
  const rankedTerrain = dedupeViewpoints(
    [...terrain].sort((a, b) => {
      const kindBoost = (v: Viewpoint) => (v.kind === 'flank' ? 2 : 0)
      return b.prominence + kindBoost(b) - (a.prominence + kindBoost(a)) || b.elevation - a.elevation
    }),
    DEDUPE_M,
  )

  // Always keep several walkable-road spots so field peaks don't crowd them out
  const reserved = rankedPaths.slice(0, RESERVED_PATH_SLOTS)
  const remainingSlots = Math.max(0, MAX_CANDIDATES - reserved.length)
  const rest = dedupeViewpoints([...rankedTerrain, ...rankedPaths.slice(RESERVED_PATH_SLOTS)], DEDUPE_M)
    .filter((v) => !reserved.some((r) => distanceM(r, v) < DEDUPE_M))
    .slice(0, remainingSlots)

  return [...reserved, ...rest].slice(0, MAX_CANDIDATES)
}
function dedupeViewpoints(list: Viewpoint[], minSepM: number): Viewpoint[] {
  const kept: Viewpoint[] = []
  for (const vp of list) {
    const idx = kept.findIndex((k) => distanceM(k, vp) < minSepM)
    if (idx >= 0) {
      const cur = kept[idx]
      const rank = (v: Viewpoint) =>
        (v.kind === 'path' ? 30 : v.kind === 'flank' ? 10 : 0) + v.elevation
      if (rank(vp) > rank(cur)) kept[idx] = vp
      continue
    }
    kept.push(vp)
  }
  return kept
}

/** Recompute aspect on a point from nearby samples (for path points). */
export function attachAspects(viewpoints: Viewpoint[], samples: ElevationPoint[]): Viewpoint[] {
  const { grid, rows, cols } = buildTerrainGrid(samples)
  return viewpoints.map((vp) => {
    if (vp.aspectDeg != null) return vp
    let best: TerrainCell | null = null
    let bestD = Infinity
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r][c]
        if (!cell) continue
        const d = distanceM(cell, vp)
        if (d < bestD) {
          bestD = d
          best = cell
        }
      }
    }
    return best && bestD < 150 ? { ...vp, aspectDeg: best.aspectDeg } : vp
  })
}