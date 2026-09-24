import type { EndSessionRequest, SubmitAnswerRequest, SubmitAnswerResponse } from './contracts.js'
import { DomainError } from './errors.js'
import { GAME_RULE_DEFAULTS, heartsToHalfUnits, type GameRuleSettings, type GameStats } from './gameRules.js'

export {
  accuracyPercentage, applyAnswerRules, GAME_RULE_DEFAULTS, halfUnitsToHearts, heartsToHalfUnits,
  initialStats, scoreAnswer, summarizeAnswers, timeRemainingAfterAnswer, type AppliedAnswerRules,
  type GameRuleSettings, type GameStats,
} from './gameRules.js'

export function verifyEndCounters(input: EndSessionRequest, stats: GameStats, allowPending = true): void {
  if (allowPending && input.questionsAnswered > stats.questionsAnswered) {
    throw new DomainError('SESSION_NOT_READY', 'Some answers have not been saved. Retry after they are saved.', true)
  }
  if (input.questionsAnswered !== stats.questionsAnswered ||
      input.correctAnswers !== stats.correctAnswers ||
      input.streaksCompleted !== stats.streaksCompleted ||
      input.heartsRemaining * 2 !== stats.heartsHalfUnits) {
    throw new DomainError('CONFLICT', 'Completion counters do not match the saved answers.')
  }
}

export function verifyHeartsRemain(stats: GameStats, settings: GameRuleSettings = GAME_RULE_DEFAULTS): void {
  if (stats.heartsHalfUnits <= heartsToHalfUnits(settings.hearts.minimum)) {
    throw new DomainError('CONFLICT', 'Session has no hearts remaining.')
  }
}

export function verifyStartReplay(
  stored: { userId: string; poolId: string },
  requested: { userId: string; poolId: string },
): void {
  if (stored.userId !== requested.userId || stored.poolId !== requested.poolId) {
    throw new DomainError('CONFLICT', 'sessionId has already been used for a different player or pool.')
  }
}

export function verifyImportReplay(storedHash: string, requestedHash: string): void {
  if (storedHash !== requestedHash) {
    throw new DomainError('CONFLICT', 'importId has already been used for a different CSV file.')
  }
}

export function replayAnswer(
  stored: { answerIndex: number; timeElapsed: string; pointsEarned: number; totalScoreAfter: number },
  input: SubmitAnswerRequest,
): SubmitAnswerResponse {
  if (stored.answerIndex !== input.answerIndex || stored.timeElapsed !== String(input.timeElapsed)) {
    throw new DomainError('CONFLICT', 'This question already has a different saved answer.')
  }
  return { pointsEarned: stored.pointsEarned, totalScore: stored.totalScoreAfter }
}

export function seededRandom(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

export function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function shuffleChoices(
  answers: readonly [string, string, string, string],
  correctAnswerKey: number,
  random: () => number,
): { choices: [string, string, string, string]; correctAnswerIndex: number } {
  const positions = shuffle([0, 1, 2, 3], random)
  return {
    choices: [answers[positions[0]], answers[positions[1]], answers[positions[2]], answers[positions[3]]],
    correctAnswerIndex: positions.indexOf(correctAnswerKey),
  }
}
