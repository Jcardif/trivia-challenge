import { invokeOperation } from './rayfinClient'
import { gameConfig } from '../config/gameConfig'
import { getCookie } from '../lib/utils'
import type {
  TelemetryBatchResponse,
  TelemetryEvent,
  User,
} from '../../rayfin/functions/src/contracts'
import type {
  AnalyticsEventName,
  AnalyticsEventType,
  AnalyticsQueueItem,
  AnalyticsEventProperties,
  AnalyticsEventContext,
  TelemetryDeliveryStatus,
  TelemetryFailure,
  TelemetryJsonObject,
  TelemetryJsonValue,
} from '../types/telemetry'

const EVENT_TYPE_MAP: Record<AnalyticsEventName, AnalyticsEventType> = {
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

const INTERACTIVE_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const MAX_EVENT_BYTES = 16 * 1024
const MAX_BATCH_BYTES = 96 * 1024
const MAX_QUEUE_BYTES = 2 * 1024 * 1024
const MAX_QUEUE_EVENTS = 500
const MAX_EVENT_AGE_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 8
const MAX_RETRY_DELAY_MS = 30_000
const encoder = new TextEncoder()

type BatchSender = (events: TelemetryEvent[]) => Promise<TelemetryBatchResponse>
type DeliveryObserver = (status: TelemetryDeliveryStatus) => void

interface PendingEvent {
  item: AnalyticsQueueItem
  bytes: number
  attempts: number
  enqueuedAt: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function snapshot(data: unknown): TelemetryJsonObject {
  let remainingNodes = 2000
  const ancestors = new Set<object>()

  function clone(value: unknown, depth: number): TelemetryJsonValue {
    if (--remainingNodes < 0 || depth > 8) {
      throw new Error('Telemetry JSON exceeds the complexity limit.')
    }
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'string' && value.length <= MAX_EVENT_BYTES) return value
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value !== 'object' || value === null || ancestors.has(value)) {
      throw new Error('Telemetry requires finite, acyclic JSON values.')
    }
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        if (value.length > 2000) throw new Error('Telemetry array is too large.')
        return Array.from(value, child => clone(child, depth + 1))
      }
      if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new Error('Telemetry requires plain JSON objects.')
      }
      const result: TelemetryJsonObject = {}
      const keys = Reflect.ownKeys(value)
      if (keys.length > 2000) throw new Error('Telemetry object has too many fields.')
      for (const key of keys) {
        if (typeof key !== 'string' || key.length > MAX_EVENT_BYTES) {
          throw new Error('Telemetry requires bounded string keys.')
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new Error('Telemetry does not accept accessors or hidden properties.')
        }
        // Optional object fields are omitted, matching the existing event callers.
        if (descriptor.value === undefined) continue
        Object.defineProperty(result, key, {
          value: clone(descriptor.value, depth + 1),
          enumerable: true,
        })
      }
      return result
    } finally {
      ancestors.delete(value)
    }
  }

  if (!isRecord(data)) throw new Error('Telemetry properties and context must be objects.')
  const result = clone(data, 0)
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Telemetry properties and context must be objects.')
  }
  return result
}

function isAcknowledgment(value: unknown): value is TelemetryBatchResponse {
  return isRecord(value)
    && typeof value.forwarded === 'boolean'
    && typeof value.processedAtUtc === 'string'
    && Number.isFinite(Date.parse(value.processedAtUtc))
    && Array.isArray(value.acknowledgedEventIds)
    && value.acknowledgedEventIds.every(id => typeof id === 'string')
}

function describeElement(target: EventTarget | null): string {
  if (!(target instanceof HTMLElement)) {
    return 'unknown'
  }

  const id = target.id ? `#${target.id}` : ''
  const cls = target.className && typeof target.className === 'string'
    ? `.${target.className.split(/\s+/).filter(Boolean).join('.')}`
    : ''

  return `${target.tagName.toLowerCase()}${id}${cls}`
}

