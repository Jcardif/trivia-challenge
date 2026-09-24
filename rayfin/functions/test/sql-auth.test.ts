import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ClientSecretCredential, type AccessToken } from '@azure/identity'
import { RayfinContext } from '@microsoft/fabric-user-data-functions'
import { Connection } from 'tedious'

const constructed: Array<{ args: unknown[]; credential: ClientSecretCredential }> = []
class RecordingCredential extends ClientSecretCredential {
  constructor(...args: ConstructorParameters<typeof ClientSecretCredential>) {
    super(...args)
    constructed.push({ args, credential: this })
  }
}
jest.unstable_mockModule('@azure/identity', () => ({ ClientSecretCredential: RecordingCredential }))
const { closeSqlPool, LoginTokenCredential, SQL_POOL_LIMITS, withSql } = await import('../src/sql.js')

const missingConfiguration = 'Server-only SQL application-identity configuration is missing.'
const secrets = {
  TRIVIA_SQL_SERVER: 'example.database.fabric.microsoft.com',
  TRIVIA_SQL_DATABASE: 'trivia',
  TRIVIA_SQL_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  TRIVIA_SQL_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  TRIVIA_SQL_CLIENT_SECRET: 'test-only-client-secret',
}
type Secrets = Record<string, string>

// A unique secret keeps each test independent of the credential cached by earlier tests.
let generation = 0
function freshSecrets(): Secrets {
  generation += 1
  return { ...secrets, TRIVIA_SQL_CLIENT_SECRET: `test-only-client-secret-${generation}` }
}

function credentialArguments(values: Secrets): unknown[] {
  return [values.TRIVIA_SQL_TENANT_ID, values.TRIVIA_SQL_CLIENT_ID, values.TRIVIA_SQL_CLIENT_SECRET]
}

function context(values: Secrets = secrets) {
  const ctx = new RayfinContext({
    rayFinEndpoint: 'https://example.invalid',
    publishableKey: 'pk-test',
    rayfinToken: '',
  }, {}, values)
  jest.spyOn(ctx, 'getToken').mockImplementation(() => {
    throw new Error('SQL must not request an operator SSO token.')
  })
  return ctx
}

const sqlScope = 'https://database.windows.net/.default'
const minute = 60_000

function loginTokenOf(connection: Connection) {
  const { authentication } = connection.config
  if (authentication.type !== 'token-credential') throw new Error(`Unexpected ${authentication.type} SQL authentication.`)
  const { credential } = authentication.options
  if (!(credential instanceof LoginTokenCredential)) throw new Error('Expected a login token recorder.')
  return credential
}

