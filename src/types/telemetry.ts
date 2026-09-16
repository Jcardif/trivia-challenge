import type { TelemetryEvent } from '../../rayfin/functions/src/contracts'

export type AnalyticsEventName =
  | 'pageview.home'
  | 'pageview.select-pool'
  | 'pool.selected'
  | 'user.register'
  | 'game.start'
  | 'game.answerquestion'
  | 'game.streakcompleted'
  | 'game.ended'
  | 'page.click'
  | 'page.touch'
  | 'page.keyboardkeydown'

export type AnalyticsEventType = 'pageview' | 'user' | 'game' | 'interaction' | 'custom'

export interface AnalyticsEventProperties {
  [key: string]: unknown
}

export interface AnalyticsEventContext {
  [key: string]: unknown
}

export type TelemetryJsonValue =
  | null
  | boolean
  | number
  | string
  | TelemetryJsonValue[]
  | { [key: string]: TelemetryJsonValue }

export interface TelemetryJsonObject {
  [key: string]: TelemetryJsonValue
}

export interface AnalyticsQueueItem extends TelemetryEvent {
  event: AnalyticsEventName
  type: AnalyticsEventType
  sessionId?: string
  properties: TelemetryJsonObject
  context: TelemetryJsonObject
}

export type TelemetryFailure =
  | 'invalid-payload'
  | 'event-too-large'
  | 'queue-full'
  | 'delivery-failed'
  | 'not-forwarded'
  | 'invalid-acknowledgment'
  | 'retry-limit'
  | 'expired'
  | 'disposed'

export interface TelemetryDeliveryStatus {
  enabled: boolean
  queuedCount: number
  sending: boolean
  deliveredCount: number
  droppedCount: number
  retryAt: string | null
  lastFailure: TelemetryFailure | null
  lastDeliveredAt: string | null
}
