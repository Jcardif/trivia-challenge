export class OperationError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly validationErrors?: Array<{ row: number; message: string }>

  constructor(
    message: string,
    code: string,
    retryable: boolean,
    validationErrors?: Array<{ row: number; message: string }>,
  ) {
    super(message)
    this.name = 'OperationError'
    this.code = code
    this.retryable = retryable
    this.validationErrors = validationErrors
  }
}
