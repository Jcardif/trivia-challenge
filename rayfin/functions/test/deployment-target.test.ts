import { describe, expect, it } from '@jest/globals'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const appId = '22222222-2222-4222-8222-222222222222'
const tenantId = '33333333-3333-4333-8333-333333333333'

function registry(overrides: Record<string, unknown> = {}) {
  return {
    active: 'daily-workspace',
    deployments: {
      'daily-workspace': {
        fabricWorkspaceId: workspaceId,
        fabricTenantId: tenantId,
        fabricItemId: appId,
        fabricApiUrl: `https://placeholder.pbidedicated.windows.net/webapi/capacities/00000000-0000-4000-8000-000000000000/workloads/BaaS/BaaSService/automatic/v1/workspaces/${workspaceId}/appbackends/${appId}/`,
        fabricDeepLink: 'https://daily.fabric.microsoft.com/groups/11111111-1111-4111-8111-111111111111/appbackends/22222222-2222-4222-8222-222222222222',
        hostingUrl: 'https://public-placeholder.example',
        ...overrides,
      },
    },
  }
}

function jwtWithTenant(id: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode({ tid: id })}.signature`
}

describe('deployment target selection', () => {
  it('uses the active Rayfin deployment as the single environment source', async () => {
    const { selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
    const target = selectDeploymentTarget(registry(), { expectedWorkspaceId: workspaceId, expectedAppId: appId })
    expect(target).toMatchObject({
      deploymentKey: 'daily-workspace',
      workspaceId,
      tenantId,
      appId,
      fabricApiUrl: 'https://dailyapi.fabric.microsoft.com/v1',
      fabricApiUrlSource: 'fabric-deep-link',
      hostingUrl: 'https://public-placeholder.example',
      itemEndpoint: `https://dailyapi.fabric.microsoft.com/v1/workspaces/${workspaceId}/appBackends/${appId}`,
    })
  })

  it('does not silently choose among recorded deployments without active selection', async () => {
    const { selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
    expect(() => selectDeploymentTarget({
      deployments: {
        one: registry().deployments['daily-workspace'],
        two: registry({ fabricWorkspaceId: '44444444-4444-4444-8444-444444444444' }).deployments['daily-workspace'],
      },
    })).toThrow('no active deployment')
  })

  it('rejects command-line target values that do not match the active deployment', async () => {
    const { selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
    expect(() => selectDeploymentTarget(registry(), {
      expectedWorkspaceId: '44444444-4444-4444-8444-444444444444',
    })).toThrow('workspace-id')
    expect(() => selectDeploymentTarget(registry(), {
      expectedAppId: '55555555-5555-4555-8555-555555555555',
    })).toThrow('app-id')
  })

  it('allows only first-party Fabric API hosts before credentials are attached', async () => {
    const { requireSafeFabricApiUrl, resolveFabricApiRequestUrl } = await import('../../../scripts/deployment-target.mjs')
    expect(requireSafeFabricApiUrl('https://api.fabric.microsoft.com/v1')).toBe('https://api.fabric.microsoft.com/v1')
    expect(requireSafeFabricApiUrl('https://dailyapi.fabric.microsoft.com/v1/anything')).toBe('https://dailyapi.fabric.microsoft.com/v1')
    expect(() => requireSafeFabricApiUrl('https://example.invalid/proxy/fabric/v1')).toThrow('first-party Fabric API')
    expect(() => requireSafeFabricApiUrl('https://app.fabric.microsoft.com/v1')).toThrow('first-party Fabric API')
    for (const unsafe of [
      'https://user:password@api.fabric.microsoft.com/v1',
      'https://api.fabric.microsoft.com:8443/v1',
      'https://api.fabric.microsoft.com/v1?redirect=other',
      'https://api.fabric.microsoft.com/v1#fragment',
    ]) expect(() => requireSafeFabricApiUrl(unsafe)).toThrow('first-party Fabric API')
    expect(() => resolveFabricApiRequestUrl('https://api.fabric.microsoft.com/v1/workspaces/x', 'https://dailyapi.fabric.microsoft.com/v1'))
      .toThrow('unexpected endpoint')
  })

  it('keeps a production API default only for legacy records without fabricApiUrl', async () => {
    const { selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
    const target = selectDeploymentTarget(registry({ fabricApiUrl: undefined, fabricDeepLink: undefined }))
    expect(target.fabricApiUrl).toBe('https://api.fabric.microsoft.com/v1')
    expect(target.fabricApiUrlSource).toBe('legacy-production-default')
    expect(() => selectDeploymentTarget(registry({ fabricApiUrl: 123, fabricDeepLink: undefined })))
      .toThrow('URL string')
  })

  it('does not forward Fabric credentials to a registry workload or proxy URL without a portal environment', async () => {
    const { selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
    expect(() => selectDeploymentTarget(registry({ fabricDeepLink: undefined }))).toThrow('first-party Fabric API')
  })

  it('fails before token acquisition when the sign-in tenant differs', async () => {
    const { assertDeploymentTenant, selectDeploymentTarget } = await import('../../../scripts/deployment-target.mjs')
    const target = selectDeploymentTarget(registry())
    expect(() => assertDeploymentTenant(target, { tenantId })).not.toThrow()
    expect(() => assertDeploymentTenant(target, { tenantId: '44444444-4444-4444-8444-444444444444' }))
      .toThrow('sign-in tenant')
    expect(() => assertDeploymentTenant(target, {}, { ambientToken: jwtWithTenant(tenantId) })).not.toThrow()
    expect(() => assertDeploymentTenant(target, {}, {
      ambientToken: jwtWithTenant('44444444-4444-4444-8444-444444444444'),
    })).toThrow('RAYFIN_TOKEN tenant')
  })
})
