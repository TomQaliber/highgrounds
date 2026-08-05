import type { ElevationPoint, Viewpoint } from './types'
import { metersPerDegree } from './geo'

const NEIGHBOR_THRESHOLD_M = 2.5
const MAX_PEAKS = 10

/**
 * Find local maxima on an irregular elevation sample by binning to a coarse grid.
 */
export function findPeaks(samples: ElevationPoint[], maxPeaks = MAX_PEAKS): Viewpoint[] {
  if (samples.length < 9) return []

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

  const grid: (ElevationPoint | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  )

  for (const s of samples) {
    const c = Math.min(cols - 1, Math.max(0, Math.round(((s.lng - minLng) * mPerDegLng) / cellM)))
    const r = Math.min(rows - 1, Math.max(0, Math.round(((s.lat - minLat) * mPerDegLat) / cellM)))
    const cur = grid[r][c]
    if (!cur || s.elevation > cur.elevation) grid[r][c] = s
  }

  const mean =
    samples.reduce((acc, s) => acc + s.elevation, 0) / Math.max(samples.length, 1)

  const peaks: Viewpoint[] = []

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
          if (n.elevation >= cell.elevation - 0.05) {
            // allow tiny float noise; require clear local max vs most neighbors
          }
          if (n.elevation > cell.elevation) isPeak = false
        }
      }
      if (!isPeak) continue
      if (maxNeighbor > -Infinity && cell.elevation - maxNeighbor < 0.3) continue
      if (cell.elevation < mean + NEIGHBOR_THRESHOLD_M * 0.15) {
        // still allow if clearly above neighbors
        if (maxNeighbor > -Infinity && cell.elevation - maxNeighbor < 1) continue
      }

      peaks.push({
        id: `peak-${r}-${c}`,
        lat: cell.lat,
        lng: cell.lng,
        elevation: cell.elevation,
        prominence: cell.elevation - mean,
        address: null,
        access: 'unknown',
        los: 'clear',
      })
    }
  }

  // Fallback: if terrain is flat, take highest samples as candidates
  if (peaks.length === 0) {
    const sorted = [...samples].sort((a, b) => b.elevation - a.elevation)
    const top = sorted.slice(0, maxPeaks)
    return top.map((s, i) => ({
      id: `high-${i}`,
      lat: s.lat,
      lng: s.lng,
      elevation: s.elevation,
      prominence: s.elevation - mean,
      address: null,
      access: 'unknown' as const,
      los: 'clear' as const,
    }))
  }

  return peaks
    .sort((a, b) => b.prominence - a.prominence || b.elevation - a.elevation)
    .slice(0, maxPeaks)
}
