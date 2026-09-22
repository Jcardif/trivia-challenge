import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, MapPin, Star } from 'lucide-react'
import EntryCountryPicker from '../components/EntryCountryPicker'
import ItemRunePicker, { SelectedRuneSlots } from '../components/ItemRunePicker'
import StationAvatar from '../components/StationAvatar'
import { useGame } from '../context/GameContext'
import { userService } from '../services/userService'
import { OperationError } from '../services/operationError'
import { analytics } from '../services/analyticsService'
import { isCountry } from '../../rayfin/functions/src/countries'
import { getStationLockdownMessage, isStationLockdownActive } from '../lib/stationLockdown'
import {
  isPlayerCode,
  isRuneSpell,
  normalizePlayerCode,
  PLAYER_CODE_LENGTH,
  RUNE_CATALOG_VERSION,
  RUNE_COUNT,
  type RuneId,
  type RuneSpell,
} from '../../rayfin/functions/src/playerIdentity'
import type { RegisterUserRequest, User } from '../types/api'
import './SignInPage.css'

// The longest seal animation lasts 1.6 seconds.
const SPELL_REVEAL_DELAY_MS = 1700

function PlayerCodeInput({
  value,
  disabled,
  invalid,
  onChange,
  onBlur,
}: {
  value: string
  disabled: boolean
  invalid: boolean
  onChange: (value: string) => void
  onBlur: () => void
}) {
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  return (
    <label className="entry-field entry-code">
      <span className="entry-control-label" data-current={!isPlayerCode(value)}>
        <b>01</b> Enter your adventurer code
      </span>
      <span className="entry-code-lock">
        <span className="entry-code-cells" aria-hidden="true">
          {Array.from({ length: PLAYER_CODE_LENGTH }, (_, index) => (
            <span
              key={index}
              data-filled={Boolean(value[index])}
              data-cursor={index === Math.min(selection.start, PLAYER_CODE_LENGTH - 1)}
              data-selected={index >= selection.start && index < selection.end}
            >
              {value[index] || '-'}
            </span>
          ))}
        </span>
        <input
          name="playerCode"
          aria-label="Adventurer code"
          aria-invalid={invalid}
          aria-describedby={invalid ? 'entry-feedback' : undefined}
          value={value}
          placeholder="K482"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={PLAYER_CODE_LENGTH}
          disabled={disabled}
          onSelect={event =>
            setSelection({
              start: event.currentTarget.selectionStart ?? 0,
              end: event.currentTarget.selectionEnd ?? 0,
            })
          }
          onClick={event => {
            const bounds = event.currentTarget.getBoundingClientRect()
            const index = Math.min(
              value.length,
              Math.max(
                0,
                Math.floor(((event.clientX - bounds.left) / bounds.width) * PLAYER_CODE_LENGTH)
              )
            )
            event.currentTarget.setSelectionRange(index, index)
          }}
          onChange={event => onChange(normalizePlayerCode(event.target.value))}
          onPaste={event => {
            event.preventDefault()
            onChange(normalizePlayerCode(event.clipboardData.getData('text')))
          }}
          onBlur={onBlur}
        />
      </span>
    </label>
  )
}

