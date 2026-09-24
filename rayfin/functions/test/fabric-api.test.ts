import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

const tenantId = '33333333-3333-4333-8333-333333333333'
const workspaceId = '11111111-1111-4111-8111-111111111111'
const appId = '22222222-2222-4222-8222-222222222222'
const acquireToken = jest.fn<() => Promise<{ token: string }>>()
const loadAuthState = jest.fn<() => Promise<{ tenantId: string }>>()
const fetchMock = jest.fn<typeof fetch>()
const originalAmbientToken = process.env.RAYFIN_TOKEN

jest.unstable_mockModule('../../../node_modules/@microsoft/rayfin-cli/dist/auth/index.js', () => ({
  getRayfinAuth: async () => ({ acquireToken }),
  loadAuthState,
}))
const { createFabricApi } = await import('../../../scripts/fabric-api.mjs')
const { selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
const target = selectDeploymentTarget({
  active: 'daily',
  deployments: {
    daily: {
      fabricTenantId: tenantId,
      fabricWorkspaceId: workspaceId,
      fabricItemId: appId,
      fabricDeepLink: `https://daily.fabric.microsoft.com/groups/${workspaceId}/appbackends/${appId}`,
    },
  },
})

beforeEach(() => {
  delete process.env.RAYFIN_TOKEN
  acquireToken.mockReset().mockResolvedValue({ token: 'test-token' })
  loadAuthState.mockReset().mockResolvedValue({ tenantId })
  fetchMock.mockReset()
  jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (originalAmbientToken === undefined) delete process.env.RAYFIN_TOKEN
  else process.env.RAYFIN_TOKEN = originalAmbientToken
})

describe('environment-bound Fabric requests', () => {
  it('keeps resource requests and pagination on the selected environment', async () => {
    const nextPage = `https://dailyapi.fabric.microsoft.com/v1/workspaces/${workspaceId}/items?continuationToken=next`
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ id: 'one' }], continuationUri: nextPage })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ id: 'two' }] })))
    const api = await createFabricApi({ target })
    expect(await api.list(`workspaces/${workspaceId}/items`)).toEqual([{ id: 'one' }, { id: 'two' }])
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      `https://dailyapi.fabric.microsoft.com/v1/workspaces/${workspaceId}/items`,
      nextPage,
    ])
    expect(fetchMock.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true)
    expect(acquireToken).toHaveBeenCalledTimes(2)
  })

  it('rejects a mismatched tenant before token acquisition or network access', async () => {
    loadAuthState.mockResolvedValue({ tenantId: '44444444-4444-4444-8444-444444444444' })
    await expect(createFabricApi({ target })).rejects.toThrow('sign-in tenant')
    expect(acquireToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not follow pagination to another environment or an unrelated endpoint', async () => {
    const api = await createFabricApi({ target })
    for (const nextPage of [
      'https://api.fabric.microsoft.com/v1/workspaces/other/items',
      'https://example.invalid/v1/items',
      'https://dailyapi.fabric.microsoft.com/outside-v1',
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ value: [], continuationUri: nextPage })))
      const tokensBefore = acquireToken.mock.calls.length
      await expect(api.list(`workspaces/${workspaceId}/items`)).rejects.toThrow('unexpected endpoint')
      expect(acquireToken.mock.calls.length).toBe(tokensBefore + 1)
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
