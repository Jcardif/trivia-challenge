import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { SqlParameters, SqlRow, SqlTable, SqlValue } from '../src/sql.js'

const realSql = await import('../src/sql.js')
const sessionId = 'cccccccc-0000-4000-8000-000000000001'
const questionId = 'dddddddd-0000-4000-8000-000000000001'
let session: SqlRow
let answers: SqlRow[]
const query = jest.fn(async (statement: string, parameters: SqlParameters = {}): Promise<SqlRow[]> => {
  if (statement.startsWith('SELECT * FROM [dbo].[GameSessions] WITH (UPDLOCK, HOLDLOCK)')) return [session]
  if (statement.includes('FROM [dbo].[GameSessionAnswers] WHERE [submissionKey]')) {
    return answers.filter(row => row.submissionKey === parameters.key.value)
  }
  if (statement.includes('FROM [dbo].[SessionQuestions]')) return [{ correctAnswerIndex: 2 }]
  if (statement.includes('UPDATE [dbo].[GameSessions]')) {
    session = { ...session, totalScore: parameters.score.value, heartsHalfUnits: parameters.hearts.value }
    return []
  }
  throw new Error(`Unexpected query: ${statement}`)
})
const insert = jest.fn(async (table: SqlTable, columns: readonly string[], rows: readonly SqlValue[][]) => {
  if (table !== 'GameSessionAnswers') throw new Error(`Unexpected insert: ${table}`)
  answers.push(...rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index].value]))))
})
const dataSession = { query, insert }
const transaction = jest.fn(async <T>(action: (sql: typeof dataSession) => Promise<T>): Promise<T> => action(dataSession))
jest.unstable_mockModule('../src/sql.js', () => ({
  ...realSql,
  withSql: async <T>(_ctx: RayfinContext, action: (sql: typeof dataSession & { transaction: typeof transaction }) => Promise<T>) =>
    action({ ...dataSession, transaction }),
}))
const { submitAnswer } = await import('../src/sessions.js')
const ctx = new RayfinContext({ rayFinEndpoint: 'https://example.invalid', publishableKey: 'pk-test', rayfinToken: '' })
const answer = { sessionId, questionId, answerIndex: 2, timeElapsed: 1.5, isCorrect: true }

beforeEach(() => {
  session = {
    id: sessionId, status: 'active', totalScore: 40, questionsAnswered: 14, correctAnswers: 4,
    streaksCompleted: 0, streakProgress: 0, heartsHalfUnits: 0,
  }
  answers = []
  query.mockClear()
  insert.mockClear()
})

describe('answer submission', () => {
  it('rejects a new answer after the saved hearts are depleted, without scoring it', async () => {
    await expect(submitAnswer(ctx, answer)).rejects.toMatchObject({ code: 'CONFLICT', message: 'Session has no hearts remaining.' })
    expect(insert).not.toHaveBeenCalled()
    expect(session.totalScore).toBe(40)
  })

  it('still replays the saved result of the answer that used the last heart', async () => {
    answers.push({
      submissionKey: `${sessionId}:${questionId}`, answerIndex: 1, timeElapsed: '1.5', pointsEarned: 0, totalScoreAfter: 40,
    })
    await expect(submitAnswer(ctx, { ...answer, answerIndex: 1, isCorrect: false }))
      .resolves.toEqual({ pointsEarned: 0, totalScore: 40 })
    expect(insert).not.toHaveBeenCalled()
  })

  it('scores answers while hearts remain', async () => {
    session.heartsHalfUnits = 1
    await expect(submitAnswer(ctx, answer)).resolves.toEqual({ pointsEarned: 10, totalScore: 50 })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(session.totalScore).toBe(50)
  })
})
