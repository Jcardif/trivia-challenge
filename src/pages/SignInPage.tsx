import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, KeyRound, MapPin, UserRound } from 'lucide-react'
import EntryCountryPicker from '../components/EntryCountryPicker'
import StationAvatar from '../components/StationAvatar'
import { useGame } from '../context/GameContext'
import { userService } from '../services/userService'
import { OperationError } from '../services/operationError'
import { analytics } from '../services/analyticsService'
import { isCountry } from '../../rayfin/functions/src/countries'
import { getStationLockdownMessage, isStationLockdownActive } from '../lib/stationLockdown'
import {
  isGeneratedPlayerName,
  isPlayerPassword,
  normalizePlayerName,
  PLAYER_NAME_MAX_LENGTH,
  PLAYER_PASSWORD_MAX_LENGTH,
  PLAYER_PASSWORD_MIN_LENGTH,
} from '../../rayfin/functions/src/playerIdentity'
import type { RegisterUserRequest, User } from '../types/api'
import './SignInPage.css'

type InvalidField = 'name' | 'password' | 'confirm' | null

const PASSWORD_RULE = `Use a password of ${PLAYER_PASSWORD_MIN_LENGTH} to ${PLAYER_PASSWORD_MAX_LENGTH} characters.`
const NAME_RULE = 'Enter the adventurer name you were given, such as Amber Query Crafter.'

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setPlayer, generation, isCurrentGame } = useGame()
  const mountedRef = useRef(false)
  const submittingRef = useRef(false)
  const nameHeading = useRef<HTMLHeadingElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'new' | 'returning'>('returning')
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pendingCreation, setPendingCreation] = useState<RegisterUserRequest | null>(null)
  const [registered, setRegistered] = useState<User | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalidField, setInvalidField] = useState<InvalidField>(null)
  const isLockdownActive = isStationLockdownActive()
  const displayedError = isLockdownActive ? getStationLockdownMessage() : error
  const creationFrozen = pendingCreation !== null
  const issued = registered !== null
  const controlsDisabled = isSubmitting || creationFrozen || issued || isLockdownActive
  const detailsReady = mode === 'new' ? isCountry(country) : name.trim().length > 0
  const secretReady =
    mode === 'new' ? password.length > 0 && confirmPassword.length > 0 : password.length > 0
  const canSubmit =
    !isSubmitting && !isLockdownActive && (creationFrozen || (detailsReady && secretReady))

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
    if (issued) nameHeading.current?.focus({ preventScroll: true })
  }, [issued])
  useEffect(() => {
    if (isSubmitting || !invalidField) return
    const inputs = { name: nameInput, password: passwordInput, confirm: confirmInput }
    inputs[invalidField].current?.focus({ preventScroll: true })
  }, [invalidField, isSubmitting])

  const startEntry = (nextMode: 'new' | 'returning') => {
    if (submittingRef.current || registered) return
    setMode(nextMode)
    setName('')
    setCountry('')
    setPassword('')
    setConfirmPassword('')
    setPendingCreation(null)
    setError(null)
    setInvalidField(null)
  }
  const reject = (field: InvalidField, message: string) => {
    setInvalidField(field)
    setError(message)
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
  const submitEntry = async () => {
    if (submittingRef.current || registered) return
    if (isStationLockdownActive()) {
      setError(getStationLockdownMessage())
      return
    }
    let request: RegisterUserRequest
    if (mode === 'new') {
      if (pendingCreation) request = pendingCreation
      else {
        if (!isCountry(country)) return reject(null, 'Choose a country or region from the list.')
        if (!isPlayerPassword(password)) return reject('password', PASSWORD_RULE)
        if (password !== confirmPassword) return reject('confirm', "Those passwords don't match.")
        request = { mode: 'new', requestId: crypto.randomUUID(), country, password }
        setPendingCreation(request)
      }
    } else {
      const normalizedName = normalizePlayerName(name)
      if (!isGeneratedPlayerName(normalizedName)) return reject('name', NAME_RULE)
      if (!isPlayerPassword(password)) return reject('password', PASSWORD_RULE)
      setName(normalizedName)
      request = { mode: 'returning', name: normalizedName, password }
    }
    setError(null)
    setInvalidField(null)
    setIsSubmitting(true)
    submittingRef.current = true
    try {
      const user = await userService.register(request)
      if (!mountedRef.current || !isCurrentGame(generation)) return
      if (mode === 'new') {
        setRegistered(user)
        setPendingCreation(null)
        setPassword('')
        setConfirmPassword('')
      } else enterChallenge(user)
    } catch (failure) {
      if (!mountedRef.current || !isCurrentGame(generation)) return
      const wrongCredentials =
        mode === 'returning' &&
        failure instanceof OperationError &&
        failure.code === 'PLAYER_VERIFICATION_FAILED'
      setError(
        wrongCredentials
          ? 'Wrong name or password. Try again, or wait 15 minutes.'
          : failure instanceof Error
            ? failure.message
            : 'Player entry failed. Please try again.'
      )
      if (wrongCredentials) {
        setPassword('')
        setInvalidField('password')
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current && isCurrentGame(generation)) setIsSubmitting(false)
    }
  }
  const describedBy = (field: InvalidField, ...ids: string[]) =>
    [...ids, invalidField === field && displayedError ? 'entry-feedback' : '']
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div className="player-entry" data-telemetry-private>
      <div className="entry-board">
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
            aria-busy={isSubmitting}
            noValidate
            onSubmit={event => {
              event.preventDefault()
              if (canSubmit) void submitEntry()
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
                        ? "Start a new adventure if you're new or forgot your name or password."
                        : 'I already have an adventurer name'}
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
            <div className="entry-lock" data-entry-error={displayedError || undefined}>
              <h2 className="entry-secret-heading">
                {issued
                  ? 'Remember your name and password to return.'
                  : mode === 'returning'
                    ? 'Welcome back. Enter the adventurer name you were given and your password.'
                    : 'Choose your country or region and a password. Your adventurer name appears next.'}
              </h2>
              {issued ? (
                <section className="entry-name-reveal" aria-label="Your adventurer is ready">
                  <div className="entry-issued-name">
                    <h2
                      ref={nameHeading}
                      tabIndex={-1}
                      className="entry-control-label"
                      aria-describedby="entry-issued-value entry-name-reminder"
                    >
                      <b>
                        <Check size={15} aria-hidden="true" />
                      </b>
                      Remember your adventurer name
                    </h2>
                    <output id="entry-issued-value" aria-label="Adventurer name">
                      {registered.name}
                    </output>
                    <p id="entry-name-reminder">
                      To return, enter this name and the password you just chose.
                    </p>
                  </div>
                </section>
              ) : (
                <div className="entry-secret">
                  {mode === 'returning' ? (
                    <label className="entry-field">
                      <span className="entry-control-label" data-current={!detailsReady}>
                        <b>01</b> Enter your adventurer name
                      </span>
                      <span className="entry-input-shell">
                        <UserRound size={22} aria-hidden="true" />
                        <input
                          ref={nameInput}
                          className="entry-input"
                          type="text"
                          name="adventurerName"
                          aria-label="Adventurer name"
                          aria-invalid={invalidField === 'name'}
                          aria-describedby={describedBy('name')}
                          value={name}
                          placeholder="e.g. Amber Query Crafter"
                          autoComplete="off"
                          autoCapitalize="words"
                          spellCheck={false}
                          maxLength={PLAYER_NAME_MAX_LENGTH}
                          disabled={controlsDisabled}
                          onChange={event => {
                            setName(event.target.value)
                            setError(null)
                            setInvalidField(null)
                          }}
                        />
                      </span>
                    </label>
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
                  <label className="entry-field">
                    <span className="entry-control-label" data-current={detailsReady && !password}>
                      <b>02</b> {mode === 'new' ? 'Create a password' : 'Enter your password'}
                    </span>
                    <span className="entry-input-shell">
                      <KeyRound size={22} aria-hidden="true" />
                      <input
                        ref={passwordInput}
                        className="entry-input"
                        type="password"
                        name="password"
                        aria-label="Password"
                        aria-invalid={invalidField === 'password'}
                        aria-describedby={describedBy('password', 'entry-password-hint')}
                        value={password}
                        // Shared kiosk: never autofill another attendee's saved password.
                        autoComplete="new-password"
                        autoCapitalize="off"
                        spellCheck={false}
                        maxLength={PLAYER_PASSWORD_MAX_LENGTH * 2}
                        disabled={controlsDisabled}
                        onChange={event => {
                          setPassword(event.target.value)
                          setError(null)
                          setInvalidField(null)
                        }}
                      />
                    </span>
                  </label>
                  {mode === 'new' && (
                    <label className="entry-field">
                      <span
                        className="entry-control-label"
                        data-current={detailsReady && Boolean(password) && !confirmPassword}
                      >
                        <b>03</b> Confirm your password
                      </span>
                      <span className="entry-input-shell">
                        <KeyRound size={22} aria-hidden="true" />
                        <input
                          ref={confirmInput}
                          className="entry-input"
                          type="password"
                          name="confirmPassword"
                          aria-label="Confirm password"
                          aria-invalid={invalidField === 'confirm'}
                          aria-describedby={describedBy('confirm')}
                          value={confirmPassword}
                          autoComplete="new-password"
                          autoCapitalize="off"
                          spellCheck={false}
                          maxLength={PLAYER_PASSWORD_MAX_LENGTH * 2}
                          disabled={controlsDisabled}
                          onChange={event => {
                            setConfirmPassword(event.target.value)
                            setError(null)
                            setInvalidField(null)
                          }}
                        />
                      </span>
                    </label>
                  )}
                  <p className="entry-hint" id="entry-password-hint">
                    {mode === 'new'
                      ? `Use ${PLAYER_PASSWORD_MIN_LENGTH} to ${PLAYER_PASSWORD_MAX_LENGTH} characters. Don't reuse a password from another account.`
                      : 'Use the password you chose when you started your adventure.'}
                  </p>
                </div>
              )}
              <div className="entry-final-action">
                {displayedError ? (
                  <p className="entry-feedback" role="alert" id="entry-feedback">
                    {displayedError}
                  </p>
                ) : !issued && isSubmitting ? (
                  <p className="entry-feedback" role="status">
                    {mode === 'new' ? 'Creating your adventurer...' : 'Checking your password...'}
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
                ) : (
                  <button type="submit" className="play-go entry-create" disabled={!canSubmit}>
                    {mode === 'returning'
                      ? 'Continue adventure'
                      : creationFrozen && error
                        ? 'Retry creating my adventurer'
                        : 'Create my adventurer'}
                    <ArrowRight size={18} />
                  </button>
                )}
              </div>
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
          <a href="https://aka.ms/trivia-rules" target="_blank" rel="noopener noreferrer">
            Terms and Conditions
          </a>{' '}
          before you begin your challenge run.
        </p>
      </footer>
    </div>
  )
}
