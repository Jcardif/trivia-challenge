# Run a kiosk

Complete [deployment](deployment.md) and [question import](questions.md) before opening the challenge to attendees.

## Start a station

1. Open the deployed app in the kiosk browser.
2. Select **Sign in operator with Fabric** and complete sign-in using the authorized operator account.
3. Wait for the attendee registration page to appear.
4. Leave the browser open for successive players.

The operator signs in once per browser session. Attendees use the adventurer entry screen and do not need Fabric accounts.

Each operator uses their own Fabric account with permission to run the same deployed app. The backend uses a separate application identity for SQL, so operators do not enter or share a database credential. All stations still use the same database and Eventstream. Assign each kiosk its own station ID for the shared scoreboard.

## Enter as an adventurer

For a new player:

1. Select **Start a new adventure** and choose **Country / region**. Type to search the required picker; select a listed name with a click or the arrow keys and Enter. Escape closes the picker without changing the country.
2. Select three different item runes in order from the nine choices. The numbers beneath the selected seals show the sequence. Before selecting the third rune, select a chosen token again or use its remove button to change it. Arrow keys move between rune keys.
3. Selecting the third rune starts registration automatically. After the spell animation and server response, the public name and private four-character code, such as `K482`, appear. The code replaces the keypad beneath the selected runes. Reduced-motion preferences skip the animation wait.
4. Remember the code and the three-rune sequence, then select **Begin trivia**.

Returning entry is the initial view. From new-player entry, select **I already have a code**. Enter the code, then select the same three runes in the same order. Selecting the third rune checks the spell automatically and continues when it matches. A failed match displays an error and clears all three rune selections, keeping the entered code. There is no separate confirmation button. Lowercase code letters and pasted separating hyphens are normalized; leading zeros matter. The keypad stays disabled until the code is valid, and editing the code clears the spell. Connection or operator-session failures retain the spell and offer **Retry verification** instead of repeatedly retrying automatically.

The private code is shown again on the saved results screen. Do not publish codes or spells on a leaderboard. Display names have no random numeric suffix. If a base name is already assigned, the next player receives that name followed by `2`, `3`, or the next collision number. This is part of the public display name, not another return code.

Country or region is saved with the player and included in registration and gameplay analytics. It is selected manually, never inferred from GPS, IP address, or browser settings. There are no real-name, email, phone, city, or state fields. Returning players keep their saved country. Forgotten codes or spells cannot be recovered; **Start a new adventure** clears the entry form for a new identity. This also means several identities can belong to the same person.

The approved country names live in [country-names.txt](../rayfin/functions/src/country-names.txt). Replace its contents with one approved country or region name per line, in the desired display order. Blank lines and `#` comments are ignored. Names must be unique ignoring case, contain no control characters, and fit within 80 UTF-16 code units. The current entries come from the application's previous country list; review or replace them before deployment. Builds generate `countryNames.generated.ts` for both the picker and server validation, without a runtime fetch. Do not edit the generated file. Keep names already assigned to players unless their records are migrated; removing or renaming a saved country can block returning entry and reject queued telemetry. Rebuild and deploy the frontend and Functions together after changing the list.

If creation is interrupted, keep the tab open and use **Retry summoning my adventurer**. The request ID, country, and spell remain fixed so a lost response does not create another identity. Reusing a creation ID with a different country is rejected. **Start over with a new adventurer instead** abandons that local retry; it cannot recover the previous code.

After five failed verifications for a player, entry is blocked for the remainder of its 15-minute attempt window. A shared 60-attempts-per-minute limit also applies across stations. Wait for the relevant window rather than repeatedly retrying. An incorrect code, incorrect spell, and a temporarily blocked player do not expose the stored name.

The rune artwork comes from the installed `@fabric-msft/svg-icons` package. Icons retain their original artwork, with accessible item names rather than visible captions. Selected seals and token frames provide the fantasy styling. Motion follows the browser's reduced-motion preference. Review Microsoft's [icon usage terms](https://learn.microsoft.com/en-us/fabric/fundamentals/icons) and the editable [name word banks](../rayfin/functions/src/player-name-words.txt) before publishing the experience. The implementation is not legal or trademark clearance.

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

Wait for the result to finish saving, then select **Play Again**. This clears the player, private code, and game state from the active UI while keeping the operator session and station assignment. The next attendee gets an empty rune selection. Returning players must enter their own code and spell again.

Keep the tab open while answers or results are saving. If a save fails, use the retry action in the app. Refreshing or closing the tab loses pending in-memory state; the application cannot resume the game after a refresh.

If the operator session expires or a request rejects it, use **Sign in operator with Fabric** in the recovery dialog, then retry saving. The attendee form, game, and pending writes stay in the same tab. Do not navigate to `/operator`, sign out, or reload to recover a pending game.

## Before opening to attendees

Complete a game on each configured station. Confirm that the intended pool is available, input controls work, and the result finishes saving. Check [telemetry delivery](telemetry-events.md#confirm-delivery) for the station.

Use an appropriate question-pool size for the devices and network at the event. The full pool is loaded before gameplay starts.

The app no longer requests attendee contact details, but generated identities, timestamps, and linked gameplay are pseudonymous data. Confirm the privacy notice, legal basis, access controls, retention/deletion policy, and public-display policy with the responsible privacy owner. Review platform access logs separately; the app cannot guarantee that hosting or identity infrastructure processes no personal data.

Removing contact fields from the application does not erase information collected by older versions. Review historical SQL data, Eventhouse data, exports, and backups separately before sharing reports. Do not expose player codes, spell hashes, or verification counters to Power BI.

## Operator troubleshooting

| Problem | Action |
| --- | --- |
| No question pools appear | Create an active display pool with the same slug used in the CSV. See [Import questions](questions.md#3-create-the-pool-and-import). |
| The app shows a station restriction | Supply `stationId` in the app URL or correct the build-time station setting. |
| An import reports row errors | Follow the [CSV error reference](questions.md#limits-and-errors). |
| The result is still saving | Keep the tab open. Retry failed writes before handing the station to another player. |
| Operator authentication expires | Sign in again in the same tab, then retry the pending save. |
| Sign-in works, but SQL operations fail on every station | Ask the deployment owner to check the backend application credential, its expiry, and SQL permissions. Signing an operator in again does not renew the application's client secret. Keep tabs with pending writes open. |
| Fabric says the app is intended only for its builder because of SSO Functions | Ask the deployment owner to follow [Switch SQL authentication](deployment.md#switch-sql-authentication). Extra SQL permissions for the operator do not remove an app sign-in restriction. |
| A code and spell cannot be verified | Check the code, leading zeros, and exact rune order. Wait after repeated failures; create a new adventurer if the credentials are forgotten. |
| Creation failed after submitting | Retry the same creation request in the open tab to recover an already-created identity. |
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
