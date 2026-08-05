import './RangeControl.css'

export const RADIUS_OPTIONS_M = [600, 1200, 2000, 3000] as const

interface RangeControlProps {
  valueM: number
  onChange: (meters: number) => void
  disabled?: boolean
}

export function RangeControl({ valueM, onChange, disabled }: RangeControlProps) {
  return (
    <div className={`range-control ${disabled ? 'is-disabled' : ''}`}>
      <label htmlFor="search-range">
        Search range
        <span>{(valueM / 1000).toFixed(valueM >= 1000 ? 1 : 1)} km</span>
      </label>
      <input
        id="search-range"
        type="range"
        min={0}
        max={RADIUS_OPTIONS_M.length - 1}
        step={1}
        value={Math.max(0, RADIUS_OPTIONS_M.indexOf(valueM as (typeof RADIUS_OPTIONS_M)[number]))}
        disabled={disabled}
        onChange={(e) => {
          const idx = Number(e.target.value)
          onChange(RADIUS_OPTIONS_M[idx] ?? valueM)
        }}
      />
      <div className="range-control__ticks" aria-hidden="true">
        {RADIUS_OPTIONS_M.map((m) => (
          <span key={m}>{(m / 1000).toFixed(1)}</span>
        ))}
      </div>
    </div>
  )
}
