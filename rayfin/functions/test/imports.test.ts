import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { SqlParameters, SqlRow, SqlTable, SqlValue } from '../src/sql.js'

const realSql = await import('../src/sql.js')
let tables: Record<string, SqlRow[]> = {}
let failTable: string | undefined
const query = jest.fn(async (statement: string, parameters: SqlParameters = {}): Promise<SqlRow[]> => {
  if (statement.startsWith('UPDATE [dbo].[QuestionImports]')) {
    const entry = tables.QuestionImports.find(row => row.id === parameters.id.value)
    if (!entry) throw new Error('Import missing')
    entry.status = 'completed'
    return []
  }
  if (statement.includes('FROM [dbo].[QuestionPools]')) {
    return tables.QuestionPools.filter(row => !parameters.slug || row.slug === parameters.slug.value)
  }
  if (statement.includes('FROM [dbo].[QuestionImports]')) {
    const entries = tables.QuestionImports.filter(row => parameters.hash
      ? row.contentHash === parameters.hash.value && row.status === 'completed' &&
        (!parameters.id || row.id !== parameters.id.value)
      : row.id === parameters.id.value)
    return statement.includes('COUNT(*)') ? [{ count: entries.length }] : entries
  }
  if (statement.includes('FROM [dbo].[Questions]')) {
    return tables.Questions.filter(row => row.import_id === parameters.id.value)
  }
  throw new Error(`Unexpected query: ${statement}`)
})
const insert = jest.fn(async (table: SqlTable, columns: readonly string[], rows: readonly SqlValue[][]) => {
  if (table === failTable) throw new Error('Simulated database failure')
  tables[table].push(...rows.map(row => Object.fromEntries(columns.map((column, index) => [column, row[index].value]))))
})
const transaction = jest.fn(async <T>(action: (sql: typeof dataSession) => Promise<T>): Promise<T> => {
  const previous = structuredClone(tables)
  try {
    return await action(dataSession)
  } catch (error) {
    tables = previous
    throw error
  }
})
const dataSession = { query, insert }
jest.unstable_mockModule('../src/sql.js', () => ({
  ...realSql,
  withSql: async <T>(_ctx: RayfinContext, action: (sql: typeof dataSession & { transaction: typeof transaction }) => Promise<T>) =>
    action({ ...dataSession, transaction }),
}))
const { importQuestions, previewQuestionImport } = await import('../src/questions.js')
const ctx = new RayfinContext({ rayFinEndpoint: 'https://example.invalid', publishableKey: 'pk-test', rayfinToken: '' })
const importId = 'aaaaaaaa-0000-4000-8000-000000000001'
const nextId = 'aaaaaaaa-0000-4000-8000-000000000002'
const csv = 'Category,Question,Answer1,Answer2,Answer3,Answer4,CorrectAnswerKey,Pools\n' +
  'Fabric,First?,A,B,C,D,0,"fabric,sql,fabric"\nFabric,Second?,A,B,C,D,1,'
const makePool = (slug: string) => ({
  id: 'bbbbbbbb-0000-4000-8000-000000000001', slug, name: 'Existing pool',
  iconPath: '/pools/default.svg', description: null, isActive: false, displayOrder: 0,
})

beforeEach(() => {
  tables = { QuestionPools: [], QuestionImports: [], Questions: [], QuestionPoolMemberships: [] }
  failTable = undefined
  query.mockClear()
  insert.mockClear()
  transaction.mockClear()
})

describe('question import preview and persistence', () => {
  it('previews all destinations, including default and inactive pools, without writing', async () => {
    tables.QuestionPools.push(makePool('fabric'))
    const preview = await previewQuestionImport(ctx, { importId, csv })
    expect(preview).toEqual({
      importId, questionCount: 2, previousImportCount: 0,
      pools: [
        { slug: 'default', questionCount: 1, existingPool: undefined },
        { slug: 'fabric', questionCount: 1, existingPool: {
          id: 'fabric', name: 'Existing pool', iconPath: '/pools/default.svg',
          description: undefined, isActive: false, displayOrder: 0,
        } },
        { slug: 'sql', questionCount: 1, existingPool: undefined },
      ],
    })
    expect(insert).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
  })

  it('uses the strict CSV parser for previews before connecting to the database', async () => {
    await expect(previewQuestionImport(ctx, { importId, csv: csv.replace('0,', '1oops,') }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(query).not.toHaveBeenCalled()
  })

  it('creates only explicitly requested pools and commits them with the questions', async () => {
    const result = await importQuestions(ctx, {
      importId, csv, poolsToCreate: [{ slug: 'SQL', name: 'SQL questions', iconPath: '/pools/default.svg' }],
    })
    expect(result.acceptedCount).toBe(2)
    expect(tables.QuestionPools).toEqual([expect.objectContaining({ slug: 'sql', name: 'SQL questions' })])
    expect(tables.Questions).toHaveLength(2)
    expect(tables.QuestionPoolMemberships).toHaveLength(3)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(query.mock.calls.some(([statement]) =>
      statement.includes('[contentHash] = @hash') && statement.includes('UPDLOCK, HOLDLOCK'))).toBe(true)
  })

  it('does not overwrite a pool created by another operator after the preview', async () => {
    tables.QuestionPools.push(makePool('sql'))
    await importQuestions(ctx, { importId, csv, poolsToCreate: [{ slug: 'sql', name: 'New name' }] })
    expect(tables.QuestionPools).toEqual([makePool('sql')])
  })

  it('rolls back newly created pools if saving questions or memberships fails', async () => {
    for (const table of ['Questions', 'QuestionPoolMemberships']) {
      failTable = table
      await expect(importQuestions(ctx, {
        importId, csv, poolsToCreate: [{ slug: 'sql', name: 'SQL' }],
      })).rejects.toThrow('Simulated database failure')
      expect(Object.values(tables).every(rows => rows.length === 0)).toBe(true)
    }
  })

  it('rejects unrelated or repeated pool creations and non-boolean confirmation before writing', async () => {
    for (const poolsToCreate of [
      [{ slug: 'unrelated', name: 'Unrelated' }],
      [{ slug: 'sql', name: 'SQL' }, { slug: 'SQL', name: 'Again' }],
      'sql',
    ]) {
      await expect(importQuestions(ctx, { importId, csv, poolsToCreate }))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    await expect(importQuestions(ctx, { importId, csv, allowDuplicateContent: 'yes' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(transaction).not.toHaveBeenCalled()
  })

  it('requires confirmation for another copy but replays the same import without confirmation', async () => {
    const original = await importQuestions(ctx, { importId, csv })
    expect(await importQuestions(ctx, { importId, csv })).toEqual(original)
    const preview = await previewQuestionImport(ctx, { importId: nextId, csv })
    expect(preview.previousImportCount).toBe(1)
    expect((await previewQuestionImport(ctx, { importId, csv })).previousImportCount).toBe(0)
    await expect(importQuestions(ctx, { importId: nextId, csv })).rejects.toMatchObject({ code: 'DUPLICATE_IMPORT' })
    expect(tables.Questions).toHaveLength(2)
    const additive = await importQuestions(ctx, { importId: nextId, csv, allowDuplicateContent: true })
    expect(additive.questionIds.some(id => original.questionIds.includes(id))).toBe(false)
    expect(tables.Questions).toHaveLength(4)
    expect(await importQuestions(ctx, { importId: nextId, csv })).toEqual(additive)
    await expect(importQuestions(ctx, { importId, csv: csv + '\n' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})