export class AnalyticsService {
  private readonly config = gameConfig.telemetry
  private readonly queue: PendingEvent[] = []
  private queuedBytes = 0
  private initialized = false
  private disposed = false
  private inFlight: Promise<void> | null = null
  private flushTimer: number | null = null
  private retryTimer: number | null = null
  private retryAt: number | null = null
  private consecutiveFailures = 0
  private deliveredCount = 0
  private droppedCount = 0
  private lastFailure: TelemetryFailure | null = null
  private lastDeliveredAt: string | null = null
  private readonly observers = new Set<DeliveryObserver>()
  private userId?: string
  private currentSessionId?: string
  private currentPoolId?: string
  private currentPoolName?: string
  private lastPointerEventTimestamp = 0
  private trackedEventCount = 0
  private readonly sendBatch: BatchSender

  constructor(
    sendBatch: BatchSender = events => invokeOperation('trackTelemetryBatch', { events }),
  ) {
    this.sendBatch = sendBatch
  }

  initialize(): void {
    if (this.initialized || !this.config.enabled || typeof window === 'undefined') {
      return
    }

    this.initialized = true
    this.disposed = false

    if (this.config.flushInterval > 0) {
      this.flushTimer = window.setInterval(() => {
        void this.flush()
      }, this.config.flushInterval)
    }

    window.addEventListener('beforeunload', this.handleBeforeUnload)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)

