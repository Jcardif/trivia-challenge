import { authenticated, date, entity, text, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class Player {
  @uuid() id!: string
  @text({ max: 320, unique: true }) email!: string
  @text({ max: 4000 }) name!: string
  @text({ max: 4000, optional: true }) phoneNumber?: string
  @text({ max: 4000, optional: true }) country?: string
  @text({ max: 4000, optional: true }) state?: string
  @date() createdAt!: Date
}
