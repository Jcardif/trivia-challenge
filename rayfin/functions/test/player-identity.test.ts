import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import {
  isGeneratedPlayerName,
  isPlayerPassword,
  normalizePlayerName,
  PLAYER_NAME_PREFIXES,
  PLAYER_NAME_TITLES,
} from '../src/playerIdentity.js'
import {
  generatePlayerName,
  hashPlayerPassword,
  verifyPlayerPassword,
} from '../src/playerCredentials.js'

describe('adventurer identity rules', () => {
  it('uses the editable TXT word banks in the compiled shared module', () => {
    const text = readFileSync(new URL('../src/player-name-words.txt', import.meta.url), 'utf8')
    const words: Record<'prefixes' | 'titles', string[]> = { prefixes: [], titles: [] }
    let section: keyof typeof words = 'prefixes'
    for (const line of text.split(/\r?\n/).map(line => line.trim())) {
      if (!line || line.startsWith('#')) continue
      if (line === '[prefixes]' || line === '[titles]')
        section = line === '[prefixes]' ? 'prefixes' : 'titles'
      else words[section].push(line)
    }
    expect(PLAYER_NAME_PREFIXES).toEqual(words.prefixes)
    expect(PLAYER_NAME_TITLES).toEqual(words.titles)
  })

  it('accepts player-chosen passwords of 4 to 64 characters', () => {
    for (const valid of ['abcd', '1234', 'two words', 'Ünïcödé', '🦦🦦🦦🦦', 'x'.repeat(64)]) {
      expect(isPlayerPassword(valid)).toBe(true)
    }
    for (const invalid of [undefined, null, 1234, '', 'abc', '    ', '🦦🦦🦦', 'x'.repeat(65)]) {
      expect(isPlayerPassword(invalid)).toBe(false)
    }
  })

  it('restores the stored spelling of a typed name regardless of case and spacing', () => {
    expect(normalizePlayerName('  amber   query crafter ')).toBe('Amber Query Crafter')
    expect(normalizePlayerName('AMBER QUERY CRAFTER 12')).toBe('Amber Query Crafter 12')
    expect(normalizePlayerName('Amber Query Crafter')).toBe('Amber Query Crafter')
    expect(normalizePlayerName(' someone   else ')).toBe('someone else')
    expect(isGeneratedPlayerName(normalizePlayerName('amber query crafter 02'))).toBe(false)
  })

  it('generates base aliases and accepts canonical collision counters only', () => {
    const bases = new Set(
      PLAYER_NAME_PREFIXES.flatMap(prefix => PLAYER_NAME_TITLES.map(title => `${prefix} ${title}`))
    )
    for (let i = 0; i < 100; i++) {
      const name = generatePlayerName()
      expect(isGeneratedPlayerName(name)).toBe(true)
      expect(bases.has(name)).toBe(true)
    }
    expect(isGeneratedPlayerName('Amber Query Crafter')).toBe(true)
    expect(isGeneratedPlayerName('Amber Query Crafter 2')).toBe(true)
    expect(isGeneratedPlayerName('Amber Query Crafter 10')).toBe(true)
    for (const suffix of ['1', '0', '02', '-2', '2.5', '2e3', '2147483648']) {
      expect(isGeneratedPlayerName(`Amber Query Crafter ${suffix}`)).toBe(false)
    }
    expect(isGeneratedPlayerName('Person Name')).toBe(false)
    expect(isGeneratedPlayerName('person@example.invalid')).toBe(false)
  })

  it('salts every password and verifies it without storing the plain text', async () => {
    const password = 'otter-42'
    const first = await hashPlayerPassword(password)
    const second = await hashPlayerPassword(password)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/)
    expect(first).not.toContain(password)
    expect(await verifyPlayerPassword(password, first)).toBe(true)
    expect(await verifyPlayerPassword('Otter-42', first)).toBe(false)
    expect(await verifyPlayerPassword('otter-42 ', first)).toBe(false)
    expect(await verifyPlayerPassword('e\u0301cole', await hashPlayerPassword('\u00e9cole'))).toBe(
      true
    )
    await expect(verifyPlayerPassword(password, 'bad-stored-hash')).rejects.toThrow(
      'Stored password verifier is invalid'
    )
  })
})
