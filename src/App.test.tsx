import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { TextEncoder } from 'node:util'
import { OperationError } from './services/operationError'

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true })

let authenticated = false
const sessionListeners = new Set<() => void>()
const signOut = jest.fn<() => Promise<void>>()
const signIn = jest.fn<() => Promise<void>>()
const invoke = jest.fn<(name: string, input: unknown) => Promise<unknown>>()
const readyConnection = {
  client: {
    auth: {
      getSession: () => ({ isAuthenticated: authenticated }),
      onSessionChange: (listener: () => void) => {
        sessionListeners.add(listener)
        return () => { sessionListeners.delete(listener) }
      },
      signOut,
    },
  },
}

jest.unstable_mockModule('@fabric-msft/svg-icons', () => ({
  Fabric32Color: () => null,
  Fabric32Filled: () => null,
}))
jest.unstable_mockModule('react-qr-code', () => ({
  default: ({ value }: { value: string }) => <svg data-testid="qr-code" data-value={value} />,
}))

jest.unstable_mockModule('./services/rayfinClient', () => ({
  getOperatorConnection: async () => readyConnection,
  getAuthenticationFailure: () => null,
  onAuthenticationFailure: () => () => {},
  signInOperator: signIn,
  invokeOperation: invoke,
}))
jest.unstable_mockModule('./services/analyticsService', () => ({
  analytics: {
    identify: jest.fn(), track: jest.fn(), setSession: jest.fn(), setPool: jest.fn(),
    resetTrackedEventCount: jest.fn(), getTrackedEventCount: () => 0,
    getDeliveryStatus: () => ({
      enabled: true, queuedCount: 0, deliveredCount: 0, droppedCount: 0,
      sending: false, retryAt: null, lastFailure: null, lastDeliveredAt: null,
    }),
    subscribeDeliveryStatus: () => () => {},
  },
}))

const { default: App } = await import('./App')
const player = { userId: 'player-1', name: 'Fabric learner', email: 'learner@example.com', createdAt: '2026-09-10T00:00:00Z' }
const pool = { id: 'fabric', name: 'Fabric', iconPath: '/pools/default.svg', isActive: true, displayOrder: 0 }
const originalFetch = globalThis.fetch

beforeEach(() => {
  authenticated = false
  sessionListeners.clear()
  invoke.mockReset()
  signIn.mockReset().mockImplementation(async () => {
    authenticated = true
    sessionListeners.forEach(listener => listener())
  })
  signOut.mockReset().mockImplementation(async () => {
    authenticated = false
    sessionListeners.forEach(listener => listener())
  })
  Object.defineProperty(window.crypto, 'randomUUID', { value: randomUUID, configurable: true })
  window.scrollTo = jest.fn()
  window.history.replaceState(null, '', '/signin')
})

afterEach(() => {
  cleanup()
  jest.useRealTimers()
  globalThis.fetch = originalFetch
})

async function registerAttendee() {
  fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Fabric learner' } })
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'learner@example.com' } })
  fireEvent.change(screen.getByLabelText(/^Country/), { target: { value: 'Canada' } })
  const form = screen.getByLabelText(/^Name/).closest('form')
  if (!form) throw new Error('Registration form missing')
  fireEvent.submit(form)
}

