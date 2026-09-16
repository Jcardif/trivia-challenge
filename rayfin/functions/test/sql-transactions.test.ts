import { describe, expect, it, jest } from '@jest/globals'
import { Connection } from 'tedious'
import { SqlSession, str } from '../src/sql.js'

function setup() {
  const connection = new Connection({ server: 'unused.example.invalid' })
  const calls: string[] = []
  const batch = jest.spyOn(connection, 'execSqlBatch').mockImplementation(request => {
    calls.push('settings')
    request.callback(null, 0)
  })
  const query = jest.spyOn(connection, 'execSql').mockImplementation(request => {
    calls.push('query')
    request.callback(/\b(BEGIN|COMMIT|ROLLBACK)\b/i.test(request.sqlTextOrProcedure ?? '')
      ? new Error('Transaction count after EXECUTE indicates a mismatching number of BEGIN and COMMIT statements.')
      : null, 0)
  })
  const begin = jest.spyOn(connection, 'beginTransaction').mockImplementation(callback => {
    calls.push('begin')
    callback(null)
  })
  const commit = jest.spyOn(connection, 'commitTransaction').mockImplementation(callback => {
    calls.push('commit')
    callback(null)
  })
  const rollback = jest.spyOn(connection, 'rollbackTransaction').mockImplementation(callback => {
    calls.push('rollback')
    callback(null)
  })
  const close = jest.spyOn(connection, 'close').mockImplementation(() => { calls.push('close') })
  return { session: new SqlSession(connection), calls, batch, query, begin, commit, rollback, close }
}

describe('SQL transaction transport', () => {
  it('uses session settings and native transaction boundaries around parameterized queries', async () => {
    const { session, calls, batch, query } = setup()
    await expect(session.transaction(async sql => {
      await sql.query('SELECT @value;', { value: str('parameterized value') })
      return 42
    })).resolves.toBe(42)
    expect(calls).toEqual(['settings', 'begin', 'query', 'commit'])
    expect(batch.mock.calls[0][0].sqlTextOrProcedure).toBe('SET XACT_ABORT ON; SET LOCK_TIMEOUT 60000;')
    expect(query.mock.calls[0][0].parametersByName.value.value).toBe('parameterized value')
  })

  it('rolls back application failures without committing', async () => {
    const { session, calls } = setup()
    const failure = new Error('The import failed.')
    await expect(session.transaction(async () => { throw failure })).rejects.toBe(failure)
    expect(calls).toEqual(['settings', 'begin', 'rollback'])
  })

  it('rolls back a failed commit and preserves that error', async () => {
    const { session, commit, rollback } = setup()
    const failure = new Error('Commit rejected.')
    commit.mockImplementation(callback => callback(failure))
    await expect(session.transaction(async () => 42)).rejects.toBe(failure)
    expect(rollback).toHaveBeenCalledTimes(1)
  })

  it('does not start work if session settings or transaction startup fails', async () => {
    const first = setup()
    const failure = new Error('Connection failed.')
    first.batch.mockImplementation(request => request.callback(failure))
    const action = jest.fn(async () => 42)
    await expect(first.session.transaction(action)).rejects.toBe(failure)
    expect(first.begin).not.toHaveBeenCalled()
    const second = setup()
    second.begin.mockImplementation(callback => callback(failure))
    await expect(second.session.transaction(action)).rejects.toBe(failure)
    expect(action).not.toHaveBeenCalled()
    expect(second.rollback).not.toHaveBeenCalled()
  })

  it('closes the connection when rollback fails without hiding the original error', async () => {
    const { session, rollback, close } = setup()
    const failure = new Error('Original failure.')
    rollback.mockImplementation(callback => callback(new Error('Connection lost.')))
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(session.transaction(async () => { throw failure })).rejects.toBe(failure)
      expect(close).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledWith('SQL rollback failed; closing the connection to discard uncommitted work.')
    } finally {
      log.mockRestore()
    }
  })
})
