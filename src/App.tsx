import { useCallback, useMemo, useRef, useState } from 'react'
import { MapView, type MapViewHandle } from './components/MapView'
import { SearchBar } from './components/SearchBar'
import { SpotCard } from './components/SpotCard'
import { SpotFilterBar } from './components/SpotFilter'
import { TimeSlider } from './components/TimeSlider'
import { classifyAndSnapViewpoints } from './lib/access'
import {
  attachAspects,
  aspectAlignment,
  candidatesFromPaths,
  findTerrainCandidates,
  mergeCandidates,
} from './lib/candidates'
import { DEFAULT_RADIUS_M, fetchPointElevation, sampleElevationGrid } from './lib/elevation'
import { EUROPE_MESSAGE, isInEurope } from './lib/europe'
import { reverseGeocode, reverseGeocodeMany, searchAddress } from './lib/geocode'
import { isGoodSunSpot, losRank, scoreViewpoints, scoreViewpointsAtTime } from './lib/los'
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
  const mapRef = useRef<MapViewHandle>(null)
  const [origin, setOrigin] = useState<SearchOrigin | null>(null)
  const [viewpoints, setViewpoints] = useState<Viewpoint[]>([])
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [filterNoticeDismissed, setFilterNoticeDismissed] = useState(false)
  const [filter, setFilter] = useState<SpotFilter>('all')
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all')
  const [elevationSamples, setElevationSamples] = useState<ElevationPoint[]>([])
  const [showHeightOverlay, setShowHeightOverlay] = useState(false)
  const [searchRadiusM, setSearchRadiusM] = useState(DEFAULT_RADIUS_M)

  const sunFilterMeta = useMemo(() => {
    let list = viewpoints
    if (accessFilter === 'walkable') {
      list = list.filter((v) => v.access === 'public' || v.kind === 'path')
    }

    if (filter !== 'sunrise' && filter !== 'sunset') {
      return { list, mode: 'all' as const }
    }

    const bearing = filter === 'sunrise' ? 90 : 270
    const losOf = (v: Viewpoint) => (filter === 'sunrise' ? v.sunriseLos : v.sunsetLos)
    const good = list.filter((v) => isGoodSunSpot(losOf(v)))
    if (good.length > 0) {
      return {
        list: [...good].sort(
          (a, b) => losRank(losOf(a)) - losRank(losOf(b)) || b.prominence - a.prominence,
        ),
        mode: 'clear' as const,
      }
    }

    // No clear/partial sun spots — still offer walkable / elevated alternatives
    const alts = [...list]
      .filter((v) => v.kind === 'path' || v.access === 'public')
      .sort((a, b) => {
        const score = (v: Viewpoint) =>
          aspectAlignment(v.aspectDeg ?? bearing, bearing) * 6 +
          (v.kind === 'path' ? 4 : 0) +
          v.prominence * 0.2 +
          v.elevation * 0.02
        return score(b) - score(a)
      })
      .slice(0, 10)

    if (alts.length > 0) {
      return { list: alts, mode: 'alternatives' as const }
    }
    if (list.length > 0) {
      return { list: list.slice(0, 8), mode: 'alternatives' as const }
    }
    return { list: [], mode: 'empty' as const }
  }, [viewpoints, filter, accessFilter])

  const visibleViewpoints = sunFilterMeta.list

  const filterNotice =
    status.kind === 'ready' &&
    (filter === 'sunrise' || filter === 'sunset') &&
    !filterNoticeDismissed
      ? sunFilterMeta.mode === 'alternatives'
        ? `No clear ${filter} views found — showing walkable high spots nearby that may still work.`
        : sunFilterMeta.mode === 'empty'
          ? `No clear ${filter} spots found here — try “All highs” or another area.`
          : null
      : null

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
    setFilterNoticeDismissed(false)
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

      setStatus({ kind: 'loading', message: 'Reading walkable paths from the map…' })
      let obs: Obstacle[] = []
      try {
        const tilePaths =
          (await mapRef.current?.extractWalkablePaths(place, radiusM)) ?? []
        if (tilePaths.length > 0) {
          const pathCandidates = candidatesFromPaths(tilePaths, samples)
          peaks = mergeCandidates(peaks, pathCandidates)
          peaks = classifyAndSnapViewpoints(peaks, tilePaths)
        }
        peaks = attachAspects(peaks, samples)
        if (tilePaths.length === 0) {
          setWarning(
            'No walkable paths found in the map tiles here — showing elevation peaks. Zoom or try another spot.',
          )
        }
      } catch {
        peaks = attachAspects(peaks, samples)
        setWarning(
          'Could not read paths from the map — showing elevation peaks only.',
        )
      }
      setObstacles(obs)

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
    setFilterNoticeDismissed(false)
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
        ref={mapRef}
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
          <p className="app__warning-text">{warning}</p>
          <button
            type="button"
            className="app__warning-close"
            onClick={() => setWarning(null)}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      {filterNotice && (
        <div className="app__warning" role="status">
          <p className="app__warning-text">{filterNotice}</p>
          <button
            type="button"
            className="app__warning-close"
            onClick={() => setFilterNoticeDismissed(true)}
            aria-label="Dismiss message"
          >
            ×
          </button>
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
