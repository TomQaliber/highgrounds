import * as SunCalc from 'suncalc'
import type { LatLng, SunState } from './types'

/**
 * Sun position for a time and place.
 * suncalc v2 returns:
 * - azimuth: degrees clockwise from north (0=N, 90=E, 180=S, 270=W)
 * - altitude: degrees above horizon
 */
export function sunStateAt(date: Date, point: LatLng): SunState {
  const pos = SunCalc.getPosition(date, point.lat, point.lng)
  const times = SunCalc.getTimes(date, point.lat, point.lng)

  const azimuthDeg = ((pos.azimuth % 360) + 360) % 360
  const altitudeDeg = pos.altitude

  const sunrise =
    times.sunrise instanceof Date && !Number.isNaN(times.sunrise.getTime())
      ? times.sunrise
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 6, 0)
  const sunset =
    times.sunset instanceof Date && !Number.isNaN(times.sunset.getTime())
      ? times.sunset
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 20, 0)

  return {
    azimuthDeg,
    altitudeDeg,
    sunrise,
    sunset,
  }
}

export function clampDateToDaylight(date: Date, sunrise: Date, sunset: Date): Date {
  const t = date.getTime()
  if (t < sunrise.getTime()) return new Date(sunrise)
  if (t > sunset.getTime()) return new Date(sunset)
  return date
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatBearing(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8
  return `${Math.round(deg)}° ${dirs[idx]}`
}

export function losLabel(score: string): string {
  switch (score) {
    case 'clear':
      return 'Clear view'
    case 'partial':
      return 'Partly blocked'
    case 'blocked':
      return 'Blocked'
    case 'night':
      return 'Below horizon'
    default:
      return score
  }
}

/** Short labels for sunrise/sunset suitability */
export function sunSpotLabel(score: string | undefined): string {
  switch (score) {
    case 'clear':
      return 'Good spot'
    case 'partial':
      return 'Mixed'
    case 'blocked':
      return 'Poor'
    case 'night':
      return 'N/A'
    default:
      return 'Unknown'
  }
}
