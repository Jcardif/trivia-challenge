# Telemetry events

The application records page interactions and game events for analysis in Fabric. The browser queues events, the `trackTelemetryBatch` Function forwards them to Eventstream, and Eventhouse stores them in `TriviaTelemetry`.

Follow [Deployment](deployment.md) to provision the analytics resources and configure the publisher credential.

## Event contract

Every event carries a stable UUID `eventId`, `event`, `type`, client ISO `timestamp`, optional attendee `userId`, `properties`, and `context`. The publisher maps `event` to `eventName`, adds `eventType: "track"` and `ingestedAtUtc`, and preserves the dynamic properties and context. `ingestedAtUtc` is the publisher timestamp, not a receipt from Eventhouse. `type` is `pageview` for page views, `user` for registration and pool selection, `game` for game events, and `interaction` for clicks, touches, and keyboard events.

| Event | When emitted | Event-specific properties |
| --- | --- | --- |
| `pageview.home` | Registration page displayed | `path` |
| `pageview.select-pool` | Pool selection page loaded | `path` |
| `pool.selected` | Player chooses a pool | `poolId`, `poolName` |
| `user.register` | A new or returning adventurer enters the challenge | `userId`, generated `name`, selected `country`, `entryMode` |
| `game.start` | Session and draw loaded, countdown starting | `sessionId`, `questionCount`, `heartsRemaining` |
| `game.answerquestion` | Answer persistence attempt resolves | `sessionId`, `questionId`, `category`, `answerIndex`, `isCorrect`, `responseTime`, `remainingTimeSeconds`, `questionNumber`, `heartsRemaining`, `totalScore` on success, `apiSuccess`, optional `error` |
| `game.streakcompleted` | Streak progress reaches five | `sessionId`, `streakLevel`, `currentStreak`, `streakProgressAfterReset`, `heartsRemaining` |
| `game.ended` | Saved game completion | `sessionId`, `questionsAnswered`, `correctAnswers`, `streaksCompleted`, `timeRemaining`, `heartsRemaining`, `gameOverReason`, `apiSuccess` |
| `page.click` | Mouse click | `x`, `y`, `button`, `element` |
| `page.touch` | Touch start | `x`, `y`, `element` |
| `page.keyboardkeydown` | Eligible, non-repeating key press | `key`, `code`, modifier booleans, `element` |

`responseTime` is in milliseconds and `remainingTimeSeconds` is in seconds. Streak levels run from 1 to 5. Click and touch listeners share a 16 ms throttle. There is no mouse-movement listener.

