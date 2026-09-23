import { UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions'
import { functionResult } from './errors.js'
import { registerPlayer } from './players.js'
import { createPool, getPool, importQuestions, listPools, previewQuestionImport } from './questions.js'
import { endSession, getSessionQuestions, startSession, submitAnswer } from './sessions.js'
import { trackTelemetryBatch } from './telemetry.js'

const udf = new UserDataFunctions()

udf.func('registerPlayer', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => registerPlayer(ctx, input)))

udf.func('listPools', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => listPools(ctx, input)))

udf.func('getPool', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => getPool(ctx, input)))

udf.func('createPool', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => createPool(ctx, input)))

udf.func('importQuestions', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => importQuestions(ctx, input)))

udf.func('previewQuestionImport', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => previewQuestionImport(ctx, input)))

udf.func('startSession', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => startSession(ctx, input)))

udf.func('getSessionQuestions', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => getSessionQuestions(ctx, input)))

udf.func('submitAnswer', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => submitAnswer(ctx, input)))

udf.func('endSession', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => endSession(ctx, input)))

udf.func('trackTelemetryBatch', async (ctx: RayfinContext, payload: string): Promise<string> =>
  functionResult(payload, (input) => trackTelemetryBatch(ctx, input)))
