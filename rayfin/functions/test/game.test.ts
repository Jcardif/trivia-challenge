import { describe, expect, it } from '@jest/globals'
import {
  applyAnswerRules, GAME_RULE_DEFAULTS, initialStats, replayAnswer, scoreAnswer, seededRandom,
  shuffle, shuffleChoices, summarizeAnswers, timeRemainingAfterAnswer, verifyEndCounters, verifyHeartsRemain,
  verifyImportReplay, verifyStartReplay,
} from '../src/game.js'
import { DomainError } from '../src/errors.js'

describe('game calculations', () => {
  it('keeps the executable defaults aligned with approved rules', () => {
    expect(GAME_RULE_DEFAULTS).toMatchObject({
      timer: {
        initialSeconds: 60,
        countdownSeconds: 3,
        bonusSeconds: 10,
        maxStreaks: 5,
        maxTotalSeconds: 120,
        wrongAnswerPauseSeconds: 5,
        wrongAnswerPenaltySeconds: 0.25,
      },
      feedback: { correctAnswerHaloMilliseconds: 500 },
      streak: { threshold: 5, decrementOnWrong: 1 },
      scoring: { pointsPerCorrectAnswer: 10 },
      hearts: { initialCount: 5, decrementOnWrong: 0.5, minimum: 0 },
      keyboard: { mappings: { A: 0, K: 1, S: 2, L: 3 } },
      questions: { answersPerQuestion: 4 },
    })
  })

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

  it('continues resetting streak progress after the final award without awarding another bonus', () => {
    const result = applyAnswerRules({
      totalScore: 250,
      questionsAnswered: 25,
      correctAnswers: 25,
      streaksCompleted: GAME_RULE_DEFAULTS.timer.maxStreaks,
      streakProgress: GAME_RULE_DEFAULTS.streak.threshold - 1,
      heartsHalfUnits: 10,
    }, true)

    expect(result).toMatchObject({
      pointsEarned: 10,
      awardedStreakLevel: null,
      streakProgressBeforeReset: null,
      stats: {
        totalScore: 260,
        questionsAnswered: 26,
        correctAnswers: 26,
        streaksCompleted: 5,
        streakProgress: 0,
        heartsHalfUnits: 10,
      },
    })
  })

  it('deducts the wrong-answer timer penalty without crossing zero', () => {
    expect(timeRemainingAfterAnswer(60, true)).toBe(60)
    expect(timeRemainingAfterAnswer(60, false)).toBe(59.75)
    expect(timeRemainingAfterAnswer(0.1, false)).toBe(0)
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

  it('rejects further answers once the saved hearts reach the minimum', () => {
    const lastHeart = summarizeAnswers(Array<boolean>(9).fill(false))
    expect(lastHeart.heartsHalfUnits).toBe(1)
    expect(() => verifyHeartsRemain(lastHeart)).not.toThrow()
    const depleted = scoreAnswer(lastHeart, false)
    expect(depleted.heartsHalfUnits).toBe(0)
    expect(() => verifyHeartsRemain(depleted)).toThrow(new DomainError('CONFLICT', 'Session has no hearts remaining.'))
    expect(() => verifyHeartsRemain(scoreAnswer(depleted, true))).toThrow('no hearts remaining')
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