Common context includes `url` and `path`. After identifying a player, it also includes the saved `country`, including on every gameplay event. This is a manually selected approved country/region name, not an inferred location. Browser language, user agent, viewport, and screen dimensions are no longer collected. When available, context also includes `sessionId`, `poolId`, `poolName`, and the `stationId` cookie. The event snapshots these fields and its top-level attendee `userId` before queueing, so a later attendee cannot change attribution. Resetting the player clears country attribution for subsequent events without changing queued events. URL queries and fragments are stripped. Page-specific context may add `page`. See [Assign a station ID](operations.md#assign-a-station-id) for station assignment.

All click, touch, and keyboard capture skips regions marked `data-telemetry-private`, including player entry, rune selection, and private-code displays. Keyboard events also skip inputs, selects, textareas, editable content, and textbox roles. Non-control text keys are generalized.

The browser queue and backend publisher reject known contact, credential, detailed-location, and browser-fingerprint fields, including nested fields. Country fields accept only names in `rayfin/functions/src/country-names.txt`; arbitrary location strings are rejected. `user.register` accepts only names matching the curated generated-name format. It never includes player codes, selected rune IDs, or rune verifiers. The creation request UUID becomes the player ID and is included as `userId`; it is not a secret. This is a guard against accidental collection, not a general detector for personal information hidden in arbitrary strings.

Generated aliases, player IDs, country, station attribution, timestamps, and gameplay are still pseudonymous data. Do not claim that deleting contact fields makes the dataset legally anonymous. Restrict access and decide retention before collecting it. Existing events from older versions are not automatically sanitized or deleted, and platform/network logging needs a separate review. Do not publish raw participant payloads in logs, issues, or shared diagnostics.

## Delivery behavior

| Limit                     | Value                             |
| ------------------------- | --------------------------------- |
| Browser queue             | 500 events or 2 MiB               |
| One event                 | 16 KiB UTF-8 JSON                 |
| Browser batch             | 50 events or 96 KiB               |
| Backend request           | 50 events or 128 KiB              |
| Event Hubs producer batch | 64 KiB                            |
| Retry lifetime            | 10 minutes or 8 attempts          |
| Backoff                   | Exponential, capped at 30 seconds |

The backend validates known event/type pairs, UUIDs, timestamps, and bounded JSON before publishing. It uses UTF-8 JSON buffers and `eventId` as the Event Hubs message ID. It acknowledges IDs only after the publisher send succeeds. Transport failures return sanitized errors.

Delivery is at least once. Deduplicate reports by `eventId`; the `TriviaEvents()` KQL function in [infra/telemetry.kql](../infra/telemetry.kql) does this. Queued events survive attendee reset in the same tab, but not tab closure or refresh. Offline delivery and page shutdown remain best effort.

The operator page at `/operator` reports queued, acknowledged, and dropped counts with the last failure. Finish and save the current game before navigating there. An acknowledgment confirms forwarding, not Eventhouse ingestion. An empty queue does not by itself prove that events arrived.

## Confirm delivery

1. Complete a game on the deployed application and wait for its result to save.
2. In the Fabric workspace, open the `triviachallenge-events` Eventstream. Confirm that its `TriviaEventhouseData` destination is `Running`.
3. Open the `TriviaChallengeTelemetry` KQL database and run the following query.

Replace `<your-deployed-https-origin>` with the app origin from the active deployment registry:

```kql
let appOrigin = "<your-deployed-https-origin>";
TriviaEvents()
| where timestamp > ago(2h)
| where tostring(context.url) startswith strcat(appOrigin, "/")
| where eventName in ("game.start", "game.answerquestion", "game.ended")
| summarize eventNames=make_set(eventName), latestEvent=max(timestamp)
    by sessionId=tostring(context.sessionId), stationId=tostring(context.stationId)
| order by latestEvent desc
```

The completed session should have start, answer, and end events, with the expected station assignment. Publisher acknowledgments in **Operator setup** do not replace this ingestion check.

### Command-line verification

The read-only verifier provides additional event counts and game totals. Set the deployment's workspace and hosting origin, then use the session identifier returned by the query above:

```bash
export WORKSPACE_ID="<your-workspace-id>"
export APP_ORIGIN="<your-deployed-https-origin>"
export SESSION_ID="<completed-game-session-id>"
export STATION_ID="<your-station-label>"
node scripts/provision-telemetry.mjs \
  --workspace-id "$WORKSPACE_ID" --verify \
  --app-origin "$APP_ORIGIN" \
  --session-id "$SESSION_ID" --station-id "$STATION_ID"
```

Use an empty `STATION_ID` if the browser has no station assignment. The command queries the last two hours and checks for all three lifecycle event names when a session is specified. It does not generate test events.

If the CLI reports `KUSTO_AUTH_REQUIRED`, use the authenticated Fabric query editor instead. For the detailed counts, open [infra/telemetry-verify.kql](../infra/telemetry-verify.kql) and replace its `declare query_parameters` line with `let` bindings for `appOrigin`, `sessionId`, and `stationId`. Browser tokens do not need to be copied.

### Destination configuration

The provisioning script configures the following destination properties:

| Property       | Value                                            |
| -------------- | ------------------------------------------------ |
| Destination    | `TriviaEventhouseData`                           |
| Ingestion mode | `ProcessedIngestion`                             |
| Target item    | The `TriviaChallengeTelemetry` KQL database item |
| Table          | `TriviaTelemetry`                                |
| Input format   | JSON encoded as UTF-8                            |

The destination's `itemId` identifies the KQL database, not the parent Eventhouse. Provisioning reuses owned resources without overwriting their definitions. If an existing destination differs, review its configuration in Fabric before making changes.

## Example report queries

Run these queries against `TriviaChallengeTelemetry`. `TriviaEvents()` deduplicates deliveries by event ID.

```kql
// Highest completed scores in the last day
TriviaEvents()
| where timestamp > ago(1d) and eventName == "game.ended"
| extend score = toint(properties.correctAnswers) * 10
| top 10 by score desc;

// Response time by category
TriviaEvents()
| where timestamp > ago(1d) and eventName == "game.answerquestion"
| summarize averageResponseMs=avg(todouble(properties.responseTime))
    by category=tostring(properties.category);

// Started sessions by station
TriviaEvents()
| where timestamp > ago(1d) and eventName == "game.start"
| summarize sessions=count() by station=tostring(context.stationId);
```
