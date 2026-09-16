import { parseArgs } from 'node:util'
import { createFabricApi, requireUuid } from './fabric-api.mjs'
import { applySecretsToRemoteEndpoint } from '../node_modules/@microsoft/rayfin-cli/dist/services/fabric/rayfin-item.js'
import { resolveDeploymentTarget } from './deployment-target.mjs'

const { values } = parseArgs({
  options: {
    'workspace-id': { type: 'string' },
    'app-id': { type: 'string' },
    'sql-database-id': { type: 'string' },
    'eventstream-id': { type: 'string' },
  },
})
const target = await resolveDeploymentTarget({
  workspaceId: values['workspace-id'],
  appId: values['app-id'],
})
const { workspaceId, appId, itemEndpoint } = target
const sqlId = requireUuid(values['sql-database-id'], 'sql-database-id')
const eventstreamId = requireUuid(values['eventstream-id'], 'eventstream-id')
const api = await createFabricApi({ target })
const base = `workspaces/${workspaceId}`
const { body: database } = await api.request(`${base}/sqlDatabases/${sqlId}`)
const [server, port] = (database?.properties?.serverFqdn ?? '').split(',')
if (!server.endsWith('.database.fabric.microsoft.com') ||
  (port && port !== '1433') || !database.properties.databaseName) {
  throw new Error('SQL metadata does not contain the expected Fabric endpoint.')
}
const { body: topology } = await api.request(`${base}/eventstreams/${eventstreamId}/topology`)
const sources = topology?.sources?.filter(source =>
  source.name === 'TriviaApp' && source.type === 'CustomEndpoint')
if (!sources || sources.length !== 1) {
  throw new Error('The Eventstream must have exactly one TriviaApp custom endpoint.')
}
const sourceId = requireUuid(sources[0].id, 'Eventstream source id')
const { body: endpoint } = await api.request(
  `${base}/eventstreams/${eventstreamId}/sources/${sourceId}/connection`,
)
let connectionString = endpoint?.accessKeys?.primaryConnectionString
if (endpoint?.type !== 'CustomEndpoint' || typeof connectionString !== 'string' ||
  !connectionString.includes('SharedAccessKey=')) {
  throw new Error('The Eventstream did not return a usable private publisher credential.')
}
if (!/;EntityPath=/i.test(connectionString)) {
  if (!/^[A-Za-z0-9._-]+$/.test(endpoint.eventHubName ?? '')) {
    throw new Error('The Eventstream response has no valid event hub name.')
  }
  connectionString = `${connectionString.replace(/;$/, '')};EntityPath=${endpoint.eventHubName}`
}
const configured = await applySecretsToRemoteEndpoint({
  itemEndpoint,
  getAuthorizationHeader: api.authorization,
  secrets: [
    { name: 'TRIVIA_SQL_SERVER', value: server },
    { name: 'TRIVIA_SQL_DATABASE', value: database.properties.databaseName },
    { name: 'TRIVIA_EVENTHUB_CONNECTION_STRING', value: connectionString },
  ],
})
console.log(JSON.stringify({ appId, configured: configured.map(secret => secret.name) }, null, 2))
