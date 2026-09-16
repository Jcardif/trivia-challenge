import { randomUUID } from 'node:crypto'
import type { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { ImportQuestionsPreview, ImportQuestionsResponse, QuestionPool } from './contracts.js'
import { importInput } from './csv.js'
import { DomainError } from './errors.js'
import { verifyImportReplay } from './game.js'
import {
  bit, date, id, int, rowBoolean, rowNumber, rowOptionalText, rowText, rowUuid, str, withSql,
  type SqlRow, type SqlValue, type SqlSession,
} from './sql.js'
import { boolean, invalid, poolInput, record, slug } from './validation.js'

function poolDto(row: SqlRow): QuestionPool {
  return {
    id: rowText(row, 'slug'),
    name: rowText(row, 'name'),
    iconPath: rowText(row, 'iconPath'),
    description: rowOptionalText(row, 'description'),
    isActive: rowBoolean(row, 'isActive'),
    displayOrder: rowNumber(row, 'displayOrder'),
  }
}

async function insertPool(sql: SqlSession, input: ReturnType<typeof poolInput>): Promise<QuestionPool> {
  await sql.insert('QuestionPools',
    ['id', 'slug', 'name', 'iconPath', 'description', 'isActive', 'displayOrder'],
    [[id(randomUUID()), str(input.slug, 400), str(input.name), str(input.iconPath),
      str(input.description), bit(input.isActive), int(input.displayOrder)]],
  )
  return {
    id: input.slug, name: input.name, iconPath: input.iconPath, description: input.description,
    isActive: input.isActive, displayOrder: input.displayOrder,
  }
}

export async function listPools(ctx: RayfinContext, value: unknown): Promise<QuestionPool[]> {
  record(value)
  return withSql(ctx, async (sql) => (await sql.query(
    'SELECT * FROM [dbo].[QuestionPools] WHERE [isActive] = 1 ORDER BY [displayOrder], [slug], [id];',
  )).map(poolDto))
}

export async function getPool(ctx: RayfinContext, value: unknown): Promise<QuestionPool> {
  const poolSlug = slug(record(value).slug)
  return withSql(ctx, async (sql) => {
    const [pool] = await sql.query('SELECT * FROM [dbo].[QuestionPools] WHERE [slug] = @slug;',
      { slug: str(poolSlug, 400) })
    if (!pool) throw new DomainError('NOT_FOUND', 'Question pool not found.')
    return poolDto(pool)
  })
}

export async function createPool(ctx: RayfinContext, value: unknown): Promise<QuestionPool> {
  const input = poolInput(value)
  return withSql(ctx, (sql) => sql.transaction(async (transaction) => {
    const [existing] = await transaction.query(
      'SELECT [id] FROM [dbo].[QuestionPools] WITH (UPDLOCK, HOLDLOCK) WHERE [slug] = @slug;',
      { slug: str(input.slug, 400) })
    if (existing) throw new DomainError('CONFLICT', 'A question pool with this slug already exists.')
    return insertPool(transaction, input)
  }))
}

export async function previewQuestionImport(ctx: RayfinContext, value: unknown): Promise<ImportQuestionsPreview> {
  const input = importInput(value)
  const counts = new Map<string, number>()
  for (const question of input.questions) {
    for (const poolSlug of question.pools) counts.set(poolSlug, (counts.get(poolSlug) ?? 0) + 1)
  }
  return withSql(ctx, async (sql) => {
    const pools = new Map((await sql.query('SELECT * FROM [dbo].[QuestionPools];'))
      .map(row => { const pool = poolDto(row); return [pool.id, pool] }))
    const [previous] = await sql.query(
      "SELECT COUNT(*) AS [count] FROM [dbo].[QuestionImports] WHERE [contentHash] = @hash AND [status] = N'completed' AND [id] <> @id;",
      { hash: str(input.contentHash, 64), id: id(input.importId) },
    )
    if (!previous) throw new Error('Import history query returned no count.')
    return {
      importId: input.importId,
      questionCount: input.questions.length,
      previousImportCount: rowNumber(previous, 'count'),
      pools: [...counts].sort(([left], [right]) => left.localeCompare(right)).map(([poolSlug, questionCount]) => ({
        slug: poolSlug, questionCount, existingPool: pools.get(poolSlug),
      })),
    }
  })
}

export async function importQuestions(ctx: RayfinContext, value: unknown): Promise<ImportQuestionsResponse> {
  const input = importInput(value)
  const options = record(value)
  const allowDuplicateContent = options.allowDuplicateContent === undefined
    ? false : boolean(options.allowDuplicateContent, 'allowDuplicateContent')
  if (options.poolsToCreate !== undefined && !Array.isArray(options.poolsToCreate)) {
    return invalid('poolsToCreate must be an array.')
  }
  const poolsToCreate = (options.poolsToCreate ?? []).map(poolInput)
    .sort((left, right) => left.slug.localeCompare(right.slug))
  const referencedPools = new Set(input.questions.flatMap(question => question.pools))
  if (new Set(poolsToCreate.map(pool => pool.slug)).size !== poolsToCreate.length ||
      poolsToCreate.some(pool => !referencedPools.has(pool.slug))) {
    return invalid('Each pool to create must have a distinct slug referenced in the CSV.')
  }
  return withSql(ctx, (sql) => sql.transaction(async (transaction) => {
    const [existing] = await transaction.query(
      'SELECT * FROM [dbo].[QuestionImports] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = @id;',
      { id: id(input.importId) },
    )
    if (existing) {
      verifyImportReplay(rowText(existing, 'contentHash'), input.contentHash)
      if (rowText(existing, 'status') !== 'completed') {
        throw new DomainError('IMPORT_NOT_READY', 'This import has not completed. Retry the same file and importId.', true)
      }
      const rows = await transaction.query(
        'SELECT [id] FROM [dbo].[Questions] WHERE [import_id] = @id ORDER BY [ordinal], [id];',
        { id: id(input.importId) },
      )
      const acceptedCount = rowNumber(existing, 'acceptedCount')
      if (rows.length !== acceptedCount) throw new Error('Stored import count does not match its questions.')
      return { importId: input.importId, acceptedCount, questionIds: rows.map((row) => rowUuid(row, 'id')) }
    }
    // The range lock closes the gap between previewing a file and another operator importing it.
    const duplicates = await transaction.query(
      "SELECT [id] FROM [dbo].[QuestionImports] WITH (UPDLOCK, HOLDLOCK) WHERE [contentHash] = @hash AND [status] = N'completed';",
      { hash: str(input.contentHash, 64) },
    )
    if (duplicates.length && !allowDuplicateContent) {
      throw new DomainError('DUPLICATE_IMPORT',
        'This file has already been imported. Review the import and explicitly confirm adding another copy.')
    }
    for (const pool of poolsToCreate) {
      const [existingPool] = await transaction.query(
        'SELECT [id] FROM [dbo].[QuestionPools] WITH (UPDLOCK, HOLDLOCK) WHERE [slug] = @slug;',
        { slug: str(pool.slug, 400) },
      )
      if (!existingPool) {
        await insertPool(transaction, pool)
      }
    }
    await transaction.insert('QuestionImports', ['id', 'contentHash', 'status', 'acceptedCount', 'createdAt'], [[
      id(input.importId), str(input.contentHash, 64), str('loading', 16), int(input.questions.length), date(new Date()),
    ]])
    const questionIds = input.questions.map(() => randomUUID())
    const questions: SqlValue[][] = input.questions.map((question, ordinal) => [
      id(questionIds[ordinal]), id(input.importId), int(ordinal), str(question.category),
      str(question.questionText), ...question.answers.map((answer) => str(answer)),
      int(question.correctAnswerKey), str(question.metadataRaw),
    ])
    await transaction.insert('Questions',
      ['id', 'import_id', 'ordinal', 'category', 'questionText',
        'answer1', 'answer2', 'answer3', 'answer4', 'correctAnswerKey', 'metadataRaw'],
      questions,
    )
    const memberships: SqlValue[][] = input.questions.flatMap((question, ordinal) => question.pools.map((poolSlug) => [
      id(randomUUID()), str(`${questionIds[ordinal]}:${poolSlug}`, 450), id(questionIds[ordinal]), str(poolSlug, 400),
    ]))
    await transaction.insert('QuestionPoolMemberships', ['id', 'membershipKey', 'question_id', 'poolSlug'], memberships)
    await transaction.query(
      "UPDATE [dbo].[QuestionImports] SET [status] = N'completed' WHERE [id] = @id;",
      { id: id(input.importId) },
    )
    return { importId: input.importId, acceptedCount: questionIds.length, questionIds }
  }))
}
