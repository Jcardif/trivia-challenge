import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_FABRIC_SETTINGS,
  isFabricHost,
  normalizeFabricApiUrl,
} from '@microsoft/rayfin-tools-common/_internal'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FABRIC_DOMAIN_SUFFIX = '.fabric.microsoft.com'

export function requireUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID.`)
  }
  return value
}

function optionalUuid(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  return requireUuid(value, label)
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

export function requireSafeFabricApiUrl(value, label = 'fabricApiUrl') {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) throw new Error(`${label} is missing from the active deployment.`)

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${label} must be a valid HTTPS Fabric API URL.`)
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  const environment = host.endsWith(FABRIC_DOMAIN_SUFFIX)
    ? host.slice(0, -FABRIC_DOMAIN_SUFFIX.length).split('.')[0]
    : ''
  if (parsed.protocol !== 'https:' ||
    parsed.username || parsed.password || parsed.port ||
    parsed.search || parsed.hash ||
    !isFabricHost(host) || !environment.endsWith('api')) {
    throw new Error(`${label} must be an HTTPS first-party Fabric API endpoint such as https://api.fabric.microsoft.com/v1 or https://dailyapi.fabric.microsoft.com/v1.`)
  }

  return normalizeFabricApiUrl(url)
}

function deriveFabricApiUrlFromDeepLink(value, workspaceId, appId, tenantId) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('active deployment fabricDeepLink must be a valid Fabric portal URL.')
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
    !isFabricHost(host)) {
    throw new Error('active deployment fabricDeepLink must be an HTTPS first-party Fabric portal URL.')
  }

  const segments = parsed.pathname.split('/').filter(Boolean)
  const groupsIndex = segments.indexOf('groups')
  if (groupsIndex < 0 || segments[groupsIndex + 1]?.toLowerCase() !== workspaceId.toLowerCase() ||
    segments[groupsIndex + 2] !== 'appbackends' ||
    segments[groupsIndex + 3]?.toLowerCase() !== appId.toLowerCase()) {
    throw new Error('active deployment fabricDeepLink does not match the deployment workspace and app.')
  }
  const ctid = parsed.searchParams.get('ctid')
  if (ctid && tenantId && ctid.toLowerCase() !== tenantId.toLowerCase()) {
    throw new Error('active deployment fabricDeepLink tenant does not match the deployment tenant.')
  }

  const subdomain = host.slice(0, -FABRIC_DOMAIN_SUFFIX.length).split('.')[0]
  const apiPrefix = subdomain === 'app' ? '' : subdomain
  return `https://${apiPrefix}api.fabric.microsoft.com/v1`
}

