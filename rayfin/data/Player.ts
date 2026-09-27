import { authenticated, date, entity, int, text, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class Player {
  @uuid() id!: string
  @text({ max: 96, unique: true }) name!: string
  @text({ max: 80 }) country!: string
  // Players created before passwords replaced return codes have no verifier and cannot sign in.
  @text({ max: 160, optional: true }) passwordHash?: string
  @int() failedAttempts!: number
  @date() attemptWindowStartedAt!: Date
  @date() createdAt!: Date
}
