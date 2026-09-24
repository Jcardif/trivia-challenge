import { describe, expect, it } from '@jest/globals'
import { fileURLToPath } from 'node:url'
import { generateFunctionsMetadata } from '../../../node_modules/@microsoft/rayfin-cli/dist/utils/functions-metadata-generator.js'

describe('Function connection declarations', () => {
  it('generates deploy metadata with the same contracts and no delegated data connections', async () => {
    const metadata = await generateFunctionsMetadata(fileURLToPath(new URL('..', import.meta.url)))
    const functions = metadata.functionsMetadata
    expect(functions.map(fn => fn.name).sort()).toEqual([
      'createPool', 'endSession', 'getPool', 'getSessionQuestions', 'importQuestions',
      'listPools', 'previewQuestionImport', 'registerPlayer', 'startSession',
      'submitAnswer', 'trackTelemetryBatch',
    ])
    for (const fn of functions) {
      expect({ name: fn.name, connections: fn.bindings.filter(binding => binding.type === 'FabricItem') })
        .toEqual({ name: fn.name, connections: [] })
      expect(fn.fabricProperties.fabricFunctionParameters.map(parameter => [parameter.name, parameter.dataType]))
        .toEqual([['ctx', 'RayfinContext'], ['payload', 'string']])
    }
  })
})
