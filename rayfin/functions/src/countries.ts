import { COUNTRIES } from './countryNames.generated.js'

export { COUNTRIES } from './countryNames.generated.js'

const countryNames = new Set<string>(COUNTRIES)
const previousNames = new Map<string, string>([
  ['Åland Islands', 'Aland Islands'],
  ['Côte d’Ivoire', "Cote d'Ivoire"],
  ['Curaçao', 'Curacao'],
  ['Réunion', 'Reunion'],
  ['Saint Barthélemy', 'Saint Barthelemy'],
  ['São Tomé and Príncipe', 'Sao Tome and Principe'],
  ['Türkiye', 'Turkiye'],
])

export function normalizeCountry(value: string): string {
  return previousNames.get(value) ?? value
}

export function isCountry(value: unknown): value is string {
  return typeof value === 'string' && countryNames.has(normalizeCountry(value))
}
