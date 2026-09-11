import { setTimeout as delay } from 'node:timers/promises'
import { getRayfinAuth } from '../node_modules/@microsoft/rayfin-cli/dist/auth/index.js'

const apiRoot = 'https://api.fabric.microsoft.com/v1/'

export function requireUuid(value, label) {
  if (typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${label} must be a UUID.`)
  }
  return value
}

export async function createFabricApi() {
  const auth = await getRayfinAuth()
  const authorization = async () => {
    const { token } = await auth.acquireToken(undefined, { silentOnly: true })
    return `Bearer ${token}`
  }

  async function request(path, options = {}) {
    const url = new URL(path, apiRoot)
    if (url.origin !== new URL(apiRoot).origin || !url.pathname.startsWith('/v1/')) {
      throw new Error('Refusing to send Fabric credentials to an unexpected endpoint.')
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(url, {
        ...options,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: await authorization(),
        },
        signal: AbortSignal.timeout(60_000),
      })
      if (response.status === 429 && attempt < 4) {
        const retrySeconds = Number(response.headers.get('Retry-After'))
        await delay(Math.min(Math.max(retrySeconds || 2 ** attempt, 1), 60) * 1000)
        continue
      }
      const text = await response.text()
      const body = text ? JSON.parse(text) : null
      if (!response.ok) {
        throw new Error(`Fabric ${response.status}: ${body?.errorCode ?? 'RequestFailed'} ${body?.message ?? ''}`)
      }
      return { body, status: response.status, headers: response.headers }
    }
    throw new Error('Fabric throttling did not clear within the retry budget.')
  }

  async function complete(response) {
    if (response.status !== 202) return response.body
    const operationId = requireUuid(response.headers.get('x-ms-operation-id'), 'Fabric operation id')
    const location = `operations/${operationId}`
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await delay(5_000)
      const operation = await request(location)
      if (operation.body?.status === 'Succeeded') {
        return (await request(`${location}/result`)).body
      }
      if (['Failed', 'Cancelled'].includes(operation.body?.status)) {
        throw new Error(`Fabric operation ${operation.body.status}: ${operation.body.error?.errorCode ?? 'UnknownError'}`)
      }
    }

    throw new Error(`Fabric operation is still pending: ${location}`)
  }

  async function list(path) {
    const items = []
    let next = path
    while (next) {
      const { body } = await request(next)
      if (!Array.isArray(body?.value)) throw new Error('Fabric list response has no item array.')
      items.push(...body.value)
      next = body.continuationUri
    }
    return items
  }

  return {
    authorization,
    request,
    list,
    create: async (path, payload) => complete(await request(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    })),
  }
}

export async function createKustoQueryApi(queryServiceUri) {
  const endpoint = new URL(queryServiceUri)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port ||
    endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
    !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.kusto\.fabric\.microsoft\.com$/i.test(endpoint.hostname)) {
    throw new Error('Refusing to send Kusto credentials to an unexpected endpoint.')
  }
  const metadataResponse = await fetch(new URL('/v1/rest/auth/metadata', endpoint), {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!metadataResponse.ok) throw new Error(`Kusto authentication metadata failed with HTTP ${metadataResponse.status}.`)
  const metadata = await metadataResponse.json()
  const resource = metadata.AzureAD?.KustoServiceResourceId
  if (!['https://kusto.kusto.windows.net', 'https://api.kusto.windows.net'].includes(resource)) {
    throw new Error('Kusto returned an unsupported authentication audience.')
  }
  const scope = `${resource}/.default`
  const auth = await getRayfinAuth()
  let token
  try {
    const result = await auth.acquireToken([scope], { silentOnly: true })
    token = result.token
  } catch {
    throw new Error(`KUSTO_AUTH_REQUIRED: Silent acquisition for ${scope} failed. No interactive login was attempted.`)
  }

  return {
    async query(database, csl, parameters = {}) {
      const response = await fetch(new URL('/v2/rest/query', endpoint), {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-ms-readonly': 'true',
        },
        body: JSON.stringify({
          db: database,
          csl,
          properties: {
            Options: { queryconsistency: 'strongconsistency', servertimeout: '00:00:30' },
            Parameters: parameters,
          },
        }),
        signal: AbortSignal.timeout(45_000),
      })
      if (!response.ok) throw new Error(`Kusto query failed with HTTP ${response.status}.`)
      const frames = await response.json()
      if (!Array.isArray(frames) ||
        !frames.some(frame => frame.FrameType === 'DataSetCompletion') ||
        frames.some(frame => frame.FrameType === 'DataSetCompletion' && (frame.HasErrors || frame.Cancelled))) {
        throw new Error('Kusto query did not complete successfully; delivery remains unverified.')
      }
      return frames.filter(frame => frame.FrameType === 'DataTable' && frame.TableKind === 'PrimaryResult')
        .map(frame => ({
          columns: frame.Columns.map(column => column.ColumnName),
          rows: frame.Rows,
        }))
    },
  }
}
