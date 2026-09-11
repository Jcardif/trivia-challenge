import { authenticated, boolean, entity, int, text, uuid } from '@microsoft/rayfin-core'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class QuestionPool {
  @uuid() id!: string
  @text({ max: 400, unique: true }) slug!: string
  @text({ max: 4000 }) name!: string
  @text({ max: 4000 }) iconPath!: string
  @text({ max: 4000, optional: true }) description?: string
  @boolean() isActive!: boolean
  @int() displayOrder!: number
}