function moveRuneFocus(event: KeyboardEvent<HTMLDivElement>) {
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
  if (
    index < 0 ||
    (event.key === 'ArrowLeft' && index % 3 === 0) ||
    (event.key === 'ArrowRight' && index % 3 === 2)
  )
    return
  buttons[index + offsets[event.key]]?.focus()
}

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setPlayer, generation, isCurrentGame } = useGame()
  const mountedRef = useRef(false)
  const submittingRef = useRef(false)
  const codeHeading = useRef<HTMLHeadingElement>(null)
  const [mode, setMode] = useState<'new' | 'returning'>('returning')
  const [playerCode, setPlayerCode] = useState('')
  const [country, setCountry] = useState('')
  const [runes, setRunes] = useState<RuneId[]>([])
  const [pendingCreation, setPendingCreation] = useState<RegisterUserRequest | null>(null)
  const [registered, setRegistered] = useState<User | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [codeInvalid, setCodeInvalid] = useState(false)
  const [celebrating, setCelebrating] = useState(false)
  const isLockdownActive = isStationLockdownActive()
  const displayedError = isLockdownActive ? getStationLockdownMessage() : error
  const creationFrozen = pendingCreation !== null
  const issued = registered !== null && !celebrating
  const controlsDisabled = isSubmitting || creationFrozen || registered !== null || isLockdownActive
  const detailsReady = mode === 'new' ? isCountry(country) : isPlayerCode(playerCode)
  const canRetry = Boolean(error) && !registered && detailsReady && isRuneSpell(runes)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    analytics.track('pageview.home', { path: location.pathname })
  }, [location.pathname])
  useEffect(() => {
    if (!celebrating) return
    const timer = window.setTimeout(
      () => setCelebrating(false),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : SPELL_REVEAL_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [celebrating])
  useEffect(() => {
    if (issued) codeHeading.current?.focus({ preventScroll: true })
  }, [issued])

  const startEntry = (nextMode: 'new' | 'returning') => {
    if (submittingRef.current || registered) return
    setMode(nextMode)
    setRunes([])
    setPlayerCode('')
    setCountry('')
    setPendingCreation(null)
    setError(null)
    setCodeInvalid(false)
    setCelebrating(false)
  }
  const changeRunes = (next: RuneId[]) => {
    if (controlsDisabled || submittingRef.current || !detailsReady) return
    setCelebrating(next.length === RUNE_COUNT && runes.length !== RUNE_COUNT)
    setRunes(next)
    setError(null)
    if (isRuneSpell(next)) void submitEntry(next)
  }
  const enterChallenge = (user: User) => {
    if (isStationLockdownActive()) {
      setError(getStationLockdownMessage())
      return
    }
    analytics.identify(user)
    analytics.track(
      'user.register',
      { userId: user.userId, name: user.name, country: user.country, entryMode: mode },
      { page: 'signin' }
    )
    setPlayer(user)
    navigate('/select-pool')
  }
  const submitEntry = async (selectedRunes = runes) => {
    if (submittingRef.current || registered) return
    if (isStationLockdownActive()) {
      setError(getStationLockdownMessage())
      return
    }
    if (!isRuneSpell(selectedRunes)) {
      setError('Choose three different item runes in order.')
      return
    }
    if (mode === 'new' && !isCountry(country)) {
      setError('Choose a country or region from the list.')
      return
    }
    if (mode === 'returning' && !isPlayerCode(playerCode)) {
      setCodeInvalid(true)
      setError('Use one letter and three digits, like K482.')
      setCelebrating(false)
      return
    }
    const spell: RuneSpell = [selectedRunes[0], selectedRunes[1], selectedRunes[2]]
    const request: RegisterUserRequest =
      mode === 'new'
        ? (pendingCreation ?? {
            mode: 'new',
            requestId: crypto.randomUUID(),
            country,
            runeVersion: RUNE_CATALOG_VERSION,
            runes: spell,
          })
        : { mode: 'returning', playerCode, runeVersion: RUNE_CATALOG_VERSION, runes: spell }
    if (mode === 'new') setPendingCreation(request)
    setError(null)
    setCodeInvalid(false)
    setIsSubmitting(true)
    submittingRef.current = true
    try {
      const user = await userService.register(request)
      if (!mountedRef.current || !isCurrentGame(generation)) return
      if (mode === 'new') {
        setRegistered(user)
        setPendingCreation(null)
      } else enterChallenge(user)
    } catch (failure) {
      if (!mountedRef.current || !isCurrentGame(generation)) return
      const wrongSpell =
        mode === 'returning' &&
        failure instanceof OperationError &&
        failure.code === 'PLAYER_VERIFICATION_FAILED'
      setError(
        wrongSpell
          ? 'Wrong code or spell. Try again, or wait 15 minutes.'
          : failure instanceof Error
            ? failure.message
            : 'Player entry failed. Please try again.'
      )
      setCelebrating(false)
      if (wrongSpell) setRunes([])
    } finally {
      submittingRef.current = false
      if (mountedRef.current && isCurrentGame(generation)) setIsSubmitting(false)
    }
  }

  return (
    <div className="player-entry" data-telemetry-private>
      <div
        className="entry-board"
        data-spell-ready={runes.length === RUNE_COUNT}
        data-spell-celebrating={celebrating}
      >
        <header className="entry-brand">
          <img src="/fabriclogo.png" alt="Microsoft Fabric" />
          <p>
            The Microsoft Fabric <strong>Trivia Challenge</strong>
          </p>
        </header>
        <main className="entry-main">
          <form
            className="entry-split"
            aria-label="Adventurer entry"
            autoComplete="off"
            aria-busy={isSubmitting || celebrating}
            onSubmit={event => {
              event.preventDefault()
              if (canRetry) void submitEntry()
            }}
          >
            <div className="entry-welcome" data-issued={issued}>
              <div className="entry-player-banner">
                <div className="entry-player-crest" aria-hidden="true">
                  <StationAvatar placement="entry" />
                </div>
                <div>
                  <span className="entry-eyebrow">
                    {issued
                      ? 'YOUR ADVENTURER'
                      : mode === 'returning'
                        ? 'YOUR ADVENTURE'
                        : 'NEW ADVENTURER'}
                  </span>
                  <h1>
                    {issued ? "You're in" : mode === 'returning' ? 'Continue' : 'Begin'}
                    <em>{issued ? 'adventurer' : 'your quest'}</em>
                  </h1>
                </div>
              </div>
              <div className="entry-details">
                {issued ? (
                  <h2 className="entry-player-name">{registered.name}</h2>
                ) : mode === 'returning' ? (
                  <PlayerCodeInput
                    value={playerCode}
                    disabled={controlsDisabled}
                    invalid={codeInvalid}
                    onChange={code => {
                      setPlayerCode(code)
                      setRunes([])
                      setError(null)
                      setCodeInvalid(false)
                      setCelebrating(false)
                    }}
                    onBlur={() => {
                      if (playerCode && !isPlayerCode(playerCode)) {
                        setCodeInvalid(true)
                        setError('Use one letter and three digits, like K482.')
                      }
                    }}
                  />
                ) : (
                  <EntryCountryPicker
                    value={country}
                    disabled={controlsDisabled}
                    onChange={value => {
                      setCountry(value)
                      setError(null)
                    }}
                  />
                )}
              </div>
              <div className="entry-player-footer">
                {issued ? (
                  <p className="entry-saved-country">
                    <MapPin size={16} /> {registered.country}
                  </p>
                ) : (
                  <div className="entry-links">
                    <button
                      type="button"
                      className="entry-mode-link"
                      disabled={controlsDisabled}
                      onClick={() => startEntry(mode === 'returning' ? 'new' : 'returning')}
                    >
                      {mode === 'returning'
                        ? "Start a new adventure if you're new or forgot your code or spell."
                        : 'I already have a code'}
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                    {creationFrozen && !isSubmitting && (
                      <button
                        type="button"
                        className="entry-mode-link"
                        onClick={() => startEntry('new')}
                      >
                        Start over with a new adventurer instead
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div
              className="arcade-machine entry-lock"
              data-spell-ready={runes.length === RUNE_COUNT}
              data-spell-celebrating={celebrating}
              data-entry-error={displayedError || undefined}
            >
              <div className="entry-spell-tray">
                <div className="entry-spell-copy">
                  <div className="entry-control-label" data-current={detailsReady && !issued}>
                    <b>{issued ? <Check size={15} aria-label="Complete" /> : '02'}</b>
                    <h2>
                      {issued
                        ? 'Keep this rune order to unlock your adventure when you return.'
                        : mode === 'returning'
                          ? 'Recast your 3 runes in the same order to rejoin the adventure.'
                          : runes.length === RUNE_COUNT && !displayedError
                            ? 'Forging your adventurer. Your code is coming next.'
                            : 'Choose 3 runes in an order to remember. Your code appears next.'}
                    </h2>
                    <span className="entry-rune-count" aria-hidden="true">
                      {runes.length} / 3
                    </span>
                  </div>
                </div>
                <SelectedRuneSlots
                  value={runes}
                  onChange={changeRunes}
                  disabled={controlsDisabled}
                />
              </div>
              {issued ? (
                <section className="entry-code-reveal" aria-label="Your adventurer is ready">
                  <div className="entry-issued-code">
                    <h2
                      ref={codeHeading}
                      tabIndex={-1}
                      className="entry-control-label"
                      aria-describedby="entry-issued-value entry-code-reminder"
                    >
                      Keep your adventurer code
                    </h2>
                    <output
                      id="entry-issued-value"
                      className="entry-code-cells"
                      aria-label="Adventurer code"
                    >
                      {registered.playerCode.split('').map((character, index) => (
                        <span key={index} data-filled="true">
                          {character}
                        </span>
                      ))}
                    </output>
                    <p id="entry-code-reminder">Keep this code and your 3-rune spell to return.</p>
                  </div>
                </section>
              ) : (
                <div className="entry-keypad" onKeyDown={moveRuneFocus}>
                  <ItemRunePicker
                    value={runes}
                    onChange={changeRunes}
                    disabled={!detailsReady || controlsDisabled}
                  />
                </div>
              )}
              <div className="entry-final-action">
                {displayedError ? (
                  <p className="entry-feedback" role="alert" id="entry-feedback">
                    {displayedError}
                  </p>
                ) : !issued && (isSubmitting || celebrating) ? (
                  <p className="entry-feedback" role="status">
                    {mode === 'new' ? 'Forging your adventurer...' : 'Checking your spell...'}
                  </p>
                ) : null}
                {issued ? (
                  <button
                    type="button"
                    className="play-go entry-create"
                    disabled={isLockdownActive}
                    onClick={() => enterChallenge(registered)}
                  >
                    Begin trivia <ArrowRight size={18} />
                  </button>
                ) : canRetry ? (
                  <button
                    type="submit"
                    className="play-go entry-create"
                    disabled={isSubmitting || isLockdownActive}
                  >
                    {mode === 'new' ? 'Retry summoning my adventurer' : 'Retry verification'}
                    <ArrowRight size={18} />
                  </button>
                ) : null}
              </div>
              {!issued && celebrating && !displayedError && (
                <div className="spell-finale" aria-hidden="true">
                  <span className="spell-wave" />
                  {Array.from({ length: 16 }, (_, index) => (
                    <span
                      className="spell-ray"
                      key={index}
                      style={{ transform: `rotate(${index * 22.5}deg)` }}
                    >
                      <Star
                        size={18}
                        fill="currentColor"
                        style={{ animationDelay: `${(index % 4) * 0.045}s` }}
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
          </form>
        </main>
      </div>
      <footer className="privacy-notice entry-privacy" aria-label="Privacy notice">
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
    </div>
  )
}
