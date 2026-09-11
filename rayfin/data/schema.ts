import type { GameSession } from './GameSession.js'
import type { GameSessionAnswer } from './GameSessionAnswer.js'
import type { Player } from './Player.js'
import type { Question } from './Question.js'
import type { QuestionImport } from './QuestionImport.js'
import type { QuestionPool } from './QuestionPool.js'
import type { QuestionPoolMembership } from './QuestionPoolMembership.js'
import type { SessionQuestion } from './SessionQuestion.js'

export { Player } from './Player.js'
export { QuestionPool } from './QuestionPool.js'
export { QuestionImport } from './QuestionImport.js'
export { Question } from './Question.js'
export { QuestionPoolMembership } from './QuestionPoolMembership.js'
export { GameSession } from './GameSession.js'
export { SessionQuestion } from './SessionQuestion.js'
export { GameSessionAnswer } from './GameSessionAnswer.js'

export type TriviaSchema = {
  Player: Player
  QuestionPool: QuestionPool
  QuestionImport: QuestionImport
  Question: Question
  QuestionPoolMembership: QuestionPoolMembership
  GameSession: GameSession
  SessionQuestion: SessionQuestion
  GameSessionAnswer: GameSessionAnswer
}
