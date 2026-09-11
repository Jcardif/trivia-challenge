import { describe, expect, it } from '@jest/globals'
import {
  initialStats, replayAnswer, scoreAnswer, seededRandom, shuffle, shuffleChoices,
  summarizeAnswers, verifyEndCounters, verifyImportReplay, verifyStartReplay,
} from '../src/game.js'
import { DomainError } from '../src/errors.js'

describe('game calculations', () => {
  it('computes ten points per correct answer and half a heart per wrong answer', () => {
    expect(summarizeAnswers([true, false, true])).toEqual({
      totalScore: 20, questionsAnswered: 3, correctAnswers: 2,
      streaksCompleted: 0, streakProgress: 1, heartsHalfUnits: 9,
    })
  })

  it('decrements streak by one rather than resetting and awards a bonus at five', () => {
    const stats = summarizeAnswers([true, true, true, true, false, true, true])
    expect(stats.streaksCompleted).toBe(1)
    expect(stats.streakProgress).toBe(0)
  })

  it('caps completed bonuses at five, resets progress, and clamps hearts at zero', () => {
    expect(summarizeAnswers(Array<boolean>(30).fill(true))).toMatchObject({
      totalScore: 300, streaksCompleted: 5, streakProgress: 0, heartsHalfUnits: 10,
    })
    expect(summarizeAnswers(Array<boolean>(12).fill(false))).toMatchObject({ heartsHalfUnits: 0, streakProgress: 0 })
  })

  it('does not mutate previous state', () => {
    const initial = initialStats()
    scoreAnswer(initial, true)
    expect(initial).toEqual(initialStats())
  })

  it('accepts compatible completion and explicitly retries outstanding answers', () => {
    const stats = summarizeAnswers([true, false])
    const input = {
      questionsAnswered: 2, correctAnswers: 1, streaksCompleted: 0,
      heartsRemaining: 4.5, finalTimeRemaining: 0,
    }
    expect(() => verifyEndCounters(input, stats)).not.toThrow()
    expect(() => verifyEndCounters({ ...input, correctAnswers: 2 }, stats)).toThrow('do not match')
    expect(() => verifyEndCounters({ ...input, questionsAnswered: 1 }, stats)).toThrow('do not match')
    expect(() => verifyEndCounters({ ...input, questionsAnswered: 3 }, stats, false)).toThrow('do not match')
    try {
      verifyEndCounters({ ...input, questionsAnswered: 3 }, stats)
      throw new Error('Expected not ready')
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'SESSION_NOT_READY', retryable: true })
    }
  })
})

describe('positional draw randomization', () => {
  it('tracks the correct original position even when all answer labels are identical', () => {
    const result = shuffleChoices(['same', 'same', 'same', 'same'], 0, () => 0)
    expect(result.choices).toEqual(['same', 'same', 'same', 'same'])
    expect(result.correctAnswerIndex).toBe(3)
  })

  it('keeps every question, including draws larger than a GraphQL default page', () => {
    const questions = Array.from({ length: 251 }, (_, index) => index)
    const draw = shuffle(questions, seededRandom(12))
    expect(draw).toHaveLength(251)
    expect(new Set(draw).size).toBe(251)
    expect(draw).not.toEqual(questions)
    expect(questions[0]).toBe(0)
    expect(draw).toEqual(shuffle(questions, seededRandom(12)))
  })

  it('preserves answer identity for every seed and correct key', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      for (let key = 0; key < 4; key += 1) {
        const answers = ['A', 'B', 'C', 'D'] as const
        const result = shuffleChoices(answers, key, seededRandom(seed))
        expect(result.choices[result.correctAnswerIndex]).toBe(answers[key])
      }
    }
  })
})

describe('idempotency decisions', () => {
  it('replays the stored response without trusting client correctness or adding score', () => {
    const stored = { answerIndex: 1, timeElapsed: '0.123456789', pointsEarned: 10, totalScoreAfter: 30 }
    const input = { questionId: 'id', answerIndex: 1, timeElapsed: 0.123456789, isCorrect: false }
    expect(replayAnswer(stored, input)).toEqual({ pointsEarned: 10, totalScore: 30 })
    expect(() => replayAnswer(stored, { ...input, answerIndex: 2 })).toThrow(DomainError)
    expect(() => replayAnswer(stored, { ...input, timeElapsed: 1 })).toThrow(DomainError)
  })

  it('requires a retry to name the same player/pool and import content', () => {
    const stored = { userId: 'player', poolId: 'pool' }
    expect(() => verifyStartReplay(stored, stored)).not.toThrow()
    expect(() => verifyStartReplay(stored, { ...stored, poolId: 'another' })).toThrow(DomainError)
    expect(() => verifyStartReplay(stored, { ...stored, userId: 'another' })).toThrow(DomainError)
    expect(() => verifyImportReplay('hash', 'hash')).not.toThrow()
    expect(() => verifyImportReplay('hash', 'different')).toThrow(DomainError)
  })
})
