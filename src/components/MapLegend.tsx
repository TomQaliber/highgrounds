import { useState } from 'react'
import './MapLegend.css'

interface MapLegendProps {
  showHeightOverlay: boolean
  onToggleHeight: () => void
  heightDisabled?: boolean
  searchRadiusM: number
}

export function MapLegend({
  showHeightOverlay,
  onToggleHeight,
  heightDisabled,
  searchRadiusM,
}: MapLegendProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className={`map-legend ${open ? 'is-open' : 'is-collapsed'}`}>
      <div className="map-legend__toolbar">
        <button
          type="button"
          className="map-legend__header"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span>Map key</span>
          <span className="map-legend__chevron" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>

        {!open && (
          <button
            type="button"
            className={`map-legend__toggle map-legend__toggle--compact ${showHeightOverlay ? 'is-on' : ''}`}
            onClick={onToggleHeight}
            disabled={heightDisabled}
            aria-pressed={showHeightOverlay}
          >
            {showHeightOverlay ? 'Heights on' : 'Heights'}
          </button>
        )}
      </div>

      {open && (
        <div className="map-legend__body">
          <ul>
            <li>
              <span className="swatch swatch--origin" aria-hidden="true" />
              Your address (dark pin)
            </li>
            <li>
              <span className="swatch swatch--spot" aria-hidden="true" />
              Viewpoint — green good / amber mixed / brown poor
            </li>
            <li>
              <span className="swatch swatch--rank" aria-hidden="true">
                1
              </span>
              Number in pin = ranking
            </li>
            <li>
              <span className="swatch swatch--label" aria-hidden="true">
                m
              </span>
              Pin label = altitude
            </li>
            <li>
              <span className="swatch swatch--sun" aria-hidden="true" />
              Orange line = toward the sun
            </li>
            <li>
              <span className="swatch swatch--radius" aria-hidden="true" />
              Green circle = {(searchRadiusM / 1000).toFixed(1)} km range
            </li>
          </ul>
          <p className="map-legend__section">Spot types</p>
          <ul>
            <li>High point · hillside · walkable path (from map tiles)</li>
          </ul>
          <p className="map-legend__section">Filters</p>
          <ul>
            <li>Sunrise / Sunset / Walkable</li>
          </ul>
          <button
            type="button"
            className={`map-legend__toggle ${showHeightOverlay ? 'is-on' : ''}`}
            onClick={onToggleHeight}
            disabled={heightDisabled}
            aria-pressed={showHeightOverlay}
          >
            {showHeightOverlay ? 'Hide height overlay' : 'Show height overlay'}
          </button>
          {showHeightOverlay && (
            <p className="map-legend__hint">Blue = lower · yellow/red = higher</p>
          )}
        </div>
      )}
    </div>
  )
}
