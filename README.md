# Microsoft Fabric Trivia Challenge

A quiz web application that helps event attendees and learners assess their Microsoft Fabric knowledge. Players answer multiple-choice questions against the clock, earn time through streaks, and review incorrect answers.

The application uses React and TypeScript, Rayfin Functions, a Fabric SQL database, and Fabric Real-Time Intelligence for telemetry.

> This application requires access to the Rayfin preview in Microsoft Fabric. The complete game runs in Fabric. Local development supports building and testing the code, but not local gameplay or offline operation.

## Features

- Timed questions with streak bonuses, hearts, and answer feedback.
- Question pools loaded from CSV files prepared in Excel or a text editor.
- Touch, mouse, and keyboard controls.
- One Fabric operator sign-in per kiosk browser. Attendees register without Fabric accounts.
- Saved game results and event telemetry for analysis in Fabric.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 and npm.
- [Git](https://git-scm.com/).
- A Fabric workspace with capacity, Rayfin enabled, and permission to deploy the application and its analytics resources.

Command examples use Bash. On Windows, use Git Bash or WSL.

### 1. Clone and install

```bash
git clone https://github.com/microsoft/trivia-challenge.git
cd trivia-challenge
npm ci --include=dev &&
  npm --prefix rayfin/functions ci --include=dev &&
  npx rayfin --version
```

The frontend and Functions have separate dependency lockfiles, so both installation commands are required. Packages are downloaded from the public npm registry. The CLI is the `@microsoft/rayfin-cli` development dependency, which provides the `rayfin` command. The version command must succeed before continuing; see [Install dependencies and the CLI](docs/deployment.md#1-install-dependencies-and-the-cli).

### 2. Deploy to Fabric

Follow [Deploy the application](docs/deployment.md) to create the app, provision analytics, and configure the backend. Use your own tenant and workspace; the repository does not provide a shared hosted instance.

### 3. Load questions

Open the deployed app and select **Sign in operator with Fabric**. After signing in, open **Operator setup** and select **Load questions and create pools**.

Use [examples/questions.csv](examples/questions.csv) as a starting point. The [Excel and CSV guide](docs/questions.md) defines every column, explains the correct-answer numbering, and walks through saving and importing the file.

### 4. Run the challenge

Return to attendee registration. Each player registers, selects a pool, reads the instructions, and plays. Wait for the result to finish saving before selecting **Play Again** for the next attendee.

For station setup and event operation, see [Run a kiosk](docs/operations.md).

## Development

Run these commands from the repository root:

```bash
npm run build
npm run schema:check
npm test
npm run lint
```

For frontend development:

```bash
npm run dev:frontend
```

Vite serves the frontend at `http://127.0.0.1:5173`. Fabric sign-in and gameplay remain unavailable on localhost. Use a dedicated Fabric deployment for the complete application.

`npm run dev` starts Rayfin's Fabric-backed development workflow and can create or update cloud resources. It is not an offline alternative.

## Project structure

| Path                | Contents                                            |
| ------------------- | --------------------------------------------------- |
| `src/`              | React pages, game state, timer, and client services |
| `public/`           | Logos, station avatars, and pool icons              |
| `rayfin/data/`      | SQL entity definitions                              |
| `rayfin/functions/` | Backend Functions and their tests                   |
| `scripts/`          | Deployment configuration and analytics provisioning |
| `infra/`            | Telemetry table definitions and KQL queries         |
| `examples/`         | Sample question CSV                                 |
| `docs/`             | Deployment, operator, and developer documentation   |

## Documentation

| Guide | Contents |
| --- | --- |
| [Deployment](docs/deployment.md) | Prerequisites, first deployment, updates, and backend configuration |
| [Excel and CSV questions](docs/questions.md) | Spreadsheet layout, answer keys, pools, metadata, and import errors |
| [Kiosk operation](docs/operations.md) | Operator sign-in, station IDs, player handoff, and troubleshooting |
| [Architecture](docs/architecture.md) | Components, game rules, data storage, and request handling |
| [Telemetry](docs/telemetry-events.md) | Event reference, delivery monitoring, privacy, and report queries |

## Contributing

This project welcomes contributions and suggestions. Most contributions require you to agree to a Contributor License Agreement declaring that you have the right to grant us the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot determines whether you need to provide a CLA. Follow its instructions. You only need to do this once across repositories using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](CODE_OF_CONDUCT.md). For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com).

See [Support](SUPPORT.md) for help, [Security](SECURITY.md) for vulnerability reporting, and [LICENSE](LICENSE) for the MIT license.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to [Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general). Use of Microsoft trademarks or logos in modified versions must not cause confusion or imply Microsoft sponsorship. Third-party trademarks and logos are subject to those third parties' policies.
