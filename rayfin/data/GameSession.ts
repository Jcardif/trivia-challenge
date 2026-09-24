import { authenticated, date, entity, int, one, text, uuid } from '@microsoft/rayfin-core'
import { Player } from './Player.js'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class GameSession {
  @uuid() id!: string
  @uuid() player_id!: string
  @one(() => Player) player!: Player
  @text({ max: 400 }) poolSlug!: string
  @int() seed!: number
  @text({ max: 16 }) status!: string
  @date() startTime!: Date
  @date({ optional: true }) endTime?: Date
  @int() totalScore!: number
  @int() questionsAnswered!: number
  @int() correctAnswers!: number
  @int() streaksCompleted!: number
  @int() streakProgress!: number
  @int() heartsHalfUnits!: number
  @text({ max: 64, optional: true }) finalTimeRemaining?: string
  @text({ max: 4000, optional: true }) gameOverReason?: string
}
