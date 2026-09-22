// Local-only A entry prototype on /signin: automatic code reveal and one start button.
// No production services.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Check, ChevronDown, Globe2, MapPin, Search, Star } from 'lucide-react'
import ItemRunePicker, { SelectedRuneSlots } from '../components/ItemRunePicker'
import PrototypeControls from '../components/PrototypeControls'
import {
  ITEM_RUNES,
  PLAYER_CODE_LETTERS,
  normalizePlayerCode,
  type RuneId,
} from '../../rayfin/functions/src/playerIdentity'
import countryText from '../../rayfin/functions/src/country-names.txt?raw'
import './SignInPage.css'
import './SignInPage.prototype.css'

const CODE_LENGTH = 4
// Let the 1.6-second seal animation finish before replacing the keypad.
const SPELL_REVEAL_DELAY_MS = 1700
const KEYPAD_RUNES = ITEM_RUNES.slice(0, 9).map(rune => rune.id)
const countries = countryText
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))
if (!countries.length)
  throw new Error('Add country names to country-names.txt before opening the prototype.')

type EntryState = {
  mode: 'returning' | 'new'
  code: string
  country: string
  runes: RuneId[]
  status: 'idle' | 'forging' | 'checking' | 'error' | 'issued' | 'ready'
  error: string
}
const initialState = (): EntryState => ({
  mode: 'returning',
  code: '',
  country: '',
  runes: [],
  status: 'idle',
  error: '',
})
type DemoPlayer = { code: string; country: string; name: string; runes: RuneId[] }
const initialPlayer = (): DemoPlayer => ({
  code: 'K482',
  country: countries[0],
  name: 'Amber Query Weaver',
  runes: ['lakehouse', 'notebook', 'data-pipeline'],
})
interface Flow {
  state: EntryState
  player: DemoPlayer
  update: (fields: Partial<EntryState>) => void
  choose: (runes: RuneId[]) => void
  changeMode: (mode: EntryState['mode']) => void
  detailsReady: boolean
  issued: boolean
  locked: boolean
}

function CodeLock({ flow }: { flow: Flow }) {
  const { state, update } = flow
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  return (
    <label className="prototype-field prototype-code">
      <span className="prototype-control-label" data-current={!flow.detailsReady}>
        <b>01</b> Enter your adventurer code
      </span>
      <span className="prototype-code-lock">
        <span className="prototype-code-cells" aria-hidden="true">
          {Array.from({ length: CODE_LENGTH }, (_, index) => (
            <span
              key={index}
              data-filled={Boolean(state.code[index])}
              data-cursor={index === Math.min(selection.start, CODE_LENGTH - 1)}
              data-selected={index >= selection.start && index < selection.end}
            >
              {state.code[index] || '-'}
            </span>
          ))}
        </span>
        <input
          aria-label="Adventurer code"
          value={state.code}
          placeholder="K482"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          disabled={flow.locked}
          onSelect={event =>
            setSelection({
              start: event.currentTarget.selectionStart ?? 0,
              end: event.currentTarget.selectionEnd ?? 0,
            })
          }
          onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const index = Math.min(
              state.code.length,
              Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * CODE_LENGTH))
            )
            event.currentTarget.setSelectionRange(index, index)
          }}
          onChange={event =>
            update({
              code: normalizePlayerCode(event.target.value).slice(0, CODE_LENGTH),
              runes: [],
              status: 'idle',
              error: '',
            })
          }
        />
      </span>
    </label>
  )
}

