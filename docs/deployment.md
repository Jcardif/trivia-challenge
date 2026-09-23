# Deploy the application

This guide deploys the frontend, Rayfin Functions, SQL database, and telemetry resources to your Fabric workspace. Run all commands from the repository root in Bash.

## Prerequisites

Use Node.js 24 and npm. Open a terminal in the repository root, where `package.json` and `rayfin/` are located. Confirm the following with your Fabric administrator:

| Requirement | What is needed |
| --- | --- |
| Capacity | A workspace assigned to capacity that supports Fabric workloads. An existing Premium P capacity can be used when Fabric is enabled. |
| Tenant settings | **Users can create Fabric items** and **Fabric Apps preview** enabled for the deploying account. Capacity-level settings must also permit Fabric items. |
| Workloads | Access to Rayfin, its Functions and SQL services, Eventstream, and Eventhouse in the target tenant and region. |
| Permissions | Permission to create and update the application and analytics items. SQL database creation requires workspace Member or Admin permissions. |
| Operator account | A Fabric account authorized to run the deployed application. This account signs in on the kiosk; attendees do not need Fabric accounts. |
| SQL application identity | A single-tenant Entra app registration, permission to grant it SQL access, and approval to use a backend client secret. A Fabric administrator must allow this service principal through the relevant tenant setting. |

See Microsoft's [Fabric capacity documentation](https://learn.microsoft.com/fabric/enterprise/licenses#capacity) and [SQL database prerequisites](https://learn.microsoft.com/fabric/database/sql/create#prerequisites).

## 1. Install dependencies and the CLI

Install both sets of locked dependencies from the public npm registry, including development dependencies:

```bash
npm ci --include=dev &&
  npm --prefix rayfin/functions ci --include=dev &&
  npx rayfin --version
```

The CLI package is **`@microsoft/rayfin-cli`**. It supplies the executable named **`rayfin`** and is installed as a development dependency. `--include=dev` ensures that deployment tools are installed even when npm otherwise omits development dependencies.

Continue only after both installations succeed and the version command prints the installed CLI version. If `npx rayfin` requests an unpublished package named `rayfin`, the local executable is unavailable. Complete this installation step in the repository root instead of changing the package name to `@microsoft/rayfin`.

The packages are available at `https://registry.npmjs.org/`. If installation cannot reach the registry, check your npm configuration and network access before continuing.

## 2. Select the deployment target

Replace each value in angle brackets with a value from your environment.

| Variable | Where to find it |
| --- | --- |
| `TENANT_ID` | Your Microsoft Entra tenant's **Tenant ID**, available from the tenant overview or your administrator. |
| `WORKSPACE_URI` | The full Fabric portal URL for the target workspace. Use the portal host for the environment you intend to deploy to, such as `https://app.fabric.microsoft.com/groups/<workspace-id>/...` for production or `https://daily.fabric.microsoft.com/groups/<workspace-id>/...` for Daily. |

```bash
export TENANT_ID="<your-tenant-id>"
export WORKSPACE_URI="<your-fabric-workspace-url>"
npx rayfin login --tenant "$TENANT_ID" --select
npx rayfin login status
```

Confirm that the reported account and tenant are the intended deployment identity.

For a new environment, use a fresh checkout without another environment's `.env.local`, `rayfin/.env`, or `rayfin/.deployments.json`. Review `services.auth.allowedRedirectUris` in `rayfin/rayfin.yml` and remove origins that do not belong to the deployment. The CLI adds the new hosting origin during deployment.

Rayfin records each deployment in the ignored `rayfin/.deployments.json` registry. The top-level `active` value selects the entry used by the helper scripts below. Use `npx rayfin up list` to view recorded deployments and `npx rayfin up switch <workspace>` to change the active one before configuring analytics or backend secrets.

## 3. Deploy the application

```bash
RAYFIN_FEATURE_FLAGS=functions npx rayfin up \
  --tenant "$TENANT_ID" \
  --workspace-uri "$WORKSPACE_URI"
npx rayfin up status
```

The `functions` flag enables the Functions deployment workflow in the pinned CLI. The workspace URI lets Rayfin derive both the workspace ID and Fabric API environment. The deployment builds the frontend and Functions, applies the SQL schema, and records its configuration in `rayfin/.deployments.json`.

