import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { RADIUS_OPTIONS_M } from './RangeControl'
import './SearchBar.css'

interface SearchBarProps {
  onSearch: (query: string) => void
  onLocate: () => void
  busy: boolean
  rangeM: number
  onRangeChange: (meters: number) => void
}

export function SearchBar({
  onSearch,
  onLocate,
  busy,
  rangeM,
  onRangeChange,
}: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [rangeOpen, setRangeOpen] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q) onSearch(q)
  }

  useEffect(() => {
    if (!rangeOpen) return
    function onDoc(e: MouseEvent) {
      if (!rangeRef.current?.contains(e.target as Node)) setRangeOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [rangeOpen])

  const rangeLabel = `${(rangeM / 1000).toFixed(1)} km`

  return (
    <form className="search-bar" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor="place-search">
        Search address
      </label>
      <input
        id="place-search"
        type="search"
        placeholder="Search an address in Europe…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        autoComplete="street-address"
      />
      <button type="submit" className="btn primary" disabled={busy || !query.trim()}>
        Find
      </button>
      <button type="button" className="btn ghost" onClick={onLocate} disabled={busy} title="Use my location">
        Near me
      </button>

      <div className="range-menu" ref={rangeRef}>
        <button
          type="button"
          className="btn ghost range-menu__btn"
          disabled={busy}
          aria-expanded={rangeOpen}
          aria-controls={listId}
          title="Search range"
          onClick={() => setRangeOpen((v) => !v)}
        >
          {rangeLabel}
        </button>
        {rangeOpen && (
          <ul id={listId} className="range-menu__list" role="listbox" aria-label="Search range">
            {RADIUS_OPTIONS_M.map((m) => (
              <li key={m} role="option" aria-selected={m === rangeM}>
                <button
                  type="button"
                  className={m === rangeM ? 'is-active' : ''}
                  onClick={() => {
                    onRangeChange(m)
                    setRangeOpen(false)
                  }}
                >
                  {(m / 1000).toFixed(1)} km
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  )
}
