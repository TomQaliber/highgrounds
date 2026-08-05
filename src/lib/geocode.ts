import type { LatLng, SearchOrigin } from './types'

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
}

export async function searchAddress(query: string): Promise<SearchOrigin | null> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    addressdetails: '0',
  })
  const res = await fetch(`/api/geocode?${params}`)
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`)
  const data = (await res.json()) as NominatimResult[]
  if (!data.length) return null
  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: data[0].display_name,
  }
}

export async function reverseGeocode(point: LatLng): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lng),
    format: 'json',
    zoom: '18',
    addressdetails: '0',
  })
  const res = await fetch(`/api/geocode/reverse?${params}`)
  if (!res.ok) return null
  const data = (await res.json()) as { display_name?: string }
  return data.display_name ?? null
}

export async function reverseGeocodeMany(points: LatLng[]): Promise<(string | null)[]> {
  const results: (string | null)[] = []
  for (let i = 0; i < points.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1100))
    results.push(await reverseGeocode(points[i]))
  }
  return results
}