Use a `*.fabric.microsoft.com` workspace URL, not a `*.powerbi.com` URL. For example, a workspace opened through `daily.powerbi.com` can be targeted with `https://daily.fabric.microsoft.com/groups/<workspace-id>/list`. Tenant selection and environment selection are separate.

Record the following values for later steps:

| Variable | Where to find it |
| --- | --- |
| `APP_ORIGIN` | `hostingUrl` in that same entry. Use the HTTPS origin without a path, query string, or trailing slash. |
| `SQL_DATABASE_ID` | Open the deployed application's SQL child item in Fabric and copy that item's identifier from its URL. Use the application-owned SQL database, not another database in the workspace. |

```bash
export APP_ORIGIN="<deployed-https-origin>"
export SQL_DATABASE_ID="<application-sql-database-id>"
```

The app is not ready for players yet. Its backend secrets and analytics resources are configured next. The scripts read workspace ID, tenant ID, application ID, Fabric API URL, and hosting URL from the active deployment registry entry. Optional `--workspace-id` and `--app-id` arguments are safety checks only; they must match the active deployment.

The helpers derive the Fabric REST environment from the entry's `fabricDeepLink`. The registry's `fabricApiUrl` normally identifies the app's regional workload endpoint, not the Fabric REST root. Do not replace it with `https://api.fabric.microsoft.com/v1`. For legacy entries without a portal link, the helpers accept a first-party REST endpoint or use production when the API URL is also absent.

## 4. Provision analytics

Preview the selected environment, workspace, and resource names, then create the resources:

```bash
node scripts/provision-telemetry.mjs
node scripts/provision-telemetry.mjs --apply
```

The script creates these items:

| Item             | Name                        |
| ---------------- | --------------------------- |
| Eventhouse       | `triviachallenge-analytics` |
| KQL database     | `TriviaChallengeTelemetry`  |
| Eventstream      | `triviachallenge-events`    |
| Eventhouse table | `TriviaTelemetry`           |

Copy `eventstreamId` from the script's JSON output:

```bash
export EVENTSTREAM_ID="<created-eventstream-id>"
```

In Fabric, open the Eventstream and confirm that its `TriviaEventhouseData` destination reaches `Running`. Newly created resources can take time to initialize.

The script reuses resources that it owns. It refuses name collisions with unrelated items and does not overwrite existing definitions. Use separate workspaces for independent deployments; these analytics names are fixed.

If Git sync has already restored the analytics items, skip provisioning. Set `EVENTSTREAM_ID` to the existing Eventstream's ID. It must contain exactly one `CustomEndpoint` source named `TriviaApp`, connected to the intended running Eventhouse destination. Step 5 reads its publisher credentials without creating items or changing its topology.

## 5. Configure the backend

### Register and authorize the SQL identity

Operator sign-in and SQL authentication are separate. Operators keep their own Fabric accounts. The Functions use one Entra application identity to connect to the shared SQL database.

