# Architecture

Microsoft Fabric Trivia Challenge is a React single-page application with a Rayfin Functions backend. Fabric SQL stores players, questions, and game results. Eventstream sends telemetry to Eventhouse for analysis.

## Components

| Component | Responsibility | Source |
| --- | --- | --- |
| React frontend | Registration, pool selection, instructions, gameplay, and results | `src/` |
| Rayfin client | Fabric operator sign-in and typed Function calls | `src/services/rayfinClient.ts` |
| Rayfin Functions | Validation, imports, scoring, persistence, and telemetry publishing | `rayfin/functions/src/` |
| Fabric SQL | Application records and transactional writes | `rayfin/data/` |
| Eventstream and Eventhouse | Telemetry ingestion and analytical queries | `scripts/provision-telemetry.mjs`, `infra/` |

## Game rules

The player flow is registration, pool selection, instructions, gameplay, and results. When only one active pool is available, selection is automatic.

| Rule | Behavior |
| --- | --- |
| Start | Three-second countdown followed by 60 seconds of active game time |
| Answers | Four choices, using touch, mouse, or A/K/S/L |
| Score | 10 points per correct answer |
| Streak progress | A correct answer adds one; an incorrect answer subtracts one, down to zero |
| Streak bonus | Five progress points award 10 seconds and reset progress; at most five bonuses |
| Active-time budget | Up to 110 seconds with the default settings; the timer also has a 120-second safety limit |
| Hearts | Five at the start; each incorrect answer removes half a heart |
| Incorrect-answer penalty | 0.25 seconds deducted from the timer |
| Answer review | The timer pauses for up to five seconds after an incorrect answer; Space skips the review |
| Correct-answer feedback | A 500 ms halo before advancing |
| End conditions | Time runs out, hearts reach zero, or all questions in the draw are answered |

Settings are defined in `src/config/gameConfig.ts`. The browser owns the timer, hearts, streak progress, and immediate feedback. The backend calculates correctness and score from the saved question and submitted answer.

Question draws include the correct answer index so the browser can provide feedback. The application is intended for supervised kiosks, not adversarial or prize-bearing competitions that require hidden answers and server-controlled timing.

## Authentication and data access

The Fabric operator authenticates the browser. Attendee registration creates or retrieves an application player record by normalized email; it does not create a Fabric identity or replace an existing player's stored details.

The same operator session is used for gameplay and question loading. There is no separate question-administrator role.

Application entities deny direct browser reads and writes through the Data API. Authenticated Functions access SQL using the Functions host's SQL-audience token and parameterized `tedious` queries. SQL connection settings are backend secrets.

## Data model

| Entity                   | Stored information                                 |
| ------------------------ | -------------------------------------------------- |
| `Player`                 | Attendee registration                              |
| `QuestionPool`           | Pool slug, display name, artwork, and availability |
| `QuestionImport`         | Import identity and content hash                   |
| `Question`               | Question text, answers, and correct answer key     |
| `QuestionPoolMembership` | Question-to-pool assignments                       |
| `GameSession`            | Player, selected pool, session status, and totals  |
| `SessionQuestion`        | The session's immutable randomized draw            |
| `GameSessionAnswer`      | Accepted answers and score snapshots               |

Entity definitions are registered in `rayfin/data/schema.ts`. The root package exports the compiled schema to make discovery explicit.

## Backend operations

`rayfin/functions/src/contracts.ts` defines the shared request and response types.

| Operation             | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `registerPlayer`      | Register or retrieve a player                      |
| `listPools`           | List active pools                                  |
| `getPool`             | Resolve a pool by slug                             |
| `createPool`          | Create a display pool                              |
| `importQuestions`     | Validate and atomically save a CSV import          |
| `startSession`        | Create a session and its draw                      |
| `getSessionQuestions` | Retrieve the complete saved draw                   |
| `submitAnswer`        | Score and save an answer                           |
| `endSession`          | Finalize the session using persisted answer totals |
| `trackTelemetryBatch` | Validate and forward telemetry                     |

The client sends JSON in a `payload` field. The SDK decodes the `FunctionResult<T>` response; `invokeOperation` returns its data or throws an `OperationError`. Callers must not parse an already-decoded result a second time.

## Consistency and retries

Session and import requests retain their identifiers across retries. Accepted answer retries return the original score snapshot, while conflicting submissions fail.

Per-session SQL locks serialize answers and completion. The frontend waits for pending answers before requesting completion. The backend returns retryable `SESSION_NOT_READY` when the requested completion counters are not yet persisted.

Imports validate all rows before committing. Repeating an import identifier with the same content does not create another copy; selecting a file again creates a new additive import. New imports do not change existing session draws.

Transactions use the driver's native begin, commit, and rollback methods. Transaction boundaries must not be split across separate `execSql` calls.

## Runtime limits

The complete application requires Fabric. The localhost frontend cannot authenticate an operator or save games. See [Development](../README.md#development).

Active games and pending writes are held in browser memory. Refreshing the page cannot resume them.

The entire question pool is returned when a game starts, so larger pools increase startup time. The CSV upload limit is not a guarantee of acceptable game-loading performance.

Telemetry is buffered in memory and delivered at least once. Consumers must deduplicate by event ID. See [Telemetry](telemetry-events.md) for delivery and privacy details.
