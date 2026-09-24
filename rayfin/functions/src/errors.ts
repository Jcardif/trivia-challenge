import type { FunctionResult } from './contracts.js'

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly validationErrors?: Array<{ row: number; message: string }>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export async function functionResult<T>(
  payload: string,
  operation: (input: unknown) => Promise<T>,
): Promise<string> {
  try {
    let input: unknown
    try {
      input = JSON.parse(payload)
    } catch {
      throw new DomainError('VALIDATION_ERROR', 'payload must contain valid JSON.')
    }
    return JSON.stringify({ success: true, data: await operation(input) } satisfies FunctionResult<T>)
  } catch (error: unknown) {
    if (!(error instanceof DomainError)) {
      // The Functions host returns and logs thrown messages and properties.
      throw new Error('The operation failed unexpectedly.')
    }
    return JSON.stringify({
      success: false,
      code: error.code,
      errorMessage: error.message,
      retryable: error.retryable,
      ...(error.validationErrors ? { validationErrors: error.validationErrors } : {}),
    } satisfies FunctionResult<T>)
  }
}