1. In the [Entra admin center](https://entra.microsoft.com/), switch to the deployment tenant. Open **Entra ID > App registrations > New registration**. Create a dedicated single-tenant app, such as `trivia-sql-backend`, without a redirect URI. Record its **Directory (tenant) ID** and **Application (client) ID**.
2. Open that registration's **Certificates & secrets > Client secrets > New client secret**. Choose an expiry approved by your organization. Copy the **Value**, not the Secret ID, and record its expiry in the team's credential store. This implementation uses a client secret; Microsoft recommends certificate or federated credentials for long-lived production use. If your policy prohibits client secrets, stop rather than placing a different credential type in this setting.
3. Ask the Fabric administrator to allow the service principal through **Service principals can call Fabric public APIs**, also named **Service principals can use Fabric APIs** in some environments. Include it in the allowed security group rather than enabling access for the entire organization.
4. On the application's SQL database child item, use **Share** or **Manage permissions** to give the application **Read** item permission. Leave additional permissions, including **Read all data**, off. Do not use the KQL database or SQL analytics endpoint.
5. Connect to that SQL database as an authorized database administrator using SSMS or the MSSQL extension for VS Code. The Rayfin child item's portal editor is read-only. Review [grant-sql-identity.sql](../scripts/grant-sql-identity.sql), replace `<application-client-id>` with the client ID from step 1, and run it. This creates an external database user and grants the required reads, inserts, and updates on the nine application tables. It does not grant `db_owner`, schema changes, deletes, or access to Rayfin's authentication tables.
6. Confirm each kiosk operator has **Run and interact** access to the Fabric app. They do not need this application credential. Item permission changes can take up to two hours to take effect.

Fabric item Read permission and SQL table grants are separate requirements. See [SQL authentication](https://learn.microsoft.com/fabric/database/sql/authentication), [database sharing](https://learn.microsoft.com/fabric/database/sql/share-sql-manage-permission), and [Entra application credentials](https://learn.microsoft.com/entra/identity-platform/how-to-add-credentials).

### Upload the backend settings

Create a local credential file with owner-only permissions:

```bash
umask 077
touch .env.sql-auth.local
chmod 600 .env.sql-auth.local
```

In a local editor, add these values to `.env.sql-auth.local`. This file is Git-ignored. Do not put credentials in `.env.example`, chat, command-line arguments, or any `VITE_*` setting.

```dotenv
TRIVIA_SQL_TENANT_ID=<deployment-tenant-id>
TRIVIA_SQL_CLIENT_ID=<application-client-id>
TRIVIA_SQL_CLIENT_SECRET="<client-secret-value>"
```

Then upload the backend settings:

```bash
node --env-file=.env.sql-auth.local scripts/configure-backend.mjs \
  --sql-database-id "$SQL_DATABASE_ID" \
  --eventstream-id "$EVENTSTREAM_ID"
```

The script requires all three application settings before contacting Fabric. It checks that the application's tenant matches the active deployment, verifies the deployment account's sign-in tenant, resolves the SQL connection information and existing Eventstream publisher credential, and writes these values to the backend secret store:

| Setting | Purpose |
| --- | --- |
| `TRIVIA_SQL_SERVER` | Fabric SQL hostname |
| `TRIVIA_SQL_DATABASE` | Application database name |
| `TRIVIA_SQL_TENANT_ID` | Entra tenant containing the backend application |
| `TRIVIA_SQL_CLIENT_ID` | Backend application's client ID |
| `TRIVIA_SQL_CLIENT_SECRET` | Private application credential used to obtain a SQL token |
| `TRIVIA_EVENTHUB_CONNECTION_STRING` | Private Eventstream publisher connection, including `EntityPath` |

The output lists configured setting names without exposing their values. The SQL driver obtains a token for the application identity. It does not use the operator's SQL token or SQL username/password authentication. The uploader updates named secrets without removing other backend settings. Secret updates are separate requests; if one fails, resolve the error and rerun the command before opening the kiosks.

Rotate the client secret before it expires. Capture a replacement, update the protected local file, rerun this upload, and verify a saved game before revoking the old secret. Secret rotation does not require a code change. Keep the local credential file only as long as your approved credential-management process requires.

## 6. Load questions and run a game

1. Open `/operator` on the hosting URL from step 3.
2. Select **Sign in operator with Fabric** and complete sign-in.
3. On the operator setup page, select **Load questions and create pools**. Bookmark `/operator` for staff; attendee screens have no operator setup button.
4. Follow the [question import guide](questions.md). No questions or pools are created at startup.
5. Return to registration, complete a game, and wait for its saved result.
6. Follow [Confirm telemetry delivery](telemetry-events.md#confirm-delivery) to check that the game events reached Eventhouse.

Repeat sign-in and a saved game with a non-builder operator in a private browser window. Then check each kiosk operator's own account and station. Confirm their results reach the existing shared scoreboard. Deployment health and a successful builder login do not prove that other operators can sign in.

The deployment is ready for a kiosk when operator sign-in, registration, question loading, saved results, and telemetry delivery work in that environment. Configure the station using [Run a kiosk](operations.md).

## Update an existing deployment

### Switch SQL authentication

Older Functions declared SQL SSO connections and used the executing operator's SQL token. Configure the application identity and permissions from step 5 before deploying this version. Then run the full deployment from step 3 to replace the Function connection metadata as well as the code. Uploading credentials alone does not remove the old SSO declarations.

There is no fallback to operator SQL SSO. Missing, expired, or unauthorized application credentials block SQL operations for every station. Keep the existing database and analytics items; do not create a separate deployment per operator.

If Fabric displayed a builder-only SSO warning, verify that it disappears for a non-builder operator after deployment. This change removes the app's delegated SQL dependency, but a local build cannot establish whether the Fabric sign-in restriction has cleared.

### Review the contact-free player schema

The player-entry implementation replaces the old `Player` contact columns with `playerCode`, a generated `name`, a required selected `country`, a salted `runeHash`, its catalog version, and verification counters. It also introduces the private `PlayerEntryState` entity. The application will not work correctly against the old email-based schema.

Review the generated schema changes and existing data before deployment. Existing player rows do not have codes or rune verifiers; there is no automatic conversion or account-recovery migration in this repository. Do not invent placeholder email addresses, fabricate credentials for existing rows, or use `--force` to bypass this decision.

Review `rayfin/functions/src/country-names.txt` before deployment. New players must select an approved country; it is saved and included in analytics. Rows without a country need a separately reviewed data transition, not an invented default. Builds generate the picker and backend allowlist from the same TXT file. Deploy frontend and Functions together, and preserve names used by existing players unless their records are migrated.

Country labels now use printable ASCII. The [seven renamed countries](operations.md#ascii-country-names) have explicit aliases for existing players and queued telemetry. Deploy frontend and Functions together, finish active games, and reload idle kiosks before using the new labels. Old frontend builds do not recognize the new spellings returned by the updated backend. Deployment does not rewrite existing SQL country values or historical Eventhouse events; review those updates separately with the database and report owners.

Any destructive migration, removal of historical contact fields, or cleanup of old SQL/Eventhouse/exported data requires a separate authorized plan. Updating application code alone does not erase previously collected information. Run `npm run schema:check` locally to check entity discovery and private policies; this does not apply the schema to Fabric.

The entry format uses nine runes and four-character codes. Deploy the frontend, Functions, and four-character `playerCode` column together. Five-character codes and removed rune choices are not supported. No credential conversion or historical-name rewrite runs automatically.

### Deploy reviewed changes

Keep that environment's private deployment files. Sign in to its tenant, set `TENANT_ID` and `WORKSPACE_URI`, and run the full deployment command from step 3. This applies code, configuration, and schema changes together.

Use `npx rayfin up switch <workspace>` before running the telemetry and backend helper scripts if the checkout records more than one deployment. Use a separate checkout for another tenant or environment. Do not copy one environment's private deployment files into another.

Review any destructive schema change before using `--force`. Routine deployment does not require it.

## Troubleshooting

| Problem | Action |
| --- | --- |
| `npx rayfin` reports npm E404 for `rayfin` | Run [Install dependencies and the CLI](#1-install-dependencies-and-the-cli) from the repository root. The required package is `@microsoft/rayfin-cli`, and development dependencies must be included. |
| Package installation fails | Check access to `https://registry.npmjs.org/` and the exact package version in the lockfile. Do not change dependency versions to bypass the error. |
| Rayfin or a required workload is unavailable | Ask the tenant administrator to confirm preview access, capacity settings, region support, and your permissions. |
| Backend configuration reports a registry mismatch | Compare the supplied tenant, workspace, app, and selected Rayfin deployment with the active entry in `rayfin/.deployments.json`. |
| A helper reports that no active deployment is selected | Run `npx rayfin up list`, then `npx rayfin up switch <workspace>` to select the intended registry entry. |
| A helper refuses the Fabric API URL | Redeploy or switch to the intended workspace to refresh its registry entry. Confirm that `fabricDeepLink` identifies the correct Fabric environment, workspace, and app. Do not replace a regional workload URL with a REST API URL. |
| A helper reports a tenant mismatch | Run `npx rayfin login --tenant <deployment-tenant-id>` for the active deployment before configuring analytics or backend secrets. |
| Question imports or registration fail with SQL errors | Confirm that `SQL_DATABASE_ID` belongs to this app, all application settings are present, the client secret is valid, and the service principal has both SQL item Read and the table grants from step 5. |
| Fabric reports a builder-only app because its Functions use SSO | Confirm the updated Functions and connection metadata were deployed, not just the backend secrets. Try a fresh non-builder session. If the same banner remains, stop and collect a redacted error for the Fabric owner; do not widen database permissions as a substitute for resolving app sign-in. |
| Telemetry destination is not running | Inspect the Eventstream destination in Fabric and follow the [telemetry guide](telemetry-events.md#confirm-delivery). |
| Localhost reports unsupported Fabric sign-in | Use the deployed hosting URL. Local gameplay is not supported. |

Deployment creates a new question and player database. It does not import data from an existing system or configure the external leaderboard report.
