import type { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { User } from './contracts.js'
import { DomainError } from './errors.js'
import {
  generatePlayerName,
  hashPlayerPassword,
  UNKNOWN_PLAYER_HASH,
  verifyPlayerPassword,
} from './playerCredentials.js'
import { PLAYER_NAME_MAX_LENGTH } from './playerIdentity.js'
import { isCountry, normalizeCountry } from './countries.js'
import {
  date,
  id,
  int,
  rowDate,
  rowNumber,
  rowOptionalText,
  rowText,
  rowUuid,
  str,
  withSql,
  type SqlRow,
  type SqlSession,
} from './sql.js'
import { registrationInput } from './validation.js'

export const PLAYER_ENTRY_LIMITS = {
  attemptsPerMinute: 60,
  failuresPerPlayer: 5,
  playerWindowMs: 15 * 60 * 1000,
} as const

const ENTRY_STATE_ID = '00000000-0000-4000-8000-000000000001'
const PLAYER_COLUMNS =
  '[id], [name], [country], [passwordHash], [failedAttempts], [attemptWindowStartedAt], [createdAt]'

function playerDto(row: SqlRow): User {
  const country = normalizeCountry(rowText(row, 'country'))
  if (!isCountry(country)) throw new Error('Stored player country is not supported.')
  return {
    userId: rowUuid(row, 'id'),
    name: rowText(row, 'name'),
    country,
    createdAt: rowDate(row, 'createdAt'),
  }
}

function verificationFailure(): DomainError {
  return new DomainError(
    'PLAYER_VERIFICATION_FAILED',
    'That name and password could not be verified. Check both, or wait 15 minutes before trying again.'
  )
}

async function reserveEntryAttempt(sql: SqlSession, now: Date): Promise<boolean> {
  // One deployment-wide lock bounds distributed guessing without storing IPs or browser identifiers.
  const [state] = await sql.query(
    'SELECT [id], [windowStartedAt], [attemptCount] FROM [dbo].[PlayerEntryStates] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = @id;',
    { id: id(ENTRY_STATE_ID) }
  )
  if (!state) {
    await sql.insert(
      'PlayerEntryStates',
      ['id', 'windowStartedAt', 'attemptCount'],
      [[id(ENTRY_STATE_ID), date(now), int(1)]]
    )
    return true
  }
  const expired = now.getTime() - Date.parse(rowDate(state, 'windowStartedAt')) >= 60_000
  const count = expired ? 0 : rowNumber(state, 'attemptCount')
  if (count >= PLAYER_ENTRY_LIMITS.attemptsPerMinute) return false
  await sql.query(
    'UPDATE [dbo].[PlayerEntryStates] SET [windowStartedAt] = @started, [attemptCount] = @count WHERE [id] = @id;',
    {
      id: id(ENTRY_STATE_ID),
      started: date(expired ? now : new Date(rowDate(state, 'windowStartedAt'))),
      count: int(count + 1),
    }
  )
  return true
}

async function availableName(sql: SqlSession): Promise<string | DomainError> {
  const base = generatePlayerName()
  const prefix = base
    .replaceAll('~', '~~')
    .replaceAll('%', '~%')
    .replaceAll('_', '~_')
    .replaceAll('[', '~[')
  // The entry-state lock serializes allocation; the name index bounds this single aggregate.
  const [row] = await sql.query(
    `SELECT COALESCE(MAX(CASE WHEN [name] = @name THEN 1 ELSE 0 END), 0) AS [hasBase],
      COALESCE(MAX(CASE WHEN [name] = @name THEN 1
        ELSE TRY_CONVERT(INT, SUBSTRING([name], LEN(@name) + 2, 96)) END), 0) AS [highestSuffix]
      FROM [dbo].[Players] WHERE [name] = @name OR [name] LIKE @prefix ESCAPE N'~';`,
    { name: str(base, PLAYER_NAME_MAX_LENGTH), prefix: str(`${prefix} %`, 200) }
  )
  if (!row) throw new Error('Player name allocation did not return an aggregate.')
  if (rowNumber(row, 'hasBase') === 0) return base
  const highest = rowNumber(row, 'highestSuffix')
  if (highest >= 2_147_483_647) {
    return new DomainError(
      'PLAYER_NAME_UNAVAILABLE',
      'This adventurer name could not be reserved. Please retry.',
      true
    )
  }
  return `${base} ${Math.max(1, highest) + 1}`
}

export async function registerPlayer(ctx: RayfinContext, value: unknown): Promise<User> {
  const input = registrationInput(value)
  const result = await withSql(ctx, sql =>
    sql.transaction(async transaction => {
      const now = new Date()
      if (!(await reserveEntryAttempt(transaction, now))) {
        return new DomainError(
          'PLAYER_ENTRY_LIMITED',
          'Too many player-entry attempts. Please wait one minute and try again.'
        )
      }
      const [existing] = await transaction.query(
        `SELECT ${PLAYER_COLUMNS} FROM [dbo].[Players] WITH (UPDLOCK, HOLDLOCK) WHERE ` +
          (input.mode === 'new' ? '[id] = @id;' : '[name] = @name;'),
        input.mode === 'new'
          ? { id: id(input.requestId) }
          : { name: str(input.name, PLAYER_NAME_MAX_LENGTH) }
      )
      if (existing) {
        const expired =
          now.getTime() - Date.parse(rowDate(existing, 'attemptWindowStartedAt')) >=
          PLAYER_ENTRY_LIMITS.playerWindowMs
        const failures = expired ? 0 : rowNumber(existing, 'failedAttempts')
        const stored = rowOptionalText(existing, 'passwordHash')
        const verified = await verifyPlayerPassword(input.password, stored ?? UNKNOWN_PLAYER_HASH)
        if (failures >= PLAYER_ENTRY_LIMITS.failuresPerPlayer) return verificationFailure()
        if (!verified || stored === undefined) {
          await transaction.query(
            'UPDATE [dbo].[Players] SET [failedAttempts] = @failures, [attemptWindowStartedAt] = @started WHERE [id] = @id;',
            {
              id: id(rowUuid(existing, 'id')),
              failures: int(failures + 1),
              started: date(expired ? now : new Date(rowDate(existing, 'attemptWindowStartedAt'))),
            }
          )
          return verificationFailure()
        }
        if (input.mode === 'new' && input.country !== normalizeCountry(rowText(existing, 'country'))) {
          return new DomainError(
            'PLAYER_REGISTRATION_CONFLICT',
            'This registration used a different country. Retry the original registration or start a new adventure.'
          )
        }
        await transaction.query(
          'UPDATE [dbo].[Players] SET [failedAttempts] = @failures, [attemptWindowStartedAt] = @started WHERE [id] = @id;',
          { id: id(rowUuid(existing, 'id')), failures: int(0), started: date(now) }
        )
        return playerDto(existing)
      }
      if (input.mode === 'returning') {
        await verifyPlayerPassword(input.password, UNKNOWN_PLAYER_HASH)
        return verificationFailure()
      }
      const name = await availableName(transaction)
      if (name instanceof DomainError) return name
      const passwordHash = await hashPlayerPassword(input.password)
      await transaction.insert(
        'Players',
        [
          'id',
          'name',
          'country',
          'passwordHash',
          'failedAttempts',
          'attemptWindowStartedAt',
          'createdAt',
        ],
        [
          [
            id(input.requestId),
            str(name, PLAYER_NAME_MAX_LENGTH),
            str(input.country, 80),
            str(passwordHash, 160),
            int(0),
            date(now),
            date(now),
          ],
        ]
      )
      return { userId: input.requestId, name, country: input.country, createdAt: now.toISOString() }
    })
  )
  // Failed-attempt counters must commit; throwing inside the transaction would undo them.
  if (result instanceof DomainError) throw result
  return result
}
