import { useCallback, useMemo, useState } from 'react'
import { MapView } from './components/MapView'
import { SearchBar } from './components/SearchBar'
import { SpotCard } from './components/SpotCard'
import { SpotFilterBar } from './components/SpotFilter'
import { TimeSlider } from './components/TimeSlider'
import { classifyAndSnapViewpoints } from './lib/access'
import {
  attachAspects,
  candidatesFromPaths,
  findTerrainCandidates,
  mergeCandidates,
} from './lib/candidates'
import { DEFAULT_RADIUS_M, elevationBbox, fetchPointElevation, sampleElevationGrid } from './lib/elevation'
import { EUROPE_MESSAGE, isInEurope } from './lib/europe'
import { reverseGeocode, reverseGeocodeMany, searchAddress } from './lib/geocode'
import { isGoodSunSpot, losRank, scoreViewpoints, scoreViewpointsAtTime } from './lib/los'
import { fetchOsmContext } from './lib/osm'
import { sunStateAt } from './lib/sun'
import type {
  AccessFilter,
  ElevationPoint,
  LatLng,
  Obstacle,
  SearchOrigin,
  SpotFilter,
  Viewpoint,
} from './lib/types'
import { MapLegend } from './components/MapLegend'
import './App.css'

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; message: string; progress?: number }
  | { kind: 'error'; message: string }
  | { kind: 'ready' }

