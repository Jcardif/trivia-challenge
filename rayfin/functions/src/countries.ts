import { COUNTRIES } from './countryNames.generated.js'

export { COUNTRIES } from './countryNames.generated.js'

const countryNames = new Set<string>(COUNTRIES)

export function isCountry(value: unknown): value is string {
  return typeof value === 'string' && countryNames.has(value)
}
