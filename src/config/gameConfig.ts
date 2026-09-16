import { GAME_RULE_DEFAULTS } from '../../rayfin/functions/src/gameRules'

const env = import.meta.env ?? {}
const lockdownMessageEnv = env.VITE_STATION_LOCKDOWN_MESSAGE
const normalizedLockdownMessage =
  typeof lockdownMessageEnv === 'string' && lockdownMessageEnv.trim().length > 0
    ? lockdownMessageEnv.trim()
    : 'This experience is currently unavailable. Please contact a team member for assistance.'

export const gameConfig = {
  ...GAME_RULE_DEFAULTS,

  /**
   * Telemetry Settings
   */
  telemetry: {
    enabled: (env.VITE_TELEMETRY_ENABLED ?? 'true') !== 'false',
    logToConsole: env.VITE_TELEMETRY_DEBUG === 'true',
    mouseMovementSampleRate: 10, // Max mouse position samples per second
    batchSize: 50, // Number of events to batch before sending
    flushInterval: 5000, // Flush telemetry every N milliseconds
  },

  /**
   * Lockdown Settings
   */
  lockdown: {
    requireStationId: env.VITE_REQUIRE_STATION_ID === 'true',
    message: normalizedLockdownMessage,
  },
} as const

export type GameConfig = typeof gameConfig
export type DifficultyLevel = typeof gameConfig.questions.difficultyLevels[number]
