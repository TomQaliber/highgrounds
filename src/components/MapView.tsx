import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map, Marker } from 'maplibre-gl'
import { Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ElevationPoint, SearchOrigin, SpotFilter, Viewpoint } from '../lib/types'
import { destinationPoint } from '../lib/geo'
import {
  escapeHtml,
  formatCoords,
  googleMapsUrl,
  mapsUrl,
} from '../lib/format'
import './MapView.css'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

interface MapViewProps {
  origin: SearchOrigin | null
  viewpoints: Viewpoint[]
  elevationSamples: ElevationPoint[]
  showHeightOverlay: boolean
  searchRadiusM: number
  selectedId: string | null
  filter: SpotFilter
  sunAzimuthDeg: number | null
  sunAltitudeDeg: number | null
  onSelect: (id: string) => void
}

function relevantScore(vp: Viewpoint, filter: SpotFilter) {
  if (filter === 'sunrise') return vp.sunriseLos
  if (filter === 'sunset') return vp.sunsetLos
  const rank = { clear: 0, partial: 1, night: 2, blocked: 3 } as const
  const a = vp.sunriseLos ?? 'blocked'
  const b = vp.sunsetLos ?? 'blocked'
  return rank[a] <= rank[b] ? a : b
}

function markerColor(vp: Viewpoint, filter: SpotFilter): string {
  const score = relevantScore(vp, filter)
  if (score === 'clear') return '#1f7a4d'
  if (score === 'partial') return '#d4890f'
  return '#a34a38'
}

/** Outer button has no CSS transform — MapLibre positions it. Visual pin is inside. */
function createMarkerButton(
  className: string,
  ariaLabel: string,
  label?: string,
  rank?: number,
): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = className
  el.setAttribute('aria-label', ariaLabel)
  const pin = document.createElement('span')
  pin.className = 'hg-marker__pin'
  pin.setAttribute('aria-hidden', 'true')
  if (rank != null) {
    const rankEl = document.createElement('span')
    rankEl.className = 'hg-marker__rank'
    rankEl.textContent = String(rank)
    pin.appendChild(rankEl)
  }
  el.appendChild(pin)
  if (label) {
    const tag = document.createElement('span')
    tag.className = 'hg-marker__label'
    tag.textContent = label
    el.appendChild(tag)
  }
  return el
}

function originPopupHtml(origin: SearchOrigin): string {
  const elev =
    origin.elevation != null ? `${Math.round(origin.elevation)} m` : 'Unknown'
  const label = escapeHtml(origin.label)
  const coords = formatCoords(origin.lat, origin.lng)
  return `
    <div class="hg-popup">
      <p class="hg-popup__kicker">Your location</p>
      <strong>${label}</strong>
      <ul>
        <li><span>Altitude</span> ${elev}</li>
        <li><span>GPS</span> ${coords}</li>
      </ul>
      <p class="hg-popup__links">
        <a href="${mapsUrl(origin.lat, origin.lng)}" target="_blank" rel="noreferrer">OpenStreetMap</a>
        ·
        <a href="${googleMapsUrl(origin.lat, origin.lng)}" target="_blank" rel="noreferrer">Google Maps</a>
      </p>
    </div>
  `
}

function elevationGeoJSON(samples: ElevationPoint[]): {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: { elevation: number }
    geometry: { type: 'Point'; coordinates: [number, number] }
  }>
} {
  return {
    type: 'FeatureCollection',
    features: samples.map((s) => ({
      type: 'Feature' as const,
      properties: { elevation: s.elevation },
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] as [number, number] },
    })),
  }
}

