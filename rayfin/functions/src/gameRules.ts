export const GAME_RULE_DEFAULTS = {
  timer: {
    initialSeconds: 60,
    countdownSeconds: 3,
    bonusSeconds: 10,
    maxStreaks: 5,
    maxTotalSeconds: 120,
    wrongAnswerPauseSeconds: 5,
    wrongAnswerPenaltySeconds: 0.25,
    lowTimeThreshold: 5,
  },
  feedback: {
    correctAnswerHaloMilliseconds: 500,
  },
  streak: {
    threshold: 5,
    decrementOnWrong: 1,
    visualIndicators: 5,
  },
  scoring: {
    pointsPerCorrectAnswer: 10,
    difficulty: {
      easy: 10,
      medium: 10,
      hard: 10,
    },
  },
  hearts: {
    initialCount: 5,
    decrementOnWrong: 0.5,
    minimum: 0,
  },
  keyboard: {
    mappings: {
      A: 0,
      K: 1,
      S: 2,
      L: 3,
    },
  },
  questions: {
    answersPerQuestion: 4,
    difficultyLevels: ['easy', 'medium', 'hard'],
  },
} as const

export interface GameRuleSettings {
  timer: {
    maxStreaks: number
    wrongAnswerPenaltySeconds: number
  }
  streak: {
    threshold: number
    decrementOnWrong: number
  }
  scoring: {
    pointsPerCorrectAnswer: number
  }
  hearts: {
    initialCount: number
    decrementOnWrong: number
    minimum: number
  }
}

export interface GameStats {
  totalScore: number
  questionsAnswered: number
  correctAnswers: number
  streaksCompleted: number
  streakProgress: number
  heartsHalfUnits: number
}

export interface AppliedAnswerRules {
  stats: GameStats
  pointsEarned: number
  awardedStreakLevel: number | null
  streakProgressBeforeReset: number | null
  heartsRemaining: number
  heartsDepleted: boolean
}

export function heartsToHalfUnits(hearts: number): number {
  return Math.max(0, Math.round(hearts * 2))
}

export function halfUnitsToHearts(halfUnits: number): number {
  return Math.max(0, halfUnits) / 2
}

export function initialStats(settings: GameRuleSettings = GAME_RULE_DEFAULTS): GameStats {
  return {
    totalScore: 0,
    questionsAnswered: 0,
    correctAnswers: 0,
    streaksCompleted: 0,
    streakProgress: 0,
    heartsHalfUnits: heartsToHalfUnits(settings.hearts.initialCount),
  }
}

export function timeRemainingAfterAnswer(
  timeRemainingSeconds: number,
  correct: boolean,
  settings: GameRuleSettings = GAME_RULE_DEFAULTS,
): number {
  return correct
    ? timeRemainingSeconds
    : Math.max(0, timeRemainingSeconds - settings.timer.wrongAnswerPenaltySeconds)
}

export function applyAnswerRules(
  stats: GameStats,
  correct: boolean,
  settings: GameRuleSettings = GAME_RULE_DEFAULTS,
): AppliedAnswerRules {
  let streakProgress = correct
    ? stats.streakProgress + 1
    : Math.max(0, stats.streakProgress - settings.streak.decrementOnWrong)
  let streaksCompleted = stats.streaksCompleted
  let awardedStreakLevel: number | null = null
  let streakProgressBeforeReset: number | null = null

  if (correct && streakProgress >= settings.streak.threshold) {
    const nextCompletedTotal = Math.min(streaksCompleted + 1, settings.timer.maxStreaks)
    if (nextCompletedTotal > streaksCompleted) {
      awardedStreakLevel = nextCompletedTotal
      streakProgressBeforeReset = streakProgress
    }
    streaksCompleted = nextCompletedTotal
    streakProgress -= settings.streak.threshold
  }

  const pointsEarned = correct ? settings.scoring.pointsPerCorrectAnswer : 0
  const nextHeartsRemaining = correct
    ? halfUnitsToHearts(stats.heartsHalfUnits)
    : Math.max(
        settings.hearts.minimum,
        Math.round((halfUnitsToHearts(stats.heartsHalfUnits) - settings.hearts.decrementOnWrong) * 2) / 2,
      )
  const minimumHeartHalfUnits = heartsToHalfUnits(settings.hearts.minimum)
  const heartsHalfUnits = heartsToHalfUnits(nextHeartsRemaining)
  const nextStats = {
    totalScore: stats.totalScore + pointsEarned,
    questionsAnswered: stats.questionsAnswered + 1,
    correctAnswers: stats.correctAnswers + (correct ? 1 : 0),
    streaksCompleted,
    streakProgress,
    heartsHalfUnits,
  }
  const heartsRemaining = halfUnitsToHearts(heartsHalfUnits)

  return {
    stats: nextStats,
    pointsEarned,
    awardedStreakLevel,
    streakProgressBeforeReset,
    heartsRemaining,
    heartsDepleted: !correct && heartsHalfUnits <= minimumHeartHalfUnits,
  }
}

export function scoreAnswer(
  stats: GameStats,
  correct: boolean,
  settings: GameRuleSettings = GAME_RULE_DEFAULTS,
): GameStats {
  return applyAnswerRules(stats, correct, settings).stats
}

export function summarizeAnswers(
  correctness: readonly boolean[],
  settings: GameRuleSettings = GAME_RULE_DEFAULTS,
): GameStats {
  return correctness.reduce((stats, correct) => scoreAnswer(stats, correct, settings), initialStats(settings))
}

export function accuracyPercentage(correctAnswers: number, questionsAnswered: number): number {
  return questionsAnswered ? correctAnswers / questionsAnswered * 100 : 0
}
