import { authenticated, boolean, date, entity, int, one, text, uuid } from '@microsoft/rayfin-core'
import { GameSession } from './GameSession.js'
import { SessionQuestion } from './SessionQuestion.js'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class GameSessionAnswer {
  @uuid() id!: string
  @text({ max: 73, unique: true }) submissionKey!: string
  @uuid() session_id!: string
  @one(() => GameSession) session!: GameSession
  @uuid() question_id!: string
  @one(() => SessionQuestion) question!: SessionQuestion
  @int() ordinal!: number
  @int() answerIndex!: number
  @boolean() isCorrect!: boolean
  @int() pointsEarned!: number
  @int() totalScoreAfter!: number
  // Preserve the submitted IEEE-754 value exactly for retry comparisons.
  @text({ max: 64 }) timeElapsed!: string
  @date() timestamp!: Date
}
