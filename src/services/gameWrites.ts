import type {
  EndSessionRequest, EndSessionResponse, SubmitAnswerRequest, SubmitAnswerResponse,
} from '../types/api'
import { OperationError } from './operationError'

export interface SaveState {
  status: 'idle' | 'saving' | 'error' | 'saved'
  pendingAnswers: number
  error?: string
}

interface GameWriteTransport {
  submitAnswer(sessionId: string, input: SubmitAnswerRequest): Promise<SubmitAnswerResponse>
  end(sessionId: string, input: EndSessionRequest): Promise<EndSessionResponse>
}

interface PendingAnswer {
  input: SubmitAnswerRequest
  accepted?: (result: SubmitAnswerResponse) => void
  failed?: (message: string) => void
}

export const EMPTY_SAVE_STATE: SaveState = { status: 'idle', pendingAnswers: 0 }

export class GameWrites {
  readonly sessionId: string
  private readonly transport: GameWriteTransport
  private readonly onState: (state: SaveState) => void
  private readonly onSaved: (result: EndSessionResponse) => void
  private readonly wait: (milliseconds: number) => Promise<void>
  private answers: PendingAnswer[] = []
  private acceptedCount = 0
  private ending: EndSessionRequest | undefined
  private running = false
  private disposed = false
  private blocked = false
  private completed = false
  private failure: string | undefined

  constructor(
    sessionId: string,
    transport: GameWriteTransport,
    onState: (state: SaveState) => void,
    onSaved: (result: EndSessionResponse) => void,
    wait: (milliseconds: number) => Promise<void> =
      milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds)),
  ) {
    this.sessionId = sessionId
    this.transport = transport
    this.onState = onState
    this.onSaved = onSaved
    this.wait = wait
  }

  enqueue(input: SubmitAnswerRequest, accepted?: PendingAnswer['accepted'], failed?: PendingAnswer['failed']): void {
    if (this.disposed || this.ending || this.completed) {
      throw new Error('This game no longer accepts answers.')
    }
    if (this.answers.some(answer => answer.input.questionId === input.questionId)) return
    this.answers.push({ input: { ...input }, accepted, failed })
    this.start()
  }

  finish(input: EndSessionRequest): void {
    if (this.disposed || this.completed) return
    // A retry must reuse the exact finalization payload, even after the UI changes.
    this.ending ??= { ...input }
    this.start()
  }

  retry(): void {
    if (this.disposed || this.running || this.completed) return
    this.blocked = false
    this.failure = undefined
    this.start()
  }

  dispose(): void {
    this.disposed = true
  }

  private start(): void {
    if (this.disposed || this.completed) return
    if (this.blocked) {
      this.onState({ status: 'error', pendingAnswers: this.answers.length - this.acceptedCount, error: this.failure })
      return
    }
    if (this.running) {
      this.onState({ status: 'saving', pendingAnswers: this.answers.length - this.acceptedCount })
      return
    }
    this.running = true
    this.onState({ status: 'saving', pendingAnswers: this.answers.length - this.acceptedCount })
    void this.drain()
  }

  private async send<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      if (this.disposed) throw new Error('The previous game was reset.')
      try {
        return await operation()
      } catch (error: unknown) {
        if (this.disposed || attempt >= 2 ||
            (error instanceof OperationError && !error.retryable)) throw error
        await this.wait(500 * 2 ** attempt)
      }
    }
  }

  private async drain(): Promise<void> {
    try {
      while (!this.disposed && this.acceptedCount < this.answers.length) {
        const answer = this.answers[this.acceptedCount]
        const result = await this.send(() => this.transport.submitAnswer(this.sessionId, answer.input))
        if (this.disposed) return
        this.acceptedCount++
        answer.accepted?.(result)
        this.onState({ status: 'saving', pendingAnswers: this.answers.length - this.acceptedCount })
      }
      if (this.disposed) return
      if (this.ending) {
        const ending = this.ending
        const result = await this.send(() => this.transport.end(this.sessionId, ending))
        if (this.disposed) return
        if (result.sessionId !== this.sessionId) {
          throw new OperationError('The saved summary belongs to another game.', 'SESSION_MISMATCH', false)
        }
        this.completed = true
        this.onSaved(result)
        this.onState({ status: 'saved', pendingAnswers: 0 })
      } else {
        this.onState({ status: 'idle', pendingAnswers: 0 })
      }
    } catch (error: unknown) {
      if (!this.disposed) {
        this.blocked = true
        this.failure = error instanceof Error ? error.message : 'Your game could not be saved.'
        this.answers[this.acceptedCount]?.failed?.(this.failure)
        this.onState({
          status: 'error',
          pendingAnswers: this.answers.length - this.acceptedCount,
          error: this.failure,
        })
      }
    } finally {
      this.running = false
    }
  }
}
