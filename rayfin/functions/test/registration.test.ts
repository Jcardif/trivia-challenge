import { readFileSync } from 'node:fs'
import { describe, expect, it } from '@jest/globals'
import ts from 'typescript'
import type { OperationMap } from '../src/contracts.js'

const operations: Record<keyof OperationMap, true> = {
  registerPlayer: true,
  listPools: true,
  getPool: true,
  createPool: true,
  previewQuestionImport: true,
  importQuestions: true,
  startSession: true,
  getSessionQuestions: true,
  submitAnswer: true,
  endSession: true,
  trackTelemetryBatch: true,
}
const source = ts.createSourceFile(
  'function_app.ts',
  readFileSync(new URL('../src/function_app.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TS,
)
const registrations = source.statements.flatMap((statement) =>
  ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) &&
  statement.expression.expression.getText(source) === 'udf.func' ? [statement.expression] : [],
)

describe('Functions deployment discovery', () => {
  it('registers every canonical operation once as a top-level literal with an inline typed handler', () => {
    const names = registrations.map((registration) => {
      const name = registration.arguments[0]
      if (!ts.isStringLiteral(name)) throw new Error('Function name must be a literal.')
      const handler = registration.arguments[1]
      if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) {
        throw new Error(`${name.text} must use an inline handler.`)
      }
      expect(handler.parameters.map((parameter) => ({
        name: parameter.name.getText(source),
        type: parameter.type?.getText(source),
      }))).toEqual([
        { name: 'ctx', type: 'RayfinContext' },
        { name: 'payload', type: 'string' },
      ])
      expect(handler.type?.getText(source)).toBe('Promise<string>')
      return name.text
    })
    expect(names.sort()).toEqual(Object.keys(operations).sort())
  })
})
