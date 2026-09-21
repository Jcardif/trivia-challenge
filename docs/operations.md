# Run a kiosk

Complete [deployment](deployment.md) and [question import](questions.md) before opening the challenge to attendees.

## Start a station

1. Open the deployed app in the kiosk browser.
2. Select **Sign in operator with Fabric** and complete sign-in using the authorized operator account.
3. Wait for the attendee registration page to appear.
4. Leave the browser open for successive players.

The operator signs in once per browser session. Attendees use the registration form and do not need Fabric accounts.

## Open operator setup

Open this address directly or bookmark it for staff:

```text
https://<your-app-host>/operator
```

The operator page contains Fabric sign-in/sign-out, **Load questions and create pools**, and telemetry delivery status. Select **Continue to the challenge** to return to attendee registration or the current result. The question-loading page also has a **Back to operator setup** link.

Attendee screens have no operator setup button or management links. When sign-in is required, they show only the operator sign-in and recovery controls, not imports, sign-out, or telemetry diagnostics.

Finish and save the current game before opening operator setup. In-app navigation to `/operator` or question loading during a game or pending save returns to the active game or results. Entering an address or opening a bookmark reloads the app, so do not do that while a game or save is in progress.

This separates staff tools from attendee screens; it does not add an administrator role or an additional permission check. Anyone using an authorized operator browser session can open `/operator` when no game is pending.

## Assign a station ID

Add a `stationId` query parameter to the deployed app URL:

```text
https://<your-app-host>/?stationId=booth-01
```

The app saves the value in a `stationId` cookie for 365 days. Later visits reuse that value. Open the app with a different value to change the assignment, or remove the cookie through browser settings to clear it.

Use an equipment or booth label, not personal information. Telemetry includes this value so reports can distinguish stations.

These station IDs also display an avatar:

| Station ID          | Avatar             |
| ------------------- | ------------------ |
| `dashboarddruid`    | Dashboard Druid    |
| `insightsalchemist` | Insights Alchemist |
| `quantumqueryist`   | Quantum Queryist   |

Other station IDs still provide attribution without an avatar.

### Require a station assignment

Set `VITE_REQUIRE_STATION_ID=true` in the deployment's `.env.local` and redeploy. A build with this option blocks registration and gameplay until the browser has a station ID.

Set `VITE_STATION_LOCKDOWN_MESSAGE` to customize the blocked-screen message. Copy the options you need from [.env.example](../.env.example) while preserving any deployment-generated values already in `.env.local`.

These options are applied at build time. Station lockdown is a kiosk control, not a replacement for authentication.

## Between players

Wait for the result to finish saving, then select **Play Again**. This clears the attendee and game state while keeping the operator session and station assignment.

Keep the tab open while answers or results are saving. If a save fails, use the retry action in the app. Refreshing or closing the tab loses pending in-memory state; the application cannot resume the game after a refresh.

If the operator session expires or a request rejects it, use **Sign in operator with Fabric** in the recovery dialog, then retry saving. The attendee form, game, and pending writes stay in the same tab. Do not navigate to `/operator`, sign out, or reload to recover a pending game.

## Before opening to attendees

Complete a game on each configured station. Confirm that the intended pool is available, input controls work, and the result finishes saving. Check [telemetry delivery](telemetry-events.md#confirm-delivery) for the station.

Use an appropriate question-pool size for the devices and network at the event. The full pool is loaded before gameplay starts.

Registration collects attendee information. Confirm your event's privacy notice, consent process, access controls, and retention policy before collecting it.

## Operator troubleshooting

| Problem | Action |
| --- | --- |
| No question pools appear | Create an active display pool with the same slug used in the CSV. See [Import questions](questions.md#3-create-the-pool-and-import). |
| The app shows a station restriction | Supply `stationId` in the app URL or correct the build-time station setting. |
| An import reports row errors | Follow the [CSV error reference](questions.md#limits-and-errors). |
| The result is still saving | Keep the tab open. Retry failed writes before handing the station to another player. |
| Operator authentication expires | Sign in again in the same tab, then retry the pending save. |
| Telemetry is queued or dropped | After the current game is saved, open `/operator` to inspect delivery status and follow the [telemetry guide](telemetry-events.md). |

## Pool artwork

The **Existing icon path** field accepts an asset path. These pool icons are included:

```text
/pools/default.svg
/pools/fabric-basics.svg
/pools/fabric.png
/pools/ignite-2026.svg
/pools/sql.svg
```

## External links

The results screen links to the existing public resources:

| Destination     | URL                           |
| --------------- | ----------------------------- |
| Leaderboard     | https://aka.ms/fabrictrivia/l |
| Fabric learning | https://aka.ms/fabrictrivia/f |
| Certification   | https://aka.ms/fabrictrivia/c |

The repository does not contain the leaderboard report. These links are defined in `src/pages/ResultsPage.tsx`; deploying another instance does not connect that report to the new instance's data.
