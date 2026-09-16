import { invokeOperation } from './rayfinClient'
import { gameConfig } from '../config/gameConfig'
import { ensureStationAccess } from '../lib/stationLockdown'
import { OperationError } from './operationError'
import type {
  GameSession, SessionQuestion, SubmitAnswerRequest, SubmitAnswerResponse,
  EndSessionRequest, EndSessionResponse, QuestionPool, CreatePoolInput,
  ImportQuestionsInput, ImportQuestionsResponse, ImportQuestionsPreview,
} from '../types/api'

export const sessionService = {
  async getPools(): Promise<QuestionPool[]> {
    ensureStationAccess()
    return invokeOperation('listPools', {})
  },

  async getPool(slug: string): Promise<QuestionPool> {
    ensureStationAccess()
    return invokeOperation('getPool', { slug })
  },

  async createPool(input: CreatePoolInput): Promise<QuestionPool> {
    ensureStationAccess()
    return invokeOperation('createPool', input)
  },

  async importQuestions(input: ImportQuestionsInput): Promise<ImportQuestionsResponse> {
    ensureStationAccess()
    return invokeOperation('importQuestions', input)
  },

  async previewQuestionImport(input: Pick<ImportQuestionsInput, 'importId' | 'csv'>): Promise<ImportQuestionsPreview> {
    ensureStationAccess()
    return invokeOperation('previewQuestionImport', input)
  },

  async start(sessionId: string, userId: string, poolId?: string): Promise<GameSession> {
    ensureStationAccess()
    const data = await invokeOperation('startSession', { sessionId, userId, ...(poolId ? { poolId } : {}) })
    if (data.sessionId !== sessionId || data.userId !== userId || (poolId && data.poolId !== poolId)) {
      throw new OperationError('The start response does not match this game.', 'SESSION_MISMATCH', false)
    }
    if (data.status !== 'active') {
      throw new OperationError('This game has already ended. Return to registration to begin a new game.', 'SESSION_ENDED', false)
    }
    return {
      ...data,
      totalScore: 0,
      questionsAnswered: 0,
      correctAnswers: 0,
      streaksCompleted: 0,
      heartsRemaining: gameConfig.hearts.initialCount,
      gameOverReason: null,
    }
  },

  async getQuestions(sessionId: string): Promise<SessionQuestion[]> {
    ensureStationAccess()
    return (await invokeOperation('getSessionQuestions', { sessionId })).questions
  },

  async submitAnswer(sessionId: string, input: SubmitAnswerRequest): Promise<SubmitAnswerResponse> {
    ensureStationAccess()
    return invokeOperation('submitAnswer', { sessionId, ...input })
  },

  async end(sessionId: string, input: EndSessionRequest): Promise<EndSessionResponse> {
    ensureStationAccess()
    return invokeOperation('endSession', { sessionId, ...input })
  },
}