function CountryPicker({ flow }: { flow: Flow }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const matches = countries.filter(country => country.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    if (open) search.current?.focus()
  }, [open])
  useEffect(() => {
    if (open)
      list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, query])

  const select = (country: string) => {
    flow.update({ country, status: 'idle', error: '' })
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
      className="prototype-field prototype-country"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <span
        className="prototype-control-label"
        id="prototype-country-label"
        data-current={!flow.detailsReady}
      >
        <b>01</b> Choose your country / region
      </span>
      <button
        ref={trigger}
        type="button"
        className="prototype-country-trigger"
        aria-labelledby="prototype-country-label prototype-country-value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? 'prototype-country-list' : undefined}
        data-chosen={Boolean(flow.state.country)}
        disabled={flow.locked}
        onClick={() => {
          setQuery('')
          setActiveIndex(Math.max(0, countries.indexOf(flow.state.country)))
          setOpen(!open)
        }}
      >
        <span className="prototype-country-orb" aria-hidden="true">
          <Globe2 size={29} />
        </span>
        <span id="prototype-country-value">{flow.state.country || 'Choose your country'}</span>
        <ChevronDown size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className="prototype-country-menu">
          <div className="prototype-country-search">
            <Search size={17} aria-hidden="true" />
            <input
              ref={search}
              role="combobox"
              aria-label="Search countries"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="prototype-country-list"
              aria-activedescendant={
                matches[activeIndex] ? `prototype-country-${activeIndex}` : undefined
              }
              value={query}
              placeholder="Find your country..."
              autoComplete="off"
              onChange={event => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={move}
            />
          </div>
          <ul
            ref={list}
            role="listbox"
            id="prototype-country-list"
            aria-label="Countries / regions"
          >
            {matches.map((country, index) => (
              <li
                key={country}
                id={`prototype-country-${index}`}
                role="option"
                aria-selected={country === flow.state.country}
                data-active={index === activeIndex}
                onMouseDown={event => event.preventDefault()}
                onClick={() => select(country)}
              >
                {country}
                {country === flow.state.country && <Check size={17} aria-hidden="true" />}
              </li>
            ))}
          </ul>
          {!matches.length && <p role="status">No countries match.</p>}
        </div>
      )}
    </div>
  )
}

function EntryLinks({ flow }: { flow: Flow }) {
  const returning = flow.state.mode === 'returning'
  return (
    <div className="prototype-entry-links">
      <button
        type="button"
        className="prototype-mode-link"
        disabled={flow.locked}
        onClick={() => flow.changeMode(returning ? 'new' : 'returning')}
      >
        {returning
          ? "Start a new adventure if you're new or forgot your code or spell."
          : 'I already have a code'}
        <ArrowRight size={17} aria-hidden="true" />
      </button>
    </div>
  )
}

function SpellTray({ flow }: { flow: Flow }) {
  const { state } = flow
  const complete = state.runes.length === 3
  return (
    <div className="prototype-spell-tray">
      <div className="prototype-spell-copy">
        <div className="prototype-control-label" data-current={flow.detailsReady && !flow.issued}>
          <b>{flow.issued ? <Check size={15} aria-label="Complete" /> : '02'}</b>
          <h2>
            {flow.issued
              ? 'Keep this rune order to unlock your adventure when you return.'
              : state.mode === 'returning'
                ? 'Recast your 3 runes in the same order to rejoin the adventure.'
                : complete
                  ? 'Forging your adventurer. Your code is coming next.'
                  : 'Choose 3 runes in an order to remember. Your code appears next.'}
          </h2>
          <span className="prototype-rune-count" aria-hidden="true">
            {state.runes.length} / 3
          </span>
        </div>
      </div>
      <Slots flow={flow} />
    </div>
  )
}

function Slots({ flow }: { flow: Flow }) {
  return (
    <SelectedRuneSlots value={flow.state.runes} onChange={flow.choose} disabled={flow.locked} />
  )
}

