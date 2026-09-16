import { RayfinClient, resolveRayfinConfig } from '@microsoft/rayfin-client'
import { ensureSignedInWithFabric, type FabricAuthOptions } from '@microsoft/rayfin-auth-provider-fabric'
import type { AppFunctionsSchema, FunctionResult, OperationMap } from '../types/api'
import { OperationError } from './operationError'
import { operationResponseValidators, validValidationErrors } from './operationResponses'

export { OperationError } from './operationError'

export type AppClient = RayfinClient<Record<string, never>, AppFunctionsSchema>
type OperationInvokers = {
  [K in keyof OperationMap]: (input: { payload: string }) => Promise<FunctionResult<OperationMap[K]['output']>>
}
type OperatorConnection = {
  client: AppClient
  fabricOptions: FabricAuthOptions
  invoke: OperationInvokers
}

let connection: Promise<OperatorConnection> | undefined
let authenticationFailure: string | null = null
const authenticationListeners = new Set<() => void>()

export function getAuthenticationFailure(): string | null {
  return authenticationFailure
}

export function onAuthenticationFailure(listener: () => void): () => void {
  authenticationListeners.add(listener)
  return () => { authenticationListeners.delete(listener) }
}

function reportAuthenticationFailure(message: string | null): void {
  authenticationFailure = message
  authenticationListeners.forEach(listener => listener())
}

export function getOperatorConnection(): Promise<OperatorConnection> {
  if (!connection) {
    connection = initializeConnection().catch((error: unknown) => {
      connection = undefined
      throw error
    })
  }
  return connection
}

async function initializeConnection(): Promise<OperatorConnection> {
  const localHosts = ['localhost', '127.0.0.1', '[::1]']
  if (localHosts.includes(window.location.hostname)) {
    throw new OperationError(
      'Local Fabric operator sign-in is not supported. Use the deployed Fabric app to register attendees and save games.',
      'LOCAL_FABRIC_UNSUPPORTED',
      false,
    )
  }
  const resolved = await resolveRayfinConfig({})
  const { workspaceId, itemId, portalUrl } = resolved.runtimeConfig
  if (!resolved.baseUrl || !resolved.publishableKey || !workspaceId || !itemId || !portalUrl) {
    throw new OperationError(
      'Fabric configuration is missing. Open the deployed app with its runtime configuration. Local Fabric operator sign-in is not supported.',
      'CONFIGURATION_MISSING',
      false,
    )
  }
  const serviceUrl = new URL(resolved.baseUrl, window.location.origin)
  if (localHosts.includes(serviceUrl.hostname)) {
    throw new OperationError(
      'Local Fabric operator sign-in is not supported. Use the deployed Fabric app to register attendees and save games.',
      'LOCAL_FABRIC_UNSUPPORTED',
      false,
    )
  }
  const client: AppClient = new RayfinClient({
    baseUrl: resolved.baseUrl,
    publishableKey: resolved.publishableKey,
    runtimeConfig: resolved.runtimeConfig,
    authStorage: true,
    persistSession: true,
    multiTabSync: false,
  })
  return {
    client,
    invoke: {
      registerPlayer: input => client.functions.registerPlayer.invoke(input),
      listPools: input => client.functions.listPools.invoke(input),
      getPool: input => client.functions.getPool.invoke(input),
      createPool: input => client.functions.createPool.invoke(input),
      previewQuestionImport: input => client.functions.previewQuestionImport.invoke(input),
      importQuestions: input => client.functions.importQuestions.invoke(input),
      startSession: input => client.functions.startSession.invoke(input),
      getSessionQuestions: input => client.functions.getSessionQuestions.invoke(input),
      submitAnswer: input => client.functions.submitAnswer.invoke(input),
      endSession: input => client.functions.endSession.invoke(input),
      trackTelemetryBatch: input => client.functions.trackTelemetryBatch.invoke(input),
    },
    fabricOptions: {
      workspaceId,
      projectId: itemId,
      fabricPortalUrl: portalUrl,
      returnOrigin: window.location.origin,
    },
  }
}

// The caller must invoke this directly in its click handler, before any await.
export function signInOperator(readyConnection: OperatorConnection): Promise<void> {
  return ensureSignedInWithFabric(readyConnection.client.auth, readyConnection.fabricOptions)
    .then(session => {
      if (!session.isAuthenticated) {
        throw new OperationError('Fabric did not establish an operator session.', 'OPERATOR_SIGN_IN_REQUIRED', false)
      }
      reportAuthenticationFailure(null)
    })
}

export async function invokeOperation<K extends keyof OperationMap>(
  name: K,
  input: OperationMap[K]['input'],
): Promise<OperationMap[K]['output']> {
  const { client, invoke } = await getOperatorConnection()
  if (!client.auth.getSession().isAuthenticated || authenticationFailure) {
    throw new OperationError(
      'The kiosk operator must sign in with Fabric. Pending game writes are kept in this browser tab.',
      'OPERATOR_SIGN_IN_REQUIRED',
      false,
    )
  }

  try {
    const result = await invoke[name](
      { payload: JSON.stringify(input) },
    )
    if (!result || typeof result !== 'object' || typeof result.success !== 'boolean') {
      throw new OperationError('The Function returned an invalid response.', 'INVALID_RESPONSE', false)
    }
    if (!result.success) {
      if (typeof result.code !== 'string' || typeof result.errorMessage !== 'string' ||
          typeof result.retryable !== 'boolean' || !validValidationErrors(result.validationErrors)) {
        throw new OperationError('The Function returned an invalid error response.', 'INVALID_RESPONSE', false)
      }
      throw new OperationError(result.errorMessage, result.code, result.retryable, result.validationErrors)
    }
    if (!operationResponseValidators[name](result.data)) {
      throw new OperationError('The Function returned an invalid result for this operation.', 'INVALID_RESPONSE', false)
    }
    return result.data
  } catch (error: unknown) {
    if (error instanceof OperationError) throw error
    if (error instanceof RayfinClient.errors.NetworkError) {
      if (error.status === 401) {
        reportAuthenticationFailure('The operator session was rejected. Sign out the operator, then sign in again. Keep this tab open to retry pending writes.')
        throw new OperationError('The operator session needs to be renewed.', 'OPERATOR_SIGN_IN_REQUIRED', false)
      }
      throw new OperationError(
        error.status === 403
          ? 'This operator does not have permission to invoke the app. Ask the deployment operator to verify Fabric access.'
          : 'The Fabric request failed. Keep this tab open and retry when the connection is available.',
        error.code ?? 'NETWORK_ERROR',
        error.status === undefined || error.status === 408 || error.status === 429 || error.status >= 500,
      )
    }
    throw new OperationError(
      error instanceof Error ? error.message : 'The Fabric operation failed unexpectedly.',
      'FUNCTION_INVOCATION_FAILED',
      true,
    )
  }
}
