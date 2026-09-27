import { beforeEach, describe, expect, it, jest } from '@jest/globals'
import { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { SqlParameters, SqlRow, SqlTable, SqlValue } from '../src/sql.js'
import {
  isGeneratedPlayerName,
  PLAYER_NAME_PREFIXES,
  PLAYER_NAME_TITLES,
} from '../src/playerIdentity.js'

const realCrypto = await import('node:crypto')
let forceNameWords = false
jest.unstable_mockModule('node:crypto', () => ({
  ...realCrypto,
  randomInt: (max: number) => (forceNameWords ? 0 : realCrypto.randomInt(max)),
}))
const realSql = await import('../src/sql.js')
let tables: Record<string, SqlRow[]> = {}
let failPlayerInsert = false
let transactionTail: Promise<unknown> = Promise.resolve()
const query = jest.fn(
  async (statement: string, parameters: SqlParameters = {}): Promise<SqlRow[]> => {
    if (statement.startsWith('UPDATE [dbo].[PlayerEntryStates]')) {
      const row = tables.PlayerEntryStates.find(entry => entry.id === parameters.id.value)
      if (!row) throw new Error('Entry state is missing')
      row.windowStartedAt = parameters.started.value
      row.attemptCount = parameters.count.value
      return []
    }
    if (statement.includes('FROM [dbo].[PlayerEntryStates]')) {
      return tables.PlayerEntryStates.filter(row => row.id === parameters.id.value)
    }
    if (statement.startsWith('UPDATE [dbo].[Players]')) {
      const row = tables.Players.find(entry => entry.id === parameters.id.value)
      if (!row) throw new Error('Player is missing')
      row.failedAttempts = parameters.failures.value
      row.attemptWindowStartedAt = parameters.started.value
      return []
    }
    if (statement.includes('AS [highestSuffix]')) {
      const base = String(parameters.name.value)
      const names = tables.Players.map(row => row.name).filter(
        (name): name is string => typeof name === 'string'
      )
      const suffixes = names
        .filter(name => name.startsWith(`${base} `))
        .map(name => Number(name.slice(base.length + 1)))
        .filter(Number.isInteger)
      return [
        {
          hasBase: names.includes(base) ? 1 : 0,
          highestSuffix: Math.max(names.includes(base) ? 1 : 0, ...suffixes),
        },
      ]
    }
    if (statement.includes('FROM [dbo].[Players]')) {
      return tables.Players.filter(row =>
        parameters.id
          ? row.id === parameters.id.value
          : parameters.name
            ? row.name === parameters.name.value
            : true
      )
    }
    throw new Error(`Unexpected query: ${statement}`)
  }
)
const insert = jest.fn(
  async (table: SqlTable, columns: readonly string[], rows: readonly SqlValue[][]) => {
    if (table === 'Players' && failPlayerInsert) throw new Error('Simulated player insert failure')
    for (const row of rows) {
      const entry = Object.fromEntries(columns.map((column, index) => [column, row[index].value]))
      if (
        tables[table].some(
          existing =>
            existing.id === entry.id ||
            (table === 'Players' && existing.name === entry.name)
        )
      ) {
        throw new Error('Unique constraint violation')
      }
      tables[table].push(entry)
    }
  }
)
const dataSession = { query, insert }
const transaction = jest.fn(<T>(action: (sql: typeof dataSession) => Promise<T>): Promise<T> => {
  const next = transactionTail.then(async () => {
    const previous = structuredClone(tables)
    try {
      return await action(dataSession)
    } catch (error) {
      tables = previous
      throw error
    }
  })
  transactionTail = next.catch(() => undefined)
  return next
})
jest.unstable_mockModule('../src/sql.js', () => ({
  ...realSql,
  withSql: async <T>(
    _ctx: RayfinContext,
    action: (sql: typeof dataSession & { transaction: typeof transaction }) => Promise<T>
  ) => action({ ...dataSession, transaction }),
}))
const { registerPlayer, PLAYER_ENTRY_LIMITS } = await import('../src/players.js')
const ctx = new RayfinContext({
  rayFinEndpoint: 'https://example.invalid',
  publishableKey: 'pk-test',
  rayfinToken: '',
})
const PASSWORD = 'otter-42'
const WRONG_PASSWORD = 'otter-43'
const request = () => ({
  mode: 'new',
  requestId: realCrypto.randomUUID(),
  country: 'Canada',
  password: PASSWORD,
})
const resume = (name: string, password = PASSWORD) => ({ mode: 'returning', name, password })

beforeEach(() => {
  tables = { Players: [], PlayerEntryStates: [] }
  forceNameWords = false
  failPlayerInsert = false
  transactionTail = Promise.resolve()
  query.mockClear()
  insert.mockClear()
  transaction.mockClear()
})

describe('contact-free player persistence', () => {
  it('uses a plain name first, then 2 and 3, with one name query per concurrent creation', async () => {
    forceNameWords = true
    const base = `${PLAYER_NAME_PREFIXES[0]} ${PLAYER_NAME_TITLES[0]}`
    const inputs = [request(), request(), request()]
    const players = await Promise.all(inputs.map(input => registerPlayer(ctx, input)))
    expect(players.map(player => player.name)).toEqual([base, `${base} 2`, `${base} 3`])
    expect(query.mock.calls.filter(([sql]) => sql.includes('AS [highestSuffix]'))).toHaveLength(3)
    expect(await registerPlayer(ctx, inputs[1])).toEqual(players[1])
    expect(query.mock.calls.filter(([sql]) => sql.includes('AS [highestSuffix]'))).toHaveLength(3)
  })

  it('increments the highest numeric collision suffix rather than probing all existing names', async () => {
    forceNameWords = true
    const first = await registerPlayer(ctx, request())
    tables.Players.push(
      { name: `${first.name} 9` },
      { name: `${first.name} 10` },
      { name: `${first.name} Extra` }
    )
    expect((await registerPlayer(ctx, request())).name).toBe(`${first.name} 11`)
    const allocations = query.mock.calls.filter(([sql]) => sql.includes('AS [highestSuffix]'))
    expect(allocations).toHaveLength(2)
    expect(allocations[1][0]).toContain("LIKE @prefix ESCAPE N'~'")
  })

  it('stores the selected country and returns it without disclosing private verification state', async () => {
    const input = request()
    const player = await registerPlayer(ctx, input)
    expect(Object.keys(player).sort()).toEqual(['country', 'createdAt', 'name', 'userId'])
    expect(player.country).toBe('Canada')
    expect(player.userId).toBe(input.requestId)
    expect(isGeneratedPlayerName(player.name)).toBe(true)
    expect(tables.Players).toHaveLength(1)
    expect(tables.Players[0]).toMatchObject({
      id: input.requestId,
      country: 'Canada',
      failedAttempts: 0,
    })
    expect(tables.Players[0].passwordHash).toMatch(/^scrypt-v1:/)
    expect(JSON.stringify(tables.Players[0])).not.toContain(PASSWORD)
    for (const key of ['email', 'phoneNumber', 'state', 'city', 'password', 'playerCode']) {
      expect(tables.Players[0]).not.toHaveProperty(key)
    }
    expect(JSON.stringify(player)).not.toMatch(/password|hash|salt|failedAttempts/i)
  })

  it('does not change the saved country when a creation ID is replayed with different input', async () => {
    const input = request()
    const player = await registerPlayer(ctx, input)
    await expect(registerPlayer(ctx, { ...input, country: 'Kenya' })).rejects.toMatchObject({
      code: 'PLAYER_REGISTRATION_CONFLICT',
    })
    expect(tables.Players).toHaveLength(1)
    expect(tables.Players[0].country).toBe('Canada')
    expect(await registerPlayer(ctx, resume(player.name))).toEqual(player)
  })

  it.each([
    ['Åland Islands', 'Aland Islands'],
    ['Côte d’Ivoire', "Cote d'Ivoire"],
    ['Curaçao', 'Curacao'],
    ['Réunion', 'Reunion'],
    ['Saint Barthélemy', 'Saint Barthelemy'],
    ['São Tomé and Príncipe', 'Sao Tome and Principe'],
    ['Türkiye', 'Turkiye'],
  ])('stores %s as %s and preserves legacy-player returns and creation retries', async (previous, current) => {
    const input = { ...request(), country: previous }
    const player = await registerPlayer(ctx, input)
    expect(player.country).toBe(current)
    expect(tables.Players[0].country).toBe(current)
    const playerInsert = insert.mock.calls.find(([table]) => table === 'Players')
    expect(playerInsert).toBeDefined()
    if (!playerInsert) throw new Error('Missing player insert.')
    const [, columns, rows] = playerInsert
    expect(rows[0][columns.indexOf('country')]).toEqual(realSql.str(current, 80))

    tables.Players[0].country = previous
    expect(await registerPlayer(ctx, resume(player.name))).toEqual(player)
    expect(await registerPlayer(ctx, { ...input, country: current })).toEqual(player)
    expect(await registerPlayer(ctx, input)).toEqual(player)
    expect(tables.Players).toHaveLength(1)
    expect(tables.Players[0].country).toBe(previous)
    await expect(registerPlayer(ctx, { ...input, country: 'Canada' })).rejects.toMatchObject({
      code: 'PLAYER_REGISTRATION_CONFLICT',
    })
  })

  it('replays a creation after a lost response and returns the same player on simultaneous requests', async () => {
    const input = request()
    const [first, replay] = await Promise.all([
      registerPlayer(ctx, input),
      registerPlayer(ctx, input),
    ])
    expect(replay).toEqual(first)
    expect(tables.Players).toHaveLength(1)
    expect(await registerPlayer(ctx, resume(`  ${first.name.toUpperCase()}  `))).toEqual(first)
    expect(tables.Players).toHaveLength(1)
    expect(
      query.mock.calls.some(
        ([statement]) =>
          statement.includes('PlayerEntryStates') && statement.includes('UPDLOCK, HOLDLOCK')
      )
    ).toBe(true)
  })

  it('rejects a different password for either returning entry or an existing creation ID', async () => {
    const input = request()
    const player = await registerPlayer(ctx, input)
    await expect(registerPlayer(ctx, resume(player.name, WRONG_PASSWORD))).rejects.toMatchObject({
      code: 'PLAYER_VERIFICATION_FAILED',
    })
    await expect(registerPlayer(ctx, { ...input, password: WRONG_PASSWORD })).rejects.toMatchObject({
      code: 'PLAYER_VERIFICATION_FAILED',
    })
    expect(tables.Players[0].failedAttempts).toBe(2)
    expect(tables.Players).toHaveLength(1)
  })

  it('keeps failed attempts committed, locks the player temporarily, and permits retry after the window', async () => {
    const player = await registerPlayer(ctx, request())
    for (let i = 0; i < PLAYER_ENTRY_LIMITS.failuresPerPlayer; i++) {
      await expect(registerPlayer(ctx, resume(player.name, WRONG_PASSWORD))).rejects.toMatchObject({
        code: 'PLAYER_VERIFICATION_FAILED',
      })
    }
    expect(tables.Players[0].failedAttempts).toBe(PLAYER_ENTRY_LIMITS.failuresPerPlayer)
    await expect(registerPlayer(ctx, resume(player.name))).rejects.toMatchObject({
      code: 'PLAYER_VERIFICATION_FAILED',
    })
    tables.Players[0].attemptWindowStartedAt = new Date(
      Date.now() - PLAYER_ENTRY_LIMITS.playerWindowMs - 100
    )
    expect(await registerPlayer(ctx, resume(player.name))).toEqual(player)
    expect(tables.Players[0].failedAttempts).toBe(0)
  })

  it('does not reveal whether an unknown name or an incorrect password caused a failure', async () => {
    const player = await registerPlayer(ctx, request())
    const missing = await registerPlayer(ctx, resume(`${player.name} 7`)).catch(error => error)
    const incorrect = await registerPlayer(ctx, resume(player.name, WRONG_PASSWORD)).catch(
      error => error
    )
    expect(missing.code).toBe('PLAYER_VERIFICATION_FAILED')
    expect(incorrect.code).toBe(missing.code)
    expect(incorrect.message).toBe(missing.message)
  })

  it('does not accept any password for a player saved before passwords existed', async () => {
    const player = await registerPlayer(ctx, request())
    tables.Players[0].passwordHash = null
    await expect(registerPlayer(ctx, resume(player.name))).rejects.toMatchObject({
      code: 'PLAYER_VERIFICATION_FAILED',
    })
    expect(tables.Players[0].failedAttempts).toBe(1)
  })

  it('enforces the shared minute limit across requests without using attendee/IP identifiers', async () => {
    tables.PlayerEntryStates.push({
      id: '00000000-0000-4000-8000-000000000001',
      windowStartedAt: new Date(),
      attemptCount: PLAYER_ENTRY_LIMITS.attemptsPerMinute,
    })
    await expect(registerPlayer(ctx, request())).rejects.toMatchObject({
      code: 'PLAYER_ENTRY_LIMITED',
    })
    expect(query).toHaveBeenCalledTimes(1)
    expect(tables.Players).toHaveLength(0)
    tables.PlayerEntryStates[0].windowStartedAt = new Date(Date.now() - 60_100)
    await registerPlayer(ctx, request())
    expect(tables.PlayerEntryStates[0].attemptCount).toBe(1)
  })

  it('rolls back a partially created identity on SQL failure, allowing a stable retry', async () => {
    failPlayerInsert = true
    const input = request()
    await expect(registerPlayer(ctx, input)).rejects.toThrow('Simulated player insert failure')
    expect(tables.Players).toHaveLength(0)
    expect(tables.PlayerEntryStates).toHaveLength(0)
    failPlayerInsert = false
    expect((await registerPlayer(ctx, input)).userId).toBe(input.requestId)
  })

  it('rejects contact data before opening a SQL transaction', async () => {
    await expect(
      registerPlayer(ctx, { ...request(), email: 'person@example.invalid' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(transaction).not.toHaveBeenCalled()
  })
})
