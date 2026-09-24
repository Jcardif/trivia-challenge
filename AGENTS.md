# Contributor guidance for agents

Preserve gameplay behavior unless a change is requested. Before changing gameplay, authentication, SQL persistence, or Function contracts, read [Architecture](docs/architecture.md). Consult `src/config/gameConfig.ts` for executable settings.

For Rayfin changes, load `.agents/skills/rayfin/SKILL.md` and read the installed package documentation identified by `rayfinDocs`. CLI documentation is in `@microsoft/rayfin-guide`. Preserve explicit private entity policies and schema discovery; run `npm run schema:check` after changing them.

For deployment or environment changes, read [Deployment](docs/deployment.md). Deployment and destructive cloud operations require explicit authorization. Local gameplay is unsupported, and `npm run dev` can change Fabric resources.

For CSV imports, read [Prepare and import questions](docs/questions.md) and use `rayfin/functions/src/csv.ts` as the format authority. For kiosk behavior, read [Run a kiosk](docs/operations.md). For analytics, read [Telemetry](docs/telemetry-events.md).

Write public documentation with placeholders and reproducible steps. Keep environment-specific deployment details and experiment notes outside committed documentation. Validate CSV examples with the application importer and use the repository's Markdown formatting configuration.
