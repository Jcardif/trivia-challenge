import type { EndSessionRequest, SubmitAnswerRequest, SubmitAnswerResponse } from './contracts.js'
import { DomainError } from './errors.js'

export interface GameStats {
  totalScore: number
  questionsAnswered: number
  correctAnswers: number
  streaksCompleted: number
  streakProgress: number
  heartsHalfUnits: number
}

export function initialStats(): GameStats {
  return {
    totalScore: 0, questionsAnswered: 0, correctAnswers: 0,
    streaksCompleted: 0, streakProgress: 0, heartsHalfUnits: 10,
  }
}

export function scoreAnswer(stats: GameStats, correct: boolean): GameStats {
  let progress = correct ? stats.streakProgress + 1 : Math.max(0, stats.streakProgress - 1)
  let completed = stats.streaksCompleted
  if (progress >= 5) {
    completed = Math.min(5, completed + 1)
    progress -= 5
  }
  return {
    totalScore: stats.totalScore + (correct ? 10 : 0),
    questionsAnswered: stats.questionsAnswered + 1,
    correctAnswers: stats.correctAnswers + (correct ? 1 : 0),
    streaksCompleted: completed,
    streakProgress: progress,
    heartsHalfUnits: Math.max(0, stats.heartsHalfUnits - (correct ? 0 : 1)),
  }
}

export function summarizeAnswers(correctness: readonly boolean[]): GameStats {
  return correctness.reduce(scoreAnswer, initialStats())
}

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
