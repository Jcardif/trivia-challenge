import { authenticated, date, entity, int, text, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class Player {
  @uuid() id!: string
  @text({ max: 4, unique: true }) playerCode!: string
  @text({ max: 96, unique: true }) name!: string
  @text({ max: 80 }) country!: string
  @text({ max: 160 }) runeHash!: string
  @int() runeVersion!: number
  @int() failedAttempts!: number
  @date() attemptWindowStartedAt!: Date
  @date() createdAt!: Date
}
