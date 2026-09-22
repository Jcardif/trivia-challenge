import { authenticated, date, entity, int, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class PlayerEntryState {
  @uuid() id!: string
  @date() windowStartedAt!: Date
  @int() attemptCount!: number
}
