# Build the Power BI leaderboard

**Draft build guide.** Rebuild the original trivia report in Power BI, using the current Eventhouse telemetry. Support a signed-in booth screen and anonymous attendees, with updates as close to live as the capacity and data pipeline allow.

This draft provides the build sequence, starter queries, model requirements, and Fabio commands. The production semantic-model/report files and embedding application are not supplied yet. Resolve the decisions below before authoring those files or publishing participant data. Nothing in this guide runs automatically as part of the trivia deployment.

## 1. Keep the reporting in Power BI

```text
Rayfin trivia app
    -> trackTelemetryBatch
    -> Eventstream: triviachallenge-events
    -> Eventhouse: triviachallenge-analytics
    -> KQL database: TriviaChallengeTelemetry
    -> Power BI semantic model using DirectQuery
    -> Power BI report
         -> signed-in booth screen
         -> anonymous website hosting the same report through Power BI Embedded
```

The anonymous website is only an embedding host. Power BI owns the visuals, filters, and calculations. A separate backend obtains short-lived embed tokens; attendees do not sign in to Microsoft.

Do not create a Fabric Real-Time Dashboard for this plan. Do not use **Publish to web** for the live report: DirectQuery reports are unsupported, and its caching is unsuitable for frequent leaderboard updates.

Keep the game's Rayfin authentication, private entities, SQL persistence, and station behavior unchanged. The current operator-authenticated Rayfin Functions are not an anonymous embed-token service.

## 2. Decide the report rules

Only the old report link and screenshots are available. They establish the appearance, not the original calculations.

| Decision | What to record before building |
| --- | --- |
| Ranking | Each player's best completed game, every completed game, or another rule |
| Ties | The tie-break fields and whether tied players share a rank |
| Top 10 | Exactly ten rows or all players tied at the cutoff |
| Event timezone | A named timezone used consistently for the date filter and yesterday's winners |
| Date attribution | Whether a game belongs to its start date or completion date |
| Pool eligibility | All pools together or a selected competition pool |
| Public names | Generated adventurer aliases only; confirm approval for public display and exclude historical real names |
| Yesterday's winners | Number of winners, eligibility, and whether previous winners can win again |
| Unknown visual | Identify the unlabeled lower-left chart in the screenshot, or explicitly omit it |
| Branding | Approved banner, prize text, and contest-rules URL for the current event |

Do not silently choose these rules in DAX. Retain the agreed rules alongside the report sources.

Telemetry is best effort and can be lost on tab closure or refresh. The game is a supervised-kiosk application, not a server-enforced competition system. Confirm candidate prize winners against saved SQL results and the event rules before announcing them.

## 3. Confirm access and capacity

You need:

