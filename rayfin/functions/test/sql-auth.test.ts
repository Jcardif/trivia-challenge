import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { RayfinContext } from '@microsoft/fabric-user-data-functions'
import { Connection } from 'tedious'
import { withSql } from '../src/sql.js'

const secrets = {
  TRIVIA_SQL_SERVER: 'example.database.fabric.microsoft.com',
  TRIVIA_SQL_DATABASE: 'trivia',
  TRIVIA_SQL_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  TRIVIA_SQL_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  TRIVIA_SQL_CLIENT_SECRET: 'test-only-client-secret',
}

function context(values: Record<string, string> = secrets) {
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

const opened: Connection[] = []

beforeEach(() => {
  opened.length = 0
  jest.spyOn(Connection.prototype, 'connect').mockImplementation(function (this: Connection, callback) {
    opened.push(this)
    callback?.()
  })
  jest.spyOn(Connection.prototype, 'close').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('application identity SQL authentication', () => {
  it('uses only server-side application credentials, without a delegated SQL token', async () => {
    const ctx = context()
    await expect(withSql(ctx, async () => 42)).resolves.toBe(42)
    expect(ctx.getToken).not.toHaveBeenCalled()
    expect(opened).toHaveLength(1)
    expect(opened[0].config.authentication).toEqual({
      type: 'azure-active-directory-service-principal-secret',
      options: {
        tenantId: secrets.TRIVIA_SQL_TENANT_ID,
        clientId: secrets.TRIVIA_SQL_CLIENT_ID,
        clientSecret: secrets.TRIVIA_SQL_CLIENT_SECRET,
      },
    })
    expect(opened[0].config.options).toMatchObject({
      database: 'trivia',
      encrypt: true,
      trustServerCertificate: false,
      connectTimeout: 60_000,
      requestTimeout: 60_000,
    })
    expect(opened[0].close).toHaveBeenCalledTimes(1)
  })

  it.each(Object.keys(secrets))('rejects missing %s before connecting, without an SSO fallback', async key => {
    const values: Record<string, string> = { ...secrets }
    delete values[key]
    const ctx = context(values)
    const action = jest.fn(async () => 42)
    await expect(withSql(ctx, action)).rejects.toThrow('Server-only SQL application-identity configuration is missing.')
    expect(ctx.getToken).not.toHaveBeenCalled()
    expect(Connection.prototype.connect).not.toHaveBeenCalled()
    expect(action).not.toHaveBeenCalled()
  })

  it('rejects blank credentials without including the supplied secret in the error', async () => {
    await expect(withSql(context({ ...secrets, TRIVIA_SQL_CLIENT_SECRET: ' ' }), async () => 42))
      .rejects.toThrow('Server-only SQL application-identity configuration is missing.')
    expect(Connection.prototype.connect).not.toHaveBeenCalled()
  })

  it('closes the connection after a connection failure without running the operation', async () => {
    const failure = new Error('SQL authentication failed.')
    jest.spyOn(Connection.prototype, 'connect').mockImplementation(callback => callback?.(failure))
    const action = jest.fn(async () => 42)
    await expect(withSql(context(), action)).rejects.toBe(failure)
    expect(action).not.toHaveBeenCalled()
    expect(Connection.prototype.close).toHaveBeenCalledTimes(1)
  })

  it('closes the connection and preserves an operation failure', async () => {
    const failure = new Error('Operation failed.')
    await expect(withSql(context(), async () => { throw failure })).rejects.toBe(failure)
    expect(Connection.prototype.close).toHaveBeenCalledTimes(1)
  })
})
