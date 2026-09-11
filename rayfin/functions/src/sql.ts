import { AudienceType, type RayfinContext } from '@microsoft/fabric-user-data-functions'
import { Connection, Request, TYPES } from 'tedious'

export type SqlRow = Record<string, unknown>
type ParameterType = Parameters<Request['addParameter']>[1]
type ParameterOptions = Parameters<Request['addParameter']>[3]
export interface SqlValue {
  type: ParameterType
  value: string | number | boolean | Date | null
  options?: ParameterOptions
}
export type SqlParameters = Record<string, SqlValue>

export const id = (value: string): SqlValue => ({ type: TYPES.UniqueIdentifier, value })
export const str = (value: string | undefined, length = 4000): SqlValue =>
  ({ type: TYPES.NVarChar, value: value ?? null, options: { length } })
export const int = (value: number): SqlValue => ({ type: TYPES.Int, value })
export const bit = (value: boolean): SqlValue => ({ type: TYPES.Bit, value })
export const date = (value: Date): SqlValue => ({ type: TYPES.DateTime2, value, options: { scale: 3 } })

export class SqlSession {
  constructor(private readonly connection: Connection) {}

  query(sql: string, parameters: SqlParameters = {}): Promise<SqlRow[]> {
    return new Promise((resolve, reject) => {
      const rows: SqlRow[] = []
      const connectionError = (error: Error): void => reject(error)
      this.connection.once('error', connectionError)
      const request = new Request(sql, (error) => {
        this.connection.removeListener('error', connectionError)
        if (error) reject(error)
        else resolve(rows)
      })
      for (const [name, parameter] of Object.entries(parameters)) {
        request.addParameter(name, parameter.type, parameter.value, parameter.options)
      }
      request.on('row', (columns: Array<{ metadata: { colName: string }; value: unknown }>) => {
        const row: SqlRow = {}
        for (const column of columns) row[column.metadata.colName] = column.value
        rows.push(row)
      })
      this.connection.execSql(request)
    })
  }

  private transactionBoundary(method: 'beginTransaction' | 'commitTransaction' | 'rollbackTransaction'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection[method](error => { if (error) reject(error); else resolve() })
    })
  }

  async transaction<T>(action: (sql: SqlSession) => Promise<T>): Promise<T> {
    // execSql uses sp_executesql, which cannot carry an unbalanced transaction across requests.
    await new Promise<void>((resolve, reject) => {
      this.connection.execSqlBatch(new Request('SET XACT_ABORT ON; SET LOCK_TIMEOUT 60000;', error => {
        if (error) reject(error)
        else resolve()
      }))
    })
    await this.transactionBoundary('beginTransaction')
    try {
      const result = await action(this)
      await this.transactionBoundary('commitTransaction')
      return result
    } catch (error: unknown) {
      try {
        await this.transactionBoundary('rollbackTransaction')
      } catch {
        console.error('SQL rollback failed; closing the connection to discard uncommitted work.')
        this.connection.close()
      }
      throw error
    }
  }

  async insert(table: SqlTable, columns: readonly string[], rows: readonly SqlValue[][]): Promise<void> {
    for (const batch of insertBatches(table, columns, rows)) {
      await this.query(batch.sql, batch.parameters)
    }
  }
}

export type SqlTable = 'Players' | 'QuestionPools' | 'QuestionImports' | 'Questions' |
  'QuestionPoolMemberships' | 'GameSessions' | 'SessionQuestions' | 'GameSessionAnswers'

export function* insertBatches(
  table: SqlTable,
  columns: readonly string[],
  rows: readonly SqlValue[][],
): Generator<{ sql: string; parameters: SqlParameters }> {
  if (!columns.length || columns.length > 2000 || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
    throw new Error('Invalid SQL insert columns.')
  }
  const batchSize = Math.min(1000, Math.floor(2000 / columns.length))
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const parameters: SqlParameters = {}
    const tuples = rows.slice(offset, offset + batchSize).map((row, rowIndex) => {
      if (row.length !== columns.length) throw new Error('SQL insert row does not match its columns.')
      return `(${row.map((value, columnIndex) => {
        const name = `p${rowIndex}_${columnIndex}`
        parameters[name] = value
        return `@${name}`
      }).join(', ')})`
    })
    yield {
      sql: `INSERT INTO [dbo].[${table}] (${columns.map((column) => `[${column}]`).join(', ')}) VALUES ${tuples.join(', ')};`,
      parameters,
    }
  }
}

export async function withSql<T>(ctx: RayfinContext, action: (sql: SqlSession) => Promise<T>): Promise<T> {
  const server = ctx.getSecret('TRIVIA_SQL_SERVER')
  const database = ctx.getSecret('TRIVIA_SQL_DATABASE')
  if (!server || !database) throw new Error('Server-only SQL configuration is missing.')
  const connection = new Connection({
    server,
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: ctx.getToken(AudienceType.Sql) },
    },
    options: {
      database, port: 1433, encrypt: true, trustServerCertificate: false,
      connectTimeout: 60_000, requestTimeout: 60_000, useColumnNames: false, lowerCaseGuids: true,
    },
  })
  // The connection can fail between requests as well as during an active request.
  let connectionFailure: Error | undefined
  connection.on('error', (error) => { connectionFailure = error })
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error)
      connection.once('error', onError)
      connection.connect((error) => {
        connection.removeListener('error', onError)
        if (error) reject(error)
        else resolve()
      })
    })
    if (connectionFailure) throw connectionFailure
    return await action(new SqlSession(connection))
  } finally {
    connection.close()
  }
}

export function rowText(row: SqlRow, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') throw new Error(`Unexpected stored ${column} type.`)
  return value
}

export function rowUuid(row: SqlRow, column: string): string {
  return rowText(row, column).toLowerCase()
}

export function rowOptionalText(row: SqlRow, column: string): string | undefined {
  return row[column] === null ? undefined : rowText(row, column)
}

export function rowNumber(row: SqlRow, column: string): number {
  const value = row[column]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Unexpected stored ${column} type.`)
  return value
}

export function rowBoolean(row: SqlRow, column: string): boolean {
  const value = row[column]
  if (typeof value !== 'boolean') throw new Error(`Unexpected stored ${column} type.`)
  return value
}

export function rowDate(row: SqlRow, column: string): string {
  const value = row[column]
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error(`Unexpected stored ${column} type.`)
  return value.toISOString()
}
