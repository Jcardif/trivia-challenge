import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { createFabricApi, createKustoQueryApi, requireUuid } from './fabric-api.mjs'

const { values } = parseArgs({
  options: {
    'workspace-id': { type: 'string' },
    apply: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    'app-origin': { type: 'string' },
    'session-id': { type: 'string' },
    'station-id': { type: 'string' },
  },
})
const workspaceId = requireUuid(values['workspace-id'], 'workspace-id')
const sessionId = values['session-id'] ? requireUuid(values['session-id'], 'session-id') : ''
const stationId = values['station-id'] ?? ''
if (values.apply && values.verify) throw new Error('Use either --apply or read-only --verify, not both.')
let appOrigin
if (values.verify) {
  if (!values['app-origin']) throw new Error('--verify requires the deployed HTTPS --app-origin.')
  const origin = new URL(values['app-origin'])
  if (origin.protocol !== 'https:' || origin.username || origin.password ||
    origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('--verify requires the deployed HTTPS --app-origin without a path, query, or fragment.')
  }
  appOrigin = origin.origin
}
const names = {
  eventhouse: 'triviachallenge-analytics',
  database: 'TriviaChallengeTelemetry',
  eventstream: 'triviachallenge-events',
  destination: 'TriviaEventhouseData',
}

if (!values.apply && !values.verify) {
  console.log(JSON.stringify({ workspaceId, ...names, apply: false }, null, 2))
} else {
  const api = await createFabricApi()
  const base = `workspaces/${workspaceId}`
  const marker = 'Microsoft Fabric Trivia Challenge Rayfin migration'
  const items = await api.list(`${base}/items`)
  async function ensure(type, path, name, payload) {
    const matches = items.filter(item => item.type === type && item.displayName === name)
    if (matches.length > 1) throw new Error(`Multiple ${type} items named ${name}.`)
    if (matches.length === 1) {
      if (matches[0].description !== marker) {
        throw new Error(`Existing ${name} is not owned by this migration; refusing to change it.`)
      }
      return matches[0]
    }
    if (!values.apply) throw new Error(`Owned ${type} ${name} is missing; --verify does not create resources.`)
    console.log(`Creating ${type} ${name}`)
    const created = await api.create(`${base}/${path}`, {
      displayName: name,
      description: marker,
      ...payload,
    })
    requireUuid(created?.id, `${type} result id`)
    return created
  }
  const part = (path, content) => ({
    path,
    payload: Buffer.from(content, 'utf8').toString('base64'),
    payloadType: 'InlineBase64',
  })
  const eventhouse = await ensure('Eventhouse', 'eventhouses', names.eventhouse, {})
  const schema = await readFile(new URL('../infra/telemetry.kql', import.meta.url), 'utf8')
  const database = await ensure('KQLDatabase', 'kqlDatabases', names.database, {
    definition: {
      parts: [
        part('DatabaseProperties.json', JSON.stringify({
          databaseType: 'ReadWrite',
          parentEventhouseItemId: eventhouse.id,
        })),
        part('DatabaseSchema.kql', schema),
      ],
    },
  })
  const topology = {
    sources: [{ name: 'TriviaApp', type: 'CustomEndpoint', properties: {} }],
    streams: [{
      name: 'TriviaEvents',
      type: 'DefaultStream',
      properties: {},
      inputNodes: [{ name: 'TriviaApp' }],
    }],
    destinations: [{
      name: names.destination,
      type: 'Eventhouse',
      properties: {
        dataIngestionMode: 'ProcessedIngestion',
        workspaceId,
        itemId: database.id,
        databaseName: database.displayName,
        tableName: 'TriviaTelemetry',
        inputSerialization: { type: 'Json', properties: { encoding: 'UTF8' } },
      },
      inputNodes: [{ name: 'TriviaEvents' }],
    }],
    operators: [],
    compatibilityLevel: '1.1',
  }
  const eventstream = await ensure('Eventstream', 'eventstreams', names.eventstream, {
    definition: {
      parts: [
        part('eventstream.json', JSON.stringify(topology)),
        part('.platform', JSON.stringify({
          $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json',
          metadata: { type: 'Eventstream', displayName: names.eventstream },
          config: { version: '2.0', logicalId: randomUUID() },
        })),
      ],
    },
  })
  const summary = {
    workspaceId,
    eventhouseId: eventhouse.id,
    databaseId: database.id,
    eventstreamId: eventstream.id,
    table: 'TriviaTelemetry',
    ...(sessionId ? { sessionId } : {}),
    deliveryVerified: false,
  }
  const { body: topologyStatus } = await api.request(`${base}/eventstreams/${eventstream.id}/topology`)
  const destination = topologyStatus.destinations?.find(node => node.name === names.destination)
  summary.destinationStatus = destination?.status ?? 'Missing'
  summary.destinationId = destination?.id
  summary.destinationErrorCode = destination?.error?.errorCode
  summary.retainedDestinations = topologyStatus.destinations?.filter(node => node.name !== names.destination)
    .map(node => ({ id: node.id, name: node.name, status: node.status }))
  if (destination && (destination.properties?.dataIngestionMode !== 'ProcessedIngestion' ||
    destination.properties.workspaceId !== workspaceId || destination.properties.itemId !== database.id ||
    destination.properties.databaseName !== database.displayName ||
    destination.properties.tableName !== 'TriviaTelemetry' ||
    destination.properties.inputSerialization?.type !== 'Json')) {
    throw new Error('The telemetry destination does not match the owned database and JSON ingestion configuration.')
  }
  if (values.verify) {
    try {
      const { body: databaseDetails } = await api.request(`${base}/kqlDatabases/${database.id}`)
      if (databaseDetails.properties?.parentEventhouseItemId !== eventhouse.id) {
        throw new Error('The owned telemetry database belongs to a different Eventhouse.')
      }
      const queryApi = await createKustoQueryApi(databaseDetails.properties.queryServiceUri)
      const csl = await readFile(new URL('../infra/telemetry-verify.kql', import.meta.url), 'utf8')
      summary.queryResults = await queryApi.query(database.displayName, csl, { appOrigin, sessionId, stationId })
      const eventCount = summary.queryResults.reduce((count, table) => {
        const index = table.columns.indexOf('uniqueEvents')
        return count + (index < 0 ? 0 : table.rows.reduce((total, row) => total + Number(row[index]), 0))
      }, 0)
      summary.deliveryVerified = eventCount > 0
      if (sessionId) {
        const observedNames = new Set(summary.queryResults.flatMap(table => {
          const index = table.columns.indexOf('eventName')
          return index < 0 ? [] : table.rows.map(row => row[index])
        }))
        summary.gameLifecycleObserved = ['game.start', 'game.answerquestion', 'game.ended']
          .every(name => observedNames.has(name))
        summary.deliveryVerified &&= summary.gameLifecycleObserved
      }
      if (!summary.deliveryVerified) process.exitCode = 1
    } catch (error) {
      summary.verificationError = error instanceof Error ? error.message : 'Telemetry verification failed.'
      process.exitCode = 1
    }
  }
  if (summary.destinationStatus !== 'Running') process.exitCode = 1
  console.log(JSON.stringify(summary, null, 2))
}
