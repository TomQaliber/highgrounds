import { useEffect, useState } from 'react'
import type { SearchOrigin, Viewpoint } from '../lib/types'
import { accessLabel } from '../lib/access'
import { distanceM } from '../lib/geo'
import {
  formatCoords,
  formatDistance,
  googleMapsUrl,
  mapsUrl,
} from '../lib/format'
import { formatTime, formatBearing, losLabel, sunSpotLabel } from '../lib/sun'
import './SpotCard.css'

function kindLabel(kind: Viewpoint['kind']): string {
  switch (kind) {
    case 'path':
      return 'On a walkable road / path'
    case 'flank':
      return 'Sun-facing hillside'
    case 'peak':
      return 'Local high point'
    default:
      return 'Viewpoint'
  }
}

function aspectLabel(aspectDeg: number | null | undefined): string | null {
  if (aspectDeg == null) return null
  return `Slope faces ${formatBearing(aspectDeg)}`
}

const PAGES = ['View', 'Place', 'Details'] as const

interface SpotCardProps {
  spot: Viewpoint | null
  origin: SearchOrigin | null
  currentTime: Date | null
  sunAzimuthDeg?: number | null
  sunAltitudeDeg?: number | null
  onClose: () => void
}

export function SpotCard({
  spot,
  origin,
  currentTime,
  sunAzimuthDeg,
  sunAltitudeDeg,
  onClose,
}: SpotCardProps) {
  const [copied, setCopied] = useState(false)
  const [page, setPage] = useState(0)

  useEffect(() => {
    setPage(0)
    setCopied(false)
  }, [spot?.id])

  if (!spot) return null

  const verdict =
    spot.sunriseLos === 'clear' && spot.sunsetLos === 'clear'
      ? 'Strong for both sunrise and sunset'
      : spot.sunriseLos === 'clear'
        ? 'Best suited for sunrise'
        : spot.sunsetLos === 'clear'
          ? 'Best suited for sunset'
          : spot.sunriseLos === 'partial' || spot.sunsetLos === 'partial'
            ? 'Possible sun views, with some blocking'
            : 'Elevation is high, but the sun may be blocked nearby'

  const coords = formatCoords(spot.lat, spot.lng)
  const distFromOrigin = origin ? formatDistance(distanceM(origin, spot)) : null
  const elevDelta =
    origin?.elevation != null ? spot.elevation - origin.elevation : null

  async function copyCoords() {
    try {
      await navigator.clipboard.writeText(`${spot!.lat},${spot!.lng}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* ignore */
    }
  }

  return (
    <aside className="spot-card" aria-live="polite">
      <button type="button" className="spot-card__close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <div className="spot-card__header">
        <p className="spot-card__kicker">{kindLabel(spot.kind)}</p>
        <h2>{Math.round(spot.elevation)} m</h2>
        {spot.placeName && <p className="spot-card__place-name">{spot.placeName}</p>}
      </div>

      <div className="spot-card__tabs" role="tablist" aria-label="Spot details">
        {PAGES.map((label, i) => (
          <button
            key={label}
            type="button"
            role="tab"
            aria-selected={page === i}
            className={page === i ? 'is-active' : ''}
            onClick={() => setPage(i)}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        className="spot-card__carousel"
        onTouchStart={(e) => {
          const startX = e.touches[0]?.clientX
          if (startX == null) return
          const el = e.currentTarget
          const onMove = (ev: TouchEvent) => {
            const dx = ev.touches[0].clientX - startX
            el.dataset.dx = String(dx)
          }
          const onEnd = () => {
            const dx = Number(el.dataset.dx ?? 0)
            if (dx < -40) setPage((p) => Math.min(PAGES.length - 1, p + 1))
            if (dx > 40) setPage((p) => Math.max(0, p - 1))
            el.dataset.dx = '0'
            el.removeEventListener('touchmove', onMove)
            el.removeEventListener('touchend', onEnd)
          }
          el.addEventListener('touchmove', onMove, { passive: true })
          el.addEventListener('touchend', onEnd)
        }}
      >
        {page === 0 && (
          <div className="spot-card__page">
            <p className="spot-card__sub">{verdict}</p>
            {aspectLabel(spot.aspectDeg) && (
              <p className="spot-card__aspect">{aspectLabel(spot.aspectDeg)}</p>
            )}
            <dl className="spot-card__meta">
              <div className="spot-card__sun-row">
                <div>
                  <dt>Sunrise view</dt>
                  <dd>
                    <span className={`badge badge--los-${spot.sunriseLos ?? 'blocked'}`}>
                      {sunSpotLabel(spot.sunriseLos)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Sunset view</dt>
                  <dd>
                    <span className={`badge badge--los-${spot.sunsetLos ?? 'blocked'}`}>
                      {sunSpotLabel(spot.sunsetLos)}
                    </span>
                  </dd>
                </div>
              </div>
              <div>
                <dt>At scrubber time{currentTime ? ` · ${formatTime(currentTime)}` : ''}</dt>
                <dd>
                  <span className={`badge badge--los-${spot.los}`}>{losLabel(spot.los)}</span>
                  {sunAzimuthDeg != null && sunAltitudeDeg != null && (
                    <span className="spot-card__muted">
                      {' '}
                      · {formatBearing(sunAzimuthDeg)}, {sunAltitudeDeg.toFixed(1)}°
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}

        {page === 1 && (
          <div className="spot-card__page">
            <dl className="spot-card__meta">
              <div>
                <dt>Nearest address</dt>
                <dd>{spot.address ?? 'Looking up…'}</dd>
              </div>
              <div>
                <dt>Access</dt>
                <dd>
                  <span className={`badge badge--${spot.access}`}>{accessLabel(spot.access)}</span>
                </dd>
              </div>
              {distFromOrigin && (
                <div>
                  <dt>Distance from you</dt>
                  <dd>{distFromOrigin}</dd>
                </div>
              )}
              <div>
                <dt>GPS coordinates</dt>
                <dd className="spot-card__coords">
                  <code>{coords}</code>
                  <button type="button" className="spot-card__copy" onClick={() => void copyCoords()}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </dd>
              </div>
            </dl>
            <p className="spot-card__links">
              <a href={mapsUrl(spot.lat, spot.lng)} target="_blank" rel="noreferrer">
                Open in OSM
              </a>
              <a href={googleMapsUrl(spot.lat, spot.lng)} target="_blank" rel="noreferrer">
                Open in Google Maps
              </a>
            </p>
          </div>
        )}

        {page === 2 && (
          <div className="spot-card__page">
            <dl className="spot-card__meta">
              <div className="spot-card__sun-row">
                <div>
                  <dt>Altitude</dt>
                  <dd>{Math.round(spot.elevation)} m</dd>
                </div>
                <div>
                  <dt>Above local avg</dt>
                  <dd>~{spot.prominence.toFixed(1)} m</dd>
                </div>
              </div>
              {elevDelta != null && (
                <div>
                  <dt>Vs your location</dt>
                  <dd>
                    {elevDelta >= 0 ? '+' : ''}
                    {elevDelta.toFixed(1)} m
                    {origin?.elevation != null && (
                      <span className="spot-card__muted">
                        {' '}
                        (you: {Math.round(origin.elevation)} m)
                      </span>
                    )}
                  </dd>
                </div>
              )}
              {origin && (
                <div>
                  <dt>Your pinned location</dt>
                  <dd>
                    {origin.label}
                    <span className="spot-card__muted">
                      {' '}
                      · {formatCoords(origin.lat, origin.lng)}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
            <p className="spot-card__disclaimer">
              Scores use slope aspect plus buildings/trees from OpenStreetMap — verify on site.
            </p>
          </div>
        )}
      </div>

      <div className="spot-card__dots" aria-hidden="true">
        {PAGES.map((label, i) => (
          <span key={label} className={page === i ? 'is-active' : ''} />
        ))}
      </div>
    </aside>
  )
}
