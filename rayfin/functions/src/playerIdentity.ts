export const RUNE_CATALOG_VERSION = 1
export const RUNE_COUNT = 3

// Keep version 1 IDs and their meaning stable so saved spells continue to verify.
export const ITEM_RUNES = [
  { id: 'lakehouse', label: 'Lakehouse' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'notebook', label: 'Notebook' },
  { id: 'data-pipeline', label: 'Data Pipeline' },
  { id: 'dataflow-gen2', label: 'Dataflow Gen2' },
  { id: 'sql-database', label: 'SQL Database' },
  { id: 'eventhouse', label: 'Eventhouse' },
  { id: 'eventstream', label: 'Eventstream' },
  { id: 'activator', label: 'Activator' },
  { id: 'report', label: 'Report' },
  { id: 'semantic-model', label: 'Semantic Model' },
  { id: 'ml-model', label: 'ML Model' },
] as const

export type RuneId = (typeof ITEM_RUNES)[number]['id']
export type RuneSpell = readonly [RuneId, RuneId, RuneId]

const runeIds: ReadonlySet<string> = new Set(ITEM_RUNES.map(rune => rune.id))

export function isRuneId(value: unknown): value is RuneId {
  return typeof value === 'string' && runeIds.has(value)
}

export function isRuneSpell(value: unknown): value is RuneSpell {
  return (
    Array.isArray(value) &&
    value.length === RUNE_COUNT &&
    [...value].every(isRuneId) &&
    new Set(value).size === RUNE_COUNT
  )
}

export const PLAYER_CODE_LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ'
export const PLAYER_CODE_CAPACITY = PLAYER_CODE_LETTERS.length * 10_000

export function normalizePlayerCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]/g, '')
}

export function isPlayerCode(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 5 &&
    /^[ABCDEFGHJKMNPQRSTVWXYZ][0-9]{4}$/.test(value)
  )
}

export function playerCodeAt(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= PLAYER_CODE_CAPACITY) {
    throw new Error('Player code index is outside the available range.')
  }
  return `${PLAYER_CODE_LETTERS[Math.floor(index / 10_000)]}${String(index % 10_000).padStart(4, '0')}`
}

export function isGeneratedPlayerName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 96) return false
  if (baseNames.has(value)) return true
  const match = /^(.*) ([1-9]\d*)$/.exec(value)
  if (!match) return false
  const counter = Number(match[2])
  return counter >= 2 && counter <= 2_147_483_647 && baseNames.has(match[1])
}

const baseNames = new Set(
  PLAYER_NAME_PREFIXES.flatMap(prefix => PLAYER_NAME_TITLES.map(title => `${prefix} ${title}`))
)
import { PLAYER_NAME_PREFIXES, PLAYER_NAME_TITLES } from './playerNameWords.generated.js'
export { PLAYER_NAME_PREFIXES, PLAYER_NAME_TITLES } from './playerNameWords.generated.js'
