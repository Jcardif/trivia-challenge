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

Gameplay defaults and pure answer calculations are defined in `rayfin/functions/src/gameRules.ts`. The frontend's `src/config/gameConfig.ts` imports those defaults and adds telemetry and station settings. Change gameplay values in the shared module so browser calculations, server scoring, and completion validation stay aligned.

The browser owns the timer, hearts, streak progress, and immediate feedback. The backend calculates correctness and score from the saved question and submitted answer. Both use the same pure answer calculation; React scheduling, animation, and persistence remain outside that calculation.

Question draws include the correct answer index so the browser can provide feedback. The application is intended for supervised kiosks, not adversarial or prize-bearing competitions that require hidden answers and server-controlled timing.

## Authentication and data access

The Fabric operator authenticates the browser. Attendee entry creates or retrieves a pseudonymous player record; it does not create a Fabric identity. New players must manually select a country or region from the approved picker. The application does not accept attendee names, email addresses, phone numbers, cities, or states, and does not infer location.

A new adventurer chooses three distinct item runes in order from the versioned nine-item catalog in `rayfin/functions/src/playerIdentity.ts`. The server generates a name from the editable `rayfin/functions/src/player-name-words.txt` word banks. The first use has no number; collisions append `2`, `3`, and later sequence numbers inline. A single aggregate over the indexed name/prefix finds the next number inside the existing entry transaction, without repeated name-collision probes. The private code is separate and contains one Crockford letter followed by three decimal digits. There are 22,000 possible codes and 504 ordered rune selections. Codes are normalized without discarding leading zeros. Five-character codes and runes outside the nine-item catalog are rejected.

The shared word module is generated before browser and Functions builds, keeping generation and validation aligned. Keep assigned words available for existing identities unless a migration is planned. Changing the word file does not rename stored players.

The country list has the same build-time model. `rayfin/functions/src/country-names.txt` generates the shared `countryNames.generated.ts`; `countries.ts` validates exact approved names with a precomputed set. The new-player request, stored record, returned player, and telemetry use the selected name. Free-text locations and missing countries are rejected. Keep assigned names available unless records are migrated. No runtime list fetch or location lookup is needed.

Returning entry verifies the code and ordered spell on the server as soon as the third rune is selected. A successful response continues into the challenge; a mismatch clears the rune selection and retains the code. The client submits only on input events, not render effects, so errors do not create an automatic retry loop. Network and operator-session failures preserve the spell for explicit retry. Only a salted scrypt verifier is stored for the spell, not the selected rune IDs. The `registerPlayer` request is a strict `new`/`returning` union; contact fields are rejected. New entry uses a stable UUID request ID as the player ID, so a retry with the same country and spell returns the same generated identity. A different spell or country never overwrites the record.

`PlayerEntryState` serializes code/name allocation and enforces a shared limit of 60 player-entry attempts per minute without recording IP addresses or device identifiers. Each player also has a five-failure limit within a 15-minute window. Failed-attempt updates commit even when verification fails. The same limits cover returning entry and creation replays. The SQL unique constraints are additional safeguards.

This is a lightweight verification mechanism for the existing operator-authenticated, supervised kiosk. It is not a separate Fabric authorization boundary, strong account authentication, proof of a real-world identity, or one-person-one-entry enforcement. Forgotten credentials produce a new identity, not a contact-based recovery flow. Changing catalog IDs or their meaning can invalidate existing spells; keep version 1 stable.

The same operator session is used for gameplay and question loading. There is no separate question-administrator role.

Operator management is available directly at `/operator`, without a button on attendee screens. Attendee routes retain a minimal sign-in recovery dialog that keeps the underlying form, game, and pending writes mounted. A rejected session opens a fresh Fabric broker login rather than reusing the rejected session or requiring sign-out. In-app navigation cannot leave a starting or active game, or its unsaved results, to open management tools.

The entry page starts with returning-player entry. Its shared board contains the title, large station avatar, code or searchable country control, and a fixed three-by-three icon-only rune keypad. The keypad becomes available after a valid code or country choice. Changing a code clears the spell. Selecting the third rune starts registration or verification once, from the input handler. New-player codes replace the keypad only after both registration and the completion animation finish. The selected runes remain visible and read-only, and **Begin trivia** is the single new-player confirmation. A failed request offers explicit retry; a pending creation retains its request ID, country, and spell. Accessible item names remain on the buttons, keyboard arrows move between rune keys, and reduced-motion preferences skip the animation wait. Entry styles are scoped to that page rather than changing document scrolling or other routes. Other pages retain the fixed station avatar.

