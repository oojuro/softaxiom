<p align="center">
  <img src="assets/softaxiom-logo.svg" alt="Soft Axiom logo" width="128" height="128">
</p>

# Soft Axiom

An open-source personal AI agent for developers and heavy users. Run it on your own computer
with your models, files and installed browser, or connect the CLI to your Soft Axiom Cloud account.

**Early source preview.** Local memory, browser tasks, Radar, Bridge and on-demand Compass planning
are available. Cloud login/chat clients are included; their server API requires deployment and
acceptance before use. Paired-device execution, a complete terminal agent and the personal web
interface remain in development. See [available commands](docs/CLI.md) for the current scope.

## What you can do

- **Keep working memory:** readable memory tiers and diaries live in your workspace, with
  capacity accounting, bounded context and consistent checkpoints.
- **Use your browser:** run scoped tasks through your installed Chrome, Chromium or Edge.
  Browser changes require approval for the exact action.
- **Watch for changes with Radar:** collect GitHub, API, MCP and configured browser events into
  a durable inbox, then route them to subscriptions and background tasks.
- **Check connections with Bridge:** configure GitHub adapter descriptors and explicitly check
  the connected account through API, MCP or browser access.
- **Plan with Compass:** request a day plan using available memory and permitted browser reads.
  Automatic daily scheduling is not included yet.

The runtime, CLI and build tools use strict TypeScript. Distributed packages contain compiled
JavaScript and type declarations for Node.js.

## Installation

The preview supports Linux and WSL2. PowerShell installs inside an existing WSL2 distribution.
You need Node/npm and the [documented prerequisites](docs/INSTALL.md), including a patched SQLite
engine for Radar. Memory and local agent tasks also require the separately installed Oojuro CLI.

### Linux / WSL2

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/oojuro/softaxiom/41e5a252b76da710df79576595353b19245cc40c/install.sh | bash
export PATH="$HOME/.local/share/softaxiom/bin:$PATH"
softaxiom --help
```

### Windows PowerShell — WSL2

```powershell
irm https://raw.githubusercontent.com/oojuro/softaxiom/41e5a252b76da710df79576595353b19245cc40c/install.ps1 | iex
```

Open your WSL2 shell and follow the printed PATH instructions. These immutable installers verify
the selected source archive and preserve existing workspace data. See [installation](docs/INSTALL.md)
for script inspection, prerequisites, custom prefixes and rollback.

**The pinned installer installs an earlier reviewed preview.** Build the current source below
for the new `sa` command families, model setup and cloud clients.

### Build the current CLI

```sh
git clone https://github.com/oojuro/softaxiom.git
cd softaxiom
npm ci --ignore-scripts
npm run build
node bin/softaxiom.js --help
```

After installing the current package, `sa` is the primary command and `softaxiom` is an alias.
From a source checkout, use `node bin/softaxiom.js` as shown here.

## Start locally

Configure your model, initialize a workspace and start an independent local conversation:

```sh
node bin/softaxiom.js setup
node bin/softaxiom.js --workspace /path/to/workspace init
node bin/softaxiom.js --workspace /path/to/workspace chat --local 'Help organize my project memory'
```

Setup accepts OpenAI, Anthropic or an explicitly configured compatible/local endpoint. Model
credentials and provider costs are yours; see [model setup](docs/MODELS.md).

### Workspace memory

Memory lives in real directories under the workspace you select:

```text
memory/
├── hot/
├── warm/
├── cool/
├── diary/
└── cold/     # Oojuro-managed journal
```

The agent curates readable memories and diaries. The runtime accounts for tier capacity, bounds
model context and checkpoints the complete memory directory. Access the cold journal through
Oojuro's supported interface. See [memory configuration and recovery](docs/MEMORY.md).

### Browser and Radar

```sh
node bin/softaxiom.js --workspace /path/to/workspace browser start
node bin/softaxiom.js --workspace /path/to/workspace radar sources
node bin/softaxiom.js --workspace /path/to/workspace radar inbox --unread
```

The browser uses a separate automation profile. Radar persists events before starting scoped
work, deduplicates notifications and saves task progress. Run `radar run` in the foreground or
under your own service manager. Source collection needs no model; agent tasks use your model.
See [browser permissions](docs/LOCAL_BROWSER.md) and [Radar configuration](docs/RADAR.md).

## Local and Cloud

The CLI connects to the runtime you choose:

| Mode | What it means | Current status |
| --- | --- | --- |
| Local | Your model access, workspace and installed browser; no Cloud account required | Available source preview |
| Cloud account | Log in and chat with the existing hosted agent and conversation, including the one used through iMessage | Preview clients included; compatible server deployment and acceptance required |
| Cloud task controls | Inspect and control hosted tasks, Radar work and approvals from the CLI | Planned |
| Cloud with a paired device | Let the hosted agent execute permitted tools on a computer you explicitly connect | Planned |

Cloud login and model-provider setup are separate. Logging in does not upload your workspace
or grant access to your computer. Use `chat --local` for independent local work after Cloud login.
See [Cloud account commands](docs/CLI.md#cloud-account-and-conversation).

Paired-device execution will require explicit consent, revocable credentials and permissions
enforced on the device. Requests must survive disconnects without repeating uncertain actions.
The [product design](docs/PRODUCT.md) describes that boundary and the remaining release work.

The open-source repository owns the shared agent runtime, CLI and portable tools. Soft Axiom
Cloud consumes reviewed versions of that core and adds managed hosting, account services,
billing and connection maintenance. See [shared core ownership](docs/SHARED_CORE.md) and
[the public/private source boundary](docs/OPEN_SOURCE_PREPARATION.md).

## Documentation and contributing

- [CLI reference](docs/CLI.md) and [model setup](docs/MODELS.md)
- [Local verification results](docs/LOCAL_VERIFICATION.md) and [memory verification](docs/MEMORY_VERIFICATION.md)
- [Architecture](docs/ARCHITECTURE.md) and [adapter SDK](docs/ADAPTER_SDK.md)
- [Contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md)

Verification results describe their recorded source and environment. Live Cloud acceptance,
real-model evaluation and native Oojuro distribution have separate release gates.

## License

[Apache License 2.0](LICENSE). Third-party components retain their own licenses and notices.
User memories and journals are user data. See [licensing and redistribution](docs/LICENSING.md)
and [third-party notices](THIRD_PARTY_NOTICES.md).
