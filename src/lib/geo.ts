/** Haversine distance in meters */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Destination point given bearing (degrees from north) and distance meters */
export function destinationPoint(
  origin: { lat: number; lng: number },
  bearingDeg: number,
  distanceMeters: number,
): { lat: number; lng: number } {
  const R = 6371000
  const δ = distanceMeters / R
  const θ = (bearingDeg * Math.PI) / 180
  const φ1 = (origin.lat * Math.PI) / 180
  const λ1 = (origin.lng * Math.PI) / 180

  const sinφ1 = Math.sin(φ1)
  const cosφ1 = Math.cos(φ1)
  const sinδ = Math.sin(δ)
  const cosδ = Math.cos(δ)

  const sinφ2 = sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ)
  const φ2 = Math.asin(sinφ2)
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * sinφ2)

  return {
    lat: (φ2 * 180) / Math.PI,
    lng: (((λ2 * 180) / Math.PI + 540) % 360) - 180,
  }
}

/** Meters per degree latitude / longitude at a given latitude */
export function metersPerDegree(lat: number): { mPerDegLat: number; mPerDegLng: number } {
  const mPerDegLat = 111_320
  const mPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180)
  return { mPerDegLat, mPerDegLng }
}

export function bboxFromCenter(
  center: { lat: number; lng: number },
  radiusM: number,
): { south: number; west: number; north: number; east: number } {
  const { mPerDegLat, mPerDegLng } = metersPerDegree(center.lat)
  const dLat = radiusM / mPerDegLat
  const dLng = radiusM / Math.max(mPerDegLng, 1e-6)
  return {
    south: center.lat - dLat,
    west: center.lng - dLng,
    north: center.lat + dLat,
    east: center.lng + dLng,
  }
}

/** Point-in-polygon (ring is [lng, lat][]) */
export function pointInRing(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** Closest point on a polyline to a target; returns point + distance */
export function closestOnLine(
  target: { lat: number; lng: number },
  line: [number, number][],
): { lat: number; lng: number; distanceM: number } {
  let best = { lat: target.lat, lng: target.lng, distanceM: Infinity }
  for (let i = 0; i < line.length - 1; i++) {
    const a = { lng: line[i][0], lat: line[i][1] }
    const b = { lng: line[i + 1][0], lat: line[i + 1][1] }
    const p = projectPoint(target, a, b)
    const d = distanceM(target, p)
    if (d < best.distanceM) best = { ...p, distanceM: d }
  }
  if (line.length === 1) {
    const p = { lat: line[0][1], lng: line[0][0] }
    return { ...p, distanceM: distanceM(target, p) }
  }
  return best
}

function projectPoint(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { lat: number; lng: number } {
  const { mPerDegLat, mPerDegLng } = metersPerDegree(p.lat)
  const ax = a.lng * mPerDegLng
  const ay = a.lat * mPerDegLat
  const bx = b.lng * mPerDegLng
  const by = b.lat * mPerDegLat
  const px = p.lng * mPerDegLng
  const py = p.lat * mPerDegLat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return {
    lng: (ax + t * dx) / mPerDegLng,
    lat: (ay + t * dy) / mPerDegLat,
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
