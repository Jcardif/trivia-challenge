import { EventHubProducerClient, MessagingError, RetryMode } from '@azure/event-hubs'
import type { CreateBatchOptions, EventData, SendBatchOptions } from '@azure/event-hubs'
import type { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { TelemetryBatchResponse, TelemetryEvent } from './contracts.js'
import { DomainError } from './errors.js'
import { isGeneratedPlayerName } from './playerIdentity.js'
import { containsPrivateTelemetryFields } from './telemetryPrivacy.js'

export const TELEMETRY_LIMITS = {
  eventsPerBatch: 50,
  eventBytes: 16 * 1024,
  requestBytes: 128 * 1024,
  producerBatchBytes: 64 * 1024,
  jsonDepth: 8,
  jsonNodes: 2000,
} as const

const EVENT_TYPES: Readonly<Record<string, string>> = {
  'pageview.home': 'pageview',
  'pageview.select-pool': 'pageview',
  'pool.selected': 'user',
  'user.register': 'user',
  'game.start': 'game',
  'game.answerquestion': 'game',
  'game.streakcompleted': 'game',
  'game.ended': 'game',
  'page.click': 'interaction',
  'page.touch': 'interaction',
  'page.keyboardkeydown': 'interaction',
}
const EVENT_FIELDS = new Set(['eventId', 'event', 'type', 'timestamp', 'userId', 'properties', 'context'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIMESTAMP = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,7})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject
interface JsonObject { [key: string]: JsonValue }

function invalid(message: string): never {
  throw new DomainError('VALIDATION_ERROR', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonObject(value: unknown): JsonObject {
  let nodes = 0
  const ancestors = new Set<object>()

  function copy(input: unknown, depth: number): JsonValue {
    if (++nodes > TELEMETRY_LIMITS.jsonNodes || depth > TELEMETRY_LIMITS.jsonDepth) {
      return invalid('Telemetry JSON exceeds the complexity limit.')
    }
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number' && Number.isFinite(input)) return input
    if (typeof input === 'string' && input.length <= TELEMETRY_LIMITS.eventBytes) return input
    if (input === null || typeof input !== 'object' || ancestors.has(input)) {
      return invalid('Telemetry requires finite, acyclic JSON values.')
    }
    ancestors.add(input)
    try {
      if (Array.isArray(input)) {
        if (input.length > TELEMETRY_LIMITS.jsonNodes) return invalid('Telemetry array is too large.')
        return Array.from(input, child => copy(child, depth + 1))
      }
      if (!isRecord(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        return invalid('Telemetry requires plain JSON objects.')
      }
      const result: JsonObject = {}
      const keys = Reflect.ownKeys(input)
      if (keys.length > TELEMETRY_LIMITS.jsonNodes) return invalid('Telemetry object has too many fields.')
      for (const key of keys) {
        if (typeof key !== 'string' || key.length > TELEMETRY_LIMITS.eventBytes) {
          return invalid('Telemetry requires bounded string keys.')
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, key)
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          return invalid('Telemetry does not accept accessors or hidden properties.')
        }
        Object.defineProperty(result, key, {
          value: copy(descriptor.value, depth + 1),
          enumerable: true,
        })
      }
      return result
    } finally {
      ancestors.delete(input)
    }
  }

  if (!isRecord(value)) return invalid('Telemetry properties and context must be JSON objects.')
  const result = copy(value, 0)
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return invalid('Telemetry properties and context must be JSON objects.')
  }
  return result
}

function eventTimestamp(value: unknown, now: Date): string {
  if (typeof value !== 'string' || value.length > 40) return invalid('Telemetry timestamp must be ISO 8601.')
  const match = TIMESTAMP.exec(value)
  if (!match) return invalid('Telemetry timestamp must be ISO 8601.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const time = Date.parse(value)
  if (day > daysInMonth[month - 1] || !Number.isFinite(time)) return invalid('Telemetry timestamp is invalid.')
  if (time > now.getTime() + 5 * 60 * 1000) return invalid('Telemetry timestamp cannot be over five minutes in the future.')
  return value
}

export function validateTelemetryBatch(payload: unknown, now = new Date()): TelemetryEvent[] {
  if (!isRecord(payload) || Object.keys(payload).some(key => key !== 'events')
    || !Array.isArray(payload.events) || payload.events.length < 1
    || payload.events.length > TELEMETRY_LIMITS.eventsPerBatch) {
    return invalid('Telemetry requires between 1 and 50 events.')
  }
  const ids = new Set<string>()
  const events = payload.events.map((value: unknown): TelemetryEvent => {
    if (!isRecord(value) || Object.keys(value).some(key => !EVENT_FIELDS.has(key))) {
      return invalid('Telemetry event fields are invalid.')
    }
    const input = jsonObject(value)
    if (typeof input.eventId !== 'string' || !UUID.test(input.eventId)) {
      return invalid('Telemetry eventId must be a UUID.')
    }
    if (ids.has(input.eventId.toLowerCase())) return invalid('Telemetry eventIds must be unique within a batch.')
    ids.add(input.eventId.toLowerCase())
    if (typeof input.event !== 'string' || !Object.hasOwn(EVENT_TYPES, input.event)
      || input.type !== EVENT_TYPES[input.event]) {
      return invalid('Telemetry event name and type must match a supported event.')
    }
    if (input.userId !== undefined && (typeof input.userId !== 'string'
      || !input.userId.trim() || input.userId.length > 128)) {
      return invalid('Telemetry userId must be a nonempty string of at most 128 characters.')
    }
    const event: TelemetryEvent = {
      eventId: input.eventId,
      event: input.event,
      type: input.type,
      timestamp: eventTimestamp(input.timestamp, now),
      ...(typeof input.userId === 'string' ? { userId: input.userId } : {}),
      properties: input.properties === undefined ? {} : jsonObject(input.properties),
      context: input.context === undefined ? {} : jsonObject(input.context),
    }
    if (containsPrivateTelemetryFields(event.properties) || containsPrivateTelemetryFields(event.context)) {
      return invalid('Telemetry must not contain contact details, player credentials, or browser fingerprint fields.')
    }
    if (event.event === 'user.register' && event.properties?.name !== undefined &&
        !isGeneratedPlayerName(event.properties.name)) {
      return invalid('Registration telemetry accepts only generated adventurer names.')
    }
    if (Buffer.byteLength(JSON.stringify(event), 'utf8') > TELEMETRY_LIMITS.eventBytes) {
      return invalid('Telemetry event exceeds the 16 KiB UTF-8 limit.')
    }
    return event
  })
  if (Buffer.byteLength(JSON.stringify({ events }), 'utf8') > TELEMETRY_LIMITS.requestBytes) {
    return invalid('Telemetry batch exceeds the 128 KiB UTF-8 limit.')
  }
  return events
}

export function telemetryEnvelope(event: TelemetryEvent, ingestedAtUtc: string) {
  return {
    eventId: event.eventId,
    eventType: 'track',
    type: event.type,
    eventName: event.event,
    userId: event.userId ?? null,
    timestamp: event.timestamp,
    properties: event.properties ?? {},
    context: event.context ?? {},
    ingestedAtUtc,
  }
}

export interface TelemetryProducerBatch {
  readonly count: number
  tryAdd(event: EventData): boolean
}

export interface TelemetryProducer<Batch extends TelemetryProducerBatch> {
  createBatch(options: CreateBatchOptions): Promise<Batch>
  sendBatch(batch: Batch, options: SendBatchOptions): Promise<void>
  close(): Promise<void>
}

function transportRetryable(error: unknown, depth = 0): boolean | undefined {
  if (error instanceof MessagingError) return error.retryable
  if (error instanceof Error && error.name === 'AbortError') return true
  if (error instanceof AggregateError && depth < 4 && error.errors.length > 0) {
    const causes: unknown[] = error.errors
    let retryable = false
    for (const cause of causes) {
      const classified = transportRetryable(cause, depth + 1)
      if (classified === undefined) return undefined
      retryable ||= classified
    }
    return retryable
  }
  return undefined
}

async function transport<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error: unknown) {
    const retryable = transportRetryable(error)
    if (retryable === undefined) throw error
    throw new DomainError('TELEMETRY_UNAVAILABLE', 'Telemetry forwarding failed.', retryable)
  }
}

// The producer seam exercises acknowledgment and sizing without claiming real ingestion.
export async function forwardTelemetryEvents<Batch extends TelemetryProducerBatch>(
  events: TelemetryEvent[],
  producer: TelemetryProducer<Batch>,
  now: () => Date = () => new Date(),
): Promise<TelemetryBatchResponse> {
  const abortSignal = AbortSignal.timeout(25_000)
  const acknowledgedEventIds: string[] = []
  const ingestedAtUtc = now().toISOString()
  try {
    let batch = await transport(() => producer.createBatch({ maxSizeInBytes: TELEMETRY_LIMITS.producerBatchBytes, abortSignal }))
    let batchIds: string[] = []
    for (const event of events) {
      const data: EventData = {
        body: Buffer.from(JSON.stringify(telemetryEnvelope(event, ingestedAtUtc)), 'utf8'),
        contentType: 'application/json',
        messageId: event.eventId,
      }
      if (!batch.tryAdd(data)) {
        if (batch.count === 0) return invalid('Telemetry event exceeds the Eventstream batch size.')
        await transport(() => producer.sendBatch(batch, { abortSignal }))
        acknowledgedEventIds.push(...batchIds)
        batch = await transport(() => producer.createBatch({ maxSizeInBytes: TELEMETRY_LIMITS.producerBatchBytes, abortSignal }))
        batchIds = []
        if (!batch.tryAdd(data)) return invalid('Telemetry event exceeds the Eventstream batch size.')
      }
      batchIds.push(event.eventId)
    }
    if (batch.count > 0) {
      await transport(() => producer.sendBatch(batch, { abortSignal }))
      acknowledgedEventIds.push(...batchIds)
    }
    return { acknowledgedEventIds, processedAtUtc: now().toISOString(), forwarded: true }
  } finally {
    await transport(() => producer.close())
  }
}

export async function trackTelemetryBatch(ctx: RayfinContext, payload: unknown): Promise<TelemetryBatchResponse> {
  const events = validateTelemetryBatch(payload)
  const connectionString = ctx.getSecret('TRIVIA_EVENTHUB_CONNECTION_STRING')
  if (!connectionString?.trim()) {
    throw new DomainError('CONFIGURATION_ERROR', 'TRIVIA_EVENTHUB_CONNECTION_STRING is not configured.')
  }
  const producer = new EventHubProducerClient(connectionString, {
    retryOptions: {
      mode: RetryMode.Exponential,
      maxRetries: 2,
      retryDelayInMs: 1000,
      maxRetryDelayInMs: 4000,
      timeoutInMs: 10_000,
    },
  })
  return forwardTelemetryEvents(events, producer)
}
