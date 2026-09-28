/* eslint-disable react-refresh/only-export-components -- prototype entry module mounts itself */
// PROTOTYPE, delete after the layout is approved. Layout A (two-column console) refined for review:
// card-free run summary, three Keep Exploring QR codes, everything on one 1920x1080 screen.
// Run `npm run prototype:results`. Params: `missed=0..10`, `outcome=complete|hearts`, `stationId=`.
import { StrictMode, useMemo, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'react-qr-code'
import '../index.css'
import StationAvatar from '../components/StationAvatar'
import HeartIndicator from '../components/HeartIndicator'
import { gameConfig } from '../config/gameConfig'

interface MissedQuestion {
  questionId: string
  questionText: string
  category: string
  choices: string[]
  correctAnswerIndex: number
  selectedAnswerIndex: number
}

interface ResultsData {
  playerName: string
  heartsDepleted: boolean
  title: string
  message: string
  score: string
  accuracy: number
  answered: number
  correct: number
  incorrect: number
  streaks: number
  hearts: number
  baseSeconds: number
  bonusSeconds: number
  totalSeconds: number
  pace: string
  missed: MissedQuestion[]
}

// The certification URL is a placeholder until the real short link is supplied.
const QR_LINKS = [
  {
    id: 'leaderboard',
    title: 'View the Leaderboard',
    href: 'https://aka.ms/fabrictrivia/l',
    description: 'See how your score compares.',
  },
  {
    id: 'learn-fabric',
    title: 'Learn More About Fabric',
    href: 'https://aka.ms/fabrictrivia/f',
    description: 'Tutorials, case studies, highlights.',
  },
  {
    id: 'certifications',
    title: 'Get Fabric Certified',
    href: 'https://learn.microsoft.com/credentials/',
    description: 'Certifications and study guides.',
  },
] as const

const q = (
  questionText: string,
  category: string,
  choices: string[],
  selectedAnswerIndex: number
): Omit<MissedQuestion, 'questionId'> => ({ questionText, category, choices, correctAnswerIndex: 0, selectedAnswerIndex })

const MISSED_POOL: MissedQuestion[] = [
  q('Which Fabric item stores data as Delta tables and automatically exposes a SQL analytics endpoint?', 'Data Engineering', ['Lakehouse', 'Eventstream', 'Dataflow Gen2', 'Activator'], 2),
  q('What does Activator do in Microsoft Fabric?', 'Real-Time Intelligence', ['Triggers actions when data meets conditions', 'Schedules notebook runs', 'Mirrors databases', 'Builds semantic models'], 1),
  q('Which language do you use to query a KQL database in an Eventhouse?', 'Real-Time Intelligence', ['Kusto Query Language', 'DAX', 'T-SQL', 'Python'], 2),
  q('What is OneLake?', 'OneLake', ['A single, unified data lake for the whole organization', 'A Power BI visual', 'An Azure VM size', 'A Spark runtime'], 3),
  q('Which feature references data in another location without copying it into OneLake?', 'OneLake', ['Shortcuts', 'Pipelines', 'Mirroring', 'Notebooks'], 2),
  q('Direct Lake mode in Power BI reads data from which source?', 'Power BI', ['Delta tables in OneLake', 'CSV uploads', 'An on-premises gateway', 'Excel workbooks'], 2),
  q('Which workload is best for low-code transformation with Power Query?', 'Data Factory', ['Dataflow Gen2', 'Eventstream', 'KQL Queryset', 'Warehouse'], 3),
  q('What is Mirroring in Fabric used for?', 'Data Integration', ['Replicating operational databases into OneLake in near real time', 'Backing up workspaces', 'Duplicating reports', 'Mirroring a dashboard to Teams'], 1),
  q('Which unit measures Fabric compute?', 'Administration', ['Capacity Units (CU)', 'DTUs', 'vCores only', 'Request Units'], 3),
  q('Which transactions does a Fabric Warehouse support?', 'Data Warehouse', ['Multi-table ACID transactions', 'No transactions', 'Single-row only', 'Eventual consistency only'], 2),
].map((question, index) => ({ ...question, questionId: `q-${index}` }))

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function formatHearts(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)
}

