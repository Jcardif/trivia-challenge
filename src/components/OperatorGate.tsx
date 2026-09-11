import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useGame } from '../context/GameContext'
import { analytics } from '../services/analyticsService'
import {
  getOperatorConnection, getAuthenticationFailure, onAuthenticationFailure, signInOperator,
} from '../services/rayfinClient'

type Connection = Awaited<ReturnType<typeof getOperatorConnection>>

export default function OperatorGate({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authFailure, setAuthFailure] = useState(getAuthenticationFailure)
  const [attempt, setAttempt] = useState(0)
  const [delivery, setDelivery] = useState(() => analytics.getDeliveryStatus())
  const { isPlaying, session, savedSummary, saveState } = useGame()
  const location = useLocation()
  const unfinishedGame = Boolean(session && !savedSummary)
  const blocked = !authenticated || Boolean(authFailure)
  const showSetup = blocked || setupOpen

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void getOperatorConnection().then(ready => {
      if (cancelled) return
      setConnection(ready)
      const update = () => {
        const signedIn = ready.client.auth.getSession().isAuthenticated
        setAuthenticated(signedIn)
        if (signedIn) setHasOpened(true)
      }
      unsubscribe = ready.client.auth.onSessionChange(update)
      update()
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Fabric configuration could not be loaded.')
    })
    return () => { cancelled = true; unsubscribe?.() }
  }, [attempt])

  useEffect(() => onAuthenticationFailure(() => {
    setAuthFailure(getAuthenticationFailure())
  }), [])

  useEffect(() => analytics.subscribeDeliveryStatus(setDelivery), [])

  const handleSignIn = () => {
    if (!connection || busy) return
    setBusy(true)
    setError(null)
    const signIn = signInOperator(connection)
    void signIn.catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'Fabric operator sign-in failed.')
    }).finally(() => { setBusy(false) })
  }

  const handleSignOut = () => {
    if (!connection || busy) return
    setBusy(true)
    setError(null)
    void connection.client.auth.signOut()
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : 'Operator sign-out failed.')
      })
      .finally(() => { setBusy(false) })
  }

  return (
    <>
      {hasOpened && <div inert={showSetup} aria-hidden={showSetup || undefined}>{children}</div>}
      {!showSetup && location.pathname !== '/playing' && (
        <button type="button" onClick={() => setSetupOpen(true)} className="fixed bottom-3 right-3 z-40 rounded-xl border border-white/20 bg-neutral-950/90 px-3 py-2 text-xs text-white/70 hover:text-white">
          Operator setup
        </button>
      )}
      {showSetup && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#040406] text-white" role="dialog" aria-modal="true" aria-labelledby="operator-heading" onKeyDownCapture={event => event.stopPropagation()}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#1f2937_0%,#040406_70%)]" />
          <div className="relative mx-auto flex min-h-screen max-w-xl items-center px-5 py-12">
            <section className="w-full rounded-[34px] border border-amber-200/20 bg-white/5 p-9 text-center shadow-[0_32px_64px_rgba(0,0,0,0.65)]">
              <img src="/fabriclogo.png" alt="Microsoft Fabric" className="mx-auto mb-6 h-16 w-16" />
              <h1 id="operator-heading" className="text-2xl font-semibold">Kiosk operator setup</h1>
              <p className="mt-4 text-white/70">
                Sign in once with Fabric for this browser. Attendees use the registration form and do not need Fabric accounts.
              </p>
              {hasOpened && blocked && <p className="mt-4 text-amber-200" role="alert">The operator session needs attention. Pending game writes stay in this tab. Sign in, then retry saving.</p>}
              {(error || authFailure) && <p className="mt-5 rounded-xl border border-red-400/40 bg-red-950/30 p-4 text-sm text-red-200" role="alert">{error ?? authFailure}</p>}
              {!connection && !error && <p className="mt-6 text-white/60" role="status">Loading Fabric configuration...</p>}
              {busy && <p className="mt-6 text-white/60" role="status">Complete the operator request in the Fabric window.</p>}
              <div className="mt-7 flex flex-col gap-3">
                {connection && !authenticated && (
                  <button type="button" disabled={busy} onClick={handleSignIn} className="rounded-2xl bg-amber-400 px-6 py-3 font-semibold text-black disabled:opacity-50">
                    Sign in operator with Fabric
                  </button>
                )}
                {!connection && error && (
                  <button type="button" onClick={() => { setError(null); setAttempt(previous => previous + 1) }} className="rounded-2xl bg-amber-400 px-6 py-3 font-semibold text-black">
                    Retry configuration
                  </button>
                )}
                {authenticated && !authFailure && (
                  <>
                    <p className="text-sm text-emerald-300">Operator signed in. This session is retained between attendees.</p>
                    <button type="button" onClick={() => setSetupOpen(false)} className="rounded-2xl bg-amber-400 px-6 py-3 font-semibold text-black">
                      {hasOpened ? 'Continue to the challenge' : 'Open attendee registration'}
                    </button>
                    {!unfinishedGame && !isPlaying && (
                      <Link to="/questions/load" onClick={() => setSetupOpen(false)} className="rounded-2xl border border-white/20 px-6 py-3 font-semibold hover:bg-white/10">
                        Load questions and create pools
                      </Link>
                    )}
                  </>
                )}
                {authenticated && (
                  <button type="button" onClick={handleSignOut} disabled={busy || (unfinishedGame && !authFailure)} className="rounded-2xl border border-white/20 px-6 py-3 text-sm disabled:opacity-50">
                    Sign out operator
                  </button>
                )}
                {unfinishedGame && <p className="text-xs text-white/60">Finish and save the current game before loading questions or signing out. Save status: {saveState.status}.</p>}
              </div>
              {authenticated && (
                <div className="mt-7 border-t border-white/15 pt-5 text-left text-xs text-white/65" role="status">
                  <p>Telemetry: {delivery.enabled ? (delivery.sending ? 'sending' : 'enabled') : 'disabled'}.</p>
                  <p className="mt-1">{delivery.queuedCount} queued, {delivery.deliveredCount} acknowledged, {delivery.droppedCount} dropped in this browser tab.</p>
                  {delivery.lastFailure && <p className="mt-2 text-amber-200">Last delivery failure: {delivery.lastFailure}. Delivery is not guaranteed after closing this tab.</p>}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </>
  )
}
