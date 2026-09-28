/**
 * PROTOTYPE, throwaway. Not part of the app build; never import from app code.
 * Questions: (1) what should the one-time secret-code reveal look like, and (2) what should
 * returning-player code entry look like, on the 1920x1080 kiosk?
 * Plan: ?screen=reveal shows the approved reveal (A, ticket). ?screen=returning shows three
 * structurally different entry variants, switchable via ?variant=A|B|C, inside the real
 * entry-page shell (brand header, left column, Terms QR footer).
 * Run: npm run prototype:entry   Keys: left/right cycle variants (outside the field), H hides the bar.
 */
/* eslint-disable react-refresh/only-export-components -- standalone prototype entry */
import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, Camera, ChevronLeft, ChevronRight, Delete, MapPin } from 'lucide-react'
import '../index.css'
import './SignInPage.css'
import StationAvatar from '../components/StationAvatar'

const NAMES = {
  short: 'Caring Report Storyteller',
  long: 'Friendly Eventstream Listener 1024',
} as const
const CODES = ['9200C', '7KQ4M', 'W1X8Z'] as const
const COUNTRY = 'Kenya'
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const KEY_DIGITS = '0123456789'.split('')
const KEY_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ'.split('')
const MISMATCH =
  "That secret code didn't match an adventurer. Check your photo and try again, or start a new challenge."

// Same normalization as normalizePlayerCode, plus dropping characters outside the alphabet.
const cleanCode = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .split('')
    .filter(char => ALPHABET.includes(char))
    .join('')
    .slice(0, 5)

type Status = 'idle' | 'checking' | 'error' | 'ok'
type Ctx = {
  name: string
  code: string
  value: string
  status: Status
  onChange: (value: string) => void
  onSubmit: () => void
}
type Variant = { key: string; label: string; render: (ctx: Ctx) => ReactNode }

const SCREENS: Record<'reveal' | 'returning', Variant[]> = {
  reveal: [{ key: 'A', label: 'Ticket (approved)', render: ctx => <RevealTicket {...ctx} /> }],
  returning: [
    { key: 'A', label: 'Ticket slots', render: ctx => <ReturningTicket {...ctx} /> },
    { key: 'B', label: 'Touch keypad', render: ctx => <ReturningKeypad {...ctx} /> },
    { key: 'C', label: 'Photo guide', render: ctx => <ReturningPhoto {...ctx} /> },
  ],
}

function BeginButton() {
  return (
    <button type="button" className="play-go entry-create">
      Begin trivia <ArrowRight size={18} />
    </button>
  )
}

function ContinueButton({ value, status }: Pick<Ctx, 'value' | 'status'>) {
  return (
    <button
      type="submit"
      className="play-go entry-create"
      disabled={value.length < 5 || status === 'checking'}
    >
      {status === 'checking' ? 'Checking your secret code...' : 'Continue'} <ArrowRight size={18} />
    </button>
  )
}

function Feedback({ status, name }: Pick<Ctx, 'status' | 'name'>) {
  if (status === 'error') {
    return (
      <p className="entry-feedback" role="alert">
        {MISMATCH}
      </p>
    )
  }
  if (status === 'ok') {
    return (
      <p className="entry-feedback proto-ok" role="status">
        Welcome back, {name}. (The app would open pool selection now.)
      </p>
    )
  }
  return null
}

