export const PLAYER_NAME_MAX_LENGTH = 96
export const PLAYER_PASSWORD_MIN_LENGTH = 4
export const PLAYER_PASSWORD_MAX_LENGTH = 64

function passwordLength(value: string): number {
  return [...value.normalize('NFC')].length
}

export function isPlayerPassword(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  const length = passwordLength(value)
  return length >= PLAYER_PASSWORD_MIN_LENGTH && length <= PLAYER_PASSWORD_MAX_LENGTH
}

export function isGeneratedPlayerName(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > PLAYER_NAME_MAX_LENGTH) return false
  if (baseNames.has(value)) return true
  const match = /^(.*) ([1-9]\d*)$/.exec(value)
  if (!match) return false
  const counter = Number(match[2])
  return counter >= 2 && counter <= 2_147_483_647 && baseNames.has(match[1])
}

// Returning players type their name, so accept any letter case and spacing and restore the stored spelling.
export function normalizePlayerName(value: string): string {
  const collapsed = value.trim().replace(/\s+/g, ' ')
  const exact = canonicalBaseNames.get(collapsed.toLowerCase())
  if (exact) return exact
  const match = /^(.*) (\d+)$/.exec(collapsed)
  const base = match && canonicalBaseNames.get(match[1].toLowerCase())
  return base ? `${base} ${match[2]}` : collapsed
}

const baseNames = new Set(
  PLAYER_NAME_PREFIXES.flatMap(prefix => PLAYER_NAME_TITLES.map(title => `${prefix} ${title}`))
)
const canonicalBaseNames = new Map([...baseNames].map(name => [name.toLowerCase(), name]))
import { PLAYER_NAME_PREFIXES, PLAYER_NAME_TITLES } from './playerNameWords.generated.js'
export { PLAYER_NAME_PREFIXES, PLAYER_NAME_TITLES } from './playerNameWords.generated.js'
