import { authenticated, entity, int, one, text, uuid } from '@microsoft/rayfin-core'
import { QuestionImport } from './QuestionImport.js'

@entity()
@authenticated('read', { policy: (_claims, row) => row.id.neq(row.id) })
export class Question {
  @uuid() id!: string
  @uuid() import_id!: string
  @one(() => QuestionImport) import!: QuestionImport
  @int() ordinal!: number
  @text({ max: 4000 }) category!: string
  @text({ max: 4000 }) questionText!: string
  @text({ max: 4000 }) answer1!: string
  @text({ max: 4000 }) answer2!: string
  @text({ max: 4000 }) answer3!: string
  @text({ max: 4000 }) answer4!: string
  @int() correctAnswerKey!: number
  @text({ max: 4000, optional: true }) metadataRaw?: string
}
