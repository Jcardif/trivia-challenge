/**
 * PROTOTYPE, throwaway. Not part of the app build; never import from app code.
 * Question: what should the one-time secret-code reveal look like on the 1920x1080 kiosk?
 * Plan: three structurally different reveals, switchable via ?variant=A|B|C, rendered
 * inside the real entry-page shell (brand header, left column, Terms QR footer).
 * Run: npm run prototype:entry   Keys: left/right cycle variants, H hides the bar.
 */
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowRight, Camera, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import '../index.css'
import './SignInPage.css'
import StationAvatar from '../components/StationAvatar'

const NAMES = {
  short: 'Caring Report Storyteller',
  long: 'Friendly Eventstream Listener 1024',
} as const
const CODES = ['9200C', '7KQ4M', 'W1X8Z'] as const
const COUNTRY = 'Kenya'

type Fixture = { name: string; code: string }

const VARIANTS = [
  { key: 'A', label: 'Ticket', render: (f: Fixture) => <VariantA {...f} /> },
  { key: 'B', label: 'Viewfinder', render: (f: Fixture) => <VariantB {...f} /> },
  { key: 'C', label: 'Full-width band', render: (f: Fixture) => <VariantC {...f} /> },
] as const

function BeginButton() {
  return (
    <button type="button" className="play-go entry-create">
      Begin trivia <ArrowRight size={18} />
    </button>
  )
}

function CodeTiles({ code, className }: { code: string; className: string }) {
  return (
    <output className={className} aria-label={`Secret code ${code.split('').join(' ')}`}>
      {code.split('').map((char, index) => (
        <span key={index}>{char}</span>
      ))}
    </output>
  )
}

function LeftColumn() {
  return (
    <div className="entry-welcome" data-issued="true">
      <div className="entry-player-banner">
        <div className="entry-player-crest" aria-hidden="true">
          <StationAvatar placement="entry" />
        </div>
        <div>
          <span className="entry-eyebrow">YOUR ADVENTURER</span>
          <h1>
            You're in,<em>adventurer</em>
          </h1>
        </div>
      </div>
      <div className="entry-player-footer">
        <p className="entry-saved-country">
          <MapPin size={16} /> {COUNTRY}
        </p>
      </div>
    </div>
  )
}

