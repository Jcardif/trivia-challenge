import { describe, expect, it } from '@jest/globals'
import { readFileSync } from 'node:fs'
import {
  ITEM_RUNES,
  PLAYER_CODE_CAPACITY,
  isGeneratedPlayerName,
  isPlayerCode,
  isRuneSpell,
  normalizePlayerCode,
  playerCodeAt,
  PLAYER_NAME_PREFIXES,
  PLAYER_NAME_TITLES,
} from '../src/playerIdentity.js'
import { generatePlayerName, hashRuneSpell, verifyRuneSpell } from '../src/playerCredentials.js'

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

  it('provides nine distinct item choices and 504 ordered spells', () => {
    expect(ITEM_RUNES).toHaveLength(9)
    expect(new Set(ITEM_RUNES.map(rune => rune.id)).size).toBe(9)
    expect(ITEM_RUNES.length * (ITEM_RUNES.length - 1) * (ITEM_RUNES.length - 2)).toBe(504)
    expect(isRuneSpell(['lakehouse', 'notebook', 'warehouse'])).toBe(true)
    expect(isRuneSpell(['warehouse', 'notebook', 'lakehouse'])).toBe(true)
    expect(isRuneSpell(['lakehouse', 'lakehouse', 'warehouse'])).toBe(false)
    expect(isRuneSpell(['lakehouse', 'notebook', 'unknown'])).toBe(false)
    expect(isRuneSpell(['lakehouse', 'notebook', 'report', 'warehouse'])).toBe(false)
    for (const removed of ['report', 'semantic-model', 'ml-model'])
      expect(isRuneSpell(['lakehouse', 'notebook', removed])).toBe(false)
    const sparseSpell = ['lakehouse', 'notebook']
    sparseSpell.length = 3
    expect(isRuneSpell(sparseSpell)).toBe(false)
  })

  it('has exactly 22,000 unique letter-and-three-digit codes, preserving leading zeros', () => {
    const codes = new Set(
      Array.from({ length: PLAYER_CODE_CAPACITY }, (_, index) => playerCodeAt(index))
    )
    expect(codes.size).toBe(22_000)
    expect([...codes].every(isPlayerCode)).toBe(true)
    expect(playerCodeAt(0)).toBe('A000')
    expect(playerCodeAt(PLAYER_CODE_CAPACITY - 1)).toBe('Z999')
    expect(normalizePlayerCode(' k-042 ')).toBe('K042')
    for (const invalid of [
      'A000\n',
      'A00',
      'A0000',
      'A00000',
      'I000',
      'L000',
      'O000',
      'U000',
      '0000',
    ]) {
      expect(isPlayerCode(invalid)).toBe(false)
    }
    for (const invalid of [-1, PLAYER_CODE_CAPACITY, 0.5, Infinity]) {
      expect(() => playerCodeAt(invalid)).toThrow()
    }
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

  it('salts every spell and verifies exact order without retaining the selected IDs', async () => {
    const spell = ['lakehouse', 'notebook', 'warehouse'] as const
    const first = await hashRuneSpell(spell)
    const second = await hashRuneSpell(spell)
    expect(first).not.toBe(second)
    expect(first).toMatch(/^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{64}$/)
    for (const rune of spell) expect(first).not.toContain(rune)
    expect(await verifyRuneSpell(spell, first)).toBe(true)
    expect(await verifyRuneSpell(['warehouse', 'notebook', 'lakehouse'], first)).toBe(false)
    await expect(verifyRuneSpell(spell, 'bad-stored-hash')).rejects.toThrow(
      'Stored spell verifier is invalid'
    )
  })
})
