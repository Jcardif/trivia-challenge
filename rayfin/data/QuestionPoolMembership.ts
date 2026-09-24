import { authenticated, entity, one, text, uuid } from '@microsoft/rayfin-core'
import { Question } from './Question.js'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class QuestionPoolMembership {
  @uuid() id!: string
  @text({ max: 450, unique: true }) membershipKey!: string
  @uuid() question_id!: string
  @one(() => Question) question!: Question
  @text({ max: 400 }) poolSlug!: string
}