- The deployed game and working telemetry, as described in [Deployment](deployment.md) and [Confirm delivery](telemetry-events.md#confirm-delivery).
- Fabio installed and authenticated to the intended Fabric environment.
- Permission and the authoring license required to create a Power BI model and report.
- An active capacity eligible for production **app-owns-data** embedding. Check the existing Fabric capacity before purchasing another one. A Pro or PPU license alone is not production embedding capacity.
- A capacity administrator who can enable automatic page refresh and permit the desired interval.
- An administrator who can approve the embedding service principal and its workspace access.
- An approved place to host a small website and its server-side token service.

Fabio's profile and credentials are separate from Rayfin's active deployment registry. A workspace ID alone does not select the correct tenant or Fabric environment. Inspect the selected Fabio profile before running commands, especially for a non-production Fabric environment.

```bash
fabio --version
fabio auth status
fabio context agent --group profile
fabio context workflow report-authoring
```

If authentication is missing, use `fabio auth login` for the intended environment. Record the following values locally, not in committed documentation:

| Value | Where to obtain it |
| --- | --- |
| `WORKSPACE_ID` | Target Fabric workspace URL |
| `KQL_DATABASE_ID` | The `TriviaChallengeTelemetry` item URL |
| Kusto query URI | `TriviaChallengeTelemetry` database details, not the SQL endpoint or Fabric REST URL |
| `APP_ORIGIN` | Hosting origin of the trivia deployment being reported on |
| Capacity ID | Workspace details returned below |

```bash
export WORKSPACE_ID="<your-workspace-id>"
export KQL_DATABASE_ID="<your-telemetry-database-id>"

fabio workspace show --id "$WORKSPACE_ID"
fabio capacity list
fabio kql-database query \
  --workspace "$WORKSPACE_ID" \
  --id "$KQL_DATABASE_ID" \
  --kql "TriviaEvents() | summarize Events=count(), LatestEvent=max(timestamp) by eventName"
```

The selected database must contain `TriviaTelemetry` and `TriviaEvents()`. The empty default database named `triviachallenge-analytics` is not the configured telemetry destination.

## 4. Prepare reporting queries in Eventhouse

Start with `TriviaEvents()`, which deduplicates deliveries by `eventId`. Also deduplicate logical answers and completed sessions: separate retry attempts can produce different event IDs for the same saved operation.

Scope every query to the intended app origin and event period. Do not combine test and production games merely because they share a database. Add the approved pool filter if needed.

### Completed games

Run this read-only starter query in the `TriviaChallengeTelemetry` query editor after replacing the origin:

```kql
let appOrigin = "<your-deployed-https-origin>";
TriviaEvents()
| where tostring(context.url) startswith strcat(appOrigin, "/")
| where eventName == "game.ended" and tobool(properties.apiSuccess) == true
| extend
    SessionId = tostring(properties.sessionId),
    PlayerId = tostring(userId),
    CompletedAtUtc = timestamp,
    CorrectAnswers = toint(properties.correctAnswers),
    QuestionsAnswered = toint(properties.questionsAnswered),
    PoolId = tostring(context.poolId)
| where isnotempty(SessionId) and isnotempty(PlayerId)
| where isnotnull(CorrectAnswers) and isnotnull(QuestionsAnswered)
| summarize arg_max(CompletedAtUtc, *) by SessionId
| project SessionId, PlayerId, CompletedAtUtc, PoolId,
    QuestionsAnswered, CorrectAnswers, Score = CorrectAnswers * 10
```

The current game awards 10 points per correct answer, defined in `rayfin/functions/src/gameRules.ts`. The end event contains `correctAnswers`, not a final `score` property. Revisit this calculation if the game's scoring changes.

This query returns one row per completed game. It does **not** yet apply player eligibility, daily ranking, ties, or a public-name policy.

### Accepted answers

Use this separate grain for category statistics. Do not calculate category accuracy from only the games that reach the Top 10.

```kql
let appOrigin = "<your-deployed-https-origin>";
TriviaEvents()
| where tostring(context.url) startswith strcat(appOrigin, "/")
| where eventName == "game.answerquestion" and tobool(properties.apiSuccess) == true
| extend
    SessionId = tostring(properties.sessionId),
    QuestionId = tostring(properties.questionId),
    AnsweredAtUtc = timestamp,
    Category = tostring(properties.category),
    IsCorrect = tobool(properties.isCorrect),
    PoolId = tostring(context.poolId)
| where isnotempty(SessionId) and isnotempty(QuestionId)
| where isnotnull(IsCorrect)
| summarize arg_max(AnsweredAtUtc, *) by SessionId, QuestionId
| project SessionId, QuestionId, AnsweredAtUtc, PoolId, Category, IsCorrect
```

After approving the rules, save the reporting logic as named KQL functions, for example `LeaderboardCompletedGames()` and `LeaderboardAnswers()`. Creating or replacing these functions changes the database; review their definitions before applying them. Keep their source in version control.

Use `datetime_utc_to_local` with the chosen named timezone to derive the event date. Define yesterday as the previous local calendar day, not the last 24 hours. Convert each local day's boundaries to UTC when filtering timestamps so daylight-saving transitions are handled correctly.

Power BI's Kusto connector supports DirectQuery. Complex KQL containing `let` statements should be placed in stored KQL functions and invoked from the connector, rather than pasted as a complex DirectQuery expression.

## 5. Build the Power BI semantic model

Use DirectQuery against the Kusto query URI and `TriviaChallengeTelemetry`. Do not substitute an Import model or a scheduled model refresh for live querying.

Use this starting model contract:

| Table | Grain and fields |
| --- | --- |
| `CompletedGames` | One row per session: session/player keys, completion timestamp, local event date, pool, score, correct answers, questions answered |
| `Answers` | One row per accepted session/question answer: timestamp, local event date, pool, category, correctness |
| `PublicPlayers` | One row per player key, with its generated adventurer alias approved for public display |
| `EventDates` | One row per local calendar date in the event |

Relate the date dimension to the appropriate local date on each fact table and `PublicPlayers` to `CompletedGames`. Avoid a many-to-many relationship between the two fact tables that multiplies answers or scores.

Define:

- The approved leaderboard score and rank measures.
- Correct percentage as accepted correct answers divided by accepted answers.
- Incorrect percentage as accepted incorrect answers divided by accepted answers.
- The winner calculation for the previous local day, with explicit handling of the report's selected date.

Return blank for a percentage with no answers instead of inventing a zero-percent result. Show answer counts beside percentages so a category with one answer is not mistaken for strong evidence.

The current entry flow generates adventurer aliases and does not accept attendee contact details. `user.register` contains the generated alias for new and returning players; join it to games by player ID without multiplying fact rows. Scope the data to the current application/version and exclude historical real names before publishing.

Never include private player codes, rune verifiers, or attempt counters in the semantic model. Keep historical contact details, raw interaction events, and unapproved names out as well. Hidden columns and report filters are not security boundaries. A returning code groups records for a pseudonymous identity, not a verified unique person; forgotten credentials can result in another identity.

### Author and publish through Fabio

Fabio can publish a complete `.SemanticModel` folder containing `definition.pbism` and the model's TMDL or `model.bim` definition. Desktop is optional; a model can be authored as files.

**Draft checkpoint:** `./TriviaLeaderboard.SemanticModel` is a proposed artifact name, not an existing repository folder. Its partitions, relationships, measures, and public fields must be authored and reviewed against the decisions above before running this command.

```bash
fabio context schema SemanticModel
fabio context describe semantic-model create

# Creates a cloud item. Run only after reviewing the model and target.
fabio semantic-model create \
  --workspace "$WORKSPACE_ID" \
  --name "Trivia Challenge Leaderboard" \
  --definition ./TriviaLeaderboard.SemanticModel
```

Copy the returned model ID:

```bash
export MODEL_ID="<created-semantic-model-id>"
```

Configure the Kusto data-source credentials/cloud connection in the Power BI semantic-model settings. Use a controlled identity with read access to the reporting source. The embedding service principal and the data-source identity are separate concerns; creating the report does not configure its source credentials.

Anonymous viewers cannot supply an organizational account to Kusto. Verify a stored connection appropriate for app-owns-data embedding; do not leave viewer SSO enabled without implementing the corresponding source-identity flow.

If an appropriate cloud connection already exists, Fabio supports binding it:

```bash
fabio semantic-model bind-connection \
  --workspace "$WORKSPACE_ID" \
  --id "$MODEL_ID" \
  --connection-id "<approved-cloud-connection-id>"

fabio semantic-model query \
  --workspace "$WORKSPACE_ID" \
  --id "$MODEL_ID" \
  --dax "EVALUATE ROW(\"CompletedGames\", COUNTROWS('CompletedGames'))"
```

Confirm that a newly ingested game appears without an Import refresh. Do not publish the report while the model cannot query its source.

## 6. Rebuild the report layout

Use one portrait page matching the reference report:

| Position     | Visual                                                           |
| ------------ | ---------------------------------------------------------------- |
| Top          | Approved prize text and date slicer                              |
| Banner       | Microsoft Fabric Trivia Challenge title and approved artwork     |
| Main section | Top-10 table with rank, approved display name, and score         |
| Middle left  | Easiest categories by correct percentage                         |
| Middle right | Hardest categories by incorrect percentage                       |
| Lower middle | Identified extra chart, if retained, beside the contest-rules QR |
| Bottom       | Yesterday's winners                                              |

Use the black background and purple separators as the visual reference. Generate the QR from the approved current rules URL; do not reuse a QR whose destination has not been checked.

Fabio accepts a compact JSON report specification. This small example shows the format, not the finished leaderboard. Save it locally as `report-spec.json`:

```json
{
  "pages": [
    {
      "displayName": "Trivia Challenge",
      "visuals": [
        {
          "type": "textbox",
          "text": "The Microsoft Fabric Trivia Challenge"
        },
        {
          "type": "card",
          "measure": "Count(CompletedGames.SessionId)"
        },
        {
          "type": "clusteredColumnChart",
          "category": "CompletedGames.PoolId",
          "measure": "Count(CompletedGames.SessionId)"
        }
      ]
    }
  ]
}
```

Replace these starter visuals with the agreed page layout and bind them to the actual model fields and measures. Fabio uses `Table.Column` field syntax; explicit measures use `Measure(Table.MeasureName)`. Apply ranking, sorting, and the Top-10 filter in the report definition. Validate both the file structure and the rendered result.

```bash
# --out writes report files locally instead of publishing a report.
fabio report scaffold \
  --workspace "$WORKSPACE_ID" \
  --name "Trivia Challenge Leaderboard" \
  --dataset "$MODEL_ID" \
  --spec @report-spec.json \
  --out ./TriviaLeaderboard.Report

fabio report validate --source ./TriviaLeaderboard.Report

# Creates a cloud item. Run after reviewing the generated files.
fabio report create \
  --workspace "$WORKSPACE_ID" \
  --name "Trivia Challenge Leaderboard" \
  --definition ./TriviaLeaderboard.Report \
  --dataset "$MODEL_ID"
```

Copy the returned report ID:

```bash
export REPORT_ID="<created-report-id>"
```

Open the report in Power BI to check layout, data bindings, sorting, date filtering, and empty states. Structural validation alone cannot prove that the leaderboard is correct.

## 7. Configure near-live updates

In the report editor, select the report page, open its formatting settings, and enable **Page refresh**. This requires a supported DirectQuery model.

Start with a proposed fixed interval of 10-15 seconds. Have the capacity administrator enable automatic page refresh and allow that interval. Check the effective interval after publishing; a lower value in Desktop does not override the capacity's minimum.

Dedicated-capacity settings can permit short intervals. Shared-capacity reports have a 30-minute minimum and do not meet this target. The normal dedicated-capacity default can also be longer than the desired interval.

Measure end-to-end freshness:

```text
game completion
    + browser telemetry batching
    + Function/Eventstream/Eventhouse ingestion
    + next Power BI page refresh
    + query and visual rendering time
```

The app's configured telemetry flush interval is five seconds. A 10-second report refresh is therefore not a promise that every result appears within 10 seconds.

Test with the expected number of viewers. Frequent refreshes multiply query and capacity load. Optimize reporting queries before reducing the interval further.

## 8. Add anonymous Power BI embedding

Use **Power BI Embedded: embed for your customers / app-owns-data**. This is not Fabric Embed for Real-Time Dashboards, ordinary report sharing, or Publish to web.

### Administrator setup

Follow Microsoft's [service-principal setup](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-service-principal):

1. Register a dedicated Microsoft Entra application for embedding.
2. Configure a server-side certificate, preferably, or a securely stored client secret. Record tenant ID and client ID.
3. Place its service principal in the approved security group.
4. Have the Fabric administrator enable the required embedding/service-principal tenant settings for that group.
5. Grant the service principal the documented workspace role needed for embedding, scoped to the reporting workspace.
6. Confirm that the report and model reside on capacity eligible for production embedding.

Do not add broad Entra API permissions by guesswork. The Power BI service-principal guide uses tenant settings and workspace access rather than conventional delegated user permissions.

### Token backend

**This backend still needs implementation and hosting. Fabio does not create it as part of report publishing.**

The backend must:

- Authenticate to Power BI using the server-side service principal.
- Keep the approved workspace, report, and model IDs in server configuration, not accept arbitrary IDs from callers.
- Obtain the report's embed URL and generate a short-lived, view-only embed token for only the approved report/model.
- Return the report ID, embed URL, embed token, and expiration to the browser. Never return the service principal's Entra token or credential.
- Use HTTPS, rate limiting, bounded retries, sanitized errors, and token-response cache controls. Do not log tokens or participant data.

Use the [Generate embed token guidance](https://learn.microsoft.com/en-us/power-bi/developer/embedded/generate-embed-token). With the V2 API, disable report editing and do not grant workspace creation/Save As rights. If RLS or SSO is introduced, implement the required effective identities rather than omitting them.

An anonymous endpoint intentionally makes the approved report accessible to anyone who can request a token. CORS is not authorization. Keep the semantic model public-safe even though its data source and service credentials remain private.

### Hosting page

Build a small page using the Power BI JavaScript SDK:

1. Request the fixed report configuration from the token backend.
2. Embed the report in view mode using the returned embed token.
3. Renew the token before its expiration without losing the viewer's date selection.
4. Show visible loading, connection-error, and retry states.
5. Check the portrait layout on a phone and the full-screen booth display.

Use Microsoft's [app-owns-data sample](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embed-customer-app) as the implementation starting point. The page does not need the Rayfin SDK or its operator session. Hosting provider, deployment commands, and backend code remain to be selected and supplied.

## 9. Verify before sharing the link

- Complete a game and confirm its saved SQL result, Eventhouse event, model result, and report score agree.
- Replay/retry an answer and completion; neither category counts nor leaderboard entries should double.
- Test repeated players, tied scores, the tenth-place cutoff, and the agreed pool eligibility.
- Test local midnight and yesterday's winners in the selected event timezone.
- Open the public page in a private browser with no Microsoft session. It must render the Power BI report without a sign-in prompt.
- Leave the page open through embed-token expiration and confirm renewal.
- Inspect the public model and browser responses for contact fields, unapproved names, secrets, or unexpected report access.
- Measure freshness and capacity load with the expected concurrent audience.
- Verify the rules QR and prize wording.

Keep the booth and attendee experiences on the same report/model unless an explicit difference is approved. Do not change the game's existing external leaderboard link until the replacement is live, approved, and verified.

## Draft completion checklist

Before treating this as an end-to-end runnable deployment guide, supply:

- Approved ranking, dates, public-name policy, winner rules, and missing visual requirements.
- Version-controlled KQL functions, semantic-model files, and the complete report layout/specification.
- Confirmed data-source credentials, eligible capacity, and effective refresh interval.
- The embedding website and token backend, with exact hosting/deployment instructions.
- Recorded results from the verification steps above.

## References

- [Current telemetry contract](telemetry-events.md)
- [Azure Data Explorer/Kusto connector and DirectQuery](https://learn.microsoft.com/en-us/power-query/connectors/azure-data-explorer)
- [Power BI automatic page refresh](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-automatic-page-refresh)
- [Power BI Embedded overview and capacity requirements](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-analytics-power-bi)
- [Why Publish to web is not the live-report path](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-publish-to-web)
- Installed Fabio documentation: `fabio context workflow report-authoring`, `fabio context schema Report`, and `fabio context schema SemanticModel`
