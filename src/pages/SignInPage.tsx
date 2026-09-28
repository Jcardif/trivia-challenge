import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Camera, Check, KeyRound, MapPin } from 'lucide-react'
import EntryCountryPicker from '../components/EntryCountryPicker'
import StationAvatar from '../components/StationAvatar'
import { useGame } from '../context/GameContext'
import { userService } from '../services/userService'
import { OperationError } from '../services/operationError'
import { analytics } from '../services/analyticsService'
import { isCountry } from '../../rayfin/functions/src/countries'
import { getStationLockdownMessage, isStationLockdownActive } from '../lib/stationLockdown'
import { isPlayerCode, normalizePlayerCode } from '../../rayfin/functions/src/playerIdentity'
import type { RegisteredPlayer, RegisterUserRequest, User } from '../types/api'
import './SignInPage.css'

type InvalidField = 'code' | null

const CODE_RULE = 'Enter your 5-character secret code.'

function withoutSecretCode(player: RegisteredPlayer): User {
  const user = { ...player }
  delete user.secretCode
  return user
}

export default function SignInPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setPlayer, generation, isCurrentGame } = useGame()
  const mountedRef = useRef(false)
  const submittingRef = useRef(false)
  const nameHeading = useRef<HTMLHeadingElement>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'new' | 'returning'>('new')
  const [country, setCountry] = useState('')
  const [secretCode, setSecretCode] = useState('')
  const [pendingCreation, setPendingCreation] = useState<RegisterUserRequest | null>(null)
  const [registered, setRegistered] = useState<User | null>(null)
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalidField, setInvalidField] = useState<InvalidField>(null)
  const isLockdownActive = isStationLockdownActive()
  const displayedError = isLockdownActive ? getStationLockdownMessage() : error
  const creationFrozen = pendingCreation !== null
  const issued = registered !== null
  const controlsDisabled = isSubmitting || creationFrozen || issued || isLockdownActive
  const detailsReady = mode === 'new' ? isCountry(country) : secretCode.trim().length > 0
  const canSubmit = !isSubmitting && !isLockdownActive && (creationFrozen || detailsReady)

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
    if (isSubmitting || invalidField !== 'code') return
    codeInput.current?.focus({ preventScroll: true })
  }, [invalidField, isSubmitting])

  const startEntry = (nextMode: 'new' | 'returning') => {
    if (submittingRef.current || registered) return
    setMode(nextMode)
    setCountry('')
    setSecretCode('')
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
        request = { mode: 'new', requestId: crypto.randomUUID(), country }
        setPendingCreation(request)
      }
    } else {
      const normalizedCode = normalizePlayerCode(secretCode)
      if (!isPlayerCode(normalizedCode)) return reject('code', CODE_RULE)
      request = { mode: 'returning', secretCode: normalizedCode }
    }
    setError(null)
    setInvalidField(null)
    setIsSubmitting(true)
    submittingRef.current = true
    try {
      const player = await userService.register(request)
      if (!mountedRef.current || !isCurrentGame(generation)) return
      const user = withoutSecretCode(player)
      if (mode === 'new') {
        if (!player.secretCode) {
          setPendingCreation(null)
          setCountry('')
          throw new Error('Secret code was not returned. Start a new challenge.')
        }
        setRegistered(user)
        setIssuedCode(player.secretCode)
        setPendingCreation(null)
      } else {
        setSecretCode('')
        enterChallenge(user)
      }
    } catch (failure) {
      if (!mountedRef.current || !isCurrentGame(generation)) return
      const operationError = failure instanceof OperationError ? failure : null
      const wrongCode =
        mode === 'returning' && operationError?.code === 'PLAYER_VERIFICATION_FAILED'
      if (mode === 'new' && operationError?.code === 'PLAYER_ALREADY_CREATED') {
        setPendingCreation(null)
        setCountry('')
      }
      setError(
        wrongCode
          ? "That secret code didn't match an adventurer. Check your photo and try again, or start a new challenge."
          : failure instanceof Error
            ? failure.message
            : 'Player entry failed. Please try again.'
      )
      if (wrongCode) {
        setSecretCode('')
        setInvalidField('code')
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
                        ? 'RETURNING ADVENTURER'
                        : 'NEW ADVENTURER'}
                  </span>
                  <h1>
                    {issued ? "You're in," : mode === 'returning' ? 'Welcome' : 'Start a new'}
                    <em>{issued ? 'adventurer' : mode === 'returning' ? 'back' : 'challenge'}</em>
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
                      onClick={() => startEntry(mode === 'new' ? 'returning' : 'new')}
                    >
                      {mode === 'new'
                        ? 'Have your secret code? Enter it here'
                        : 'Forgot your code? Start a new challenge'}
                      <ArrowRight size={17} aria-hidden="true" />
                    </button>
                    {creationFrozen && !isSubmitting && (
                      <button
                        type="button"
                        className="entry-mode-link"
                        onClick={() => startEntry('new')}
                      >
                        Start a new challenge
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="entry-lock" data-entry-error={displayedError || undefined}>
              <h2 className="entry-secret-heading">
                {issued
                  ? "Take a photo now. Your secret code won't be shown again."
                  : mode === 'returning'
                    ? 'Enter the secret code from your photo.'
                    : "Choose your country or region. We'll give you an adventurer name and a secret code."}
              </h2>
              {issued ? (
                <section className="entry-name-reveal" aria-label="Your adventurer is ready">
                  <div className="entry-issued-name">
                    <div className="entry-issued-block">
                      <h2
                        ref={nameHeading}
                        tabIndex={-1}
                        className="entry-control-label"
                        aria-describedby="entry-issued-value"
                      >
                        <b>
                          <Check size={15} aria-hidden="true" />
                        </b>
                        Your adventurer name
                      </h2>
                      <output id="entry-issued-value" aria-label="Adventurer name">
                        {registered.name}
                      </output>
                    </div>
                    <div className="entry-issued-block entry-code-block">
                      <h2 className="entry-control-label" aria-describedby="entry-issued-code">
                        <b>
                          <KeyRound size={15} aria-hidden="true" />
                        </b>
                        Your secret code
                      </h2>
                      <output
                        id="entry-issued-code"
                        className="entry-issued-code"
                        aria-label="Secret code"
                      >
                        {issuedCode}
                      </output>
                    </div>
                    <div className="entry-code-callout" role="note">
                      <Camera size={22} aria-hidden="true" />
                      <p>
                        Take a photo of your secret code now. It won't be shown again, and it's all
                        you need to come back.
                      </p>
                    </div>
                  </div>
                </section>
              ) : (
                <div className="entry-secret">
                  {mode === 'returning' ? (
                    <label className="entry-field">
                      <span className="entry-control-label" data-current={!detailsReady}>
                        <b>01</b> Secret code
                      </span>
                      <span className="entry-input-shell">
                        <KeyRound size={22} aria-hidden="true" />
                        <input
                          ref={codeInput}
                          className="entry-input"
                          type="password"
                          name="secretCode"
                          aria-label="Secret code"
                          aria-invalid={invalidField === 'code'}
                          aria-describedby={describedBy('code', 'entry-code-hint')}
                          value={secretCode}
                          // Shared kiosk: never autofill another attendee's saved code.
                          autoComplete="new-password"
                          autoCapitalize="characters"
                          spellCheck={false}
                          maxLength={12}
                          disabled={controlsDisabled}
                          onChange={event => {
                            setSecretCode(event.target.value)
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
                  {mode === 'returning' && (
                    <p className="entry-hint" id="entry-code-hint">
                      5 letters and numbers. Capitals don't matter.
                    </p>
                  )}
                </div>
              )}
              <div className="entry-final-action">
                {displayedError ? (
                  <p className="entry-feedback" role="alert" id="entry-feedback">
                    {displayedError}
                  </p>
                ) : !issued && isSubmitting ? (
                  <p className="entry-feedback" role="status">
                    {mode === 'new'
                      ? 'Creating your adventurer...'
                      : 'Checking your secret code...'}
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
                      ? 'Continue'
                      : creationFrozen && error
                        ? 'Retry'
                        : 'Start a new challenge'}
                    <ArrowRight size={18} />
                  </button>
                )}
              </div>
            </div>
          </form>
        </main>
      </div>
      <footer className="privacy-notice entry-privacy" aria-label="Privacy notice">
        <div className="entry-privacy-copy">
          <p>
            Your privacy matters to us. We save your selected country or region with your adventurer
            profile. When you start the Challenge, your country, gameplay and telemetry data feed
            the Microsoft Fabric Real-Time Intelligence demo so attendees can see live analytics.
            That telemetry may inform post-event learnings or future Microsoft marketing.
          </p>
          <p>
            Scan the QR code to read the Terms and Conditions before you begin your challenge run.
          </p>
        </div>
        <figure className="entry-terms-qr">
          <span className="entry-terms-qr-tile">
            <img src="/terms-qr.png" alt="QR code for the Terms and Conditions" />
          </span>
          <figcaption>Scan to read the Terms and Conditions</figcaption>
        </figure>
      </footer>
    </div>
  )
}
