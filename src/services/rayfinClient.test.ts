/**
 * @jest-environment-options {"url":"https://trivia.example.invalid"}
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { EndSessionRequest, EndSessionResponse } from '../types/api'

let authenticated = false
const signOut = jest.fn(async () => { authenticated = false })
const auth = { getSession: () => ({ isAuthenticated: authenticated }), signOut }
const invokePools = jest.fn<() => Promise<unknown>>()
type Invoke = (input: { payload: string }, options?: { timeoutMs: number }) => Promise<unknown>
const invokeAnswer = jest.fn<Invoke>()
const invokeEnd = jest.fn<Invoke>()
const invokeImport = jest.fn<Invoke>()
const invokeStart = jest.fn<Invoke>()
const invokeDraw = jest.fn<Invoke>()
const invokeTelemetry = jest.fn<Invoke>()
const ensureSignedIn = jest.fn(async () => {
  authenticated = true
  return { isAuthenticated: true }
})
const initiateLogin = jest.fn(async () => { authenticated = true })

class NetworkError extends Error {
  readonly status = 401
}

jest.unstable_mockModule('@microsoft/rayfin-client', () => ({
  RayfinClient: class {
    static errors = { NetworkError }
    auth = auth
    functions = {
      listPools: { invoke: invokePools },
      submitAnswer: { invoke: invokeAnswer },
      endSession: { invoke: invokeEnd },
      importQuestions: { invoke: invokeImport },
      startSession: { invoke: invokeStart },
      getSessionQuestions: { invoke: invokeDraw },
      trackTelemetryBatch: { invoke: invokeTelemetry },
    }
  },
  resolveRayfinConfig: async () => ({
    baseUrl: 'https://api.example.invalid',
    publishableKey: 'pk-test',
    runtimeConfig: {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      itemId: '22222222-2222-4222-8222-222222222222',
      portalUrl: 'https://app.fabric.microsoft.com',
    },
  }),
}))
jest.unstable_mockModule('@microsoft/rayfin-auth-provider-fabric', () => ({
  ensureSignedInWithFabric: ensureSignedIn,
  initiateFabricLogin: initiateLogin,
}))

beforeEach(() => {
  jest.resetModules()
  authenticated = false
  signOut.mockClear()
  invokePools.mockReset().mockResolvedValue({ success: true, data: [] })
  invokeAnswer.mockReset()
  invokeEnd.mockReset()
  invokeImport.mockReset()
  invokeStart.mockReset()
  invokeDraw.mockReset()
  invokeTelemetry.mockReset()
  ensureSignedIn.mockClear()
  initiateLogin.mockReset().mockImplementation(async () => { authenticated = true })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('game write invocation timeouts', () => {
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const answer = {
    questionId: '22222222-2222-4222-8222-222222222222',
    answerIndex: 0, timeElapsed: 1, isCorrect: true,
  }
  const ending: EndSessionRequest = {
    questionsAnswered: 1, correctAnswers: 1, streaksCompleted: 0,
    finalTimeRemaining: 0, heartsRemaining: 5,
  }
  const summary: EndSessionResponse = {
    sessionId, finalScore: 10, questionsAnswered: 1,
    correctAnswers: 1, accuracy: 100, streaksCompleted: 0, heartsRemaining: 5,
  }

  it('overrides game-write timeouts but preserves defaults for reads, imports, starts and telemetry', async () => {
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    const payload = { payload: '{}' }
    await connection.invoke.submitAnswer(payload)
    await connection.invoke.endSession(payload)
    await connection.invoke.listPools(payload)
    await connection.invoke.importQuestions(payload)
    await connection.invoke.startSession(payload)
    await connection.invoke.getSessionQuestions(payload)
    await connection.invoke.trackTelemetryBatch(payload)
    expect(invokeAnswer).toHaveBeenCalledWith(payload, { timeoutMs: 30_000 })
    expect(invokeEnd).toHaveBeenCalledWith(payload, { timeoutMs: 30_000 })
    expect(invokePools).toHaveBeenCalledWith(payload)
    expect(invokeImport).toHaveBeenCalledWith(payload)
    expect(invokeStart).toHaveBeenCalledWith(payload)
    expect(invokeDraw).toHaveBeenCalledWith(payload)
    expect(invokeTelemetry).toHaveBeenCalledWith(payload)
  })

  it.each(['answer', 'completion'] as const)(
    'retains a stalled %s for manual retry after exactly 91.5 seconds of attempts and backoff',
    async (operation) => {
      jest.useFakeTimers()
      authenticated = true
      const client = await import('./rayfinClient')
      const { GameWrites } = await import('./gameWrites')
      const blocked = operation === 'answer' ? invokeAnswer : invokeEnd
      blocked.mockImplementation((_input, options) => new Promise((_resolve, reject) => {
        const timeoutMs = options?.timeoutMs ?? 250_000
        window.setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs)
      }))
      if (operation === 'answer') invokeEnd.mockResolvedValue({ success: true, data: summary })
      const onState = jest.fn()
      const onSaved = jest.fn()
      const writes = new GameWrites(sessionId, {
        submitAnswer: (id, input) => client.invokeOperation('submitAnswer', { ...input, sessionId: id }),
        end: (id, input) => client.invokeOperation('endSession', { ...input, sessionId: id }),
      }, onState, onSaved)
      if (operation === 'answer') writes.enqueue(answer)
      writes.finish(ending)

      await jest.advanceTimersByTimeAsync(91_499)
      expect(onState).toHaveBeenLastCalledWith({
        status: 'saving', pendingAnswers: operation === 'answer' ? 1 : 0,
      })
      expect(blocked).toHaveBeenCalledTimes(3)
      expect(onSaved).not.toHaveBeenCalled()
      if (operation === 'answer') expect(invokeEnd).not.toHaveBeenCalled()

      await jest.advanceTimersByTimeAsync(1)
      expect(onState).toHaveBeenLastCalledWith({
        status: 'error', pendingAnswers: operation === 'answer' ? 1 : 0, error: 'Request timed out after 30000ms',
      })
      await jest.advanceTimersByTimeAsync(60_000)
      expect(blocked).toHaveBeenCalledTimes(3)

      blocked.mockResolvedValue({
        success: true,
        data: operation === 'answer' ? { totalScore: 10, pointsEarned: 10 } : summary,
      })
      writes.retry()
      await jest.advanceTimersByTimeAsync(0)
      expect(onSaved).toHaveBeenCalledWith(summary)
      expect(onState).toHaveBeenLastCalledWith({ status: 'saved', pendingAnswers: 0 })
      expect(blocked).toHaveBeenCalledTimes(4)
      const originalInput = { ...(operation === 'answer' ? answer : ending), sessionId }
      for (const call of blocked.mock.calls) {
        expect(call).toEqual([{ payload: JSON.stringify(originalInput) }, { timeoutMs: 30_000 }])
      }
      writes.dispose()
    },
  )
})

describe('operator sign-in recovery', () => {
  it('retains the normal SDK sign-in flow for a browser without a rejected session', async () => {
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    const signIn = client.signInOperator(connection)
    expect(ensureSignedIn).toHaveBeenCalledWith(auth, connection.fabricOptions)
    expect(initiateLogin).not.toHaveBeenCalled()
    await signIn
    expect(client.getAuthenticationFailure()).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('renews a rejected session directly through the broker without signing out or reusing it', async () => {
    authenticated = true
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    const changed = jest.fn()
    const unsubscribe = client.onAuthenticationFailure(changed)
    invokePools.mockRejectedValueOnce(new NetworkError('Unauthorized'))
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(authenticated).toBe(true)
    expect(client.getAuthenticationFailure()).toMatch(/Sign in again with Fabric/)
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(invokePools).toHaveBeenCalledTimes(1)

    const signIn = client.signInOperator(connection)
    // The broker must be called before returning to preserve the browser's user gesture.
    expect(initiateLogin).toHaveBeenCalledWith(auth, connection.fabricOptions)
    expect(ensureSignedIn).not.toHaveBeenCalled()
    await signIn
    expect(signOut).not.toHaveBeenCalled()
    expect(client.getAuthenticationFailure()).toBeNull()
    expect(changed).toHaveBeenCalledTimes(2)
    await expect(client.invokeOperation('listPools', {})).resolves.toEqual([])
    unsubscribe()
  })

  it('keeps requests blocked after a cancelled broker login and permits another recovery attempt', async () => {
    authenticated = true
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    invokePools.mockRejectedValueOnce(new NetworkError('Unauthorized'))
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    initiateLogin.mockRejectedValueOnce(new Error('Popup closed'))
    await expect(client.signInOperator(connection)).rejects.toThrow('Popup closed')
    expect(client.getAuthenticationFailure()).not.toBeNull()
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(invokePools).toHaveBeenCalledTimes(1)
    await client.signInOperator(connection)
    expect(initiateLogin).toHaveBeenCalledTimes(2)
    expect(client.getAuthenticationFailure()).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not clear the failure unless the broker establishes an authenticated session', async () => {
    authenticated = true
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    invokePools.mockRejectedValueOnce(new NetworkError('Unauthorized'))
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    initiateLogin.mockImplementationOnce(async () => { authenticated = false })
    await expect(client.signInOperator(connection)).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(client.getAuthenticationFailure()).not.toBeNull()
  })
})