function credentialOf(connection: Connection) {
  return loginTokenOf(connection).source
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

const settle = () => new Promise(resolve => setImmediate(resolve))
const opened: Connection[] = []
const closed: Connection[] = []
const resets: Connection[] = []
let tokenLifetimeMs = 60 * minute

beforeEach(() => {
  constructed.length = 0
  opened.length = 0
  closed.length = 0
  resets.length = 0
  tokenLifetimeMs = 60 * minute
  // Stand-in tokens keep tests offline; the login flow still requests them through the shared credential.
  jest.spyOn(ClientSecretCredential.prototype, 'getToken').mockImplementation(async (): Promise<AccessToken> => ({
    token: 'test-only-token', expiresOnTimestamp: Date.now() + tokenLifetimeMs,
  }))
  jest.spyOn(Connection.prototype, 'connect').mockImplementation(function (this: Connection, callback) {
    opened.push(this)
    loginTokenOf(this).getToken(sqlScope).then(() => callback?.(), (error: Error) => callback?.(error))
  })
  jest.spyOn(Connection.prototype, 'reset').mockImplementation(function (this: Connection, callback) {
    resets.push(this)
    callback(undefined)
  })
  jest.spyOn(Connection.prototype, 'close').mockImplementation(function (this: Connection) {
    closed.push(this)
  })
})
afterEach(() => {
  closeSqlPool()
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('application identity SQL authentication', () => {
  it('uses only server-side application credentials, without a delegated SQL token', async () => {
    const values = freshSecrets()
    const ctx = context(values)
    await expect(withSql(ctx, async () => 42)).resolves.toBe(42)
    expect(ctx.getToken).not.toHaveBeenCalled()
    expect(constructed.map(({ args }) => args)).toEqual([credentialArguments(values)])
    expect(constructed[0].credential).toBeInstanceOf(ClientSecretCredential)
    expect(opened).toHaveLength(1)
    expect(opened[0].config.authentication.type).toBe('token-credential')
    expect(Object.keys(opened[0].config.authentication.options)).toEqual(['credential'])
    expect(credentialOf(opened[0])).toBe(constructed[0].credential)
    expect(opened[0].config.options).toMatchObject({
      database: 'trivia',
      encrypt: true,
      trustServerCertificate: false,
      connectTimeout: 60_000,
      requestTimeout: 60_000,
    })
    expect(jest.mocked(ClientSecretCredential.prototype.getToken).mock.calls.map(([scope]) => scope)).toEqual([sqlScope])
    expect(jest.mocked(ClientSecretCredential.prototype.getToken).mock.contexts).toEqual([constructed[0].credential])
    expect(closed).toEqual([])
  })

  it('reuses one credential across servers and one pooled connection per server and database', async () => {
    const values = freshSecrets()
    await withSql(context(values), async () => 1)
    await withSql(context(values), async () => 2)
    expect(opened).toHaveLength(1)
    expect(resets).toEqual([opened[0]])
    await withSql(context({ ...values, TRIVIA_SQL_SERVER: 'other.database.fabric.microsoft.com', TRIVIA_SQL_DATABASE: 'other' }), async () => 3)
    expect(opened).toHaveLength(2)
    expect(closed).toEqual([opened[0]])
    await Promise.all([withSql(context(values), async () => 4), withSql(context(values), async () => 5)])
    expect(opened).toHaveLength(4)
    expect(new Set(opened).size).toBe(4)
    expect(closed).toEqual([opened[0], opened[1]])
    expect(constructed).toHaveLength(1)
    for (const connection of opened) expect(credentialOf(connection)).toBe(constructed[0].credential)
  })

  it.each([
    ['TRIVIA_SQL_TENANT_ID', '33333333-3333-4333-8333-333333333333'],
    ['TRIVIA_SQL_CLIENT_ID', '44444444-4444-4444-8444-444444444444'],
    ['TRIVIA_SQL_CLIENT_SECRET', 'rotated-test-only-client-secret'],
  ])('replaces the credential when %s changes, without keeping the previous one', async (key, replacement) => {
    const values = freshSecrets()
    const changed = { ...values, [key]: replacement }
    await withSql(context(values), async () => 1)
    await withSql(context(changed), async () => 2)
    await withSql(context(values), async () => 3)
    expect(constructed.map(({ args }) => args))
      .toEqual([credentialArguments(values), credentialArguments(changed), credentialArguments(values)])
    expect(new Set(constructed.map(({ credential }) => credential)).size).toBe(3)
    opened.forEach((connection, index) => expect(credentialOf(connection)).toBe(constructed[index].credential))
    expect(closed).toEqual([opened[0], opened[1]])
  })

  it('passes the full unmodified secret to the credential', async () => {
    const values = { ...freshSecrets(), TRIVIA_SQL_CLIENT_SECRET: `  padded-${generation}~secret  ` }
    await withSql(context(values), async () => 1)
    expect(constructed.map(({ args }) => args)).toEqual([credentialArguments(values)])
  })

  it('gives concurrent invocations with old and new settings their own matching credential', async () => {
    const first = freshSecrets()
    const second = freshSecrets()
    const calls = [first, second, first, second].map((values, index) => ({
      values: { ...values, TRIVIA_SQL_DATABASE: `trivia-${index}` },
    }))
    await Promise.all(calls.map(({ values }) => withSql(context(values), async () => 1)))
    expect(opened).toHaveLength(4)
    for (const connection of opened) {
      const call = calls.find(({ values }) => values.TRIVIA_SQL_DATABASE === connection.config.options.database)
      const entry = constructed.find(({ credential }) => credential === credentialOf(connection))
      expect(entry?.args).toEqual(credentialArguments(call!.values))
    }
  })

  it('does not let a failed login with replaced settings evict the newer credential', async () => {
    const previous = freshSecrets()
    const current = freshSecrets()
    const failure = new Error('SQL authentication failed.')
    let failLogin: (() => void) | undefined
    jest.mocked(Connection.prototype.connect).mockImplementationOnce(function (this: Connection, callback) {
      opened.push(this)
      failLogin = () => callback?.(failure)
    })
    const stalled = withSql(context(previous), async () => 1)
    await withSql(context(current), async () => 2)
    failLogin?.()
    await expect(stalled).rejects.toBe(failure)
    await withSql(context(current), async () => 3)
    expect(constructed.map(({ args }) => args))
      .toEqual([credentialArguments(previous), credentialArguments(current)])
    expect(opened).toHaveLength(2)
    expect(credentialOf(opened[1])).toBe(constructed[1].credential)
    expect(resets).toEqual([opened[1]])
    expect(closed).toEqual([opened[0]])
  })

  it.each(Object.keys(secrets))('rejects missing %s before connecting, without an SSO fallback', async key => {
    const values: Secrets = { ...secrets }
    delete values[key]
    const ctx = context(values)
    const action = jest.fn(async () => 42)
    await expect(withSql(ctx, action)).rejects.toThrow(missingConfiguration)
    expect(ctx.getToken).not.toHaveBeenCalled()
    expect(Connection.prototype.connect).not.toHaveBeenCalled()
    expect(constructed).toHaveLength(0)
    expect(action).not.toHaveBeenCalled()
  })

  it.each(Object.keys(secrets).flatMap(key => [[key, 'missing'], [key, 'blank']]))(
    'rejects %s when %s after a credential is cached, then builds a fresh credential',
    async (key, state) => {
      const values = freshSecrets()
      await withSql(context(values), async () => 1)
      const invalid: Secrets = { ...values }
      if (state === 'missing') delete invalid[key]
      else invalid[key] = ' '
      const ctx = context(invalid)
      const action = jest.fn(async () => 2)
      await expect(withSql(ctx, action)).rejects.toThrow(missingConfiguration)
      expect(ctx.getToken).not.toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
      expect(opened).toHaveLength(1)
      expect(closed).toEqual([opened[0]])
      expect(constructed).toHaveLength(1)
      await expect(withSql(context(values), async () => 3)).resolves.toBe(3)
      expect(constructed.map(({ args }) => args)).toEqual([credentialArguments(values), credentialArguments(values)])
      expect(constructed[1].credential).not.toBe(constructed[0].credential)
      expect(credentialOf(opened[1])).toBe(constructed[1].credential)
    },
  )

  it('rejects blank credentials without including the supplied secret in the error', async () => {
    await expect(withSql(context({ ...secrets, TRIVIA_SQL_CLIENT_SECRET: ' ' }), async () => 42))
      .rejects.toThrow(missingConfiguration)
    expect(Connection.prototype.connect).not.toHaveBeenCalled()
  })

  it.each(['the connect callback', 'an error event'])(
    'closes the connection when login fails through %s and uses a fresh credential next time',
    async mode => {
      const values = freshSecrets()
      const failure = new Error('SQL authentication failed.')
      jest.mocked(Connection.prototype.connect).mockImplementationOnce(function (this: Connection, callback) {
        opened.push(this)
        if (mode === 'the connect callback') callback?.(failure)
        else this.emit('error', failure)
      })
      const action = jest.fn(async () => 42)
      await expect(withSql(context(values), action)).rejects.toBe(failure)
      expect(action).not.toHaveBeenCalled()
      expect(closed).toEqual([opened[0]])
      await expect(withSql(context(values), async () => 43)).resolves.toBe(43)
      expect(constructed).toHaveLength(2)
      expect(credentialOf(opened[1])).toBe(constructed[1].credential)
      expect(constructed[1].credential).not.toBe(constructed[0].credential)
    },
  )

  it('preserves an operation failure and keeps the idle connection and credential', async () => {
    const values = freshSecrets()
    const failure = new Error('Operation failed.')
    await expect(withSql(context(values), async () => { throw failure })).rejects.toBe(failure)
    await expect(withSql(context(values), async () => 1)).resolves.toBe(1)
    expect(constructed).toHaveLength(1)
    expect(opened).toHaveLength(1)
    expect(resets).toEqual([opened[0]])
    expect(closed).toEqual([])
  })
})

describe('per-worker SQL connection pool', () => {
  it('bounds open connections and hands a released connection to a queued invocation', async () => {
    const values = freshSecrets()
    const gate = deferred()
    const invocations = SQL_POOL_LIMITS.maxConnections + 1
    const running = Array.from({ length: invocations }, (_, index) =>
      withSql(context(values), async () => { await gate.promise; return index }))
    await settle()
    expect(opened).toHaveLength(SQL_POOL_LIMITS.maxConnections)
    gate.resolve()
    await expect(Promise.all(running)).resolves.toEqual([...Array(invocations).keys()])
    expect(opened).toHaveLength(SQL_POOL_LIMITS.maxConnections)
    expect(resets).toHaveLength(1)
    expect(closed).toEqual([])
  })

  it('times out a queued invocation when every connection stays busy', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    const values = freshSecrets()
    const gate = deferred()
    const running = Array.from({ length: SQL_POOL_LIMITS.maxConnections }, () =>
      withSql(context(values), () => gate.promise))
    const action = jest.fn(async () => 1)
    const queued = withSql(context(values), action)
    await settle()
    jest.advanceTimersByTime(SQL_POOL_LIMITS.acquireTimeoutMs)
    await expect(queued).rejects.toThrow('Timed out waiting for a SQL connection.')
    expect(action).not.toHaveBeenCalled()
    gate.resolve()
    await Promise.all(running)
  })

  it('closes a connection that stays idle for the idle timeout', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    const values = freshSecrets()
    await withSql(context(values), async () => 1)
    jest.advanceTimersByTime(SQL_POOL_LIMITS.idleTimeoutMs - 1)
    expect(closed).toEqual([])
    jest.advanceTimersByTime(1)
    expect(closed).toEqual([opened[0]])
    await withSql(context(values), async () => 2)
    expect(opened).toHaveLength(2)
  })

  it.each([
    ['its login token nears expiry', 20 * minute, 16 * minute],
    ['it reaches the maximum connection age', 2 * 60 * minute, 32 * minute],
  ])('stops reusing a busy connection once %s', async (_reason, lifetime, retiredBy) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    tokenLifetimeMs = lifetime
    const values = freshSecrets()
    await withSql(context(values), async () => 1)
    for (let elapsed = 4 * minute; elapsed < retiredBy; elapsed += 4 * minute) {
      jest.advanceTimersByTime(4 * minute)
      await withSql(context(values), async () => 1)
    }
    expect(opened).toHaveLength(1)
    jest.advanceTimersByTime(4 * minute)
    await withSql(context(values), async () => 1)
    expect(opened).toHaveLength(2)
    expect(closed).toEqual([opened[0]])
  })

  it('closes a connection immediately when its login token is already inside the expiry margin', async () => {
    tokenLifetimeMs = SQL_POOL_LIMITS.tokenExpiryMarginMs
    await withSql(context(freshSecrets()), async () => 1)
    expect(closed).toEqual([opened[0]])
  })

  it('replaces a pooled connection that fails its reset check', async () => {
    const values = freshSecrets()
    await withSql(context(values), async () => 1)
    jest.mocked(Connection.prototype.reset).mockImplementationOnce(function (this: Connection, callback) {
      resets.push(this)
      callback(new Error('Connection lost.'))
    })
    await expect(withSql(context(values), async () => 2)).resolves.toBe(2)
    expect(resets).toEqual([opened[0]])
    expect(opened).toHaveLength(2)
    expect(closed).toEqual([opened[0]])
  })

  it.each([
    ['ends', (connection: Connection) => connection.emit('end')],
    ['reports an error', (connection: Connection) => connection.emit('error', new Error('Socket closed.'))],
  ])('closes an idle connection that %s between invocations', async (_event, fail) => {
    const values = freshSecrets()
    await withSql(context(values), async () => 1)
    fail(opened[0])
    expect(closed).toEqual([opened[0]])
    await withSql(context(values), async () => 2)
    expect(opened).toHaveLength(2)
    expect(resets).toEqual([])
  })

  it('does not return a connection whose rollback failed', async () => {
    jest.spyOn(Connection.prototype, 'execSqlBatch').mockImplementation(request => request.callback(null, 0))
    jest.spyOn(Connection.prototype, 'beginTransaction').mockImplementation(callback => callback(null))
    jest.spyOn(Connection.prototype, 'rollbackTransaction')
      .mockImplementation(callback => callback(new Error('Connection lost.')))
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const values = freshSecrets()
    const failure = new Error('Original failure.')
    await expect(withSql(context(values), sql => sql.transaction(async () => { throw failure }))).rejects.toBe(failure)
    expect(log).toHaveBeenCalledWith('SQL rollback failed; closing the connection to discard uncommitted work.')
    expect(closed).toContain(opened[0])
    await withSql(context(values), async () => 2)
    expect(opened).toHaveLength(2)
    expect(resets).toEqual([])
  })
})
