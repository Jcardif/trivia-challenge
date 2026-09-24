import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Globe2, Search } from 'lucide-react'
import { COUNTRIES } from '../../rayfin/functions/src/countries'

interface Props {
  value: string
  disabled: boolean
  onChange: (country: string) => void
}

export default function EntryCountryPicker({ value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const matches = COUNTRIES.filter(country => country.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    if (open) search.current?.focus()
  }, [open])
  useEffect(() => {
    if (open)
      list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, query])

  const select = (country: string) => {
    if (disabled) return
    onChange(country)
    setOpen(false)
    trigger.current?.focus()
  }
  const move = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index =>
        Math.max(0, Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
      )
    } else if (event.key === 'Enter' && matches[activeIndex]) {
      event.preventDefault()
      select(matches[activeIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
  }

  return (
    <div
      className="entry-field entry-country"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <span className="entry-control-label" id="entry-country-label" data-current={!value}>
        <b>01</b> Choose your country / region
      </span>
      <button
        ref={trigger}
        type="button"
        className="entry-country-trigger"
        aria-labelledby="entry-country-label entry-country-value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? 'entry-country-list' : undefined}
        data-chosen={Boolean(value)}
        disabled={disabled}
        onClick={() => {
          setQuery('')
          setActiveIndex(
            Math.max(
              0,
              COUNTRIES.findIndex(country => country === value)
            )
          )
          setOpen(!open)
        }}
      >
        <span className="entry-country-orb" aria-hidden="true">
          <Globe2 size={29} />
        </span>
        <span id="entry-country-value">{value || 'Choose your country'}</span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className="entry-country-menu">
          <div className="entry-country-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={search}
              role="combobox"
              aria-label="Search countries"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="entry-country-list"
              aria-activedescendant={
                matches[activeIndex] ? `entry-country-${activeIndex}` : undefined
              }
              value={query}
              placeholder="Find your country..."
              autoComplete="off"
              disabled={disabled}
              onChange={event => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={move}
            />
          </div>
          <ul ref={list} role="listbox" id="entry-country-list" aria-label="Countries / regions">
            {matches.map((country, index) => (
              <li
                key={country}
                id={`entry-country-${index}`}
                role="option"
                aria-selected={country === value}
                data-active={index === activeIndex}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(country)}
              >
                {country}
                {country === value && <Check size={17} aria-hidden="true" />}
              </li>
            ))}
          </ul>
          {!matches.length && <p role="status">No countries match.</p>}
        </div>
      )}
    </div>
  )
}
