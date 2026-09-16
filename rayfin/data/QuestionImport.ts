import { authenticated, date, entity, int, text, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class QuestionImport {
  @uuid() id!: string
  @text({ max: 64 }) contentHash!: string
  @text({ max: 16 }) status!: string
  @int() acceptedCount!: number
  @date() createdAt!: Date
}
