import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { parseArgs } from 'node:util'
import { requireUuid } from '../../../scripts/deployment-target.mjs'

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const clientId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const appId = '22222222-2222-4222-8222-222222222222'
const sqlId = '33333333-3333-4333-8333-333333333333'
const eventstreamId = '44444444-4444-4444-8444-444444444444'
const sourceId = '55555555-5555-4555-8555-555555555555'
const target = {
  workspaceId, appId, tenantId,
  itemEndpoint: `https://api.fabric.microsoft.com/v1/workspaces/${workspaceId}/appBackends/${appId}`,
}
const credentials = {
  TRIVIA_SQL_TENANT_ID: tenantId,
  TRIVIA_SQL_CLIENT_ID: clientId,
  TRIVIA_SQL_CLIENT_SECRET: 'test-only-client-secret',
}
const eventConnection = 'Endpoint=sb://example.invalid/;SharedAccessKey=test-only-publisher-key'
const request = jest.fn<(path: string) => Promise<{ body: unknown }>>()
const authorization = jest.fn(async () => 'test-only-authorization')
const createFabricApi = jest.fn(async () => ({ request, authorization }))
const resolveTarget = jest.fn(async () => ({ ...target }))
const publish = jest.fn(async ({ secrets }: { secrets: { name: string; value: string }[] }) =>
  secrets.map(({ name }) => ({ name })))

jest.unstable_mockModule('../../../scripts/fabric-api.mjs', () => ({ createFabricApi, requireUuid }))
jest.unstable_mockModule('node:util', () => ({
  parseArgs: (options: Parameters<typeof parseArgs>[0]) => parseArgs({
    ...options,
    args: ['--sql-database-id', sqlId, '--eventstream-id', eventstreamId],
  }),
}))
jest.unstable_mockModule('../../../scripts/deployment-target.mjs', () => ({ resolveDeploymentTarget: resolveTarget }))
jest.unstable_mockModule('../../../node_modules/@microsoft/rayfin-cli/dist/services/fabric/rayfin-item.js', () => ({
  applySecretsToRemoteEndpoint: publish,
}))

const originalEnv = Object.fromEntries(Object.keys(credentials).map(key => [key, process.env[key]]))

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  Object.assign(process.env, credentials)
  resolveTarget.mockResolvedValue({ ...target })
  request.mockImplementation(async path => {
    if (path.endsWith(`/sqlDatabases/${sqlId}`)) {
      return { body: { properties: { serverFqdn: 'example.database.fabric.microsoft.com,1433', databaseName: 'trivia' } } }
    }
    if (path.endsWith('/topology')) {
      return { body: { sources: [{ id: sourceId, name: 'TriviaApp', type: 'CustomEndpoint' }] } }
    }
    if (path.endsWith(`/sources/${sourceId}/connection`)) {
      return { body: { type: 'CustomEndpoint', accessKeys: { primaryConnectionString: eventConnection }, eventHubName: 'trivia-events' } }
    }
    throw new Error(`Unexpected test request: ${path}`)
  })
})

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  jest.restoreAllMocks()
})

describe('server-only backend configuration', () => {
  it('uploads application SQL credentials and preserves the existing Eventstream configuration', async () => {
    await import('../../../scripts/configure-backend.mjs')
    expect(publish).toHaveBeenCalledWith({
      itemEndpoint: target.itemEndpoint,
      getAuthorizationHeader: authorization,
      secrets: [
        { name: 'TRIVIA_SQL_SERVER', value: 'example.database.fabric.microsoft.com' },
        { name: 'TRIVIA_SQL_DATABASE', value: 'trivia' },
        ...Object.entries(credentials).map(([name, value]) => ({ name, value })),
        { name: 'TRIVIA_EVENTHUB_CONNECTION_STRING', value: `${eventConnection};EntityPath=trivia-events` },
      ],
    })
    expect(request).toHaveBeenCalledTimes(3)
    const output = JSON.stringify(jest.mocked(console.log).mock.calls)
    expect(output).toContain('TRIVIA_SQL_CLIENT_SECRET')
    expect(output).not.toContain(credentials.TRIVIA_SQL_CLIENT_SECRET)
    expect(output).not.toContain(eventConnection)
  })

  it.each(Object.keys(credentials))('rejects missing %s before acquiring Fabric credentials or making requests', async key => {
    delete process.env[key]
    await expect(import('../../../scripts/configure-backend.mjs')).rejects.toThrow(key)
    expect(createFabricApi).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it.each(['TRIVIA_SQL_TENANT_ID', 'TRIVIA_SQL_CLIENT_ID'])('rejects invalid %s before accessing Fabric', async key => {
    process.env[key] = 'not-a-uuid'
    await expect(import('../../../scripts/configure-backend.mjs')).rejects.toThrow(`${key} must be a UUID`)
    expect(createFabricApi).not.toHaveBeenCalled()
  })

  it('rejects a blank client secret before accessing Fabric', async () => {
    process.env.TRIVIA_SQL_CLIENT_SECRET = ' '
    await expect(import('../../../scripts/configure-backend.mjs')).rejects.toThrow('TRIVIA_SQL_CLIENT_SECRET is required')
    expect(createFabricApi).not.toHaveBeenCalled()
  })

  it('rejects an application from a different tenant before accessing Fabric', async () => {
    process.env.TRIVIA_SQL_TENANT_ID = workspaceId
    await expect(import('../../../scripts/configure-backend.mjs')).rejects.toThrow('must match the active Rayfin deployment tenant')
    expect(createFabricApi).not.toHaveBeenCalled()
  })

  it('compares valid tenant IDs without case sensitivity', async () => {
    process.env.TRIVIA_SQL_TENANT_ID = tenantId.toUpperCase()
    process.env.TRIVIA_SQL_CLIENT_ID = clientId.toUpperCase()
    await import('../../../scripts/configure-backend.mjs')
    expect(publish.mock.calls[0][0].secrets).toEqual(expect.arrayContaining([
      { name: 'TRIVIA_SQL_TENANT_ID', value: tenantId },
      { name: 'TRIVIA_SQL_CLIENT_ID', value: clientId },
    ]))
  })

  it('does not upload any credentials when the existing Eventstream has no matching source', async () => {
    request.mockResolvedValueOnce({
      body: { properties: { serverFqdn: 'example.database.fabric.microsoft.com', databaseName: 'trivia' } },
    }).mockResolvedValueOnce({ body: { sources: [] } })
    await expect(import('../../../scripts/configure-backend.mjs')).rejects.toThrow('exactly one TriviaApp custom endpoint')
    expect(publish).not.toHaveBeenCalled()
  })
})
