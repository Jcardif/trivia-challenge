import { describe, expect, it } from '@jest/globals'
import { id, insertBatches, int, rowUuid, str } from '../src/sql.js'
import { verifyStartReplay } from '../src/game.js'
import { uuid } from '../src/validation.js'

describe('parameterized SQL insert batching', () => {
  it('keeps wide imports below the SQL 2100-parameter limit and preserves every row', () => {
    const columns = Array.from({ length: 13 }, (_, index) => `field${index}`)
    const rows = Array.from({ length: 1001 }, (_, row) => columns.map((_, column) => str(`${row}:${column}`)))
    const batches = [...insertBatches('SessionQuestions', columns, rows)]
    expect(batches).toHaveLength(7)
    expect(batches.every((batch) => Object.keys(batch.parameters).length <= 2000)).toBe(true)
    expect(batches.flatMap((batch) => Object.values(batch.parameters))).toHaveLength(1001 * 13)
  })

  it('obeys the SQL 1000 VALUES row limit even with narrow rows', () => {
    const batches = [...insertBatches('Questions', ['ordinal'], Array.from({ length: 2500 }, (_, i) => [int(i)]))]
    expect(batches.map((batch) => Object.keys(batch.parameters).length)).toEqual([1000, 1000, 500])
  })

  it('never concatenates caller values into SQL', () => {
    const value = "'); DROP TABLE Players;--"
    const [batch] = [...insertBatches('Players', ['id', 'name'], [[
      id('11111111-1111-4111-8111-111111111111'), str(value),
    ]])]
    expect(batch.sql).not.toContain(value)
    expect(batch.parameters.p0_1.value).toBe(value)
    expect(batch.sql).toContain('VALUES (@p0_0, @p0_1)')
  })

  it('rejects mismatched row shapes and unsafe internal column names', () => {
    expect(() => [...insertBatches('Players', ['id', 'name'], [[str('name')]])]).toThrow()
    expect(() => [...insertBatches('Players', ['name];DROP'], [[str('name')]])]).toThrow()
    expect([...insertBatches('Questions', ['ordinal'], [])]).toEqual([])
  })

  it('normalizes SQL GUIDs and request GUIDs to the same retry identity', () => {
    const returnedBySql = 'ABCDEFAB-ABCD-4ABC-8ABC-ABCDEFABCDEF'
    const stored = { userId: rowUuid({ player_id: returnedBySql }, 'player_id'), poolId: 'pool' }
    const requested = { userId: uuid(returnedBySql.toLowerCase(), 'userId'), poolId: 'pool' }
    expect(stored.userId).toBe(returnedBySql.toLowerCase())
    expect(() => verifyStartReplay(stored, requested)).not.toThrow()
  })
})