describe('ported attendee flow', () => {
  it('requires explicit operator sign-in, retains it between attendees, and waits for saved results', async () => {
    let sessionId = ''
    let acceptAnswer!: (value: unknown) => void
    const pendingAnswer = new Promise(resolve => { acceptAnswer = resolve })
    invoke.mockImplementation(async (name, input) => {
      if (name === 'registerPlayer') return player
      if (name === 'listPools') return [pool]
      if (name === 'startSession') {
        if (!input || typeof input !== 'object' || !('sessionId' in input) || typeof input.sessionId !== 'string') throw new Error('Missing stable session ID')
        sessionId = input.sessionId
        return { sessionId, userId: player.userId, poolId: pool.id, seed: 42, startTime: '2026-09-10T00:00:00Z', status: 'active' }
      }
      if (name === 'getSessionQuestions') return {
        questions: [{ questionId: 'q1', questionText: 'Which answer is correct?', category: 'Fabric', choices: ['Correct choice', 'Choice two', 'Choice three', 'Choice four'], correctAnswerIndex: 0 }],
      }
      if (name === 'submitAnswer') return pendingAnswer
      if (name === 'endSession') return {
        sessionId, finalScore: 10, questionsAnswered: 1, correctAnswers: 1,
        accuracy: 100, streaksCompleted: 0, heartsRemaining: 5,
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    render(<App />)
    const operatorButton = await screen.findByRole('button', { name: 'Sign in operator with Fabric' })
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
    fireEvent.click(operatorButton)
    await registerAttendee()
    const begin = await screen.findByRole('button', { name: 'Begin Your Quest' })
    expect(window.location.pathname).toBe('/instructions')
    jest.useFakeTimers()
    fireEvent.click(begin)
    await screen.findByText('3')
    act(() => jest.advanceTimersByTime(3000))
    expect(screen.getByText('Which answer is correct?')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    act(() => jest.advanceTimersByTime(500))
    await screen.findByRole('heading', { name: 'Saving your results' })
    expect(invoke.mock.calls.some(([name]) => name === 'endSession')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Play Again' })).not.toBeInTheDocument()
    await act(async () => { acceptAnswer({ totalScore: 10, pointsEarned: 10 }) })
    const playAgain = await screen.findByRole('button', { name: 'Play Again' })
    expect(invoke.mock.calls.filter(([name]) => name === 'endSession')).toHaveLength(1)
    expect(screen.getAllByTestId('qr-code').map(code => code.getAttribute('data-value'))).toEqual([
      'https://aka.ms/fabrictrivia/l', 'https://aka.ms/fabrictrivia/f', 'https://aka.ms/fabrictrivia/c',
    ])
    fireEvent.click(playAgain)
    await screen.findByLabelText(/^Email/)
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/^Email/)).toHaveValue('')
    const firstSessionId = sessionId
    await registerAttendee()
    fireEvent.click(await screen.findByRole('button', { name: 'Begin Your Quest' }))
    await screen.findByText('3')
    expect(sessionId).not.toBe(firstSessionId)
  })

  it('restores an operator session without opening a popup and keeps multiple-pool selection', async () => {
    authenticated = true
    invoke.mockImplementation(async name => {
      if (name === 'registerPlayer') return player
      if (name === 'listPools') return [pool, { ...pool, id: 'analytics', name: 'Analytics' }]
      throw new Error(`Unexpected operation ${name}`)
    })
    render(<App />)
    await registerAttendee()
    await screen.findByRole('heading', { name: 'Choose Your Challenge' })
    expect(screen.getByRole('button', { name: 'Analytics' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))
    await screen.findByRole('button', { name: 'Begin Your Quest' })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('keeps the attendee form mounted when the operator session expires', async () => {
    authenticated = true
    render(<App />)
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Still here' } })
    act(() => {
      authenticated = false
      sessionListeners.forEach(listener => listener())
    })
    await screen.findByText(/operator session needs attention/i)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in operator with Fabric' }))
    await waitFor(() => expect(screen.getByLabelText(/^Name/)).toHaveValue('Still here'))
    expect(signOut).not.toHaveBeenCalled()
  })

  it('keeps an in-progress game and pending answer across operator expiry and explicit retry', async () => {
    authenticated = true
    let sessionId = ''
    let rejectAnswer!: (error: Error) => void
    const pendingAnswer = new Promise((_, reject) => { rejectAnswer = reject })
    const submittedAnswers: unknown[] = []
    invoke.mockImplementation(async (name, input) => {
      if (name === 'registerPlayer') return player
      if (name === 'listPools') return [pool]
      if (name === 'startSession') {
        if (!input || typeof input !== 'object' || !('sessionId' in input) || typeof input.sessionId !== 'string') throw new Error('Missing session ID')
        sessionId = input.sessionId
        return { sessionId, userId: player.userId, poolId: pool.id, seed: 42, startTime: '2026-09-10T00:00:00Z', status: 'active' }
      }
      if (name === 'getSessionQuestions') return {
        questions: [{ questionId: 'q1', questionText: 'Question before expiry', category: 'Fabric', choices: ['A', 'B', 'C', 'D'], correctAnswerIndex: 0 }],
      }
      if (name === 'submitAnswer') {
        submittedAnswers.push(input)
        return submittedAnswers.length === 1 ? pendingAnswer : { totalScore: 10, pointsEarned: 10 }
      }
      if (name === 'endSession') return {
        sessionId, finalScore: 10, questionsAnswered: 1, correctAnswers: 1,
        accuracy: 100, streaksCompleted: 0, heartsRemaining: 5,
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    render(<App />)
    await registerAttendee()
    const begin = await screen.findByRole('button', { name: 'Begin Your Quest' })
    jest.useFakeTimers()
    fireEvent.click(begin)
    await screen.findByText('3')
    act(() => jest.advanceTimersByTime(3000))
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    await act(async () => {
      authenticated = false
      sessionListeners.forEach(listener => listener())
      rejectAnswer(new OperationError('Operator session expired', 'OPERATOR_SIGN_IN_REQUIRED', false))
    })
    await screen.findByText(/operator session needs attention/i)
    act(() => jest.advanceTimersByTime(500))
    expect(screen.getByText('Your game could not be saved')).toBeInTheDocument()
    expect(invoke.mock.calls.some(([name]) => name === 'endSession')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in operator with Fabric' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry saving results' }))
    await screen.findByRole('button', { name: 'Play Again' })
    expect(submittedAnswers).toHaveLength(2)
    expect(submittedAnswers[0]).toEqual(submittedAnswers[1])
    for (const operation of ['registerPlayer', 'startSession', 'getSessionQuestions', 'endSession']) {
      expect(invoke.mock.calls.filter(([name]) => name === operation)).toHaveLength(1)
    }
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('reuses the start request ID when retrying an interrupted game start', async () => {
    authenticated = true
    const requests: string[] = []
    invoke.mockImplementation(async (name, input) => {
      if (name === 'registerPlayer') return player
      if (name === 'listPools') return [pool]
      if (name === 'startSession') {
        if (!input || typeof input !== 'object' || !('sessionId' in input) || typeof input.sessionId !== 'string') throw new Error('Missing session ID')
        requests.push(input.sessionId)
        if (requests.length === 1) throw new Error('Connection interrupted')
        return { sessionId: input.sessionId, userId: player.userId, poolId: pool.id, seed: 42, startTime: '2026-09-10T00:00:00Z', status: 'active' }
      }
      if (name === 'getSessionQuestions') return {
        questions: [{ questionId: 'q1', questionText: 'Question', category: 'Fabric', choices: ['A', 'B', 'C', 'D'], correctAnswerIndex: 0 }],
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    render(<App />)
    await registerAttendee()
    fireEvent.click(await screen.findByRole('button', { name: 'Begin Your Quest' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry this game' }))
    await screen.findByText('3')
    expect(requests).toHaveLength(2)
    expect(requests[0]).toBe(requests[1])
  })

  it('offers question loading and retries the same import ID before showing accepted counts', async () => {
    authenticated = true
    const imports: unknown[] = []
    invoke.mockImplementation(async (name, input) => {
      if (name === 'listPools') return [pool]
      if (name === 'previewQuestionImport') {
        if (!input || typeof input !== 'object' || !('importId' in input)) throw new Error('Missing import ID')
        return { importId: input.importId, questionCount: 1, previousImportCount: 0,
          pools: [{ slug: pool.id, questionCount: 1, existingPool: pool }] }
      }
      if (name === 'importQuestions') {
        imports.push(input)
        if (imports.length === 1) throw new Error('Import connection interrupted')
        if (!input || typeof input !== 'object' || !('importId' in input)) throw new Error('Missing import ID')
        return { importId: input.importId, acceptedCount: 1, questionIds: ['imported-question'] }
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Operator setup' }))
    fireEvent.click(screen.getByRole('link', { name: 'Load questions and create pools' }))
    expect(await screen.findByRole('heading', { name: 'Load questions' })).toBeInTheDocument()
    const file = new File(['csv fixture'], 'questions.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: async () => 'csv fixture' })
    // A file at the existing 10 MiB limit must not hit a smaller frontend cap.
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 })
    fireEvent.change(screen.getByLabelText('Question file'), { target: { files: [file] } })
    await screen.findByRole('heading', { name: 'Import preview' })
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Retry this import' }))
    await screen.findByText('Import complete. 1 question accepted.')
    expect(imports).toHaveLength(2)
    expect(imports[0]).toEqual(imports[1])
    expect(screen.getByRole('button', { name: 'Import questions' })).toBeDisabled()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('requires explicit pool creation and duplicate confirmation before an additive import', async () => {
    authenticated = true
    invoke.mockImplementation(async (name, input) => {
      if (name === 'listPools') return []
      if (!input || typeof input !== 'object' || !('importId' in input)) throw new Error('Missing import ID')
      if (name === 'previewQuestionImport') return {
        importId: input.importId, questionCount: 2, previousImportCount: 1,
        pools: [{ slug: 'demo', questionCount: 2 }, { slug: 'fabric', questionCount: 1, existingPool: pool }],
      }
      if (name === 'importQuestions') return {
        importId: input.importId, acceptedCount: 2, questionIds: ['q1', 'q2'],
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    window.history.replaceState(null, '', '/questions/load')
    render(<App />)
    const file = new File(['csv fixture'], 'questions.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'text', { value: async () => 'csv fixture' })
    fireEvent.change(await screen.findByLabelText('Question file'), { target: { files: [file] } })
    await screen.findByRole('heading', { name: 'Import preview' })
    expect(screen.getByText(/already been imported 1 time/)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Import questions' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Display name for demo'), { target: { value: 'Demo pool' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Create 1 missing pool/ }))
    expect(submit).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add another copy of these questions.' }))
    fireEvent.click(submit)
    await screen.findByText('Import complete. 2 questions accepted.')
    expect(invoke).toHaveBeenCalledWith('importQuestions', expect.objectContaining({
      csv: 'csv fixture',
      poolsToCreate: [{ slug: 'demo', name: 'Demo pool', iconPath: '/pools/default.svg' }],
      allowDuplicateContent: true,
    }))
    expect(invoke.mock.calls.filter(([name]) => name === 'createPool')).toHaveLength(0)
  })

  it('seeds through the same authenticated preview and import without automatic writes', async () => {
    authenticated = true
    const csv = readFileSync(new URL('../examples/questions.csv', import.meta.url), 'utf8')
    const fetchSample = jest.fn(async () => ({ ok: true, text: async () => csv }))
    Object.defineProperty(globalThis, 'fetch', { value: fetchSample, configurable: true, writable: true })
    invoke.mockImplementation(async (name, input) => {
      if (name === 'listPools') return []
      if (!input || typeof input !== 'object' || !('importId' in input)) throw new Error('Missing import ID')
      if (name === 'previewQuestionImport') return {
        importId: input.importId, questionCount: 4, previousImportCount: 0,
        pools: [{ slug: 'fabric-basics', questionCount: 4 }],
      }
      if (name === 'importQuestions') return {
        importId: input.importId, acceptedCount: 4, questionIds: ['q1', 'q2', 'q3', 'q4'],
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    window.history.replaceState(null, '', '/questions/load')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use sample questions' }))
    await screen.findByRole('heading', { name: 'Import preview' })
    expect(fetchSample).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls.filter(([name]) => name === 'importQuestions')).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox', { name: /Create 1 missing pool/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }))
    await screen.findByText('Import complete. 4 questions accepted.')
    expect(invoke).toHaveBeenCalledWith('importQuestions', expect.objectContaining({
      csv, poolsToCreate: [{ slug: 'fabric-basics', name: 'fabric basics', iconPath: '/pools/default.svg' }],
      allowDuplicateContent: false,
    }))
  })

  it('refreshes a stale preview after another import, retaining the identity until explicit confirmation', async () => {
    authenticated = true
    let previews = 0
    let imports = 0
    invoke.mockImplementation(async (name, input) => {
      if (name === 'listPools') return [pool]
      if (!input || typeof input !== 'object' || !('importId' in input)) throw new Error('Missing import ID')
      if (name === 'previewQuestionImport') return {
        importId: input.importId, questionCount: 1, previousImportCount: previews++,
        pools: [{ slug: 'fabric', questionCount: 1, existingPool: pool }],
      }
      if (name === 'importQuestions') {
        if (imports++ === 0) throw new OperationError('This file has already been imported.', 'DUPLICATE_IMPORT', false)
        return { importId: input.importId, acceptedCount: 1, questionIds: ['q1'] }
      }
      throw new Error(`Unexpected operation ${name}`)
    })
    window.history.replaceState(null, '', '/questions/load')
    render(<App />)
    const file = new File(['csv'], 'questions.csv')
    Object.defineProperty(file, 'text', { value: async () => 'csv' })
    fireEvent.change(await screen.findByLabelText('Question file'), { target: { files: [file] } })
    await screen.findByRole('heading', { name: 'Import preview' })
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review this import again' }))
    await screen.findByText(/already been imported 1 time/)
    expect(screen.getByRole('button', { name: 'Import questions' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add another copy of these questions.' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import questions' }))
    await screen.findByText('Import complete. 1 question accepted.')
    const requests = invoke.mock.calls.filter(([name]) => name === 'importQuestions').map(([, input]) => input)
    expect(requests).toHaveLength(2)
    const firstRequest = requests[0]
    if (!firstRequest || typeof firstRequest !== 'object') throw new Error('Missing first request')
    expect(requests[1]).toEqual({ ...firstRequest, allowDuplicateContent: true })
  })
})