function buildFixture(missedCount: number, outcome: string): ResultsData {
  const missed = MISSED_POOL.slice(0, missedCount)
  const heartsDepleted = outcome === 'hearts'
  const correct = 18
  const answered = correct + missed.length
  const accuracy = Math.round((correct / answered) * 100)
  const streaks = Math.min(3, gameConfig.timer.maxStreaks)
  const baseSeconds = gameConfig.timer.initialSeconds
  const bonusSeconds = streaks * gameConfig.timer.bonusSeconds
  const totalSeconds = baseSeconds + bonusSeconds
  const spent = heartsDepleted ? totalSeconds - 21 : totalSeconds
  const hearts = heartsDepleted ? 0 : Math.max(0, gameConfig.hearts.initialCount - missed.length * gameConfig.hearts.decrementOnWrong)
  const playerName = 'Amber Query Crafter'
  return {
    playerName,
    heartsDepleted,
    title: heartsDepleted ? `Sorry, ${playerName}.` : `Elite run, ${playerName}.`,
    message: heartsDepleted
      ? 'You ran out of hearts 💔. Review the questions you missed and jump back in for another run.'
      : 'You read the board like a pro and kept the streak meter glowing. Another game could put you on top.',
    score: new Intl.NumberFormat().format(correct * gameConfig.scoring.pointsPerCorrectAnswer),
    accuracy,
    answered,
    correct,
    incorrect: missed.length,
    streaks,
    hearts,
    baseSeconds,
    bonusSeconds,
    totalSeconds,
    pace: formatDuration(spent / answered),
    missed,
  }
}

const RESET_HINT = 'Line behind you? Tap Reset so the next player can start.'

function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#1f2937_0%,#040406_70%)]" />
      <div className="absolute -top-44 left-[22%] h-96 w-96 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-sky-400/15 blur-3xl" />
      <div className="absolute -bottom-40 -right-28 h-80 w-80 rounded-full bg-purple-500/15 blur-3xl" />
    </div>
  )
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[0.68rem] font-semibold uppercase tracking-[0.32em] text-white/50">{children}</p>
}

function AccuracyRing({ value }: { value: number }) {
  const radius = 68
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(100, Math.max(0, value))
  return (
    <div className="relative h-44 w-44 shrink-0">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="accuracy-ring" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        <circle cx="80" cy="80" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke="url(#accuracy-ring)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="drop-shadow-[0_0_12px_rgba(251,191,36,0.45)]"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className={`${clamped === 100 ? "text-[2.6rem]" : "text-5xl"} font-bold tabular-nums`}>
          {clamped}
          <span className="text-2xl text-white/55">%</span>
        </p>
        <p className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.32em] text-white/50">Accuracy</p>
      </div>
    </div>
  )
}

function AnswerSplit({ data }: { data: ResultsData }) {
  return (
    <div className="min-w-0 flex-1">
      <Eyebrow>Answers</Eyebrow>
      <p className="mt-2 text-5xl font-semibold tabular-nums">
        {data.answered}
        <span className="ml-3 text-lg font-normal text-white/50">answered</span>
      </p>
      <div className="mt-5 flex h-3 gap-1 overflow-hidden rounded-full bg-white/8">
        {data.correct > 0 && <div className="rounded-full bg-emerald-400" style={{ flexGrow: data.correct }} />}
        {data.incorrect > 0 && <div className="rounded-full bg-rose-400" style={{ flexGrow: data.incorrect }} />}
      </div>
      <div className="mt-3 flex justify-between text-sm">
        <span className="flex items-center gap-2 text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          {data.correct} correct
        </span>
        <span className={`flex items-center gap-2 ${data.incorrect ? "text-rose-300" : "text-white/40"}`}>
          {data.incorrect} missed
          <span className={`h-2 w-2 rounded-full ${data.incorrect ? 'bg-rose-400' : 'bg-white/25'}`} />
        </span>
      </div>
    </div>
  )
}

