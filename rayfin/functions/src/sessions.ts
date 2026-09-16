import { randomInt, randomUUID } from 'node:crypto'
import type { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type {
  EndSessionResponse, SessionQuestion, SessionQuestionsResponse, StartSessionResponse, SubmitAnswerResponse,
} from './contracts.js'
import { DomainError } from './errors.js'
import {
  accuracyPercentage, applyAnswerRules, initialStats, replayAnswer, seededRandom, shuffle, shuffleChoices,
  summarizeAnswers, verifyEndCounters, verifyStartReplay, type GameStats,
} from './game.js'
import {
  bit, date, id, int, rowBoolean, rowDate, rowNumber, rowOptionalText, rowText, rowUuid, str, withSql,
  type SqlRow, type SqlSession,
} from './sql.js'
import { answerInput, endInput, record, slug, uuid } from './validation.js'

function startDto(row: SqlRow): StartSessionResponse {
  const status = rowText(row, 'status')
  if (status !== 'active' && status !== 'completed' && status !== 'abandoned') {
    throw new Error('Unexpected stored session status.')
  }
  return {
    sessionId: rowUuid(row, 'id'),
    userId: rowUuid(row, 'player_id'),
    seed: rowNumber(row, 'seed'),
    poolId: rowText(row, 'poolSlug'),
    startTime: rowDate(row, 'startTime'),
    status,
  }
}

function sessionStats(row: SqlRow): GameStats {
  return {
    totalScore: rowNumber(row, 'totalScore'),
    questionsAnswered: rowNumber(row, 'questionsAnswered'),
    correctAnswers: rowNumber(row, 'correctAnswers'),
    streaksCompleted: rowNumber(row, 'streaksCompleted'),
    streakProgress: rowNumber(row, 'streakProgress'),
    heartsHalfUnits: rowNumber(row, 'heartsHalfUnits'),
  }
}

function endDto(sessionId: string, stats: GameStats, gameOverReason?: string): EndSessionResponse {
  return {
    sessionId,
    finalScore: stats.totalScore,
    questionsAnswered: stats.questionsAnswered,
    correctAnswers: stats.correctAnswers,
    accuracy: accuracyPercentage(stats.correctAnswers, stats.questionsAnswered),
    streaksCompleted: stats.streaksCompleted,
    heartsRemaining: stats.heartsHalfUnits / 2,
    gameOverReason,
  }
}

function questionDto(row: SqlRow): SessionQuestion {
  const metadataRaw = rowOptionalText(row, 'metadataRaw')
  return {
    questionId: rowUuid(row, 'id'),
    category: rowText(row, 'category'),
    questionText: rowText(row, 'questionText'),
    choices: [rowText(row, 'choice1'), rowText(row, 'choice2'), rowText(row, 'choice3'), rowText(row, 'choice4')],
    correctAnswerIndex: rowNumber(row, 'correctAnswerIndex'),
    ...(metadataRaw === undefined ? {} : { metadata: { raw: metadataRaw } }),
  }
}

async function lockedSession(sql: SqlSession, sessionId: string): Promise<SqlRow> {
  const [session] = await sql.query(
    'SELECT * FROM [dbo].[GameSessions] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = @id;',
    { id: id(sessionId) },
  )
  if (!session) throw new DomainError('NOT_FOUND', 'Session not found.')
  return session
}

async function saveStats(sql: SqlSession, sessionId: string, stats: GameStats): Promise<void> {
  await sql.query(`
    UPDATE [dbo].[GameSessions] SET [totalScore] = @score, [questionsAnswered] = @answered,
      [correctAnswers] = @correct, [streaksCompleted] = @streaks, [streakProgress] = @progress,
      [heartsHalfUnits] = @hearts
    WHERE [id] = @id;
  `, {
    id: id(sessionId), score: int(stats.totalScore), answered: int(stats.questionsAnswered),
    correct: int(stats.correctAnswers), streaks: int(stats.streaksCompleted),
    progress: int(stats.streakProgress), hearts: int(stats.heartsHalfUnits),
  })
}

export async function startSession(ctx: RayfinContext, value: unknown): Promise<StartSessionResponse> {
  const input = record(value)
  const sessionId = uuid(input.sessionId, 'sessionId')
  const userId = uuid(input.userId, 'userId')
  const poolId = slug(input.poolId, 'default')
  return withSql(ctx, (sql) => sql.transaction(async (transaction) => {
    const [existing] = await transaction.query(
      'SELECT * FROM [dbo].[GameSessions] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = @id;',
      { id: id(sessionId) },
    )
    if (existing) {
      const stored = startDto(existing)
      verifyStartReplay(stored, { userId, poolId })
      return stored
    }
    const [player] = await transaction.query('SELECT [id] FROM [dbo].[Players] WHERE [id] = @id;', { id: id(userId) })
    if (!player) throw new DomainError('NOT_FOUND', 'Player not found.')
    const questions = await transaction.query(`
      SELECT q.* FROM [dbo].[Questions] q
      INNER JOIN [dbo].[QuestionImports] i ON i.[id] = q.[import_id] AND i.[status] = N'completed'
      WHERE EXISTS (
        SELECT 1 FROM [dbo].[QuestionPoolMemberships] m
        WHERE m.[question_id] = q.[id] AND m.[poolSlug] = @pool
      )
      ORDER BY q.[id];
    `, { pool: str(poolId, 400) })
    if (!questions.length) throw new DomainError('EMPTY_POOL', 'No questions available in this pool.')
    const seed = randomInt(0, 2_147_483_647)
    const random = seededRandom(seed)
    const startTime = new Date()
    const stats = initialStats()
    await transaction.insert('GameSessions',
      ['id', 'player_id', 'poolSlug', 'seed', 'status', 'startTime', 'totalScore', 'questionsAnswered',
        'correctAnswers', 'streaksCompleted', 'streakProgress', 'heartsHalfUnits'],
      [[id(sessionId), id(userId), str(poolId, 400), int(seed), str('active', 16), date(startTime),
        int(stats.totalScore), int(stats.questionsAnswered), int(stats.correctAnswers),
        int(stats.streaksCompleted), int(stats.streakProgress), int(stats.heartsHalfUnits)]],
    )
    const snapshots = shuffle(questions, random).map((question, ordinal) => {
      const shuffled = shuffleChoices(
        [rowText(question, 'answer1'), rowText(question, 'answer2'), rowText(question, 'answer3'), rowText(question, 'answer4')],
        rowNumber(question, 'correctAnswerKey'), random,
      )
      return [
        id(randomUUID()), id(sessionId), id(rowUuid(question, 'id')), str(`${sessionId}:${ordinal}`, 80), int(ordinal),
        str(rowText(question, 'category')), str(rowText(question, 'questionText')),
        ...shuffled.choices.map((choice) => str(choice)),
        int(shuffled.correctAnswerIndex), str(rowOptionalText(question, 'metadataRaw')),
      ]
    })
    await transaction.insert('SessionQuestions',
      ['id', 'session_id', 'sourceQuestion_id', 'positionKey', 'ordinal', 'category', 'questionText',
        'choice1', 'choice2', 'choice3', 'choice4', 'correctAnswerIndex', 'metadataRaw'],
      snapshots,
    )
    const [created] = await transaction.query(
      'SELECT * FROM [dbo].[GameSessions] WHERE [id] = @id;',
      { id: id(sessionId) },
    )
    if (!created) throw new Error('Created session could not be read back.')
    return startDto(created)
  }))
}

export async function getSessionQuestions(ctx: RayfinContext, value: unknown): Promise<SessionQuestionsResponse> {
  const sessionId = uuid(record(value).sessionId, 'sessionId')
  return withSql(ctx, async (sql) => {
    const [session] = await sql.query('SELECT [id] FROM [dbo].[GameSessions] WHERE [id] = @id;', { id: id(sessionId) })
    if (!session) throw new DomainError('NOT_FOUND', 'Session not found.')
    const rows = await sql.query(
      'SELECT * FROM [dbo].[SessionQuestions] WHERE [session_id] = @id ORDER BY [ordinal], [id];',
      { id: id(sessionId) },
    )
    if (!rows.length) throw new Error('A persisted session is missing its question draw.')
    return { questions: rows.map(questionDto) }
  })
}

export async function submitAnswer(ctx: RayfinContext, value: unknown): Promise<SubmitAnswerResponse> {
  const input = answerInput(value)
  const submissionKey = `${input.sessionId}:${input.questionId}`
  return withSql(ctx, (sql) => sql.transaction(async (transaction) => {
    const session = await lockedSession(transaction, input.sessionId)
    const [existing] = await transaction.query(
      'SELECT * FROM [dbo].[GameSessionAnswers] WHERE [submissionKey] = @key;',
      { key: str(submissionKey, 73) },
    )
    if (existing) {
      return replayAnswer({
        answerIndex: rowNumber(existing, 'answerIndex'),
        timeElapsed: rowText(existing, 'timeElapsed'),
        pointsEarned: rowNumber(existing, 'pointsEarned'),
        totalScoreAfter: rowNumber(existing, 'totalScoreAfter'),
      }, input)
    }
    if (rowText(session, 'status') !== 'active') throw new DomainError('CONFLICT', 'Session is no longer active.')
    const [question] = await transaction.query(
      'SELECT [correctAnswerIndex] FROM [dbo].[SessionQuestions] WHERE [id] = @question AND [session_id] = @session;',
      { question: id(input.questionId), session: id(input.sessionId) },
    )
    if (!question) throw new DomainError('NOT_FOUND', 'Question not found in this session.')
    const correct = input.answerIndex === rowNumber(question, 'correctAnswerIndex')
    const result = applyAnswerRules(sessionStats(session), correct)
    const stats = result.stats
    const pointsEarned = result.pointsEarned
    await transaction.insert('GameSessionAnswers',
      ['id', 'submissionKey', 'session_id', 'question_id', 'ordinal', 'answerIndex', 'isCorrect',
        'pointsEarned', 'totalScoreAfter', 'timeElapsed', 'timestamp'],
      [[id(randomUUID()), str(submissionKey, 73), id(input.sessionId), id(input.questionId),
        int(stats.questionsAnswered - 1), int(input.answerIndex), bit(correct), int(pointsEarned),
        int(stats.totalScore), str(String(input.timeElapsed), 64), date(new Date())]],
    )
    await saveStats(transaction, input.sessionId, stats)
    return { pointsEarned, totalScore: stats.totalScore }
  }))
}

export async function endSession(ctx: RayfinContext, value: unknown): Promise<EndSessionResponse> {
  const input = endInput(value)
  return withSql(ctx, (sql) => sql.transaction(async (transaction) => {
    const session = await lockedSession(transaction, input.sessionId)
    const answers = await transaction.query(
      'SELECT [isCorrect] FROM [dbo].[GameSessionAnswers] WHERE [session_id] = @id ORDER BY [ordinal], [id];',
      { id: id(input.sessionId) },
    )
    const stats = summarizeAnswers(answers.map((answer) => rowBoolean(answer, 'isCorrect')))
    const status = rowText(session, 'status')
    verifyEndCounters(input, stats, status === 'active')
    if (status === 'completed') {
      const reason = rowOptionalText(session, 'gameOverReason')
      if (reason !== input.gameOverReason) throw new DomainError('CONFLICT', 'Session was completed with a different ending reason.')
      return endDto(input.sessionId, stats, reason)
    }
    if (status !== 'active') throw new DomainError('CONFLICT', 'Session is no longer active.')
    await saveStats(transaction, input.sessionId, stats)
    await transaction.query(`
      UPDATE [dbo].[GameSessions] SET [status] = N'completed', [endTime] = @end,
        [finalTimeRemaining] = @remaining, [gameOverReason] = @reason
      WHERE [id] = @id;
    `, {
      id: id(input.sessionId), end: date(new Date()), remaining: str(String(input.finalTimeRemaining), 64),
      reason: str(input.gameOverReason),
    })
    return endDto(input.sessionId, stats, input.gameOverReason)
  }))
}
