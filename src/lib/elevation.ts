import type { ElevationPoint, LatLng } from './types'
import { bboxFromCenter, metersPerDegree, sleep } from './geo'

interface OpenTopoResult {
  results?: Array<{ elevation: number | null; location: { lat: number; lng: number } }>
  status?: string
  error?: string
}

const BATCH = 100
const MIN_SPACING_M = 75
export const DEFAULT_RADIUS_M = 1200

/** Wider searches use coarser spacing so API calls stay reasonable. */
export function spacingForRadius(radiusM: number): number {
  return Math.max(MIN_SPACING_M, Math.round(radiusM / 16))
}

export function buildGrid(
  center: LatLng,
  radiusM = DEFAULT_RADIUS_M,
  spacingM = spacingForRadius(radiusM),
): LatLng[] {
  const { mPerDegLat, mPerDegLng } = metersPerDegree(center.lat)
  const steps = Math.ceil((radiusM * 2) / spacingM)
  const half = steps / 2
  const points: LatLng[] = []

  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const dNorth = (i - half) * spacingM
      const dEast = (j - half) * spacingM
      if (Math.hypot(dNorth, dEast) > radiusM) continue
      points.push({
        lat: center.lat + dNorth / mPerDegLat,
        lng: center.lng + dEast / Math.max(mPerDegLng, 1e-6),
      })
    }
  }
  return points
}

async function fetchElevations(locations: LatLng[]): Promise<ElevationPoint[]> {
  const qs = locations.map((p) => `${p.lat},${p.lng}`).join('|')
  const res = await fetch(`/api/elevation?locations=${encodeURIComponent(qs)}`)
  if (!res.ok) {
    throw new Error(`Elevation request failed (${res.status})`)
  }
  const data = (await res.json()) as OpenTopoResult
  if (data.error || data.status === 'INVALID_REQUEST') {
    throw new Error(data.error ?? 'Invalid elevation request')
  }
  const out: ElevationPoint[] = []
  for (const r of data.results ?? []) {
    if (r.elevation == null || Number.isNaN(r.elevation)) continue
    out.push({ lat: r.location.lat, lng: r.location.lng, elevation: r.elevation })
  }
  return out
}

export async function fetchPointElevation(point: LatLng): Promise<number | null> {
  try {
    const [hit] = await fetchElevations([point])
    return hit?.elevation ?? null
  } catch {
    return null
  }
}

/** Sample EU-DEM elevations for a neighborhood grid (rate-limited). */
export async function sampleElevationGrid(
  center: LatLng,
  radiusM = DEFAULT_RADIUS_M,
  onProgress?: (done: number, total: number) => void,
): Promise<ElevationPoint[]> {
  const grid = buildGrid(center, radiusM, spacingForRadius(radiusM))
  const all: ElevationPoint[] = []
  const totalBatches = Math.ceil(grid.length / BATCH)

  for (let i = 0; i < grid.length; i += BATCH) {
    const chunk = grid.slice(i, i + BATCH)
    const batchIndex = Math.floor(i / BATCH)
    if (batchIndex > 0) await sleep(1100) // public API: 1 req/s
    const points = await fetchElevations(chunk)
    all.push(...points)
    onProgress?.(Math.min(batchIndex + 1, totalBatches), totalBatches)
  }

  if (all.length === 0) {
    throw new Error('No elevation data returned. This location may be outside EU-DEM coverage.')
  }
  return all
}

export function elevationBbox(center: LatLng, radiusM = DEFAULT_RADIUS_M) {
  return bboxFromCenter(center, radiusM)
}
