import { describe, expect, it } from '@jest/globals'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COUNTRIES, isCountry } from '../src/countries.js'

describe('approved country names', () => {
  it('uses exactly the editable TXT list for browser and backend validation', () => {
    const source = readFileSync(new URL('../src/country-names.txt', import.meta.url), 'utf8')
    const expected = source
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
    expect(COUNTRIES).toEqual(expected)
    expect(new Set(COUNTRIES).size).toBe(COUNTRIES.length)
    expect(COUNTRIES.every(country => country.length <= 80 && isCountry(country))).toBe(true)
    for (const value of ['', 'unlisted country', 'Canada, Ontario', undefined, null, 123, {}]) {
      expect(isCountry(value)).toBe(false)
    }
  })

  it.each([
    ['# Approved names\r\n\r\n  Canada  \r\nKenya\r\n', true],
    ['# No approved entries\n', false],
    ['Canada\ncanada\n', false],
    [`${'x'.repeat(81)}\n`, false],
    ['Can\u0000ada\n', false],
  ])('generates only a valid replacement list: %j', (source, valid) => {
    const root = mkdtempSync(join(tmpdir(), 'trivia-country-generator-'))
    try {
      mkdirSync(join(root, 'scripts'))
      const data = join(root, 'rayfin/functions/src')
      mkdirSync(data, { recursive: true })
      const script = join(root, 'scripts/generate-countries.mjs')
      copyFileSync(new URL('../../../scripts/generate-countries.mjs', import.meta.url), script)
      writeFileSync(join(data, 'country-names.txt'), source)
      const generate = () => execFileSync(process.execPath, [script], { stdio: 'pipe' })
      if (valid) {
        generate()
        const generated = readFileSync(join(data, 'countryNames.generated.ts'), 'utf8')
        expect(generated).toContain('"Canada"')
        expect(generated).toContain('"Kenya"')
        expect(generated).not.toContain('United States')
      } else expect(generate).toThrow()
    } finally {
      rmSync(root, { recursive: true })
    }
  })
})
