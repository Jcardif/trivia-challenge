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

## 5. Configure the backend

```bash
node scripts/configure-backend.mjs \
  --sql-database-id "$SQL_DATABASE_ID" \
  --eventstream-id "$EVENTSTREAM_ID"
```

The script uses the active Rayfin deployment registry entry, verifies the sign-in tenant matches that entry, resolves the SQL connection information and Eventstream publisher credential, and writes these values to the backend secret store:

| Setting | Purpose |
| --- | --- |
| `TRIVIA_SQL_SERVER` | Fabric SQL hostname |
| `TRIVIA_SQL_DATABASE` | Application database name |
| `TRIVIA_EVENTHUB_CONNECTION_STRING` | Private Eventstream publisher connection, including `EntityPath` |

The output lists configured setting names without exposing their values. SQL uses a token supplied by the Functions host, not a stored SQL password. Keep backend settings out of `VITE_*` variables and source control.

## 6. Load questions and run a game

1. Open the hosting URL from step 3.
2. Select **Sign in operator with Fabric** and complete sign-in.
3. Open **Operator setup**, then select **Load questions and create pools**.
4. Follow the [question import guide](questions.md). No questions or pools are created at startup.
5. Return to registration, complete a game, and wait for its saved result.
6. Follow [Confirm telemetry delivery](telemetry-events.md#confirm-delivery) to check that the game events reached Eventhouse.

The deployment is ready for a kiosk when registration, question loading, saved results, and telemetry delivery work in that environment. Configure the station using [Run a kiosk](operations.md).

## Update an existing deployment

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
| Question imports or registration fail with SQL errors | Confirm that `SQL_DATABASE_ID` belongs to this app and that step 5 completed. |
| Telemetry destination is not running | Inspect the Eventstream destination in Fabric and follow the [telemetry guide](telemetry-events.md#confirm-delivery). |
| Localhost reports unsupported Fabric sign-in | Use the deployed hosting URL. Local gameplay is not supported. |

Deployment creates a new question and player database. It does not import data from an existing system or configure the external leaderboard report.
