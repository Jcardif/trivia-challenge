import { describe, expect, it } from '@jest/globals'
import {
  applyAnswerRules,
  GAME_RULE_DEFAULTS,
  initialStats,
  timeRemainingAfterAnswer,
} from '../../rayfin/functions/src/gameRules'
import { gameConfig } from './gameConfig'

describe('frontend shared game rules', () => {
  it('uses the shared executable defaults for browser rule configuration', () => {
    expect(gameConfig.timer.initialSeconds).toBe(GAME_RULE_DEFAULTS.timer.initialSeconds)
    expect(gameConfig.timer.countdownSeconds).toBe(GAME_RULE_DEFAULTS.timer.countdownSeconds)
    expect(gameConfig.timer.bonusSeconds).toBe(GAME_RULE_DEFAULTS.timer.bonusSeconds)
    expect(gameConfig.timer.maxStreaks).toBe(GAME_RULE_DEFAULTS.timer.maxStreaks)
    expect(gameConfig.timer.maxTotalSeconds).toBe(GAME_RULE_DEFAULTS.timer.maxTotalSeconds)
    expect(gameConfig.timer.wrongAnswerPauseSeconds).toBe(GAME_RULE_DEFAULTS.timer.wrongAnswerPauseSeconds)
    expect(gameConfig.timer.wrongAnswerPenaltySeconds).toBe(GAME_RULE_DEFAULTS.timer.wrongAnswerPenaltySeconds)
    expect(gameConfig.feedback.correctAnswerHaloMilliseconds)
      .toBe(GAME_RULE_DEFAULTS.feedback.correctAnswerHaloMilliseconds)
    expect(gameConfig.keyboard.mappings).toEqual({ A: 0, K: 1, S: 2, L: 3 })
    expect(gameConfig.questions.answersPerQuestion).toBe(4)
  })

  it('calculates frontend answer progress without React or browser state', () => {
    let result = applyAnswerRules(initialStats(gameConfig), true, gameConfig)
    for (let answer = 2; answer <= gameConfig.streak.threshold; answer += 1) {
      result = applyAnswerRules(result.stats, true, gameConfig)
    }

    expect(result).toMatchObject({
      pointsEarned: 10,
      awardedStreakLevel: 1,
      streakProgressBeforeReset: 5,
      heartsRemaining: 5,
      heartsDepleted: false,
      stats: {
        totalScore: 50,
        questionsAnswered: 5,
        correctAnswers: 5,
        streaksCompleted: 1,
        streakProgress: 0,
        heartsHalfUnits: 10,
      },
    })
  })

  it('applies the configured wrong-answer floors and penalties', () => {
    const result = applyAnswerRules({
      ...initialStats(gameConfig),
      streakProgress: 2,
      heartsHalfUnits: 1,
    }, false, gameConfig)

    expect(result.stats.streakProgress).toBe(1)
    expect(result.heartsRemaining).toBe(0)
    expect(result.heartsDepleted).toBe(true)
    expect(timeRemainingAfterAnswer(0.1, false, gameConfig)).toBe(0)
    expect(timeRemainingAfterAnswer(60, false, gameConfig)).toBe(59.75)
  })
})