function Keypad({ flow }: { flow: Flow }) {
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -3,
      ArrowDown: 3,
    }
    if (!(event.key in offsets)) return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('.arcade-rune')]
    const index = buttons.findIndex(button => button === document.activeElement)
    if (index < 0) return
    if (
      (event.key === 'ArrowLeft' && index % 3 === 0) ||
      (event.key === 'ArrowRight' && index % 3 === 2)
    )
      return
    buttons[index + offsets[event.key]]?.focus()
  }
  return (
    <div className="prototype-keypad" data-prototype-keypad onKeyDown={moveFocus}>
      <ItemRunePicker
        value={flow.state.runes}
        onChange={flow.choose}
        disabled={!flow.detailsReady || flow.locked}
        availableRunes={KEYPAD_RUNES}
      />
    </div>
  )
}

function Finale({ state }: { state: EntryState }) {
  if (state.runes.length !== 3 || state.error) return null
  return (
    <div className="spell-finale" aria-hidden="true">
      <span className="spell-wave" />
      {Array.from({ length: 16 }, (_, index) => (
        <span className="spell-ray" key={index} style={{ transform: `rotate(${index * 22.5}deg)` }}>
          <Star
            size={18}
            fill="currentColor"
            style={{ animationDelay: `${(index % 4) * 0.045}s` }}
          />
        </span>
      ))}
    </div>
  )
}

function CodeReveal({ flow }: { flow: Flow }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section
      className="prototype-code-reveal"
      aria-label="Adventurer code reveal"
      data-telemetry-private
    >
      <div className="prototype-issued-code">
        <h2
          ref={heading}
          tabIndex={-1}
          className="prototype-control-label"
          aria-describedby="prototype-issued-value prototype-code-reminder"
        >
          {flow.state.mode === 'new' ? 'Keep your adventurer code' : 'Your adventurer code'}
        </h2>
        <output
          id="prototype-issued-value"
          className="prototype-code-cells"
          aria-label="Adventurer code"
        >
          {flow.player.code.split('').map((character, index) => (
            <span key={index} data-filled="true">
              {character}
            </span>
          ))}
        </output>
        <p id="prototype-code-reminder">
          {flow.state.mode === 'new'
            ? 'Keep this code and your 3-rune spell to return.'
            : 'Your code and spell matched.'}
        </p>
      </div>
    </section>
  )
}

function EntryAction({ flow }: { flow: Flow }) {
  const { state } = flow
  if (state.status === 'ready')
    return (
      <div className="prototype-handoff" role="status">
        <strong>
          <Check size={18} /> Ready to play
        </strong>
        <span>Local preview ends here. No game started.</span>
      </div>
    )
  if (state.status === 'issued')
    return (
      <button className="play-go prototype-create" onClick={() => flow.update({ status: 'ready' })}>
        Begin trivia <ArrowRight size={18} />
      </button>
    )
  return (
    <p className="prototype-feedback" role={state.error ? 'alert' : 'status'} aria-live="polite">
      {state.status === 'forging'
        ? 'Forging your adventurer...'
        : state.status === 'checking'
          ? 'Checking your spell...'
          : state.error}
    </p>
  )
}

export function VariantA({ flow }: { flow: Flow }) {
  const { state } = flow
  return (
    <section className="prototype-split">
      <div className="prototype-welcome" data-issued={flow.issued}>
        <div className="prototype-player-banner">
          <div className="prototype-player-crest" aria-hidden="true">
            <img src="/avatars/dashboarddruid.png" alt="" />
          </div>
          <div>
            <span className="prototype-eyebrow">
              {flow.issued
                ? 'YOUR ADVENTURER'
                : state.mode === 'returning'
                  ? 'YOUR ADVENTURE'
                  : 'NEW ADVENTURER'}
            </span>
            <h1>
              {flow.issued ? "You're in" : state.mode === 'returning' ? 'Continue' : 'Begin'}
              <em>{flow.issued ? 'adventurer' : 'your quest'}</em>
            </h1>
          </div>
        </div>
        <div className="prototype-details">
          {flow.issued ? (
            <p className="prototype-player-name">{flow.player.name}</p>
          ) : state.mode === 'returning' ? (
            <CodeLock flow={flow} />
          ) : (
            <CountryPicker flow={flow} />
          )}
        </div>
        <div className="prototype-player-footer">
          {flow.issued ? (
            <p className="prototype-saved-country">
              <MapPin size={16} /> {flow.player.country}
            </p>
          ) : (
            <EntryLinks flow={flow} />
          )}
        </div>
      </div>
      <div
        className="arcade-machine prototype-lock"
        data-spell-ready={state.runes.length === 3}
        data-spell-celebrating={state.runes.length === 3}
        data-entry-error={state.error || undefined}
      >
        <SpellTray flow={flow} />
        {flow.issued ? <CodeReveal flow={flow} /> : <Keypad flow={flow} />}
        <div className="prototype-final-action">
          <EntryAction flow={flow} />
        </div>
        {!flow.issued && <Finale state={state} />}
      </div>
    </section>
  )
}

