import { randomUUID } from 'node:crypto'
import type { RayfinContext } from '@microsoft/fabric-user-data-functions'
import type { User } from './contracts.js'
import { date, id, rowDate, rowOptionalText, rowText, rowUuid, str, withSql, type SqlRow } from './sql.js'
import { registrationInput } from './validation.js'

function playerDto(row: SqlRow): User {
  return {
    userId: rowUuid(row, 'id'),
    email: rowText(row, 'email'),
    name: rowText(row, 'name'),
    phoneNumber: rowOptionalText(row, 'phoneNumber'),
    country: rowOptionalText(row, 'country'),
    state: rowOptionalText(row, 'state'),
    createdAt: rowDate(row, 'createdAt'),
  }
}

export async function registerPlayer(ctx: RayfinContext, value: unknown): Promise<User> {
  const input = registrationInput(value)
  return withSql(ctx, (sql) => sql.transaction(async (transaction) => {
    const [existing] = await transaction.query(
      'SELECT * FROM [dbo].[Players] WITH (UPDLOCK, HOLDLOCK) WHERE [email] = @email;',
      { email: str(input.email, 320) },
    )
    if (existing) return playerDto(existing)
    const userId = randomUUID()
    const createdAt = new Date()
    await transaction.insert('Players',
      ['id', 'email', 'name', 'phoneNumber', 'country', 'state', 'createdAt'],
      [[id(userId), str(input.email, 320), str(input.name), str(input.phoneNumber),
        str(input.country), str(input.state), date(createdAt)]],
    )
    const [created] = await transaction.query('SELECT * FROM [dbo].[Players] WHERE [id] = @id;', { id: id(userId) })
    if (!created) throw new Error('Created player could not be read back.')
    return playerDto(created)
  }))
}
