<p align="center">
  <img src="assets/softaxiom-logo.svg" alt="Soft Axiom logo" width="128" height="128">
</p>

# Soft Axiom

**Your personal coach for following through.**

Soft Axiom remembers what matters, helps you take the next step, and gets useful work done.

An open-source coach for work, learning, personal goals and everyday life. Run it on your own
computer with your files and installed browser, or connect the CLI to your Soft Axiom Cloud account.

**Early source preview.** Local memory, browser tasks, Radar, Bridge and on-demand Compass planning
are available. Cloud login/chat clients are included; their server API requires deployment and
acceptance before use. Paired-device execution, a complete terminal agent and the personal web
interface remain in development. See [available commands](docs/CLI.md) for the current scope.

## A coach who helps you make progress

The coaching experience is being built around memory, practical help and follow-through:

- **Remember what matters:** your goals, commitments, preferences and what has worked before.
- **Make the next step clear:** turn an overwhelming goal into something manageable today.
- **Get useful work done:** prepare research, drafts and other work that helps you move forward.
- **Bring in expertise:** involve specialized agents, built into Soft Axiom or connected externally.
- **Follow up thoughtfully:** check in at times you choose and adjust when circumstances change.

Its intended personality is calm, resourceful and candid, with a little wit. It challenges a weak
plan with a specific reason, acknowledges uncertainty and helps you adjust when a plan stops
working. You choose the goals, the level of directness and when to pause check-ins.

The complete coaching experience, personality controls and external-agent integration remain
implementation work. See the [product direction](docs/PRODUCT.md#personality-and-initiative);
the source-preview capabilities available today are listed below.

The next foundation will reuse the [OpenClaw engine](https://github.com/openclaw/openclaw), adding
our cached/tiered memory, diary and internal/external specialized agents. That distribution will
use Fireworks for first-party inference and start without an embedding model. The
[migration tracker](https://github.com/oojuro/softaxiom/issues/23) records this work; the current
preview has not migrated yet.

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
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/oojuro/softaxiom/b240a156ea69f1b8d1cb999a276d42d698290fdf/install.sh | bash
export PATH="$HOME/.local/share/softaxiom/bin:$PATH"
sa --help
```

### Windows PowerShell — WSL2

```powershell
irm https://raw.githubusercontent.com/oojuro/softaxiom/b240a156ea69f1b8d1cb999a276d42d698290fdf/install.ps1 | iex
```

Open your WSL2 shell and follow the printed PATH instructions. These immutable installers verify
the selected source archive and preserve existing workspace data. See [installation](docs/INSTALL.md)
for script inspection, prerequisites, custom prefixes and rollback.

The pinned installers include the reviewed `sa` preview and local model setup.

### Build from source

```sh
git clone https://github.com/oojuro/softaxiom.git
cd softaxiom
npm ci --ignore-scripts
npm run build
node bin/softaxiom.js --help
```

`sa` is the primary command and `softaxiom` is an alias. For the examples below, replace `sa`
with `node bin/softaxiom.js` when running a built source checkout.

## Start locally

Configure your model, initialize a workspace and start an independent local conversation:

```sh
sa setup
sa --workspace /path/to/workspace init
sa --workspace /path/to/workspace chat --local 'Help organize my project memory'
```

The current preview's setup accepts OpenAI, Anthropic or an explicitly configured compatible/local
endpoint. The planned OpenClaw-based distribution will replace these choices with Fireworks-only
first-party inference. Model credentials and provider costs are yours; see [current model
setup](docs/MODELS.md).

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
sa --workspace /path/to/workspace browser start
sa --workspace /path/to/workspace radar sources
sa --workspace /path/to/workspace radar inbox --unread
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
