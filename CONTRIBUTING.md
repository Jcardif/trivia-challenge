# Contributing

Use GitHub issues to discuss a bug or proposed change before starting substantial work. For security vulnerabilities, follow [Security](SECURITY.md) instead of opening a public issue.

This project follows the [Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md). Contributions are subject to the Contributor License Agreement process described in the [README](README.md#contributing).

## Set up your development environment

Use Node.js 24, npm, Git, and a Bash terminal. Clone your fork and install the locked dependencies for both projects:

```bash
git clone https://github.com/<your-github-account>/trivia-challenge.git
cd trivia-challenge
npm ci --include=dev &&
  npm --prefix rayfin/functions ci --include=dev
```

Read [Architecture](docs/architecture.md) before changing gameplay, authentication, persistence, or Function contracts. The client and backend share rules from `rayfin/functions/src/gameRules.ts`; `src/config/gameConfig.ts` adds browser settings.

Local tests and builds do not require deployment. `npm run dev:frontend` starts a UI development server, but Fabric authentication and complete gameplay require a deployed app. `npm run dev` can create or update Fabric resources. Use [Deployment](docs/deployment.md) and a dedicated test workspace for live work.

## Validate a change

Run the checks relevant to the files you changed:

| Command | Checks |
| --- | --- |
| `npm test -- --selectProjects frontend --runTestsByPath src/App.test.tsx` | Player flow, operator recovery, and kiosk navigation |
| `npm test -- --selectProjects functions --runTestsByPath rayfin/functions/test/players.test.ts` | Player creation, verification, and persistence |
| `npm run build` | Frontend type checking and production bundle |
| `npm run build:functions` | Functions type checking and build |
| `npm run schema:check` | Entity discovery and private Data API policies, without applying a database migration |
| `npm run lint` | JavaScript and TypeScript lint rules |

Before submitting a pull request, run the complete local checks:

```bash
npm test &&
  npm run build &&
  npm run build:functions &&
  npm run schema:check &&
  npm run lint
```

Do not treat local success as proof of Fabric sign-in, SQL permissions, ingestion, or dashboard freshness. For deployment-affecting changes, record the live checks completed in a test workspace and any checks that remain outstanding. Remove tenant identifiers, credentials, and participant data from shared evidence.

### Review dependencies

Audit both lockfiles. Use `--omit=dev` when checking the runtime dependency sets separately:

```bash
npm audit
npm audit --prefix rayfin/functions
npm audit --omit=dev
npm audit --prefix rayfin/functions --omit=dev
```

Keep the Rayfin packages on matching supported versions. Do not run `npm audit fix --force` or override the CLI's telemetry stack without a separate compatibility review.

The pinned `@microsoft/rayfin-cli@1.35.0` still brings known advisories through its development-only telemetry dependencies:

| Dependency | Outstanding advisories |
| --- | --- |
| `@opentelemetry/core@2.7.1` | [Unbounded baggage allocation](https://github.com/advisories/GHSA-8988-4f7v-96qf) |
| `@opentelemetry/propagator-jaeger@2.7.1` | [Malformed-header denial of service](https://github.com/advisories/GHSA-45rx-2jwx-cxfr) |
| `protobufjs@8.0.1` | Multiple code-generation, prototype-injection, and denial-of-service advisories, including [GHSA-66ff-xgx4-vchm](https://github.com/advisories/GHSA-66ff-xgx4-vchm) and [GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww) |

These packages are not part of the deployed frontend or Functions runtime dependency sets. No exploitable path through this application's reviewed CLI usage has been established, but the advisories remain unresolved. Retain the supported CLI pins until an upstream fix is available; do not describe the full development dependency audit as clean. Recheck this exception when updating Rayfin.

## Preserve application behavior

- Keep player creation, question imports, answers, and completion retry-safe.
- Preserve native SQL transactions and locking. A series of independent API writes is not an equivalent replacement.
- Keep every application entity explicitly private to the Data API and registered in `rayfin/data/schema.ts`.
- Preserve pending game state during operator-session recovery. Do not introduce navigation or automatic retries that discard it.
- Update shared contracts and both callers when a Function request or response changes.

Use installed Rayfin package documentation for the pinned SDK. Packages with a `rayfinDocs` field include their documentation on disk. CLI workflow guidance is in `node_modules/@microsoft/rayfin-guide/assets/docs/`.

### Edit names and countries

Edit `rayfin/functions/src/player-name-words.txt` to change generated adventurer names. Put one word or phrase per line under `[prefixes]` and `[titles]`. Names receive a numeric suffix only after a collision.

Edit `rayfin/functions/src/country-names.txt` to change the approved country picker. Names must be unique ignoring case, use printable ASCII, and fit within 80 characters. See [ASCII country names](docs/operations.md#ascii-country-names) before changing an existing name.

Run `npm run entry:generate` after editing either list. Builds and tests also run generation. Do not edit the generated TypeScript files directly. Preserve existing names or provide a reviewed compatibility and data-transition plan; these lists also validate saved identities and telemetry.

## Write documentation

Follow the [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/) and the repository's `.prettierrc`. Use the [procedure guidance](https://learn.microsoft.com/style-guide/procedures-instructions/writing-step-by-step-instructions) for tasks.

- Start with the reader's goal, required access, and expected result.
- Use sentence-case headings, active voice, and short procedures with one action per step.
- Use the exact UI labels and commands supported by the current code. Distinguish sample capabilities from separately built integrations.
- Use placeholders for tenant, workspace, application, and database values. Keep private environment notes, credentials, and experiment logs out of committed documentation.
- State when a command changes cloud resources or data. Separate preview commands from apply commands.
- Link to the authoritative guide instead of repeating a procedure in several places.
- Validate CSV examples with the application importer. A visually correct spreadsheet is not proof of a valid import.
- Keep the Microsoft security-reporting, license, code-of-conduct, and trademark notices intact.

Format changed Markdown files with the installed formatter:

```bash
npx --no-install prettier --write README.md CONTRIBUTING.md "docs/*.md"
```

Review local links and anchors after changing headings. Use descriptive link text and alternative text for informative images. Do not reuse a legacy screenshot or architecture diagram if it no longer describes this implementation.

## Submit a pull request

1. Keep the change focused and update its directly related documentation.
2. Describe the user-visible behavior, compatibility implications, and any deployment or data changes.
3. Include the checks you ran, meaningful performance measurements where relevant, and unresolved limitations.
4. Review the diff for generated output, deployment-specific settings, credentials, and participant data.
5. Submit the pull request from your fork and follow the CLA bot's instructions.

See [Support](SUPPORT.md) for help and [LICENSE](LICENSE) for licensing terms.