function normalizeHttpsOrigin(value, label) {
  if (value === undefined || value === null || value === '') return undefined
  let parsed
  try {
    parsed = new URL(String(value))
  } catch {
    throw new Error(`${label} must be a valid HTTPS origin.`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
    parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${label} must be an HTTPS origin without a path, query, or fragment.`)
  }
  return parsed.origin
}

export function resolveFabricApiRequestUrl(path, fabricApiUrl) {
  const apiRoot = new URL(`${fabricApiUrl.replace(/\/+$/, '')}/`)
  const url = new URL(path, apiRoot)
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    url.origin !== apiRoot.origin ||
    !(url.pathname === '/v1' || url.pathname.startsWith('/v1/'))) {
    throw new Error('Refusing to send Fabric credentials to an unexpected endpoint.')
  }
  return url
}

export function selectDeploymentTarget(registry, options = {}) {
  const {
    expectedWorkspaceId,
    expectedAppId,
    registryPath = 'rayfin/.deployments.json',
  } = options
  const root = requireObject(registry, registryPath)
  const deployments = requireObject(root.deployments, `${registryPath} deployments`)
  const active = typeof root.active === 'string' ? root.active.trim() : ''
  if (!active) {
    const count = Object.keys(deployments).length
    throw new Error(count > 1
      ? 'Multiple deployments are recorded, but no active deployment is selected. Run `npx rayfin up list` and `npx rayfin up switch <workspace>`.'
      : 'No active deployment is selected. Run `npx rayfin up` or `npx rayfin up switch <workspace>` before using deployment helpers.')
  }
  const record = requireObject(deployments[active], `Active deployment "${active}"`)
  const workspaceId = requireUuid(record.fabricWorkspaceId, 'active deployment fabricWorkspaceId')
  const appId = requireUuid(record.fabricItemId, 'active deployment fabricItemId')
  const tenantId = optionalUuid(record.fabricTenantId, 'active deployment fabricTenantId')
  const expectedWorkspace = optionalUuid(expectedWorkspaceId, 'workspace-id')
  const expectedApp = optionalUuid(expectedAppId, 'app-id')
  if (expectedWorkspace && expectedWorkspace.toLowerCase() !== workspaceId.toLowerCase()) {
    throw new Error('The supplied workspace-id does not match the active Rayfin deployment.')
  }
  if (expectedApp && expectedApp.toLowerCase() !== appId.toLowerCase()) {
    throw new Error('The supplied app-id does not match the active Rayfin deployment.')
  }

  const hasFabricApiUrl = typeof record.fabricApiUrl === 'string' && record.fabricApiUrl.trim() !== ''
  if (record.fabricApiUrl !== undefined && record.fabricApiUrl !== null &&
    typeof record.fabricApiUrl !== 'string') {
    throw new Error('active deployment fabricApiUrl must be a URL string.')
  }
  const deepLinkFabricApiUrl = deriveFabricApiUrlFromDeepLink(record.fabricDeepLink, workspaceId, appId, tenantId)
  let fabricApiUrl = deepLinkFabricApiUrl
  let fabricApiUrlSource = deepLinkFabricApiUrl ? 'fabric-deep-link' : ''
  if (!fabricApiUrl && hasFabricApiUrl) {
    fabricApiUrl = requireSafeFabricApiUrl(record.fabricApiUrl, 'active deployment fabricApiUrl')
    fabricApiUrlSource = 'deployment-registry'
  }
  if (!fabricApiUrl) {
    fabricApiUrl = DEFAULT_FABRIC_SETTINGS.fabricApiBaseUrl
    fabricApiUrlSource = 'legacy-production-default'
  }

  return Object.freeze({
    deploymentKey: active,
    workspaceId,
    tenantId,
    appId,
    fabricApiUrl,
    fabricApiUrlSource,
    fabricDeepLink: typeof record.fabricDeepLink === 'string' ? record.fabricDeepLink : undefined,
    hostingUrl: normalizeHttpsOrigin(record.hostingUrl, 'active deployment hostingUrl'),
    itemEndpoint: `${fabricApiUrl.replace(/\/+$/, '')}/workspaces/${workspaceId}/appBackends/${appId}`,
  })
}

export async function readDeploymentRegistry(projectRoot = process.cwd()) {
  const registryPath = join(projectRoot, 'rayfin', '.deployments.json')
  let content
  try {
    content = await readFile(registryPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('No Rayfin deployment registry was found at rayfin/.deployments.json. Run `npx rayfin up` for the target workspace first.')
    }
    throw error
  }
  try {
    return JSON.parse(content)
  } catch {
    throw new Error('rayfin/.deployments.json is not valid JSON.')
  }
}

export async function resolveDeploymentTarget(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd()
  return selectDeploymentTarget(await readDeploymentRegistry(projectRoot), {
    expectedWorkspaceId: options.workspaceId,
    expectedAppId: options.appId,
    registryPath: 'rayfin/.deployments.json',
  })
}

function jwtTenantId(token) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return typeof decoded.tid === 'string' ? decoded.tid : undefined
  } catch {
    return undefined
  }
}

export function assertDeploymentTenant(target, authState, options = {}) {
  if (!target.tenantId) return
  const ambientToken = options.ambientToken ?? process.env.RAYFIN_TOKEN
  if (ambientToken) {
    const tokenTenantId = jwtTenantId(ambientToken)
    if (!tokenTenantId) {
      throw new Error('RAYFIN_TOKEN tenant could not be verified against the active deployment. Use `npx rayfin login --tenant <deployment-tenant-id>` or provide a tenant-scoped JWT.')
    }
    if (tokenTenantId.toLowerCase() !== target.tenantId.toLowerCase()) {
      throw new Error('RAYFIN_TOKEN tenant does not match the active Rayfin deployment.')
    }
    return
  }

  const activeTenantId = typeof authState?.tenantId === 'string' ? authState.tenantId : ''
  if (!activeTenantId) {
    throw new Error('The active Rayfin deployment records a tenant, but no Rayfin sign-in tenant is active. Run `npx rayfin login --tenant <deployment-tenant-id>` first.')
  }
  if (activeTenantId.toLowerCase() !== target.tenantId.toLowerCase()) {
    throw new Error('The active Rayfin sign-in tenant does not match the active deployment. Run `npx rayfin login --tenant <deployment-tenant-id>` first.')
  }
}
