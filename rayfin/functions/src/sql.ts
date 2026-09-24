import { ClientSecretCredential, type AccessToken, type GetTokenOptions, type TokenCredential } from '@azure/identity'
import type { RayfinContext } from '@microsoft/fabric-user-data-functions'
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
  private pendingRequests = 0
  private transactionOpen = false
  private discarded = false

  constructor(private readonly connection: Connection) {}

  /** True when no request or transaction is outstanding, so a pool may hand the connection to another invocation. */
  get reusable(): boolean {
    return !this.discarded && this.pendingRequests === 0 && !this.transactionOpen
  }

  query(sql: string, parameters: SqlParameters = {}): Promise<SqlRow[]> {
    return new Promise((resolve, reject) => {
      const rows: SqlRow[] = []
      const connectionError = (error: Error): void => reject(error)
      this.connection.once('error', connectionError)
      this.pendingRequests += 1
      const request = new Request(sql, (error) => {
        this.pendingRequests -= 1
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
      this.pendingRequests += 1
      this.connection[method](error => {
        this.pendingRequests -= 1
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async transaction<T>(action: (sql: SqlSession) => Promise<T>): Promise<T> {
    // execSql uses sp_executesql, which cannot carry an unbalanced transaction across requests.
    await new Promise<void>((resolve, reject) => {
      this.pendingRequests += 1
      this.connection.execSqlBatch(new Request('SET XACT_ABORT ON; SET LOCK_TIMEOUT 60000;', error => {
        this.pendingRequests -= 1
        if (error) reject(error)
        else resolve()
      }))
    })
    // Mark the transaction open before BEGIN so an ambiguous BEGIN failure never returns the connection to a pool.
    this.transactionOpen = true
    await this.transactionBoundary('beginTransaction')
    try {
      const result = await action(this)
      await this.transactionBoundary('commitTransaction')
      this.transactionOpen = false
      return result
    } catch (error: unknown) {
      try {
        await this.transactionBoundary('rollbackTransaction')
        this.transactionOpen = false
      } catch {
        console.error('SQL rollback failed; closing the connection to discard uncommitted work.')
        this.discarded = true
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

export type SqlTable = 'Players' | 'PlayerEntryStates' | 'QuestionPools' | 'QuestionImports' | 'Questions' |
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

// One current credential lets a warm worker reuse its in-memory Entra token when it opens SQL connections.
let currentSqlCredential: {
  tenantId: string
  clientId: string
  clientSecret: string
  credential: ClientSecretCredential
} | undefined

function sqlCredential(tenantId: string, clientId: string, clientSecret: string): ClientSecretCredential {
  const current = currentSqlCredential
  if (current?.tenantId === tenantId && current.clientId === clientId && current.clientSecret === clientSecret) {
    return current.credential
  }
  currentSqlCredential = undefined
  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret)
  currentSqlCredential = { tenantId, clientId, clientSecret, credential }
  return credential
}

// Limits for the per-worker pool. Connections retire well before their login token expires, because the
// application is responsible for not using pooled token-authenticated connections after the token expires.
export const SQL_POOL_LIMITS = {
  maxConnections: 10,
  acquireTimeoutMs: 60_000,
  idleTimeoutMs: 5 * 60_000,
  maxConnectionAgeMs: 30 * 60_000,
  tokenExpiryMarginMs: 5 * 60_000,
} as const

// Delegates to the shared credential and records the expiry of the token used for one connection's login.
export class LoginTokenCredential implements TokenCredential {
  expiresOnTimestamp: number | undefined

  constructor(readonly source: ClientSecretCredential) {}

  async getToken(scopes: string | string[], options?: GetTokenOptions): Promise<AccessToken | null> {
    const token = await this.source.getToken(scopes, options)
    this.expiresOnTimestamp = token?.expiresOnTimestamp
    return token
  }
}

interface PooledConnection {
  connection: Connection
  login: LoginTokenCredential
  createdAt: number
  failed: boolean
  closed: boolean
  idle: boolean
  idleTimer?: ReturnType<typeof setTimeout>
}

class SqlConnectionPool {
  private readonly idle: PooledConnection[] = []
  private readonly waiters: Array<() => void> = []
  private open = 0
  private retired = false

  constructor(readonly server: string, readonly database: string, readonly credential: ClientSecretCredential) {}

  async acquire(): Promise<PooledConnection> {
    const deadline = Date.now() + SQL_POOL_LIMITS.acquireTimeoutMs
    for (;;) {
      for (let entry = this.idle.pop(); entry; entry = this.idle.pop()) {
        this.leaveIdle(entry)
        if (!this.canReuse(entry)) {
          this.discard(entry)
          continue
        }
        try {
          // sp_reset_connection restores fresh-login session state and proves the connection still works.
          await new Promise<void>((resolve, reject) => {
            entry.connection.reset((error) => { if (error) reject(error); else resolve() })
          })
          if (!entry.failed) return entry
        } catch {
          entry.failed = true
        }
        this.discard(entry)
      }
      if (this.open < SQL_POOL_LIMITS.maxConnections) return this.create()
      await this.waitForCapacity(deadline)
    }
  }

  release(entry: PooledConnection, reusable: boolean): void {
    if (!reusable || this.retired || !this.canReuse(entry)) {
      this.discard(entry)
      return
    }
    entry.idle = true
    entry.idleTimer = setTimeout(() => {
      this.removeIdle(entry)
      this.discard(entry)
    }, SQL_POOL_LIMITS.idleTimeoutMs)
    entry.idleTimer.unref?.()
    this.idle.push(entry)
    this.wakeWaiter()
  }

  retire(): void {
    this.retired = true
    for (const entry of this.idle.splice(0)) {
      this.leaveIdle(entry)
      this.discard(entry)
    }
  }

  private async create(): Promise<PooledConnection> {
    this.open += 1
    const login = new LoginTokenCredential(this.credential)
    const connection = new Connection({
      server: this.server,
      authentication: { type: 'token-credential', options: { credential: login } },
      options: {
        database: this.database, port: 1433, encrypt: true, trustServerCertificate: false,
        connectTimeout: 60_000, requestTimeout: 60_000, useColumnNames: false, lowerCaseGuids: true,
      },
    })
    const entry: PooledConnection = { connection, login, createdAt: Date.now(), failed: false, closed: false, idle: false }
    // The connection can fail between requests as well as during an active request.
    let connectionFailure: Error | undefined
    const markFailed = (): void => {
      entry.failed = true
      if (entry.idle) {
        this.removeIdle(entry)
        this.discard(entry)
      }
    }
    connection.on('error', (error) => {
      connectionFailure = error
      markFailed()
    })
    connection.on('end', markFailed)
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
      return entry
    } catch (error: unknown) {
      // Fetch a fresh token after a failed login instead of retrying with the cached one.
      if (currentSqlCredential?.credential === this.credential) currentSqlCredential = undefined
      this.discard(entry)
      throw error
    }
  }

  private canReuse(entry: PooledConnection): boolean {
    const now = Date.now()
    const tokenExpiry = entry.login.expiresOnTimestamp
    return !entry.failed && !entry.closed && tokenExpiry !== undefined &&
      now < tokenExpiry - SQL_POOL_LIMITS.tokenExpiryMarginMs &&
      now - entry.createdAt < SQL_POOL_LIMITS.maxConnectionAgeMs
  }

  private removeIdle(entry: PooledConnection): void {
    const index = this.idle.indexOf(entry)
    if (index >= 0) this.idle.splice(index, 1)
    this.leaveIdle(entry)
  }

  private leaveIdle(entry: PooledConnection): void {
    entry.idle = false
    if (entry.idleTimer) clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }

  private discard(entry: PooledConnection): void {
    if (entry.closed) return
    entry.closed = true
    this.open -= 1
    entry.connection.close()
    this.wakeWaiter()
  }

  private wakeWaiter(): void {
    this.waiters.shift()?.()
  }

  private waitForCapacity(deadline: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter = (): void => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter)
        if (index >= 0) this.waiters.splice(index, 1)
        reject(new Error('Timed out waiting for a SQL connection.'))
      }, Math.max(0, deadline - Date.now()))
      this.waiters.push(waiter)
    })
  }
}

// One pool per warm worker, for the current server, database, and credential. A settings change retires it.
let currentSqlPool: SqlConnectionPool | undefined

function sqlPool(server: string, database: string, credential: ClientSecretCredential): SqlConnectionPool {
  const current = currentSqlPool
  if (current?.server === server && current.database === database && current.credential === credential) return current
  current?.retire()
  currentSqlPool = new SqlConnectionPool(server, database, credential)
  return currentSqlPool
}

/** Closes idle pooled connections now and in-use ones when their invocation finishes. */
export function closeSqlPool(): void {
  currentSqlPool?.retire()
  currentSqlPool = undefined
}

export async function withSql<T>(ctx: RayfinContext, action: (sql: SqlSession) => Promise<T>): Promise<T> {
  const server = ctx.getSecret('TRIVIA_SQL_SERVER')?.trim()
  const database = ctx.getSecret('TRIVIA_SQL_DATABASE')?.trim()
  const tenantId = ctx.getSecret('TRIVIA_SQL_TENANT_ID')?.trim()
  const clientId = ctx.getSecret('TRIVIA_SQL_CLIENT_ID')?.trim()
  const clientSecret = ctx.getSecret('TRIVIA_SQL_CLIENT_SECRET')
  if (!server || !database || !tenantId || !clientId || !clientSecret?.trim()) {
    currentSqlCredential = undefined
    closeSqlPool()
    throw new Error('Server-only SQL application-identity configuration is missing.')
  }
  const credential = sqlCredential(tenantId, clientId, clientSecret)
  const pool = sqlPool(server, database, credential)
  const entry = await pool.acquire()
  const session = new SqlSession(entry.connection)
  try {
    return await action(session)
  } finally {
    pool.release(entry, session.reusable)
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
