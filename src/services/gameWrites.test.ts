import { describe, expect, it, jest } from '@jest/globals'
import { waitFor } from '@testing-library/react'
import { GameWrites, type SaveState } from './gameWrites'
import { OperationError } from './operationError'
import type { EndSessionRequest, EndSessionResponse, SubmitAnswerResponse } from '../types/api'

const firstAnswer = { questionId: 'q1', answerIndex: 0, timeElapsed: 1, isCorrect: true }
const secondAnswer = { questionId: 'q2', answerIndex: 1, timeElapsed: 2, isCorrect: false }
const endInput: EndSessionRequest = {
  questionsAnswered: 2, correctAnswers: 1, streaksCompleted: 0,
  finalTimeRemaining: 0, heartsRemaining: 4.5,
}
const summary: EndSessionResponse = {
  sessionId: 'session-one', finalScore: 10, questionsAnswered: 2,
  correctAnswers: 1, accuracy: 50, streaksCompleted: 0, heartsRemaining: 4.5,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

function harness() {
  const submitAnswer = jest.fn<() => Promise<SubmitAnswerResponse>>()
    .mockResolvedValue({ totalScore: 10, pointsEarned: 10 })
  const end = jest.fn<() => Promise<EndSessionResponse>>().mockResolvedValue(summary)
  const onState = jest.fn<(state: SaveState) => void>()
  const onSaved = jest.fn<(result: EndSessionResponse) => void>()
  const writes = new GameWrites('session-one', { submitAnswer, end }, onState, onSaved, async () => {})
  return { writes, submitAnswer, end, onState, onSaved }
}

describe('game write coordination', () => {
  it('serializes answers and does not finalize until every answer is accepted', async () => {
    const { writes, submitAnswer, end, onSaved } = harness()
    const first = deferred<SubmitAnswerResponse>()
    submitAnswer.mockReturnValueOnce(first.promise)
    writes.enqueue(firstAnswer)
    writes.enqueue(secondAnswer)
    writes.finish(endInput)
    expect(submitAnswer).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
    first.resolve({ totalScore: 10, pointsEarned: 10 })
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(summary))
    expect(submitAnswer.mock.calls).toEqual([
      ['session-one', firstAnswer],
      ['session-one', secondAnswer],
    ])
    expect(end).toHaveBeenCalledWith('session-one', endInput)
  })

  it('stops after three attempts, retains failed answers, and resumes the same writes on retry', async () => {
    const { writes, submitAnswer, end, onState, onSaved } = harness()
    submitAnswer.mockRejectedValue(new OperationError('Offline', 'NETWORK_ERROR', true))
    writes.enqueue(firstAnswer)
    writes.enqueue(secondAnswer)
    writes.finish(endInput)
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({
      status: 'error', pendingAnswers: 2, error: 'Offline',
    }))
    expect(submitAnswer).toHaveBeenCalledTimes(3)
    expect(end).not.toHaveBeenCalled()
    submitAnswer.mockResolvedValue({ totalScore: 10, pointsEarned: 10 })
    writes.retry()
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(summary))
    expect(submitAnswer).toHaveBeenCalledTimes(5)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('does not automatically retry an operator-session failure', async () => {
    const { writes, submitAnswer, end, onState } = harness()
    submitAnswer.mockRejectedValue(new OperationError('Operator sign-in needed', 'OPERATOR_SIGN_IN_REQUIRED', false))
    writes.enqueue(firstAnswer)
    writes.finish(endInput)
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({
      status: 'error', pendingAnswers: 1, error: 'Operator sign-in needed',
    }))
    expect(submitAnswer).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
  })

  it('retries finalization with its original payload without resubmitting accepted answers', async () => {
    const { writes, submitAnswer, end, onState, onSaved } = harness()
    end.mockRejectedValue(new OperationError('Try later', 'BUSY', true))
    writes.enqueue(firstAnswer)
    writes.finish(endInput)
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({
      status: 'error', pendingAnswers: 0, error: 'Try later',
    }))
    writes.finish({ ...endInput, questionsAnswered: 100 })
    end.mockResolvedValue(summary)
    writes.retry()
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(submitAnswer).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(4)
    for (const call of end.mock.calls) expect(call).toEqual(['session-one', endInput])
  })

  it('ignores duplicate input and duplicate completion calls', async () => {
    const { writes, submitAnswer, end, onSaved } = harness()
    writes.enqueue(firstAnswer)
    writes.enqueue(firstAnswer)
    writes.finish(endInput)
    writes.finish(endInput)
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    writes.finish(endInput)
    writes.retry()
    expect(submitAnswer).toHaveBeenCalledTimes(1)
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('does not let a late response mutate a reset game or dispatch later writes', async () => {
    const { writes, submitAnswer, end, onState, onSaved } = harness()
    const first = deferred<SubmitAnswerResponse>()
    const accepted = jest.fn()
    submitAnswer.mockReturnValueOnce(first.promise)
    writes.enqueue(firstAnswer, accepted)
    writes.enqueue(secondAnswer)
    writes.finish(endInput)
    writes.dispose()
    const stateCalls = onState.mock.calls.length
    first.resolve({ totalScore: 10, pointsEarned: 10 })
    await first.promise
    await Promise.resolve()
    expect(accepted).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onState).toHaveBeenCalledTimes(stateCalls)
    expect(submitAnswer).toHaveBeenCalledTimes(1)
    expect(end).not.toHaveBeenCalled()
  })

  it('rejects a final summary for a different session', async () => {
    const { writes, end, onState, onSaved } = harness()
    end.mockResolvedValue({ ...summary, sessionId: 'another-session' })
    writes.finish(endInput)
    await waitFor(() => expect(onState).toHaveBeenLastCalledWith({
      status: 'error', pendingAnswers: 0, error: 'The saved summary belongs to another game.',
    }))
    expect(onSaved).not.toHaveBeenCalled()
  })
})