function LeftColumn({ mode, hideLink }: { mode: 'issued' | 'returning'; hideLink?: boolean }) {
  return (
    <div className="entry-welcome" data-issued={mode === 'issued'}>
      <div className="entry-player-banner">
        <div className="entry-player-crest" aria-hidden="true">
          <StationAvatar placement="entry" />
        </div>
        <div>
          <span className="entry-eyebrow">
            {mode === 'issued' ? 'YOUR ADVENTURER' : 'RETURNING ADVENTURER'}
          </span>
          <h1>
            {mode === 'issued' ? "You're in," : 'Welcome'}
            <em>{mode === 'issued' ? 'adventurer' : 'back'}</em>
          </h1>
        </div>
      </div>
      <div className="entry-player-footer">
        {mode === 'issued' ? (
          <p className="entry-saved-country">
            <MapPin size={16} /> {COUNTRY}
          </p>
        ) : hideLink ? null : (
          <div className="entry-links">
            <button type="button" className="entry-mode-link">
              Forgot your code? Start a new challenge <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ReturningForm({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (ctx.value.length === 5 && ctx.status !== 'checking') ctx.onSubmit()
  }
  return (
    <form className="entry-split" autoComplete="off" noValidate onSubmit={submit}>
      {children}
    </form>
  )
}

// Five masked slots over one real password input, so keyboards, paste and focus all work.
function MaskedSlots({ value, status, onChange, className }: Pick<Ctx, 'value' | 'status' | 'onChange'> & { className: string }) {
  const [focused, setFocused] = useState(false)
  return (
    <div className={`proto-slots ${className}`} data-status={status}>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          data-filled={index < value.length}
          data-active={focused && status !== 'checking' && index === value.length}
        >
          {index < value.length && <i>*</i>}
        </span>
      ))}
      <input
        type="password"
        aria-label="Secret code"
        autoComplete="new-password"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus
        value={value}
        disabled={status === 'checking'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={event => onChange(cleanCode(event.target.value))}
      />
    </div>
  )
}

// Reveal A (approved): the code is printed on an admission ticket, a familiar thing to photograph.
function RevealTicket({ name, code }: Ctx) {
  return (
    <div className="entry-split">
      <LeftColumn mode="issued" />
      <div className="entry-lock proto-lock">
        <div className="pa-stage">
          <article className="pa-ticket" aria-label="Your adventurer ticket">
            <header className="pa-stub">
              <span className="pa-kicker">Adventurer</span>
              <strong className="pa-name">{name}</strong>
            </header>
            <div className="pa-perf" aria-hidden="true" />
            <section className="pa-body">
              <span className="pa-kicker">Secret code</span>
              <output className="pa-tiles" aria-label={`Secret code ${code.split('').join(' ')}`}>
                {code.split('').map((char, index) => (
                  <span key={index}>{char}</span>
                ))}
              </output>
              <span className="pa-foot">Microsoft Fabric Trivia Challenge</span>
            </section>
          </article>
          <p className="pa-note">
            <Camera size={24} aria-hidden="true" />
            <span>
              <b>Take a photo of your ticket.</b> Your code won't be shown again, and it's all you
              need to come back.
            </span>
          </p>
        </div>
        <div className="entry-final-action">
          <BeginButton />
        </div>
      </div>
    </div>
  )
}

// Returning A: the same ticket, empty. The attendee fills the slots they see in their photo.
function ReturningTicket(ctx: Ctx) {
  return (
    <ReturningForm ctx={ctx}>
      <LeftColumn mode="returning" />
      <div className="entry-lock proto-lock">
        <div className="pa-stage">
          <article className="pa-ticket ra-ticket" data-status={ctx.status}>
            <header className="pa-stub">
              <span className="pa-kicker">Adventurer</span>
              {ctx.status === 'ok' ? (
                <strong className="pa-name">{ctx.name}</strong>
              ) : (
                <span className="ra-pending">Your name appears when your code matches</span>
              )}
            </header>
            <div className="pa-perf" aria-hidden="true" />
            <section className="pa-body">
              <span className="pa-kicker">Secret code</span>
              <MaskedSlots className="ra-slots" {...ctx} />
              <span className="pa-foot">Microsoft Fabric Trivia Challenge</span>
            </section>
          </article>
          <p className="pa-note">
            <Camera size={24} aria-hidden="true" />
            <span>
              <b>Type the code from your ticket photo.</b> 5 letters and numbers. Capitals don't
              matter.
            </span>
          </p>
        </div>
        <div className="entry-final-action">
          <Feedback {...ctx} />
          <ContinueButton {...ctx} />
        </div>
      </div>
    </ReturningForm>
  )
}

// Returning B: an on-screen keypad with only the 32 valid characters, so O/I/L/U can't be typed.
function ReturningKeypad(ctx: Ctx) {
  const busy = ctx.status === 'checking'
  const full = ctx.value.length >= 5
  const press = (char: string) => ctx.onChange(cleanCode(ctx.value + char))
  const key = (char: string) => (
    <button
      key={char}
      type="button"
      disabled={busy || full}
      onMouseDown={event => event.preventDefault()}
      onClick={() => press(char)}
    >
      {char}
    </button>
  )
  return (
    <ReturningForm ctx={ctx}>
      <LeftColumn mode="returning" />
      <div className="entry-lock proto-lock">
        <div className="rb-stage">
          <div className="rb-top">
            <span className="pa-kicker">Secret code</span>
            <MaskedSlots className="rb-slots" {...ctx} />
            <p className="rb-hint">Tap the 5 characters from your ticket photo, or type them.</p>
          </div>
          <div className="rb-pad" role="group" aria-label="Code keypad">
            <div className="rb-digits">{KEY_DIGITS.map(key)}</div>
            <div className="rb-letters">
              {KEY_LETTERS.map(key)}
              <button
                type="button"
                className="rb-back"
                aria-label="Delete last character"
                disabled={busy || ctx.value.length === 0}
                onMouseDown={event => event.preventDefault()}
                onClick={() => ctx.onChange(ctx.value.slice(0, -1))}
              >
                <Delete size={24} aria-hidden="true" /> Delete
              </button>
            </div>
          </div>
        </div>
        <div className="entry-final-action">
          <Feedback {...ctx} />
          <ContinueButton {...ctx} />
        </div>
      </div>
    </ReturningForm>
  )
}

// Returning C: shows where to look in the photo, then one plain masked field. Forgot link sits here.
function ReturningPhoto(ctx: Ctx) {
  return (
    <ReturningForm ctx={ctx}>
      <LeftColumn mode="returning" hideLink />
      <div className="entry-lock proto-lock">
        <div className="rc-stage">
          <figure className="rc-phone" aria-hidden="true">
            <div className="rc-screen">
              <div className="rc-mini">
                <span className="rc-mini-kicker">ADVENTURER</span>
                <span className="rc-bar" />
                <i className="rc-perf" />
                <span className="rc-mini-kicker">SECRET CODE</span>
                <span className="rc-mini-code">
                  {Array.from({ length: 5 }, (_, index) => (
                    <b key={index} />
                  ))}
                </span>
              </div>
            </div>
            <figcaption>Open the photo of your ticket</figcaption>
          </figure>
          <div className="rc-form">
            <h2 className="rc-title">Enter your secret code</h2>
            <label className="rc-field" data-status={ctx.status}>
              <span className="rc-mask" aria-hidden="true" data-empty={ctx.value.length === 0}>
                {ctx.value.length ? '*'.repeat(ctx.value.length) : '_____'}
              </span>
              <input
                type="password"
                aria-label="Secret code"
                autoComplete="new-password"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                value={ctx.value}
                disabled={ctx.status === 'checking'}
                onChange={event => ctx.onChange(cleanCode(event.target.value))}
              />
            </label>
            <p className="entry-hint">
              The 5 letters and numbers under SECRET CODE. Capitals don't matter.
            </p>
            <button type="button" className="entry-mode-link rc-forgot">
              Forgot your code? Start a new challenge <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="entry-final-action">
          <Feedback {...ctx} />
          <ContinueButton {...ctx} />
        </div>
      </div>
    </ReturningForm>
  )
}

function readParam(key: string, fallback: string) {
  return new URLSearchParams(window.location.search).get(key) ?? fallback
}

function Prototype() {
  const [screen, setScreen] = useState<keyof typeof SCREENS>(() =>
    readParam('screen', 'returning') === 'reveal' ? 'reveal' : 'returning'
  )
  const [variant, setVariant] = useState(() => readParam('variant', 'A').toUpperCase())
  const [nameKey, setNameKey] = useState<keyof typeof NAMES>(() =>
    readParam('name', 'short') === 'long' ? 'long' : 'short'
  )
  const [code, setCode] = useState(() => readParam('code', CODES[0]))
  const [value, setValue] = useState(() => cleanCode(readParam('typed', '')))
  const [status, setStatus] = useState<Status>(() => readParam('state', 'idle') as Status)
  const [barHidden, setBarHidden] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const variants = SCREENS[screen]
  const index = Math.max(
    0,
    variants.findIndex(entry => entry.key === variant)
  )
  const current = variants[index]

  useEffect(() => {
    const params = new URLSearchParams({ screen, variant: current.key, name: nameKey, code })
    if (screen === 'returning' && status !== 'idle') params.set('state', status)
    window.history.replaceState(null, '', `?${params}`)
  }, [screen, current.key, nameKey, code, status])

  const cycle = useCallback(
    (step: number) => setVariant(variants[(index + step + variants.length) % variants.length].key),
    [index, variants]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]')) return
      if (event.key === 'ArrowLeft') cycle(-1)
      if (event.key === 'ArrowRight') cycle(1)
      if (event.key.toLowerCase() === 'h') setBarHidden(hidden => !hidden)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cycle])

  const setFixture = (next: Status) => {
    window.clearTimeout(timer.current)
    setStatus(next)
    setValue(next === 'checking' || next === 'ok' ? code : '')
  }

  const ctx: Ctx = {
    name: NAMES[nameKey],
    code,
    value,
    status,
    onChange: next => {
      setValue(next)
      if (status === 'error' || status === 'ok') setStatus('idle')
    },
    onSubmit: () => {
      setStatus('checking')
      const attempt = value
      timer.current = window.setTimeout(() => {
        if (attempt === code) {
          setStatus('ok')
        } else {
          setStatus('error')
          setValue('')
        }
      }, 900)
    },
  }

  return (
    <>
      <style>{PROTOTYPE_CSS}</style>
      <div className="player-entry" data-telemetry-private>
        <div className="entry-board">
          <header className="entry-brand">
            <img src="/fabriclogo.png" alt="Microsoft Fabric" />
            <p>
              The Microsoft Fabric <strong>Trivia Challenge</strong>
            </p>
          </header>
          <main className="entry-main" key={`${screen}-${current.key}`}>
            {current.render(ctx)}
          </main>
        </div>
        <footer className="privacy-notice entry-privacy" aria-label="Privacy notice">
          <div className="entry-privacy-copy">
            <p>
              Your privacy matters to us. We save your selected country or region with your
              adventurer profile. When you start the Challenge, your country, gameplay and telemetry
              data feed the Microsoft Fabric Real-Time Intelligence demo so attendees can see live
              analytics. That telemetry may inform post-event learnings or future Microsoft
              marketing.
            </p>
            <p>
              Scan the QR code to read the Terms and Conditions before you begin your challenge
              run.
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
      {import.meta.env.DEV && !barHidden && (
        <nav className="proto-bar" aria-label="Prototype controls">
          {(['reveal', 'returning'] as const).map(key => (
            <button
              key={key}
              type="button"
              data-on={key === screen}
              onClick={() => {
                setScreen(key)
                setVariant('A')
                setFixture('idle')
              }}
            >
              {key}
            </button>
          ))}
          <span className="proto-sep" />
          <button type="button" onClick={() => cycle(-1)} aria-label="Previous variant">
            <ChevronLeft size={18} />
          </button>
          <strong>
            {current.key} · {current.label}
          </strong>
          <button type="button" onClick={() => cycle(1)} aria-label="Next variant">
            <ChevronRight size={18} />
          </button>
          <span className="proto-sep" />
          {screen === 'reveal' ? (
            <>
              {(['short', 'long'] as const).map(key => (
                <button
                  key={key}
                  type="button"
                  data-on={key === nameKey}
                  onClick={() => setNameKey(key)}
                >
                  {key} name
                </button>
              ))}
              {CODES.map(entry => (
                <button key={entry} type="button" data-on={entry === code} onClick={() => setCode(entry)}>
                  {entry}
                </button>
              ))}
            </>
          ) : (
            <>
              {(['idle', 'checking', 'error', 'ok'] as const).map(key => (
                <button key={key} type="button" data-on={key === status} onClick={() => setFixture(key)}>
                  {key}
                </button>
              ))}
              <span className="proto-hint">
                typed: {value.length}/5 · matches {code}
              </span>
            </>
          )}
          <span className="proto-sep" />
          <span className="proto-hint">H hides</span>
        </nav>
      )}
    </>
  )
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const PROTOTYPE_CSS = `
.player-entry .proto-lock { grid-template-rows: minmax(0, 1fr) auto; gap: 18px; }
.player-entry .proto-ok { color: #86efac; }

/* Ticket (reveal A, reused by returning A) */
.pa-stage { align-self: center; display: grid; justify-items: center; gap: 26px; }
.pa-ticket {
  position: relative; width: min(100%, 580px); border-radius: 24px;
  border: 1px solid #e7c77a77;
  background: radial-gradient(ellipse at 50% 0%, #fbbf2422, transparent 60%), linear-gradient(170deg, #2a2418, #14110d 55%, #0d0c11);
  box-shadow: 0 28px 70px #000a, inset 0 1px 0 #fff3;
  animation: entry-reveal .45s;
}
.pa-stub { display: grid; gap: 8px; padding: 30px 32px 26px; text-align: center; }
.pa-kicker { color: #cdb57c; font-size: 12px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; text-align: center; }
.pa-name { color: #fff7e0; font-size: 30px; font-weight: 750; line-height: 1.15; letter-spacing: -.01em; overflow-wrap: anywhere; }
.pa-perf { position: relative; margin: 0 26px; border-top: 2px dashed #e7c77a55; }
.pa-perf::before, .pa-perf::after {
  content: ''; position: absolute; top: -16px; width: 30px; height: 30px; border-radius: 50%;
  background: #141722; border: 1px solid #e7c77a77;
}
.pa-perf::before { left: -43px; clip-path: inset(0 0 0 50%); }
.pa-perf::after { right: -43px; clip-path: inset(0 50% 0 0); }
.pa-body { display: grid; justify-items: center; gap: 18px; padding: 28px 32px 30px; }
.pa-tiles { display: flex; gap: 12px; }
.pa-tiles span, .proto-slots span {
  display: grid; place-items: center; width: 84px; height: 108px; border-radius: 14px;
  border: 1px solid #f5ce72aa; background: linear-gradient(#0a0d14, #181d29);
  box-shadow: inset 0 3px 10px #000b, 0 0 20px #fbbf2426;
  color: #ffe399; font: 800 64px/1 ${MONO}; font-variant-numeric: slashed-zero; text-shadow: 0 0 16px #fbbf2470;
}
.pa-foot { color: #968a69; font-size: 12px; letter-spacing: .1em; }
.pa-note { display: flex; align-items: center; gap: 14px; max-width: 580px; margin: 0; color: #efe3c3; font-size: 16px; line-height: 1.45; }
.pa-note svg { flex: none; color: #fbbf24; }
.pa-note b { color: #fff; }

/* Masked slots shared by returning A and B */
.proto-slots { position: relative; display: flex; gap: 12px; }
.proto-slots span { position: relative; border-color: #f5ce7255; box-shadow: inset 0 3px 10px #000b; transition: border-color .15s, box-shadow .15s; }
.proto-slots span[data-filled='true'] { border-color: #f5ce72aa; box-shadow: inset 0 3px 10px #000b, 0 0 20px #fbbf2426; }
.proto-slots span i { color: #ffe399; font: 800 72px/1 ${MONO}; font-style: normal; transform: translateY(.06em); text-shadow: 0 0 14px #fbbf24aa; animation: entry-reveal .2s; }
.proto-slots span[data-active='true'] { border-color: #ffe399; box-shadow: inset 0 3px 10px #000b, 0 0 0 3px #fbbf2433, 0 0 24px #fbbf2455; }
.proto-slots span[data-active='true']::after { content: ''; width: 3px; height: 46px; border-radius: 2px; background: #ffe399; animation: pb-blink 1s steps(2) infinite; }
.proto-slots[data-status='error'] span { border-color: #fb7185aa; }
.proto-slots[data-status='checking'] span { animation: proto-pulse 0.9s ease-in-out infinite; }
.proto-slots[data-status='ok'] span { border-color: #86efacaa; }
.proto-slots input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: text; }
.proto-slots input::-ms-reveal { display: none; }
@keyframes proto-pulse { 50% { opacity: .55; } }
@keyframes pb-blink { 50% { opacity: .25; } }
.ra-ticket[data-status='error'] { border-color: #fb7185aa; animation: proto-shake .35s; }
.ra-ticket[data-status='ok'] { border-color: #86efacaa; }
.ra-pending { color: #8f8570; font-size: 18px; font-style: italic; line-height: 1.6; }
@keyframes proto-shake { 25% { transform: translateX(-8px); } 75% { transform: translateX(8px); } }

/* Returning B: keypad */
.rb-stage { align-self: center; display: grid; gap: 28px; }
.rb-top { display: grid; justify-items: center; gap: 14px; }
.rb-slots span { width: 76px; height: 96px; }
.rb-hint { margin: 0; color: #bba96e; font-size: 15px; }
.rb-pad { display: grid; gap: 10px; }
.rb-digits { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: 10px; }
.rb-letters { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 10px; }
.rb-pad button {
  display: flex; align-items: center; justify-content: center; gap: 8px; height: 64px;
  border: 1px solid #cbb26c55; border-bottom: 3px solid #826a3d88; border-radius: 12px 4px;
  background: linear-gradient(#1d202b, #10131b); color: #f1e0b6; font: 700 26px ${MONO};
  box-shadow: inset 0 1px 0 #fff1; cursor: pointer; transition: background .1s, transform .05s;
}
.rb-pad button:not(:disabled):hover { border-color: #ffe39999; }
.rb-pad button:not(:disabled):active { transform: translateY(2px); background: #fbbf2433; }
.rb-pad button:disabled { opacity: .35; cursor: default; }
.rb-pad .rb-back { grid-column: span 2; font: 600 16px system-ui, sans-serif; color: #e5d5ab; }

/* Returning C: photo guide + single field */
.rc-stage { align-self: center; display: grid; grid-template-columns: 210px minmax(0, 1fr); align-items: center; gap: 48px; }
.rc-phone { display: grid; justify-items: center; gap: 14px; margin: 0; }
.rc-screen { width: 190px; height: 340px; padding: 40px 14px; border: 7px solid #2d303c; border-radius: 30px; background: #06070c; box-shadow: 0 20px 50px #0009, inset 0 0 0 1px #fff1; display: grid; align-items: center; }
.rc-mini { display: grid; justify-items: center; gap: 8px; padding: 16px 10px; border: 1px solid #e7c77a66; border-radius: 10px; background: linear-gradient(170deg, #2a2418, #0d0c11); }
.rc-mini-kicker { color: #cdb57c; font-size: 7px; font-weight: 700; letter-spacing: .2em; }
.rc-bar { width: 80%; height: 8px; border-radius: 4px; background: #fff7e055; }
.rc-perf { width: 100%; border-top: 1px dashed #e7c77a55; margin: 4px 0; }
.rc-mini-code { display: flex; gap: 4px; padding: 5px; border-radius: 8px; box-shadow: 0 0 0 2px #fbbf24, 0 0 18px #fbbf24aa; animation: proto-pulse 1.6s ease-in-out infinite; }
.rc-mini-code b { width: 20px; height: 26px; border: 1px solid #f5ce72aa; border-radius: 4px; background: #0a0d14; }
.rc-phone figcaption { color: #bba96e; font-size: 13px; text-align: center; }
.rc-form { display: grid; gap: 16px; min-width: 0; }
.rc-title { margin: 0; color: #fff7e0; font-size: 30px; font-weight: 750; letter-spacing: -.01em; }
.rc-field {
  position: relative; display: grid; place-items: center; height: 104px; border: 1px solid #cbb26c88; border-bottom: 3px solid #826a3d;
  border-radius: 14px 5px; background: linear-gradient(110deg, #302c2855, #090d16 72%); box-shadow: inset 0 2px 12px #0008; cursor: text;
}
.rc-field:focus-within { border-color: #ffe399; box-shadow: inset 0 2px 12px #0008, 0 0 18px #fbbf2444; }
.rc-field[data-status='error'] { border-color: #fb7185; }
.rc-mask { padding-left: .6em; color: #ffe399; font: 800 60px/1 ${MONO}; letter-spacing: .6em; transform: translateY(.04em); text-shadow: 0 0 14px #fbbf2488; }
.rc-mask[data-empty='true'] { color: #5c5440; text-shadow: none; transform: none; }
.rc-field input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: text; }
.rc-field input::-ms-reveal { display: none; }
.rc-forgot { justify-self: start; margin-top: 6px; }

/* prototype bar, deliberately unlike the design */
.proto-bar {
  position: fixed; left: 50%; bottom: 14px; z-index: 99; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 999px; white-space: nowrap;
  background: #fff; color: #111; font: 600 13px system-ui, sans-serif; box-shadow: 0 8px 30px #0008;
}
.proto-bar button { display: grid; place-items: center; min-width: 30px; height: 30px; padding: 0 10px; border: 0; border-radius: 999px; background: #eee; color: #111; font: inherit; cursor: pointer; }
.proto-bar button[data-on='true'] { background: #111; color: #fff; }
.proto-bar strong { min-width: 150px; text-align: center; }
.proto-sep { width: 1px; height: 20px; margin: 0 4px; background: #ccc; }
.proto-hint { padding: 0 6px; color: #777; font-weight: 500; }

/* Rejected reveal variants B (viewfinder) and C (full-width band) are in the prototype branch history. */
`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Prototype />
  </StrictMode>
)
