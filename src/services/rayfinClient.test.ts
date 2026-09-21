/**
 * @jest-environment-options {"url":"https://trivia.example.invalid"}
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals'

let authenticated = false
const signOut = jest.fn(async () => { authenticated = false })
const auth = { getSession: () => ({ isAuthenticated: authenticated }), signOut }
const invokePools = jest.fn<() => Promise<unknown>>()
const ensureSignedIn = jest.fn(async () => {
  authenticated = true
  return { isAuthenticated: true }
})
const initiateLogin = jest.fn(async () => { authenticated = true })

class NetworkError extends Error {
  readonly status = 401
}

jest.unstable_mockModule('@microsoft/rayfin-client', () => ({
  RayfinClient: class {
    static errors = { NetworkError }
    auth = auth
    functions = { listPools: { invoke: invokePools } }
  },
  resolveRayfinConfig: async () => ({
    baseUrl: 'https://api.example.invalid',
    publishableKey: 'pk-test',
    runtimeConfig: {
      workspaceId: '11111111-1111-4111-8111-111111111111',
      itemId: '22222222-2222-4222-8222-222222222222',
      portalUrl: 'https://app.fabric.microsoft.com',
    },
  }),
}))
jest.unstable_mockModule('@microsoft/rayfin-auth-provider-fabric', () => ({
  ensureSignedInWithFabric: ensureSignedIn,
  initiateFabricLogin: initiateLogin,
}))

beforeEach(() => {
  jest.resetModules()
  authenticated = false
  signOut.mockClear()
  invokePools.mockReset().mockResolvedValue({ success: true, data: [] })
  ensureSignedIn.mockClear()
  initiateLogin.mockReset().mockImplementation(async () => { authenticated = true })
})

describe('operator sign-in recovery', () => {
  it('retains the normal SDK sign-in flow for a browser without a rejected session', async () => {
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    const signIn = client.signInOperator(connection)
    expect(ensureSignedIn).toHaveBeenCalledWith(auth, connection.fabricOptions)
    expect(initiateLogin).not.toHaveBeenCalled()
    await signIn
    expect(client.getAuthenticationFailure()).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('renews a rejected session directly through the broker without signing out or reusing it', async () => {
    authenticated = true
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    const changed = jest.fn()
    const unsubscribe = client.onAuthenticationFailure(changed)
    invokePools.mockRejectedValueOnce(new NetworkError('Unauthorized'))
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(authenticated).toBe(true)
    expect(client.getAuthenticationFailure()).toMatch(/Sign in again with Fabric/)
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(invokePools).toHaveBeenCalledTimes(1)

    const signIn = client.signInOperator(connection)
    // The broker must be called before returning to preserve the browser's user gesture.
    expect(initiateLogin).toHaveBeenCalledWith(auth, connection.fabricOptions)
    expect(ensureSignedIn).not.toHaveBeenCalled()
    await signIn
    expect(signOut).not.toHaveBeenCalled()
    expect(client.getAuthenticationFailure()).toBeNull()
    expect(changed).toHaveBeenCalledTimes(2)
    await expect(client.invokeOperation('listPools', {})).resolves.toEqual([])
    unsubscribe()
  })

  it('keeps requests blocked after a cancelled broker login and permits another recovery attempt', async () => {
    authenticated = true
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    invokePools.mockRejectedValueOnce(new NetworkError('Unauthorized'))
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    initiateLogin.mockRejectedValueOnce(new Error('Popup closed'))
    await expect(client.signInOperator(connection)).rejects.toThrow('Popup closed')
    expect(client.getAuthenticationFailure()).not.toBeNull()
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(invokePools).toHaveBeenCalledTimes(1)
    await client.signInOperator(connection)
    expect(initiateLogin).toHaveBeenCalledTimes(2)
    expect(client.getAuthenticationFailure()).toBeNull()
    expect(signOut).not.toHaveBeenCalled()
  })

  it('does not clear the failure unless the broker establishes an authenticated session', async () => {
    authenticated = true
    const client = await import('./rayfinClient')
    const connection = await client.getOperatorConnection()
    invokePools.mockRejectedValueOnce(new NetworkError('Unauthorized'))
    await expect(client.invokeOperation('listPools', {})).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    initiateLogin.mockImplementationOnce(async () => { authenticated = false })
    await expect(client.signInOperator(connection)).rejects.toMatchObject({ code: 'OPERATOR_SIGN_IN_REQUIRED' })
    expect(client.getAuthenticationFailure()).not.toBeNull()
  })
})