function PrototypeFlow() {
  const [state, setState] = useState<EntryState>(initialState)
  const [player, setPlayer] = useState<DemoPlayer>(initialPlayer)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    console.info('[entry prototype]', {
      design: 'A',
      ...state,
      demoPlayer: player,
      countrySource: 'country-names.txt',
      countriesLoaded: countries.length,
    })
  }, [state, player])

  const update = (fields: Partial<EntryState>) => setState(previous => ({ ...previous, ...fields }))
  const changeMode = (mode: EntryState['mode']) => {
    window.clearTimeout(timer.current)
    setState({ ...initialState(), mode })
  }
  const normalizedCode = normalizePlayerCode(state.code)
  const detailsReady =
    state.mode === 'returning'
      ? normalizedCode.length === CODE_LENGTH &&
        PLAYER_CODE_LETTERS.includes(normalizedCode[0]) &&
        /^[0-9]{3}$/.test(normalizedCode.slice(1))
      : countries.includes(state.country)
  const issued = state.status === 'issued' || state.status === 'ready'
  const locked = state.status === 'forging' || state.status === 'checking' || issued
  const choose = (runes: RuneId[]) => {
    if (!detailsReady || locked) return
    update({ runes, error: '', status: 'idle' })
    if (runes.length !== 3) return
    if (state.mode === 'new') {
      update({ status: 'forging' })
      timer.current = window.setTimeout(
        () => {
          setPlayer({
            code: 'Q042',
            name: 'Amber Query Weaver',
            country: state.country,
            runes: [...runes],
          })
          update({ status: 'issued' })
        },
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SPELL_REVEAL_DELAY_MS
      )
      return
    }
    update({ status: 'checking' })
    timer.current = window.setTimeout(() => {
      const matched =
        normalizedCode === player.code && runes.every((rune, index) => rune === player.runes[index])
      update(
        matched
          ? { status: 'ready' }
          : { status: 'error', error: 'Wrong code or spell. Try again.', runes: [] }
      )
    }, 850)
  }
  const flow: Flow = {
    state,
    player,
    update,
    choose,
    changeMode,
    detailsReady,
    issued,
    locked,
  }

  return (
    <div className="player-entry entry-prototype">
      <div
        className="prototype-board"
        data-spell-ready={state.runes.length === 3}
        data-spell-celebrating={state.runes.length === 3}
      >
        <header className="prototype-brand">
          <img src="/fabriclogo.png" alt="Microsoft Fabric" />
          <p>
            The Microsoft Fabric <strong>Trivia Challenge</strong>
          </p>
        </header>
        <main className="prototype-main">
          <VariantA flow={flow} />
        </main>
      </div>
      <footer className="privacy-notice prototype-privacy">
        <p>
          Your privacy matters to us. We save your selected country or region with your adventurer
          profile. When you start the Challenge, your country, gameplay and telemetry data feed the
          Microsoft Fabric Real-Time Intelligence demo so attendees can see live analytics. That
          telemetry may inform post-event learnings or future Microsoft marketing.
        </p>
        <p>
          Review the{' '}
          <a href="http://aka.ms/igniteRTI-racingrules" target="_blank" rel="noopener noreferrer">
            Terms and Conditions
          </a>{' '}
          before you begin your challenge run.
        </p>
      </footer>
      <PrototypeControls
        onDemo={() => {
          window.clearTimeout(timer.current)
          setState({ ...initialState(), code: player.code })
        }}
        onReset={() => {
          setPlayer(initialPlayer())
          changeMode('returning')
        }}
      >
        <h2>What makes entry feel obvious?</h2>
        <p>
          A uses one shared game board: its title is inside the frame, and the adventurer and rune
          controls share the same background without separate card borders. The alternative entry
          link stays with the code or country field. A larger avatar fills the space above the
          adventurer details. Choosing the third rune plays the completion animation, then replaces
          the right keypad with the code automatically. The three enlarged selected runes stay above
          it and become read-only. There is no separate receipt screen.
        </p>
        <p>
          Each numbered instruction belongs to its control: country or code on the left, runes on
          the right. There is no create button. Begin trivia is the only primary action, shown after
          the code appears. Reduced motion skips the wait. Switching entry modes is a text link, not
          a competing primary action. Correct returning spells advance automatically to the inline
          preview endpoint.
        </p>
        <p>
          <strong>Country source:</strong> rayfin/functions/src/country-names.txt,{' '}
          {countries.length} names read directly. No generated copy or network lookup.
        </p>
        <p>
          <strong>Code experiment:</strong> one Crockford letter and three digits, giving 22,000
          possible codes. Production still uses one letter and four digits.
        </p>
        <p>
          <strong>Demo:</strong> K482, then Lakehouse, Notebook, Data Pipeline. Those are keypad
          positions 1, 3, 4. Creating an adventurer replaces this in-memory demo with Q042 and your
          chosen spell.
        </p>
        <h3>Research behind the choices</h3>
        <ul>
          <li>
            <a
              href="https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/112"
              target="_blank"
              rel="noreferrer"
            >
              Xbox XAG 112
            </a>
            : consistent layouts, input methods, and focus order. The nine available icons stay in
            the same 3-by-3 positions in every flow and viewport. Only the prototype omits the
            original bottom row; the production catalog is unchanged.
          </li>
          <li>
            <a
              href="https://www.nngroup.com/articles/progressive-disclosure/"
              target="_blank"
              rel="noreferrer"
            >
              NN/g progressive disclosure
            </a>
            : show the important actions first and make the next step obvious. Joining reveals the
            new-player fields in place. Returning-first is a hypothesis, not a proven preference for
            this audience.
          </li>
          <li>
            <a
              href="https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html"
              target="_blank"
              rel="noreferrer"
            >
              WCAG target size, enhanced
            </a>
            : aim for at least 44-by-44 CSS-pixel targets, with larger rune keys wherever possible.
          </li>
          <li>
            <a
              href="https://www.w3.org/WAI/WCAG22/Understanding/on-input.html"
              target="_blank"
              rel="noreferrer"
            >
              WCAG on input
            </a>
            : make auto-advance predictable. New players are told their code appears after choosing
            three runes. The returning instruction says recasting the three runes in order rejoins
            the adventure.
          </li>
          <li>
            <a
              href="https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html"
              target="_blank"
              rel="noreferrer"
            >
              WCAG animation from interactions
            </a>
            : retain the selection boop and spell burst, and respect reduced-motion settings.
          </li>
        </ul>
        <h3>Live prototype state</h3>
        <pre>
          {JSON.stringify(
            { design: 'A', ...state, demoPlayer: player, countriesLoaded: countries.length },
            null,
            2
          )}
        </pre>
      </PrototypeControls>
    </div>
  )
}

export default function SignInPagePrototype() {
  return <PrototypeFlow />
}
