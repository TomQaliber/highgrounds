import type { AccessFilter, SpotFilter } from '../lib/types'
import './SpotFilter.css'

interface SpotFilterBarProps {
  value: SpotFilter
  onChange: (value: SpotFilter) => void
  accessFilter: AccessFilter
  onAccessChange: (value: AccessFilter) => void
  sunriseCount: number
  sunsetCount: number
  walkableCount: number
  disabled?: boolean
}

export function SpotFilterBar({
  value,
  onChange,
  accessFilter,
  onAccessChange,
  sunriseCount,
  sunsetCount,
  walkableCount,
  disabled,
}: SpotFilterBarProps) {
  return (
    <div className={`spot-filter-wrap ${disabled ? 'is-disabled' : ''}`}>
      <div className="spot-filter" role="tablist" aria-label="Show spots for">
        <button
          type="button"
          role="tab"
          aria-selected={value === 'all'}
          className={value === 'all' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => onChange('all')}
        >
          All spots
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === 'sunrise'}
          className={value === 'sunrise' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => onChange('sunrise')}
        >
          Sunrise {sunriseCount > 0 ? `(${sunriseCount})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={value === 'sunset'}
          className={value === 'sunset' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => onChange('sunset')}
        >
          Sunset {sunsetCount > 0 ? `(${sunsetCount})` : ''}
        </button>
      </div>
      <div className="spot-filter spot-filter--access" role="tablist" aria-label="Access">
        <button
          type="button"
          role="tab"
          aria-selected={accessFilter === 'all'}
          className={accessFilter === 'all' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => onAccessChange('all')}
        >
          All access
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={accessFilter === 'walkable'}
          className={accessFilter === 'walkable' ? 'is-active' : ''}
          disabled={disabled}
          onClick={() => onAccessChange('walkable')}
          title="Only spots on or near public paths and roads"
        >
          Walkable {walkableCount > 0 ? `(${walkableCount})` : ''}
        </button>
      </div>
    </div>
  )
}
