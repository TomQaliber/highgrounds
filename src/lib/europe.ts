import type { LatLng } from './types'

/** Rough EU-DEM coverage (EEA + buffer). */
const EUROPE = {
  minLat: 34.5,
  maxLat: 72.0,
  minLng: -25.0,
  maxLng: 45.0,
}

export function isInEurope(point: LatLng): boolean {
  return (
    point.lat >= EUROPE.minLat &&
    point.lat <= EUROPE.maxLat &&
    point.lng >= EUROPE.minLng &&
    point.lng <= EUROPE.maxLng
  )
}

export const EUROPE_MESSAGE =
  'High Grounds currently covers Europe only (EU-DEM elevation). Other regions will follow later.'