    document.addEventListener('click', this.handleClick, { passive: true })
    document.addEventListener('touchstart', this.handleTouch, { passive: true })
    document.addEventListener('keydown', this.handleKeydown, { passive: true })
    this.publishStatus()
  }

  identify(user: User | null): void {
    this.userId = user?.userId ?? undefined
  }

  setSession(sessionId: string | null): void {
    this.currentSessionId = sessionId ?? undefined
  }

  setPool(pool: { id: string; name: string } | null): void {
    this.currentPoolId = pool?.id ?? undefined
    this.currentPoolName = pool?.name ?? undefined
  }

  track(eventName: AnalyticsEventName, properties: AnalyticsEventProperties = {}, context: AnalyticsEventContext = {}): void {
    if (!this.config.enabled || this.disposed || typeof window === 'undefined') {
      return
    }

    let item: AnalyticsQueueItem
    let bytes: number
    try {
      if (!Object.hasOwn(EVENT_TYPE_MAP, eventName)) throw new Error('Unknown telemetry event.')
      item = {
        eventId: window.crypto.randomUUID(),
        event: eventName,
        type: EVENT_TYPE_MAP[eventName],
        timestamp: new Date().toISOString(),
        ...(this.userId ? { userId: this.userId } : {}),
        properties: snapshot(properties),
        context: snapshot(this.enrichContext(snapshot(context))),
      }
      bytes = encoder.encode(JSON.stringify(item)).byteLength
    } catch {
      this.recordDrop('invalid-payload')
      return
    }
    if (bytes > MAX_EVENT_BYTES) {
      this.recordDrop('event-too-large')
      return
    }
    if (this.queue.length >= MAX_QUEUE_EVENTS || this.queuedBytes + bytes > MAX_QUEUE_BYTES) {
      this.recordDrop('queue-full')
      return
    }

    this.queue.push({ item, bytes, attempts: 0, enqueuedAt: Date.now() })
    this.queuedBytes += bytes
    this.trackedEventCount += 1

    if (this.config.logToConsole) {
      console.debug('[Telemetry] Event queued', { event: eventName, queuedCount: this.queue.length })
    }
    this.publishStatus()
    if (this.queue.length >= this.batchSize) {
      void this.flush()
    }
  }

  private get batchSize(): number {
    return Math.max(1, Math.min(50, this.config.batchSize))
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight
    if (!this.config.enabled || this.disposed || typeof window === 'undefined') return Promise.resolve()
    if (this.retryAt !== null && Date.now() < this.retryAt) return Promise.resolve()
    this.pruneQueue()
    if (this.queue.length === 0) return Promise.resolve()

    this.clearRetryTimer()
    const batch: PendingEvent[] = []
    let bytes = 13 // {"events":[]} plus a separator for each event.
    for (const entry of this.queue) {
      if (batch.length >= this.batchSize || bytes + entry.bytes + 1 > MAX_BATCH_BYTES) break
      batch.push(entry)
      bytes += entry.bytes + 1
      entry.attempts += 1
    }
    this.inFlight = this.deliver(batch).finally(() => {
      this.inFlight = null
      if (this.disposed) {
        const count = this.removeQueued(() => true)
        if (count > 0) this.recordDrop('disposed', count)
      } else {
        this.pruneQueue()
      }
      if (!this.disposed && this.queue.length > 0) {
        const delay = this.consecutiveFailures === 0
          ? 50
          : Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** Math.min(this.consecutiveFailures - 1, 5))
        this.scheduleFlush(delay)
      }
      this.publishStatus()
    })
    this.publishStatus()
    return this.inFlight
  }

  private async deliver(batch: PendingEvent[]): Promise<void> {
    let response: TelemetryBatchResponse
    try {
      response = await this.sendBatch(batch.map(entry => entry.item))
    } catch {
      this.recordFailure('delivery-failed')
      return
    }
    if (!isAcknowledgment(response)) {
      this.recordFailure('invalid-acknowledgment')
      return
    }
    if (!response.forwarded) {
      this.recordFailure('not-forwarded')
      return
    }
    const batchIds = new Set(batch.map(entry => entry.item.eventId))
    const acknowledged = new Set(response.acknowledgedEventIds)
    if (acknowledged.size !== response.acknowledgedEventIds.length
      || [...acknowledged].some(id => !batchIds.has(id))) {
      this.recordFailure('invalid-acknowledgment')
      return
    }
    this.deliveredCount += this.removeQueued(entry => acknowledged.has(entry.item.eventId))
    if (acknowledged.size > 0) this.lastDeliveredAt = response.processedAtUtc
    if (acknowledged.size !== batch.length) {
      this.recordFailure('delivery-failed')
    } else {
      this.consecutiveFailures = 0
      this.lastFailure = null
    }
  }

  private removeQueued(predicate: (entry: PendingEvent) => boolean): number {
    let removed = 0
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index]
      if (!predicate(entry)) continue
      this.queuedBytes -= entry.bytes
      this.queue.splice(index, 1)
      removed += 1
    }
    return removed
  }

  private pruneQueue(): void {
    const expired = this.removeQueued(entry => Date.now() - entry.enqueuedAt >= MAX_EVENT_AGE_MS)
    const exhausted = this.removeQueued(entry => entry.attempts >= MAX_ATTEMPTS)
    if (expired > 0) this.recordDrop('expired', expired)
    if (exhausted > 0) this.recordDrop('retry-limit', exhausted)
    if (this.queue.length === 0) {
      this.consecutiveFailures = 0
      this.clearRetryTimer()
    }
  }

  private scheduleFlush(delay: number): void {
    this.clearRetryTimer()
    this.retryAt = Date.now() + delay
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      this.retryAt = null
      void this.flush()
    }, delay)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.retryAt = null
  }

  private recordFailure(reason: TelemetryFailure): void {
    this.consecutiveFailures += 1
    this.lastFailure = reason
    console.warn('[Telemetry] Delivery not acknowledged', { reason })
  }

  private recordDrop(reason: TelemetryFailure, count = 1): void {
    this.droppedCount += count
    this.lastFailure = reason
    console.warn('[Telemetry] Events dropped', { reason, count })
    this.publishStatus()
  }

  private enrichContext(context: AnalyticsEventContext): AnalyticsEventContext {
    if (typeof window === 'undefined') {
      return context
    }

    const baseContext: AnalyticsEventContext = {
      // Query strings and fragments can contain authentication codes or tokens.
      url: `${window.location.origin}${window.location.pathname}`,
      path: window.location.pathname,
      language: window.navigator.language,
      userAgent: window.navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${window.screen.width}x${window.screen.height}`,
    }

    if (this.currentSessionId) {
      baseContext.sessionId = this.currentSessionId
    }

    if (this.currentPoolId) {
      baseContext.poolId = this.currentPoolId
    }
    if (this.currentPoolName) {
      baseContext.poolName = this.currentPoolName
    }

    // Include stationId from cookie if present
    const stationId = getCookie('stationId')
    if (stationId) {
      baseContext.stationId = stationId
    }

    return {
      ...baseContext,
      ...context,
    }
  }

  private handleClick = (event: MouseEvent): void => {
    const now = performance.now()
    if (now - this.lastPointerEventTimestamp < 16) {
      return
    }
    this.lastPointerEventTimestamp = now

    this.track('page.click', {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
      element: describeElement(event.target),
    })
  }

  private handleTouch = (event: TouchEvent): void => {
    const touch = event.touches[0] ?? event.changedTouches[0]
    if (!touch) {
      return
    }

    const now = performance.now()
    if (now - this.lastPointerEventTimestamp < 16) {
      return
    }
    this.lastPointerEventTimestamp = now

    this.track('page.touch', {
      x: touch.clientX,
      y: touch.clientY,
      element: describeElement(event.target),
    })
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return
    }

    const target = event.target instanceof HTMLElement ? event.target : null
    if (target && (INTERACTIVE_INPUT_TAGS.has(target.tagName)
      || target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"]'))) {
      return
    }

    const keyValue = this.shouldCaptureExactKey(event.key)
      ? event.key
      : this.generalizeKey(event.key)

    this.track('page.keyboardkeydown', {
      key: keyValue,
      code: this.shouldCaptureExactKey(event.key) ? event.code : keyValue,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      element: describeElement(target),
    })
  }

  private shouldCaptureExactKey(key: string): boolean {
    const configuredKeys = Object.keys(gameConfig.keyboard.mappings)
    return configuredKeys.includes(key.toUpperCase()) || key.length > 1
  }

  private generalizeKey(key: string): string {
    if (key.length !== 1) {
      return key
    }
    if (/^[0-9]$/.test(key)) {
      return 'digit'
    }
    if (/^[a-zA-Z]$/.test(key)) {
      return 'alpha'
    }
    return 'character'
  }

  private handleBeforeUnload = (): void => {
    // Rayfin invocations are best effort here, not a durable unload transport.
    void this.flush()
  }

  dispose(): void {
    this.disposed = true
    this.initialized = false
    if (typeof window !== 'undefined') {
      if (this.flushTimer !== null) window.clearInterval(this.flushTimer)
      this.flushTimer = null
      this.clearRetryTimer()
      window.removeEventListener('beforeunload', this.handleBeforeUnload)
      document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      document.removeEventListener('click', this.handleClick)
      document.removeEventListener('touchstart', this.handleTouch)
      document.removeEventListener('keydown', this.handleKeydown)
    }
    if (!this.inFlight) {
      const count = this.removeQueued(() => true)
      if (count > 0) this.recordDrop('disposed', count)
    }
    this.userId = undefined
    this.currentSessionId = undefined
    this.currentPoolId = undefined
    this.currentPoolName = undefined
    this.publishStatus()
    this.observers.clear()
  }

  getDeliveryStatus(): TelemetryDeliveryStatus {
    return {
      enabled: this.config.enabled && !this.disposed,
      queuedCount: this.queue.length,
      sending: this.inFlight !== null,
      deliveredCount: this.deliveredCount,
      droppedCount: this.droppedCount,
      retryAt: this.retryAt === null ? null : new Date(this.retryAt).toISOString(),
      lastFailure: this.lastFailure,
      lastDeliveredAt: this.lastDeliveredAt,
    }
  }

  subscribeDeliveryStatus(observer: DeliveryObserver): () => void {
    this.observers.add(observer)
    this.publishStatus()
    return () => { this.observers.delete(observer) }
  }

  private publishStatus(): void {
    for (const observer of this.observers) {
      try {
        observer(this.getDeliveryStatus())
      } catch {
        console.warn('[Telemetry] Delivery observer failed')
      }
    }
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.flush()
    }
  }

  getTrackedEventCount(): number {
    return this.trackedEventCount
  }

  resetTrackedEventCount(): void {
    this.trackedEventCount = 0
  }
}

export const analytics = new AnalyticsService()
