import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { ClientSecretCredential } from '@azure/identity'
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
const { withSql } = await import('../src/sql.js')

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

function credentialOf(connection: Connection) {
  const { authentication } = connection.config
  if (authentication.type !== 'token-credential') throw new Error(`Unexpected ${authentication.type} SQL authentication.`)
  return authentication.options.credential
}

const opened: Connection[] = []
const closed: Connection[] = []

beforeEach(() => {
  constructed.length = 0
  opened.length = 0
  closed.length = 0
  jest.spyOn(ClientSecretCredential.prototype, 'getToken')
    .mockRejectedValue(new Error('Tests must not request Entra tokens.'))
  jest.spyOn(Connection.prototype, 'connect').mockImplementation(function (this: Connection, callback) {
    opened.push(this)
    callback?.()
  })
  jest.spyOn(Connection.prototype, 'close').mockImplementation(function (this: Connection) {
    closed.push(this)
  })
})
afterEach(() => { jest.restoreAllMocks() })

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
    expect(closed).toEqual([opened[0]])
    expect(ClientSecretCredential.prototype.getToken).not.toHaveBeenCalled()
  })

  it('reuses one credential across fresh sequential and concurrent connections', async () => {
    const values = freshSecrets()
    await withSql(context(values), async () => 1)
    await withSql(context({ ...values, TRIVIA_SQL_SERVER: 'other.database.fabric.microsoft.com', TRIVIA_SQL_DATABASE: 'other' }), async () => 2)
    await Promise.all([withSql(context(values), async () => 3), withSql(context(values), async () => 4)])
    expect(constructed).toHaveLength(1)
    expect(opened).toHaveLength(4)
    expect(new Set(opened).size).toBe(4)
    for (const connection of opened) expect(credentialOf(connection)).toBe(constructed[0].credential)
    expect(closed).toHaveLength(4)
    expect(new Set(closed)).toEqual(new Set(opened))
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
    expect(credentialOf(opened[2])).toBe(constructed[1].credential)
    expect(closed).toHaveLength(3)
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

  it('closes the connection, preserves an operation failure, and keeps the credential', async () => {
    const values = freshSecrets()
    const failure = new Error('Operation failed.')
    await expect(withSql(context(values), async () => { throw failure })).rejects.toBe(failure)
    expect(closed).toEqual([opened[0]])
    await expect(withSql(context(values), async () => 1)).resolves.toBe(1)
    expect(constructed).toHaveLength(1)
    expect(closed).toHaveLength(2)
  })
})