// A: the code is printed on an admission ticket, a familiar thing to photograph and keep.
function VariantA({ name, code }: Fixture) {
  return (
    <div className="entry-split">
      <LeftColumn />
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
              <CodeTiles code={code} className="pa-tiles" />
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

// B: no boxes. Camera corner brackets frame a huge code; the name is secondary.
function VariantB({ name, code }: Fixture) {
  return (
    <div className="entry-split">
      <LeftColumn />
      <div className="entry-lock proto-lock">
        <div className="pb-stage">
          <div className="pb-frame">
            <i className="pb-corner pb-tl" />
            <i className="pb-corner pb-tr" />
            <i className="pb-corner pb-bl" />
            <i className="pb-corner pb-br" />
            <span className="pb-rec">
              <i /> Take a photo
            </span>
            <span className="pb-label">Your secret code</span>
            <output className="pb-code" aria-label={`Secret code ${code.split('').join(' ')}`}>
              {code}
            </output>
            <span className="pb-name">
              Adventurer <b>{name}</b>
            </span>
          </div>
          <ol className="pb-steps">
            <li>
              <b>01</b>
              <span>Photograph the code. It won't be shown again.</span>
            </li>
            <li>
              <b>02</b>
              <span>Tap Begin trivia and play.</span>
            </li>
            <li>
              <b>03</b>
              <span>Next time, enter just this code to come back.</span>
            </li>
          </ol>
        </div>
        <div className="entry-final-action">
          <BeginButton />
        </div>
      </div>
    </div>
  )
}

// C: drops the two-column split. Name joins the headline; the code spans the board as one band.
function VariantC({ name, code }: Fixture) {
  return (
    <div className="pc-stage">
      <div className="pc-head">
        <div className="entry-player-crest pc-crest" aria-hidden="true">
          <StationAvatar placement="entry" />
        </div>
        <div className="pc-titles">
          <span className="entry-eyebrow">YOUR ADVENTURER</span>
          <h1>
            You're in, <em>adventurer</em>
          </h1>
          <p className="pc-name">
            <span className="pc-as">
              You'll play as <b>{name}</b>
            </span>
            <span>
              <MapPin size={16} aria-hidden="true" /> {COUNTRY}
            </span>
          </p>
        </div>
      </div>
      <section className="pc-band" aria-label="Your secret code">
        <div className="pc-band-copy">
          <Camera size={34} aria-hidden="true" />
          <p>
            <b>Photograph your secret code</b>
            It won't be shown again. It's all you need to come back.
          </p>
        </div>
        <CodeTiles code={code} className="pc-code" />
      </section>
      <div className="pc-cta">
        <BeginButton />
      </div>
    </div>
  )
}

function readParam(key: string, fallback: string) {
  return new URLSearchParams(window.location.search).get(key) ?? fallback
}

function Prototype() {
  const [variant, setVariant] = useState(() => readParam('variant', 'A').toUpperCase())
  const [nameKey, setNameKey] = useState(() => readParam('name', 'short') as keyof typeof NAMES)
  const [code, setCode] = useState(() => readParam('code', CODES[0]))
  const [barHidden, setBarHidden] = useState(false)
  const index = Math.max(
    0,
    VARIANTS.findIndex(entry => entry.key === variant)
  )
  const current = VARIANTS[index]

  useEffect(() => {
    const params = new URLSearchParams({ variant: current.key, name: nameKey, code })
    window.history.replaceState(null, '', `?${params}`)
  }, [current.key, nameKey, code])

  const cycle = useCallback(
    (step: number) => setVariant(VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key),
    [index]
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
          <main className="entry-main">{current.render({ name: NAMES[nameKey], code })}</main>
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
          {(Object.keys(NAMES) as (keyof typeof NAMES)[]).map(key => (
            <button
              key={key}
              type="button"
              data-on={key === nameKey}
              onClick={() => setNameKey(key)}
            >
              {key} name
            </button>
          ))}
          <span className="proto-sep" />
          {CODES.map(value => (
            <button key={value} type="button" data-on={value === code} onClick={() => setCode(value)}>
              {value}
            </button>
          ))}
          <span className="proto-sep" />
          <span className="proto-hint">H hides</span>
        </nav>
      )}
    </>
  )
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

const PROTOTYPE_CSS = `
.player-entry .proto-lock { grid-template-rows: minmax(0, 1fr) auto; gap: 18px; }

/* A: ticket */
.pa-stage { align-self: center; display: grid; justify-items: center; gap: 26px; }
.pa-ticket {
  position: relative; width: min(100%, 580px); border-radius: 24px;
  border: 1px solid #e7c77a77;
  background: radial-gradient(ellipse at 50% 0%, #fbbf2422, transparent 60%), linear-gradient(170deg, #2a2418, #14110d 55%, #0d0c11);
  box-shadow: 0 28px 70px #000a, inset 0 1px 0 #fff3;
  animation: entry-reveal .45s;
}
.pa-stub { display: grid; gap: 8px; padding: 30px 32px 26px; text-align: center; }
.pa-kicker { color: #cdb57c; font-size: 12px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; }
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
.pa-tiles span {
  display: grid; place-items: center; width: 84px; height: 108px; border-radius: 14px;
  border: 1px solid #f5ce72aa; background: linear-gradient(#0a0d14, #181d29);
  box-shadow: inset 0 3px 10px #000b, 0 0 20px #fbbf2426;
  color: #ffe399; font: 800 64px/1 ${MONO}; font-variant-numeric: slashed-zero; text-shadow: 0 0 16px #fbbf2470;
}
.pa-foot { color: #968a69; font-size: 12px; letter-spacing: .1em; }
.pa-note { display: flex; align-items: center; gap: 14px; max-width: 580px; margin: 0; color: #efe3c3; font-size: 16px; line-height: 1.45; }
.pa-note svg { flex: none; color: #fbbf24; }
.pa-note b { color: #fff; }

/* B: viewfinder */
.pb-stage { align-self: center; display: grid; gap: 40px; }
.pb-frame { position: relative; display: grid; justify-items: center; gap: 12px; padding: 64px 40px 48px; animation: entry-reveal .45s; }
.pb-corner { position: absolute; width: 60px; height: 60px; border: 0 solid #fbbf24; filter: drop-shadow(0 0 8px #fbbf2488); }
.pb-tl { top: 0; left: 0; border-width: 4px 0 0 4px; border-top-left-radius: 16px; }
.pb-tr { top: 0; right: 0; border-width: 4px 4px 0 0; border-top-right-radius: 16px; }
.pb-bl { bottom: 0; left: 0; border-width: 0 0 4px 4px; border-bottom-left-radius: 16px; }
.pb-br { bottom: 0; right: 0; border-width: 0 4px 4px 0; border-bottom-right-radius: 16px; }
.pb-rec { position: absolute; top: 20px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; color: #fecaca; font-size: 12px; font-weight: 700; letter-spacing: .2em; text-transform: uppercase; }
.pb-rec i { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; box-shadow: 0 0 10px #ef4444; animation: pb-blink 1.4s steps(2) infinite; }
@keyframes pb-blink { 50% { opacity: .25; } }
.pb-label { color: #cdb57c; font-size: 13px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase; }
.pb-code { color: #ffe399; font: 800 150px/1 ${MONO}; letter-spacing: .14em; padding-left: .14em; font-variant-numeric: slashed-zero; text-shadow: 0 0 34px #fbbf2460; }
.pb-name { color: #b9b2a3; font-size: 18px; text-align: center; }
.pb-name b { display: block; margin-top: 4px; color: #fff7e0; font-size: 24px; font-weight: 700; }
.pb-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none; }
.pb-steps li { display: grid; align-content: start; gap: 8px; padding-top: 14px; border-top: 2px solid #fbbf2433; color: #e8dcc0; font-size: 15px; line-height: 1.4; }
.pb-steps li:first-child { border-top-color: #fbbf24; color: #fff; font-weight: 600; }
.pb-steps b { color: #fbbf24; font: 700 12px ${MONO}; }

/* C: full-width band */
.pc-stage { display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: 34px; padding: 30px 48px 34px; min-height: 0; }
.pc-head { align-self: center; display: flex; align-items: center; justify-content: center; gap: 48px; }
.pc-crest { flex: none; width: 210px; height: 210px; }
.pc-titles { display: grid; gap: 6px; }
.pc-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; margin: 10px 0 0; color: #c9c2b3; font-size: 22px; }
.pc-name b { color: #fff7e0; font-weight: 700; }
.pc-name span:not(.pc-as) { display: inline-flex; align-items: center; gap: 6px; color: #a3a3ad; font-size: 15px; }
.pc-band {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 40px;
  margin: 0 -48px; padding: 34px 64px;
  border-block: 1px solid #fbbf2466;
  background: linear-gradient(90deg, #fbbf2410, #fbbf2424 60%, #fbbf2410);
  animation: entry-reveal .45s;
}
.pc-band-copy { display: flex; align-items: center; gap: 20px; }
.pc-band-copy svg { flex: none; color: #fbbf24; }
.pc-band-copy p { display: grid; gap: 6px; margin: 0; color: #e8dcc0; font-size: 17px; line-height: 1.4; }
.pc-band-copy b { color: #fff; font-size: 26px; font-weight: 750; letter-spacing: -.01em; }
.pc-code { display: flex; }
.pc-code span {
  display: grid; place-items: center; width: 118px; height: 150px;
  color: #ffe399; font: 800 116px/1 ${MONO}; font-variant-numeric: slashed-zero; text-shadow: 0 0 28px #fbbf2466;
}
.pc-code span + span { border-left: 1px solid #fbbf2440; }
.pc-cta { justify-self: center; width: min(100%, 560px); }

/* prototype bar, deliberately unlike the design */
.proto-bar {
  position: fixed; left: 50%; bottom: 14px; z-index: 99; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 999px;
  background: #fff; color: #111; font: 600 13px system-ui, sans-serif; box-shadow: 0 8px 30px #0008;
}
.proto-bar button { display: grid; place-items: center; min-width: 30px; height: 30px; padding: 0 10px; border: 0; border-radius: 999px; background: #eee; color: #111; font: inherit; cursor: pointer; }
.proto-bar button[data-on='true'] { background: #111; color: #fff; }
.proto-bar strong { min-width: 150px; text-align: center; }
.proto-sep { width: 1px; height: 20px; margin: 0 4px; background: #ccc; }
.proto-hint { padding-right: 6px; color: #777; font-weight: 500; }
`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Prototype />
  </StrictMode>
)