Application entities deny direct browser reads and writes through the Data API. Authenticated Functions access SQL using an Entra application identity and parameterized `tedious` queries. The SQL hostname, database, tenant ID, client ID, and client secret are backend secrets. The driver obtains the application's SQL token; Functions do not declare delegated SQL connections or request an operator SQL token. Missing application credentials fail explicitly, without a fallback to operator SSO.

Fabric operator sign-in remains the application access check. Every authorized operator uses the same backend SQL identity, with permissions limited to the application tables. Operators do not receive its credentials. This supports one shared database and telemetry pipeline across stations; it does not introduce per-operator SQL permissions or a question-administrator role.

The SQL implementation provides native transactions and locking across several statements. A replacement data-access implementation must retain atomic imports, serialized session writes, replayable results, and the private entity policies. Typed single-entity queries and mutations alone do not satisfy those requirements.

## Data model

| Entity | Stored information |
| --- | --- |
| `Player` | Generated name, selected country, private return code, salted rune verifier, and verification counters |
| `PlayerEntryState` | Deployment-wide player-entry attempt window |
| `QuestionPool` | Pool slug, display name, artwork, and availability |
| `QuestionImport` | Import identity and content hash |
| `Question` | Question text, answers, and correct answer key |
| `QuestionPoolMembership` | Question-to-pool assignments |
| `GameSession` | Player, selected pool, session status, and totals |
| `SessionQuestion` | The session's immutable randomized draw |
| `GameSessionAnswer` | Accepted answers and score snapshots |

Entity definitions are registered in `rayfin/data/schema.ts`. The root package exports the compiled schema to make discovery explicit.

## Backend operations

`rayfin/functions/src/contracts.ts` defines the shared request and response types.

| Operation | Purpose |
| --- | --- |
| `registerPlayer` | Create an idempotent generated identity or verify a returning code and spell |
| `listPools` | List active pools |
| `getPool` | Resolve a pool by slug |
| `createPool` | Create a display pool |
| `previewQuestionImport` | Validate a CSV and show pool destinations and previous imports without writing |
| `importQuestions` | Validate and atomically save a CSV import |
| `startSession` | Create a session and its draw |
| `getSessionQuestions` | Retrieve the complete saved draw |
| `submitAnswer` | Score and save an answer |
| `endSession` | Finalize the session using persisted answer totals |
| `trackTelemetryBatch` | Validate and forward telemetry |

The client sends JSON in a `payload` field. The SDK decodes the `FunctionResult<T>` response; `invokeOperation` returns its data or throws an `OperationError`. Callers must not parse an already-decoded result a second time.

## Consistency and retries

Session and import requests retain their identifiers across retries. Accepted answer retries return the original score snapshot, while conflicting submissions fail.

Per-session SQL locks serialize answers and completion. The frontend waits for pending answers before requesting completion. The backend returns retryable `SESSION_NOT_READY` when the requested completion counters are not yet persisted.

Imports validate all rows before committing. The operator preview shows destination counts, missing display pools, and previous imports of the exact file. Explicitly requested pool creation shares the import transaction. Existing pool metadata is preserved, including pools another operator creates after the preview.

Repeating an import identifier with the same content does not create another copy. Selecting a file again creates a new additive import, but repeated content requires explicit confirmation. A locked backend lookup prevents an unconfirmed duplicate when another import finishes after the preview. This is a warning and confirmation mechanism, not question-level deduplication. New imports do not change existing session draws.

Transactions use the driver's native begin, commit, and rollback methods. Transaction boundaries must not be split across separate `execSql` calls.

## Runtime limits

The complete application requires Fabric. The localhost frontend cannot authenticate an operator or save games. Local Functions routing alone does not satisfy this application's operator-authentication requirement. See [Development](../README.md#development).

Active games and pending writes are held in browser memory. Refreshing the page cannot resume them.

The entire question pool is returned when a game starts, so larger pools increase startup time. The CSV upload limit is not a guarantee of acceptable game-loading performance.

Telemetry is buffered in memory and delivered at least once. Consumers must deduplicate by event ID. Player entry and private-code regions exclude interaction capture; credentials and contact fields are rejected by both the browser queue and publisher. Generated aliases and gameplay remain pseudonymous records, not proof of legal anonymization. See [Telemetry](telemetry-events.md) for delivery and privacy details.