export default function App() {
  const [origin, setOrigin] = useState<SearchOrigin | null>(null)
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([])
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [filter, setFilter] = useState<SpotFilter>('all')
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all')
  const [elevationSamples, setElevationSamples] = useState<ElevationPoint[]>([])
  const [showHeightOverlay, setShowHeightOverlay] = useState(false)
  const [searchRadiusM, setSearchRadiusM] = useState(DEFAULT_RADIUS_M)

  const visibleViewpoints = useMemo(() => {
    let list = viewpoints
    if (accessFilter === 'walkable') {
      list = list.filter((v) => v.access === 'public' || v.kind === 'path')
    }
    if (filter === 'sunrise') {
      list = list.filter((v) => isGoodSunSpot(v.sunriseLos))
      list = [...list].sort(
        (a, b) => losRank(a.sunriseLos) - losRank(b.sunriseLos) || b.prominence - a.prominence,
      )
    } else if (filter === 'sunset') {
      list = list.filter((v) => isGoodSunSpot(v.sunsetLos))
      list = [...list].sort(
        (a, b) => losRank(a.sunsetLos) - losRank(b.sunsetLos) || b.prominence - a.prominence,
      )
    }
    return list
  }, [viewpoints, filter, accessFilter])

  const selected = visibleViewpoints.find((v) => v.id === selectedId) ?? null

  const sunFocus = selected ?? origin
  const sun = useMemo(() => {
    if (!sunFocus || !currentTime) return null
    return sunStateAt(currentTime, sunFocus)
  }, [sunFocus, currentTime])

  const sunriseCount = viewpoints.filter(
    (v) =>
      isGoodSunSpot(v.sunriseLos) &&
      (accessFilter === 'all' || v.access === 'public' || v.kind === 'path'),
  ).length
  const sunsetCount = viewpoints.filter(
    (v) =>
      isGoodSunSpot(v.sunsetLos) &&
      (accessFilter === 'all' || v.access === 'public' || v.kind === 'path'),
  ).length
  const walkableCount = viewpoints.filter((v) => v.access === 'public' || v.kind === 'path').length

  const runAnalysis = useCallback(async (place: SearchOrigin, radiusM: number) => {
    if (!isInEurope(place)) {
      setStatus({ kind: 'error', message: EUROPE_MESSAGE })
      setViewpoints([])
      setObstacles([])
      setElevationSamples([])
      setWarning(null)
      setOrigin(place)
      return
    }

    setOrigin(place)
    setSelectedId(null)
    setViewpoints([])
    setObstacles([])
    setElevationSamples([])
    setShowHeightOverlay(false)
    setWarning(null)
    setFilter('all')
    setAccessFilter('all')
    setStatus({ kind: 'loading', message: 'Sampling elevation…', progress: 0 })

    try {
      const originElev =
        place.elevation != null ? place.elevation : await fetchPointElevation(place)
      if (place.elevation == null) {
        await new Promise((r) => setTimeout(r, 1100))
      }
      setOrigin({ ...place, elevation: originElev })

      const samples = await sampleElevationGrid(place, radiusM, (done, total) => {
        setStatus({
          kind: 'loading',
          message: `Sampling elevation (${done}/${total})…`,
          progress: done / total,
        })
      })
      setElevationSamples(samples)

      setStatus({ kind: 'loading', message: 'Finding peaks & sun-facing slopes…' })
      let peaks = findTerrainCandidates(samples)

      setStatus({ kind: 'loading', message: 'Checking paths, access & obstacles…' })
      const bbox = elevationBbox(place, radiusM + 400)
      let obs: Obstacle[] = []
      try {
        const ctx = await fetchOsmContext(bbox)
        obs = ctx.obstacles
        setObstacles(obs)
        const pathCandidates = candidatesFromPaths(ctx.accessFeatures, samples)
        peaks = mergeCandidates(peaks, pathCandidates)
        peaks = classifyAndSnapViewpoints(peaks, ctx.accessFeatures)
        peaks = attachAspects(peaks, samples)
      } catch {
        setObstacles([])
        setWarning(
          'OpenStreetMap is slow or busy — showing elevation peaks only. Access and sun-blocking may be incomplete; try again in a moment.',
        )
      }

      const now = new Date()
      const sunNow = sunStateAt(now, place)
      let time = now
      if (
        !Number.isNaN(sunNow.sunrise.getTime()) &&
        !Number.isNaN(sunNow.sunset.getTime())
      ) {
        if (now < sunNow.sunrise) time = sunNow.sunrise
        else if (now > sunNow.sunset) time = sunNow.sunset
      }
      setCurrentTime(time)

      peaks = scoreViewpoints(peaks, time, obs)
      setViewpoints(peaks)

      setStatus({ kind: 'loading', message: 'Looking up nearest addresses…' })
      const addressTargets = peaks.slice(0, 3)
      const addresses = await reverseGeocodeMany(addressTargets)
      setViewpoints((prev) =>
        prev.map((vp, i) =>
          i < addresses.length ? { ...vp, address: addresses[i] ?? vp.address } : vp,
        ),
      )

      setStatus({ kind: 'ready' })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Something went wrong',
      })
    }
  }, [])

  function handleSelect(id: string) {
    setSelectedId(id)
    setViewpoints((cur) => {
      const spot = cur.find((v) => v.id === id)
      if (spot && !spot.address) {
        void reverseGeocode(spot).then((address) => {
          if (!address) return
          setViewpoints((latest) =>
            latest.map((v) => (v.id === id && !v.address ? { ...v, address } : v)),
          )
        })
      }
      return cur
    })
  }

  function handleTimeChange(date: Date) {
    setCurrentTime(date)
    setViewpoints((prev) => scoreViewpointsAtTime(prev, date, obstacles))
  }

  function handleFilterChange(next: SpotFilter) {
    setFilter(next)
    if (!origin || !sun) return

    const times = sunStateAt(currentTime ?? new Date(), origin)
    if (next === 'sunrise') {
      const t = new Date(times.sunrise.getTime() + 18 * 60 * 1000)
      handleTimeChange(t)
    } else if (next === 'sunset') {
      const t = new Date(times.sunset.getTime() - 18 * 60 * 1000)
      handleTimeChange(t)
    }
  }

  function handleRangeChange(meters: number) {
    setSearchRadiusM(meters)
    if (origin && status.kind !== 'loading') {
      void runAnalysis(origin, meters)
    }
  }

  async function handleSearch(query: string) {
    setStatus({ kind: 'loading', message: 'Finding place…' })
    try {
      const place = await searchAddress(query)
      if (!place) {
        setStatus({ kind: 'error', message: 'No results for that address.' })
        return
      }
      await runAnalysis(place, searchRadiusM)
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Geocoding failed',
      })
    }
  }

  function handleLocate() {
    if (!navigator.geolocation) {
      setStatus({ kind: 'error', message: 'Geolocation is not available in this browser.' })
      return
    }
    setStatus({ kind: 'loading', message: 'Getting your location…' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point: LatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        void runAnalysis(
          {
            ...point,
            label: 'Current location',
          },
          searchRadiusM,
        )
      },
      () => {
        setStatus({
          kind: 'error',
          message: 'Could not read your location. Allow location access or search an address.',
        })
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  const busy = status.kind === 'loading'

  return (
    <div className={`app ${status.kind === 'ready' ? 'is-ready' : ''}`}>
      <MapView
        origin={origin}
        viewpoints={visibleViewpoints}
        elevationSamples={elevationSamples}
        showHeightOverlay={showHeightOverlay}
        searchRadiusM={searchRadiusM}
        selectedId={selectedId}
        filter={filter}
        sunAzimuthDeg={sun?.azimuthDeg ?? null}
        sunAltitudeDeg={sun?.altitudeDeg ?? null}
        onSelect={handleSelect}
      />

      <div className="app__atmosphere" aria-hidden="true" />

      <header className="app__top">
        <div className="brand">
          <p className="brand__name">High Grounds</p>
          <p className="brand__tag">Find sunrise & sunset viewpoints nearby</p>
        </div>
        <SearchBar
          onSearch={handleSearch}
          onLocate={handleLocate}
          busy={busy}
          rangeM={searchRadiusM}
          onRangeChange={handleRangeChange}
        />
        {origin && status.kind === 'ready' && (
          <SpotFilterBar
            value={filter}
            onChange={handleFilterChange}
            accessFilter={accessFilter}
            onAccessChange={setAccessFilter}
            sunriseCount={sunriseCount}
            sunsetCount={sunsetCount}
            walkableCount={walkableCount}
            disabled={busy}
          />
        )}
        {origin && (
          <p className="app__place" title={origin.label}>
            {origin.label}
            <span className="app__place-range">
              {' '}
              · {(searchRadiusM / 1000).toFixed(1)} km
            </span>
          </p>
        )}
      </header>

      {status.kind === 'idle' && (
        <div className="app__empty">
          <h1>High Grounds</h1>
          <p>
            Find high spots, sun-facing hillsides, and elevated walkable roads — then see which work
            for sunrise or sunset.
          </p>
          <p className="app__empty-hint">Search an address or use your location (Europe).</p>
        </div>
      )}

      {status.kind === 'loading' && (
        <div className="app__status" role="status">
          <div className="spinner" />
          <span>{status.message}</span>
          {status.progress != null && (
            <div className="progress">
              <div className="progress__bar" style={{ width: `${Math.round(status.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {status.kind === 'error' && (
        <div className="app__status app__status--error" role="alert">
          {status.message}
        </div>
      )}

      {warning && status.kind === 'ready' && (
        <div className="app__warning" role="status">
          {warning}
        </div>
      )}

      {status.kind === 'ready' && filter !== 'all' && visibleViewpoints.length === 0 && (
        <div className="app__warning" role="status">
          No clear {filter} spots found here — try “All highs” or another area.
        </div>
      )}

      <div className="app__bottom">
        <SpotCard
          spot={selected}
          origin={origin}
          currentTime={currentTime}
          sunAzimuthDeg={sun?.azimuthDeg ?? null}
          sunAltitudeDeg={sun?.altitudeDeg ?? null}
          onClose={() => setSelectedId(null)}
        />
        <div className="app__dock">
          {status.kind === 'ready' && (
            <div className="app__dock-tools">
              <MapLegend
                showHeightOverlay={showHeightOverlay}
                onToggleHeight={() => setShowHeightOverlay((v) => !v)}
                heightDisabled={elevationSamples.length === 0}
                searchRadiusM={searchRadiusM}
              />
            </div>
          )}
          <TimeSlider
            sunrise={sun?.sunrise ?? null}
            sunset={sun?.sunset ?? null}
            value={currentTime}
            onChange={handleTimeChange}
            disabled={busy || !origin}
          />
        </div>
      </div>
    </div>
  )
}
