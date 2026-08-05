export type AccessKind = 'public' | 'private' | 'unknown'
export type LosScore = 'clear' | 'partial' | 'blocked' | 'night'

export interface LatLng {
  lat: number
  lng: number
}

export interface ElevationPoint extends LatLng {
  elevation: number
}

export interface Obstacle {
  id: string
  kind: 'building' | 'tree' | 'forest'
  /** Approximate footprint as closed ring [lng, lat][] */
  ring: [number, number][]
  heightM: number
  heightEstimated: boolean
  /** Point obstacles (single trees) use center + radius */
  center?: LatLng
  radiusM?: number
}

export interface AccessFeature {
  id: string
  kind: 'path' | 'park' | 'restricted'
  access: AccessKind
  /** Line or polygon rings */
  geometry: [number, number][]
  isPolygon: boolean
  name?: string | null
}

export interface Viewpoint {
  id: string
  lat: number
  lng: number
  elevation: number
  prominence: number
  address: string | null
  access: AccessKind
  /** Line of sight at the scrubber time */
  los: LosScore
  /** Clear view toward sunrise (~15–20 min after rise) */
  sunriseLos?: LosScore
  /** Clear view toward sunset (~15–20 min before set) */
  sunsetLos?: LosScore
  /** Slope aspect in degrees from north (direction the hillside faces) */
  aspectDeg?: number | null
  /** How the candidate was found */
  kind?: 'peak' | 'flank' | 'path'
  /** OSM road / place name when known */
  placeName?: string | null
  nearbyHeightsEstimated?: boolean
}

export type SpotFilter = 'all' | 'sunrise' | 'sunset'
export type AccessFilter = 'all' | 'walkable'

export interface SearchOrigin extends LatLng {
  label: string
  elevation?: number | null
}

export interface SunState {
  azimuthDeg: number
  altitudeDeg: number
  sunrise: Date
  sunset: Date
}