function Metric({ label, value, suffix, children }: { label: string; value: string; suffix?: string; children: ReactNode }) {
  return (
    <div className="px-6 first:pl-0 last:pr-0">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-2 text-3xl font-semibold tabular-nums">
        {value}
        {suffix && <span className="ml-1.5 text-base font-normal text-white/45">{suffix}</span>}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function MetricStrip({ data }: { data: ResultsData }) {
  const maxStreaks = gameConfig.timer.maxStreaks
  const maxSeconds = gameConfig.timer.maxTotalSeconds
  return (
    <div className="grid grid-cols-4 divide-x divide-white/10 border-y border-white/10 py-6">
      <Metric label="Streaks" value={String(data.streaks)} suffix={`/ ${maxStreaks}`}>
        <div className="flex gap-1.5" aria-hidden="true">
          {Array.from({ length: maxStreaks }, (_, index) => (
            <span
              key={index}
              className={`h-1.5 flex-1 rounded-full ${index < data.streaks ? 'bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'bg-white/12'}`}
            />
          ))}
        </div>
        <p className="mt-2 text-xs text-white/45">+{data.bonusSeconds}s bonus earned</p>
      </Metric>
      <Metric label="Hearts" value={formatHearts(data.hearts)} suffix={`/ ${gameConfig.hearts.initialCount}`}>
        <div className="w-fit">
          <HeartIndicator heartsRemaining={data.hearts} maxHearts={gameConfig.hearts.initialCount} showLabel={false} />
        </div>
      </Metric>
      <Metric label="Time budget" value={formatDuration(data.totalSeconds)}>
        <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/8" aria-hidden="true">
          <span className="rounded-full bg-sky-400" style={{ width: `${(data.baseSeconds / maxSeconds) * 100}%` }} />
          <span className="rounded-full bg-amber-300" style={{ width: `${(data.bonusSeconds / maxSeconds) * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-white/45">
          {data.baseSeconds}s base · +{data.bonusSeconds}s bonus
        </p>
      </Metric>
      <Metric label="Avg pace" value={data.pace} suffix="/ question">
        <p className="text-xs text-white/45">Average time per answer</p>
      </Metric>
    </div>
  )
}

function MissedList({ missed }: { missed: MissedQuestion[] }) {
  if (!missed.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-4xl">🏆</p>
        <p className="mt-3 text-lg font-semibold">Flawless victory</p>
        <p className="mt-1 text-sm text-white/55">No missed questions this time. Keep the streak alive!</p>
      </div>
    )
  }
  return (
    <ol className="min-h-0 flex-1 overflow-y-auto pb-10 [mask-image:linear-gradient(to_bottom,black_88%,transparent)]">
      {missed.map((question, index) => (
        <li key={question.questionId} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 border-b border-white/8 py-4">
          <span className="pt-0.5 font-mono text-sm text-white/30 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
          <div>
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.25em] text-amber-200/55">{question.category}</p>
            <p className="mt-1 text-base font-medium text-white">{question.questionText}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              <span className="text-emerald-300">✓ {question.choices[question.correctAnswerIndex]}</span>
              <span className="text-rose-300/85">
                ✕ <span className="line-through decoration-rose-300/50">{question.choices[question.selectedAnswerIndex]}</span>
              </span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

function ResultsLayout({ data }: { data: ResultsData }) {
  const badgeTone = data.heartsDepleted ? 'text-rose-200 bg-rose-400/10' : 'text-amber-200 bg-amber-300/10'
  const dotTone = data.heartsDepleted ? 'bg-rose-400' : 'bg-amber-300'
  return (
    <div className="relative h-screen overflow-hidden bg-[#040406] text-white">
      <Backdrop />
      <div className="relative z-10 mx-auto grid h-full max-w-[1500px] grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-16 px-10 py-9">
        <section className="flex min-h-0 flex-col">
          <header className="flex items-center gap-3 text-sm text-white/55">
            <img src="/fabriclogo.png" alt="" className="h-7 w-7" />
            The Microsoft Fabric Trivia Challenge
          </header>

          <p className={`mt-10 inline-flex w-fit items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] ${badgeTone}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} />
            {data.heartsDepleted ? 'Game Over' : 'Quest Complete'}
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight">{data.title}</h1>
          <p className="mt-2 max-w-md text-base text-white/60">{data.message}</p>

          <div className="mt-8">
            <Eyebrow>Final score</Eyebrow>
            <p className="mt-1 bg-linear-to-b from-amber-200 to-amber-500 bg-clip-text text-[7.5rem] font-black leading-none text-transparent tabular-nums drop-shadow-[0_18px_40px_rgba(217,119,6,0.35)]">
              {data.score}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              className="rounded-2xl bg-linear-to-r from-amber-400 via-amber-300 to-amber-500 px-6 py-4 text-lg font-semibold text-[#2b1800] shadow-[0_18px_42px_rgba(251,191,36,0.4)] transition hover:brightness-[1.08]"
            >
              Play Again
            </button>
            <button
              type="button"
              className="rounded-2xl border border-amber-200/45 px-6 py-4 text-lg font-semibold text-amber-100 transition hover:border-amber-200 hover:bg-white/5"
            >
              Reset
            </button>
          </div>
          <p className="mt-3 text-sm text-white/55">{RESET_HINT}</p>

          <div className="mt-auto">
            <Eyebrow>Keep exploring · scan with your phone</Eyebrow>
            <ul className="mt-4 grid grid-cols-3 gap-4">
              {QR_LINKS.map(link => (
                <li key={link.id} className="flex flex-col items-center text-center">
                  <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-amber-200/15">
                    <QRCode value={link.href} size={150} bgColor="transparent" fgColor="#FCD34D" />
                  </div>
                  <p className="mt-3 text-sm font-semibold">{link.title}</p>
                  <p className="mt-0.5 text-xs text-white/50">{link.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="relative flex min-h-0 flex-col">
          <div
            className="absolute -left-8 top-0 h-full w-px bg-linear-to-b from-transparent via-white/15 to-transparent"
            aria-hidden="true"
          />
          <Eyebrow>Run summary</Eyebrow>
          <div className="mt-5 flex items-center gap-10">
            <AccuracyRing value={data.accuracy} />
            <AnswerSplit data={data} />
          </div>
          <div className="mt-7">
            <MetricStrip data={data} />
          </div>

          <div className="mt-7 flex items-baseline justify-between">
            <p className="flex items-center gap-3 text-lg font-semibold">
              Missed questions
              <span className="rounded-full bg-rose-400/15 px-2.5 py-0.5 text-sm font-semibold text-rose-200 tabular-nums">{data.missed.length}</span>
            </p>
            {data.missed.length > 0 && <p className="text-xs text-white/45">✓ correct answer · ✕ your answer</p>}
          </div>
          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            <MissedList missed={data.missed} />
          </div>
        </section>
      </div>
    </div>
  )
}

function readParam(name: string, fallback: string): string {
  return new URLSearchParams(window.location.search).get(name) ?? fallback
}

function FixtureBar({
  missed,
  outcome,
  onMissed,
  onOutcome,
}: {
  missed: number
  outcome: string
  onMissed: (count: number) => void
  onOutcome: () => void
}) {
  if (!import.meta.env.DEV) return null
  return (
    <div className="fixed bottom-4 left-4 z-[1000] flex items-center gap-2 rounded-full border-2 border-fuchsia-400 bg-white px-3 py-1.5 font-mono text-xs text-black shadow-[0_8px_30px_rgba(0,0,0,0.6)]">
      <span className="font-semibold">PROTOTYPE A</span>
      <span className="border-l border-black/20 pl-2">missed</span>
      {[0, 4, 10].map(count => (
        <button
          key={count}
          type="button"
          className={`rounded px-1.5 ${missed === count ? 'bg-fuchsia-500 text-white' : 'hover:bg-fuchsia-100'}`}
          onClick={() => onMissed(count)}
        >
          {count}
        </button>
      ))}
      <button type="button" className="rounded px-1.5 hover:bg-fuchsia-100" onClick={onOutcome}>
        outcome: {outcome}
      </button>
    </div>
  )
}

function ResultsPrototype() {
  const [missed, setMissed] = useState(() => Math.min(10, Math.max(0, Number(readParam('missed', '4')) || 0)))
  const [outcome, setOutcome] = useState(() => readParam('outcome', 'complete'))
  const data = useMemo(() => buildFixture(missed, outcome), [missed, outcome])

  const update = (patch: Record<string, string>) => {
    const params = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(patch)) params.set(key, value)
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }

  return (
    <>
      <ResultsLayout data={data} />
      <StationAvatar />
      <FixtureBar
        missed={missed}
        outcome={outcome}
        onMissed={count => {
          setMissed(count)
          update({ missed: String(count) })
        }}
        onOutcome={() => {
          const next = outcome === 'hearts' ? 'complete' : 'hearts'
          setOutcome(next)
          update({ outcome: next })
        }}
      />
    </>
  )
}

const initialParams = new URLSearchParams(window.location.search)
if (!initialParams.has('stationId')) {
  initialParams.set('stationId', 'insightsalchemist')
  window.history.replaceState(null, '', `${window.location.pathname}?${initialParams}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ResultsPrototype />
  </StrictMode>
)
