import { authenticated, entity, int, one, text, uuid } from '@microsoft/rayfin-core'
import { GameSession } from './GameSession.js'
import { Question } from './Question.js'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class SessionQuestion {
  @uuid() id!: string
  @uuid() session_id!: string
  @one(() => GameSession) session!: GameSession
  @uuid() sourceQuestion_id!: string
  @one(() => Question) sourceQuestion!: Question
  @text({ max: 80, unique: true }) positionKey!: string
  @int() ordinal!: number
  @text({ max: 4000 }) category!: string
  @text({ max: 4000 }) questionText!: string
  @text({ max: 4000 }) choice1!: string
  @text({ max: 4000 }) choice2!: string
  @text({ max: 4000 }) choice3!: string
  @text({ max: 4000 }) choice4!: string
  @int() correctAnswerIndex!: number
  @text({ max: 4000, optional: true }) metadataRaw?: string
}