export function MapView({
  origin,
  viewpoints,
  elevationSamples,
  showHeightOverlay,
  searchRadiusM,
  selectedId,
  filter,
  sunAzimuthDeg,
  sunAltitudeDeg,
  onSelect,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const markersRef = useRef<Marker[]>([])
  const originMarkerRef = useRef<Marker | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [4.9, 52.37],
      zoom: 11,
      attributionControl: false,
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      map.addSource('sun-ray', {
        type: 'geojson',
        data: emptyCollection(),
      })
      map.addLayer({
        id: 'sun-ray-glow',
        type: 'line',
        source: 'sun-ray',
        paint: {
          'line-color': '#ffb020',
          'line-width': 8,
          'line-opacity': 0.25,
        },
      })
      map.addLayer({
        id: 'sun-ray-line',
        type: 'line',
        source: 'sun-ray',
        paint: {
          'line-color': '#e8910a',
          'line-width': 3.5,
          'line-opacity': 0.95,
          'line-dasharray': [2, 1.2],
        },
      })

      map.addSource('search-radius', {
        type: 'geojson',
        data: emptyCollection(),
      })
      map.addLayer({
        id: 'search-radius-fill',
        type: 'fill',
        source: 'search-radius',
        paint: {
          'fill-color': '#2f6b4f',
          'fill-opacity': 0.06,
        },
      })
      map.addLayer({
        id: 'search-radius-line',
        type: 'line',
        source: 'search-radius',
        paint: {
          'line-color': '#2f6b4f',
          'line-width': 1.5,
          'line-opacity': 0.45,
          'line-dasharray': [2, 1.5],
        },
      })

      map.addSource('elevation-grid', {
        type: 'geojson',
        data: emptyCollection(),
      })
      map.addLayer({
        id: 'elevation-heat',
        type: 'circle',
        source: 'elevation-grid',
        layout: { visibility: 'none' },
        paint: {
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            12,
            18,
            15,
            28,
          ],
          'circle-blur': 0.85,
          'circle-opacity': 0.55,
          'circle-color': [
            'interpolate',
            ['linear'],
            ['get', 'elevation'],
            0,
            '#2b4c7e',
            15,
            '#3d8b6e',
            35,
            '#c4a035',
            60,
            '#c45c2a',
            100,
            '#8b2e1f',
          ],
        },
      })
    })

    return () => {
      markersRef.current.forEach((m) => m.remove())
      markersRef.current = []
      originMarkerRef.current?.remove()
      originMarkerRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !origin) return
    map.flyTo({ center: [origin.lng, origin.lat], zoom: 14, essential: true })

    const updateRadius = () => {
      const source = map.getSource('search-radius') as maplibregl.GeoJSONSource | undefined
      if (!source) return
      source.setData(circlePolygon(origin.lng, origin.lat, searchRadiusM))
    }
    if (map.isStyleLoaded()) updateRadius()
    else map.once('load', updateRadius)
  }, [origin?.lat, origin?.lng, searchRadiusM])

  // Height overlay data + visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      const source = map.getSource('elevation-grid') as maplibregl.GeoJSONSource | undefined
      if (!source) return
      source.setData(elevationGeoJSON(elevationSamples))

      if (!map.getLayer('elevation-heat')) return

      // Stretch color scale to local min/max for contrast
      if (elevationSamples.length > 0) {
        const elevs = elevationSamples.map((s) => s.elevation)
        const min = Math.min(...elevs)
        const max = Math.max(...elevs)
        const mid1 = min + (max - min) * 0.33
        const mid2 = min + (max - min) * 0.66
        map.setPaintProperty('elevation-heat', 'circle-color', [
          'interpolate',
          ['linear'],
          ['get', 'elevation'],
          min,
          '#2b4c7e',
          mid1,
          '#3d8b6e',
          mid2,
          '#c4a035',
          max,
          '#c45c2a',
        ])
      }

      map.setLayoutProperty(
        'elevation-heat',
        'visibility',
        showHeightOverlay && elevationSamples.length > 0 ? 'visible' : 'none',
      )
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [elevationSamples, showHeightOverlay])

  // Origin pin
  useEffect(() => {
    const map = mapRef.current
    originMarkerRef.current?.remove()
    originMarkerRef.current = null
    if (!map || !origin) return

    const elevLabel =
      origin.elevation != null ? `${Math.round(origin.elevation)} m` : 'You'
    const el = createMarkerButton(
      'hg-marker hg-marker--origin',
      `Your location: ${origin.label}`,
      elevLabel,
    )

    const popup = new Popup({ offset: 28, maxWidth: '280px', closeButton: true }).setHTML(
      originPopupHtml(origin),
    )

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([origin.lng, origin.lat])
      .setPopup(popup)
      .addTo(map)

    el.addEventListener('click', (e) => {
      e.stopPropagation()
      marker.togglePopup()
    })

    originMarkerRef.current = marker
  }, [origin])

  const viewpointSignature = viewpoints
    .map(
      (v) =>
        `${v.id}|${v.lat.toFixed(5)}|${v.lng.toFixed(5)}|${Math.round(v.elevation)}|${v.address ?? ''}|${v.access}|${v.sunriseLos}|${v.sunsetLos}|${v.prominence.toFixed(1)}`,
    )
    .join(';')

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []

    viewpoints.forEach((vp, index) => {
      const rank = index + 1
      const score = relevantScore(vp, filter)
      const el = createMarkerButton(
        `hg-marker los-${score ?? 'blocked'}`,
        `Rank ${rank}: viewpoint ${Math.round(vp.elevation)} meters near ${vp.address ?? 'unknown address'}`,
        `${Math.round(vp.elevation)} m`,
        rank,
      )
      el.dataset.viewpointId = vp.id
      el.style.setProperty('--marker-color', markerColor(vp, filter))
      if (selectedId === vp.id) el.classList.add('is-selected')

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([vp.lng, vp.lat])
        .addTo(map)

      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onSelectRef.current(vp.id)
      })

      markersRef.current.push(marker)
    })
  }, [viewpointSignature, filter, origin?.lat, origin?.lng, origin?.label, origin?.elevation])

  useEffect(() => {
    markersRef.current.forEach((marker) => {
      const el = marker.getElement()
      const id = el.dataset.viewpointId
      const index = id ? viewpoints.findIndex((v) => v.id === id) : -1
      const vp = index >= 0 ? viewpoints[index] : undefined
      if (!vp) return
      const score = relevantScore(vp, filter)
      const label = el.querySelector('.hg-marker__label')
      const rankEl = el.querySelector('.hg-marker__rank')

      // Preserve maplibregl-marker (position:absolute) — never replace className wholesale
      el.classList.add('hg-marker')
      el.classList.toggle('is-selected', selectedId === vp.id)
      for (const c of ['los-clear', 'los-partial', 'los-blocked', 'los-night']) {
        el.classList.remove(c)
      }
      el.classList.add(`los-${score ?? 'blocked'}`)
      el.style.setProperty('--marker-color', markerColor(vp, filter))
      if (label) label.textContent = `${Math.round(vp.elevation)} m`
      if (rankEl) rankEl.textContent = String(index + 1)
    })
  }, [selectedId, filter, viewpoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const updateRay = () => {
      const source = map.getSource('sun-ray') as maplibregl.GeoJSONSource | undefined
      if (!source) return

      const focus =
        viewpoints.find((v) => v.id === selectedId) ??
        viewpoints[0] ??
        (origin ? { lat: origin.lat, lng: origin.lng } : null)

      if (
        !focus ||
        sunAzimuthDeg == null ||
        sunAltitudeDeg == null ||
        sunAltitudeDeg < -0.5
      ) {
        source.setData(emptyCollection())
        return
      }

      const end = destinationPoint(focus, sunAzimuthDeg, 1800)
      source.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [focus.lng, focus.lat],
            [end.lng, end.lat],
          ],
        },
      })
    }

    if (map.isStyleLoaded()) updateRay()
    else map.once('load', updateRay)
  }, [viewpoints, selectedId, origin, sunAzimuthDeg, sunAltitudeDeg])

  return <div ref={containerRef} className="map-view" role="presentation" />
}

function emptyCollection(): {
  type: 'FeatureCollection'
  features: []
} {
  return { type: 'FeatureCollection', features: [] }
}

function circlePolygon(lng: number, lat: number, radiusM: number, steps = 64) {
  const coords: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 360
    const p = destinationPoint({ lat, lng }, bearing, radiusM)
    coords.push([p.lng, p.lat])
  }
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [coords],
    },
  }
}
