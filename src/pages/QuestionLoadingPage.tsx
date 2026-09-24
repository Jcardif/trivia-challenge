import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import Header from '../components/Header'
import { useGame } from '../context/GameContext'
import { sessionService } from '../services/sessionService'
import { OperationError } from '../services/operationError'
import type { ImportQuestionsInput, ImportQuestionsPreview, ImportQuestionsResponse, QuestionPool } from '../types/api'
import { getStationLockdownMessage, isStationLockdownActive } from '../lib/stationLockdown'

const MAX_CSV_BYTES = 10 * 1024 * 1024
const sampleUrl = new URL('../../examples/questions.csv?no-inline', import.meta.url).href
const inputClass = 'mt-2 w-full rounded-xl border border-white/15 bg-neutral-950 px-4 py-3 text-white focus:border-amber-300 focus:outline-none disabled:opacity-50'
const buttonClass = 'rounded-2xl bg-amber-400 px-6 py-3 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50'

export default function QuestionLoadingPage() {
  const { session, savedSummary, isPlaying } = useGame()
  const [pools, setPools] = useState<QuestionPool[]>([])
  const [poolError, setPoolError] = useState<string | null>(null)
  const [poolForm, setPoolForm] = useState({ slug: '', name: '', description: '', iconPath: '/pools/default.svg' })
  const [creatingPool, setCreatingPool] = useState(false)
  const [poolMessage, setPoolMessage] = useState<string | null>(null)
  const [loadingPools, setLoadingPools] = useState(true)
  const [poolAttempt, setPoolAttempt] = useState(0)
  const [fileName, setFileName] = useState('')
  const [pendingImport, setPendingImport] = useState<ImportQuestionsInput | null>(null)
  const [preview, setPreview] = useState<ImportQuestionsPreview | null>(null)
  const [poolNames, setPoolNames] = useState<Record<string, string>>({})
  const [createMissingPools, setCreateMissingPools] = useState(false)
  const [allowDuplicateContent, setAllowDuplicateContent] = useState(false)
  const [result, setResult] = useState<ImportQuestionsResponse | null>(null)
  const [phase, setPhase] = useState<'empty' | 'reading' | 'ready' | 'submitting' | 'error' | 'complete'>('empty')
  const [importError, setImportError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Array<{ row: number; message: string }>>([])
  const mountedRef = useRef(false)
  const fileVersionRef = useRef(0)
  const importBusyRef = useRef(false)
  const poolBusyRef = useRef(false)
  const submittedImportRef = useRef<ImportQuestionsInput | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const lockdown = isStationLockdownActive()
  const blockedByGame = Boolean(session && !savedSummary) || isPlaying

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; fileVersionRef.current++ }
  }, [])

  useEffect(() => {
    if (blockedByGame) return
    let current = true
    setLoadingPools(true)
    setPoolError(null)
    void sessionService.getPools()
      .then(items => { if (current) setPools(items) })
      .catch((error: unknown) => {
        if (current) setPoolError(error instanceof Error ? error.message : 'Question pools could not be loaded.')
      })
      .finally(() => { if (current) setLoadingPools(false) })
    return () => { current = false }
  }, [poolAttempt, blockedByGame])

  useEffect(() => {
    if (phase !== 'submitting' && !creatingPool) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase, creatingPool])

  const createPool = async (event: FormEvent) => {
    event.preventDefault()
    if (poolBusyRef.current || lockdown) return
    poolBusyRef.current = true
    setCreatingPool(true)
    setPoolError(null)
    setPoolMessage(null)
    try {
      const pool = await sessionService.createPool({
        slug: poolForm.slug.trim(),
        name: poolForm.name.trim(),
        description: poolForm.description.trim() || undefined,
        iconPath: poolForm.iconPath.trim() || undefined,
      })
      if (!mountedRef.current) return
      setPools(previous => [...previous.filter(item => item.id !== pool.id), pool]
        .sort((left, right) => left.displayOrder - right.displayOrder || left.name.localeCompare(right.name)))
      setPoolMessage(`Created "${pool.name}". Use "${pool.id}" in the CSV Pools column.`)
      setPoolForm({ slug: '', name: '', description: '', iconPath: '/pools/default.svg' })
    } catch (error: unknown) {
      if (mountedRef.current) setPoolError(error instanceof Error ? error.message : 'The pool could not be created.')
    } finally {
      poolBusyRef.current = false
      if (mountedRef.current) setCreatingPool(false)
    }
  }

  const prepareImport = async (name: string, read: () => Promise<string>, importId: string = crypto.randomUUID()) => {
    if (importBusyRef.current) return
    const version = ++fileVersionRef.current
    submittedImportRef.current = null
    setPendingImport(null)
    setPreview(null)
    setPoolNames({})
    setCreateMissingPools(false)
    setAllowDuplicateContent(false)
    setResult(null)
    setValidationErrors([])
    setImportError(null)
    setFileName(name)
    if (!name) { setPhase('empty'); return }
    setPhase('reading')
    try {
      const csv = await read()
      if (!mountedRef.current || version !== fileVersionRef.current) return
      const input = { importId, csv }
      setPendingImport(input)
      const details = await sessionService.previewQuestionImport(input)
      if (!mountedRef.current || version !== fileVersionRef.current) return
      if (details.importId !== importId) {
        throw new OperationError('The preview belongs to another import.', 'IMPORT_MISMATCH', false)
      }
      setPreview(details)
      setPoolNames(Object.fromEntries(details.pools.filter(pool => !pool.existingPool)
        .map(pool => [pool.slug, pool.slug.replace(/[-_]+/g, ' ')])))
      setPhase('ready')
    } catch (error: unknown) {
      if (!mountedRef.current || version !== fileVersionRef.current) return
      setImportError(error instanceof Error ? error.message : 'The CSV file could not be previewed.')
      if (error instanceof OperationError) setValidationErrors(error.validationErrors ?? [])
      setPhase('error')
    }
  }

  const selectFile = (file: File | undefined) => prepareImport(file?.name ?? '', async () => {
    if (!file) throw new Error('Select a CSV file.')
    if (file.size > MAX_CSV_BYTES) throw new Error('CSV files must be no larger than 10 MiB.')
    return file.text()
  })

  const loadSample = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
    return prepareImport('questions.csv', async () => {
      const response = await fetch(sampleUrl)
      if (!response.ok) throw new Error('The sample CSV could not be loaded. Download it and select the file instead.')
      return response.text()
    })
  }

  const missingPools = preview?.pools.filter(pool => !pool.existingPool) ?? []
  const needsConfirmation = missingPools.length > 0 && (!createMissingPools ||
    missingPools.some(pool => !poolNames[pool.slug]?.trim())) ||
    Boolean(preview?.previousImportCount && !allowDuplicateContent)

  const importQuestions = async () => {
    if (!pendingImport || !preview || needsConfirmation || importBusyRef.current || lockdown || phase === 'complete') return
    importBusyRef.current = true
    const input = submittedImportRef.current ?? {
      ...pendingImport,
      poolsToCreate: missingPools.map(pool => ({
        slug: pool.slug, name: poolNames[pool.slug].trim(), iconPath: '/pools/default.svg',
      })),
      allowDuplicateContent,
    }
    submittedImportRef.current = input
    const version = fileVersionRef.current
    setPhase('submitting')
    setImportError(null)
    setValidationErrors([])
    try {
      const imported = await sessionService.importQuestions(input)
      if (!mountedRef.current || version !== fileVersionRef.current) return
      if (imported.importId !== pendingImport.importId) {
        throw new OperationError('The response belongs to another import.', 'IMPORT_MISMATCH', false)
      }
      setResult(imported)
      setPhase('complete')
      setPoolAttempt(value => value + 1)
    } catch (error: unknown) {
      if (!mountedRef.current || version !== fileVersionRef.current) return
      setImportError(error instanceof Error ? error.message : 'The CSV import failed.')
      if (error instanceof OperationError) setValidationErrors(error.validationErrors ?? [])
      setPhase('error')
    } finally {
      importBusyRef.current = false
    }
  }

  if (blockedByGame) return <Navigate to={isPlaying ? '/playing' : '/results'} replace />
  const importBusy = phase === 'reading' || phase === 'submitting'
  const choicesLocked = importBusy || Boolean(submittedImportRef.current) || lockdown

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#040406] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,#1f2937_0%,#040406_70%)]" />
      <main className="relative mx-auto max-w-5xl px-5 py-10">
        <Header />
        <h1 className="mt-6 text-center text-3xl font-semibold">Load questions</h1>
        <p className="mx-auto mt-3 max-w-2xl text-center text-white/65">Create pools and add questions from a CSV file. Existing questions are kept. This uses the kiosk operator's Fabric session.</p>
        {!importBusy && !creatingPool && <div className="mt-6 flex flex-wrap gap-5 text-amber-200">
          <Link to="/operator" className="underline">Back to operator setup</Link>
          <Link to="/signin" className="underline">Back to attendee registration</Link>
        </div>}
        {lockdown && <p className="mt-5 rounded-xl border border-red-400/40 p-4 text-red-200" role="alert">{getStationLockdownMessage()}</p>}
        <div className="mt-7 grid items-start gap-7 md:grid-cols-2">
          <section className="rounded-3xl border border-amber-200/20 bg-white/5 p-7">
            <h2 className="text-xl font-semibold">Question pools</h2>
            {loadingPools && <p className="mt-4 text-white/60" role="status">Loading pools...</p>}
            {!loadingPools && pools.length === 0 && <p className="mt-4 text-white/60">No active pools yet. Create one below, or confirm missing pools in the import preview.</p>}
            <ul className="mt-4 space-y-3">
              {pools.map(pool => <li key={pool.id} className="rounded-xl border border-white/10 p-3"><span className="font-semibold">{pool.name}</span><span className="ml-3 font-mono text-sm text-amber-200">{pool.id}</span></li>)}
            </ul>
            {poolError && <div className="mt-4 text-sm text-red-200" role="alert"><p>{poolError}</p><button type="button" disabled={loadingPools || creatingPool} onClick={() => setPoolAttempt(value => value + 1)} className="mt-2 underline">Reload pools</button></div>}
            {poolMessage && <p className="mt-4 text-sm text-emerald-300" role="status">{poolMessage}</p>}
            <form onSubmit={event => { void createPool(event) }} className="mt-7 space-y-4 border-t border-white/10 pt-6">
              <h3 className="text-lg font-semibold">Create a pool</h3>
              <label className="block text-sm">Slug<input required name="slug" value={poolForm.slug} disabled={creatingPool || lockdown} onChange={event => setPoolForm(previous => ({ ...previous, slug: event.target.value }))} placeholder="fabric-basics" className={inputClass} /></label>
              <label className="block text-sm">Name<input required name="poolName" value={poolForm.name} disabled={creatingPool || lockdown} onChange={event => setPoolForm(previous => ({ ...previous, name: event.target.value }))} className={inputClass} /></label>
              <label className="block text-sm">Description<input name="description" value={poolForm.description} disabled={creatingPool || lockdown} onChange={event => setPoolForm(previous => ({ ...previous, description: event.target.value }))} className={inputClass} /></label>
              <label className="block text-sm">Existing icon path<input name="iconPath" value={poolForm.iconPath} disabled={creatingPool || lockdown} onChange={event => setPoolForm(previous => ({ ...previous, iconPath: event.target.value }))} className={inputClass} /></label>
              <button disabled={creatingPool || lockdown} type="submit" className={buttonClass}>{creatingPool ? 'Creating pool...' : 'Create pool'}</button>
            </form>
          </section>
          <section className="rounded-3xl border border-amber-200/20 bg-white/5 p-7">
            <h2 className="text-xl font-semibold">Import a CSV</h2>
            <p className="mt-3 text-sm text-white/65">Up to 10 MiB. Use these columns, with a zero-based correct answer key from 0 to 3.</p>
            <code className="mt-4 block break-words rounded-xl bg-black/40 p-3 text-xs leading-relaxed text-amber-100">Category,Question,Answer1,Answer2,Answer3,Answer4,CorrectAnswerKey,Metadata,Pools</code>
            <p className="mt-3 text-sm text-white/65">The Pools column assigns comma-separated slugs. Quote cells containing commas. A blank Pools value uses default. Review the destinations below before saving.</p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm text-amber-200">
              <button type="button" disabled={importBusy || lockdown} className="underline disabled:opacity-50" onClick={() => { void loadSample() }}>Use sample questions</button>
              <a href={sampleUrl} download="questions.csv" className="underline">Download sample CSV</a>
            </div>
            <label className="mt-6 block text-sm">Question file<input ref={fileInputRef} type="file" accept=".csv,text/csv" disabled={importBusy || lockdown} onChange={event => { void selectFile(event.target.files?.[0]) }} className={`${inputClass} file:mr-4 file:rounded-lg file:border-0 file:bg-white/15 file:px-3 file:py-1 file:text-white`} /></label>
            {fileName && <p className="mt-3 break-all text-sm text-white/60">{fileName}</p>}
            {pendingImport && <p className="mt-2 break-all font-mono text-xs text-white/50">Import ID: {pendingImport.importId}</p>}
            {importBusy && <div className="mt-5" role="status"><p>{phase === 'reading' ? 'Validating the CSV and loading its destinations...' : 'Saving questions in Fabric...'}</p><progress aria-label="CSV import progress" className="mt-3 w-full" /><p className="mt-2 text-sm text-white/60">Keep this tab open until the operation finishes.</p></div>}
            {preview && <div className="mt-5 space-y-4">
              <h3 className="text-lg font-semibold">Import preview</h3>
              <p>{preview.questionCount} question{preview.questionCount === 1 ? '' : 's'} will be added. Existing questions will not be replaced.</p>
              <ul className="space-y-3">
                {preview.pools.map(destination => <li key={destination.slug} className="rounded-xl border border-white/15 p-3">
                  <p><code className="break-all text-amber-200">{destination.slug}</code>: {destination.questionCount} question{destination.questionCount === 1 ? '' : 's'}</p>
                  {destination.existingPool
                    ? <p className="mt-2 text-sm text-white/65">Existing pool: {destination.existingPool.name}{!destination.existingPool.isActive && '. This pool is inactive and will not appear to players.'}</p>
                    : <label className="mt-2 block text-sm">Display name for {destination.slug}<input value={poolNames[destination.slug] ?? ''} maxLength={4000} disabled={choicesLocked} onChange={event => setPoolNames(previous => ({ ...previous, [destination.slug]: event.target.value }))} className={inputClass} /></label>}
                </li>)}
              </ul>
              {missingPools.length > 0 && <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" checked={createMissingPools} disabled={choicesLocked} onChange={event => setCreateMissingPools(event.target.checked)} className="mt-1" />
                Create {missingPools.length} missing pool{missingPools.length === 1 ? '' : 's'} with the names above. Pools and questions will be saved together.
              </label>}
              {preview.previousImportCount > 0 && <div className="rounded-xl border border-amber-300/40 p-4">
                <p role="alert">This exact file has already been imported {preview.previousImportCount} time{preview.previousImportCount === 1 ? '' : 's'}.</p>
                <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={allowDuplicateContent} disabled={choicesLocked} onChange={event => setAllowDuplicateContent(event.target.checked)} className="mt-1" />Add another copy of these questions.</label>
              </div>}
            </div>}
            {importError && <p className="mt-5 text-sm text-red-200" role="alert">{importError}</p>}
            {validationErrors.length > 0 && <ul className="mt-3 max-h-72 list-inside list-disc overflow-y-auto text-sm text-red-200">{validationErrors.map((error, index) => <li key={`${error.row}-${index}`}>Row {error.row}: {error.message}</li>)}</ul>}
            {result && <p className="mt-5 rounded-xl border border-emerald-400/40 bg-emerald-950/20 p-4 text-emerald-200" role="status">Import complete. {result.acceptedCount} question{result.acceptedCount === 1 ? '' : 's'} accepted.</p>}
            <button type="button" disabled={!pendingImport || !preview || needsConfirmation || importBusy || phase === 'complete' || lockdown} onClick={() => { void importQuestions() }} className={`${buttonClass} mt-6`}>
              {phase === 'error' && submittedImportRef.current ? 'Retry this import' : 'Import questions'}
            </button>
            {phase === 'error' && pendingImport && <button type="button" disabled={lockdown} className="mt-4 block text-sm text-amber-200 underline" onClick={() => { void prepareImport(fileName, async () => pendingImport.csv, pendingImport.importId) }}>Review this import again</button>}
            <p className="mt-3 text-xs text-white/50">Retry keeps the same request and cannot add the same import twice. Selecting a file starts a new import and checks for previous copies.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
