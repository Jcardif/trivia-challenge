import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { generateDabConfig } from '../node_modules/@microsoft/rayfin-cli/dist/utils/dab-config-generator.js'

const result = await generateDabConfig({
  projectRoot: process.cwd(),
  dialect: 'mssql',
  buildCommand: 'npm run build:schema',
})
const config = JSON.parse(await readFile(result.configPath, 'utf8'))
const expected = [
  'Player', 'QuestionPool', 'QuestionImport', 'Question', 'QuestionPoolMembership',
  'GameSession', 'SessionQuestion', 'GameSessionAnswer',
].sort()
assert.deepEqual(Object.keys(config.entities).sort(), expected,
  'Schema must contain exactly the eight application entities.')
for (const [name, entity] of Object.entries(config.entities)) {
  assert.deepEqual(entity.permissions, [{
    role: 'authenticated',
    actions: [{ action: 'read', policy: { database: '@item.id ne @item.id' } }],
  }], `${name} must not expose records or writes through direct browser data APIs.`)
  assert.deepEqual(entity['x-schema'].constraints.primaryKey.columns, ['id'])
  for (const field of Object.values(entity['x-schema'].fields)) {
    assert.notEqual(field.dbType, 'NVARCHAR(MAX)', `${name} has unbounded text.`)
  }
}
console.log(`Generated ${expected.length} application entities with private Data API policies.`)
