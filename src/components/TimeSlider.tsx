import './TimeSlider.css'
import { formatTime } from '../lib/sun'

interface TimeSliderProps {
  sunrise: Date | null
  sunset: Date | null
  value: Date | null
  onChange: (date: Date) => void
  disabled?: boolean
}

export function TimeSlider({ sunrise, sunset, value, onChange, disabled }: TimeSliderProps) {
  if (!sunrise || !sunset || !value || Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime())) {
    return (
      <div className="time-slider muted">
        <span>Daylight timeline appears after a search</span>
      </div>
    )
  }

  const start = sunrise.getTime()
  const end = sunset.getTime()
  const span = Math.max(end - start, 1)
  const pct = Math.min(100, Math.max(0, ((value.getTime() - start) / span) * 100))

  return (
    <div className={`time-slider ${disabled ? 'is-disabled' : ''}`}>
      <div className="time-slider__labels">
        <span>Sunrise {formatTime(sunrise)}</span>
        <span className="time-slider__now">{formatTime(value)}</span>
        <span>Sunset {formatTime(sunset)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round((pct / 100) * 1000)}
        disabled={disabled}
        aria-label="Time of day"
        onChange={(e) => {
          const t = start + (Number(e.target.value) / 1000) * span
          onChange(new Date(t))
        }}
      />
      <div className="time-slider__hint">Scrub daytime to update the sun and viewpoint clearance</div>
    </div>
  )
}
