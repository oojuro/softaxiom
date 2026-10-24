<p align="center">
  <img src="assets/softaxiom-logo.svg" alt="Soft Axiom logo" width="128" height="128">
</p>

# Soft Axiom

A personal AI assistant you can run yourself, with your own model credentials and data.

The runtime, CLI and build tools are written in strict TypeScript. Packages contain compiled
JavaScript and generated type declarations for Node.js.

**Status: early source preview.** The runnable core includes workspace memory, local installed-browser execution and a durable
Radar inbox with scoped background tasks for developers and heavy users. The shared runtime now includes context assembly, model/tool execution, authority checks and
skill loading, consumed by the hosted product through the same package. See [the shared core](docs/SHARED_CORE.md). This is not a supported complete assistant release.

The product uses one **`sa` CLI**, with `softaxiom` as an alias: **`sa radar …`** watches and routes
events, **`sa bridge …`** describes/checks connections, and **`sa compass plan …`** prepares an
on-demand day plan. See [available commands](docs/CLI.md) and [the local/cloud product map](docs/PRODUCT.md).
Cloud login and same-conversation chat have preview clients; their server API must be deployed
and accepted before use. Paired-device execution and the Thesys OpenUI interface remain release
work. The pinned bootstrap below installs the reviewed `sa` preview, including local API-key
setup and the trusted model-profile security fix.

Source builds also support [persistent interactive terminal chat](docs/CHAT.md), journal-backed
history and stable-ID interruption recovery. Installer promotion remains separate from these
source capabilities; the bootstrap below still selects its reviewed source revision.
Source chat can also [delegate browser tasks](docs/CHAT_BROWSER.md) to the existing Radar worker
with exact origin grants and durable approvals, and inspect their saved results in later messages.

## Installation

The preview supports Linux and WSL2. The PowerShell entry point installs inside WSL2.
These immutable bootstrap URLs install the reviewed TypeScript preview, verify the source archive,
and preserve existing workspace data. Node/npm and the Linux prerequisites must already be installed.
Memory and agent tasks also need the separately installed Oojuro CLI.

### Linux / WSL2

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/oojuro/softaxiom/b240a156ea69f1b8d1cb999a276d42d698290fdf/install.sh | bash
export PATH="$HOME/.local/share/softaxiom/bin:$PATH"
sa --help
```

### Windows PowerShell — installs inside WSL2

```powershell
irm https://raw.githubusercontent.com/oojuro/softaxiom/b240a156ea69f1b8d1cb999a276d42d698290fdf/install.ps1 | iex
```

Open your WSL2 shell and use the printed Linux PATH instructions. This is not a native Windows
installer. No system packages, shell startup files, credentials or browser profiles are changed.
For inspecting scripts first, supported Node/SQLite versions, prerequisites, custom prefixes and
rollback, see [installation](docs/INSTALL.md).

## Workspace memory

The default product runs on your own computer, with your files, terminal and installed browser.
Hosted computer/browser providers are optional private adapters, not core dependencies. The product CLI manages real
`memory/hot`, `warm`, `cool`, `diary` and Oojuro-managed `cold` directories in the visible workspace.
The AI curates importance and writes its diary; the runtime accounts for capacity, assembles
bounded context and preserves complete checkpoint generations.

With Node 22.19+, Linux `flock`, and the Oojuro front-door CLI on PATH:

```sh
npm ci --ignore-scripts
npm run build
node bin/softaxiom.js --workspace /path/to/workspace init
node bin/softaxiom.js --workspace /path/to/workspace usage
node bin/softaxiom.js --workspace /path/to/workspace search 'resume compiler work'
```

Read [architecture](docs/ARCHITECTURE.md), [setup, configuration and limitations](docs/MEMORY.md), and
[local defaults and adapter contracts](docs/ADAPTERS.md). No cloud migration or deployment
is performed by these commands. Model access is optional for CLI operations. Run `sa setup` after installation (or
`node bin/softaxiom.js setup` from built source) to configure local model access without a
Cloud account. See [model setup](docs/MODELS.md). Real-model evaluation is deferred.

[Verification results](docs/MEMORY_VERIFICATION.md): 16 deterministic tests passed on Node 22.19
and 24.20 using the actual Oojuro journal; the licensing follow-up passes 17 total tests.
Packaged CLI checkpoint/restore also passed. See [local browser setup](docs/LOCAL_BROWSER.md), [Radar commands and recovery](docs/RADAR.md),
and [local execution verification](docs/LOCAL_VERIFICATION.md).

## Local browser and Radar

```sh
node bin/softaxiom.js --workspace /path/to/workspace browser start
node bin/softaxiom.js --workspace /path/to/workspace radar sources
node bin/softaxiom.js --workspace /path/to/workspace radar inbox --unread
```

Radar supports explicit GitHub PR checks/reviews, incremental HTTP and MCP checks, signed
webhook ingress and configured browser pages. Events persist before scoped work starts.
The local worker saves progress and asks for exact browser-interaction approvals; unknown
outcomes require reconciliation. Run `radar run` in the foreground or your own service manager.
Collection needs no model. Agent tasks use your configured model and Oojuro, without a cloud account.

Start with [the browser profile/permissions guide](docs/LOCAL_BROWSER.md) and
[the Radar source/subscription examples](docs/RADAR.md). Chrome/Chromium/Edge on Linux/WSL are the
initial browser target; the CLI uses a separate automation profile, not a copy of personal logins.
Project file edits and sandboxed terminal commands require an explicit operator folder grant;
Radar also requires separate subscription actions. See [local execution](docs/LOCAL_EXECUTION.md)
for setup, Linux Bubblewrap prerequisites, limits and uncertain-command recovery. Terminal
networking and Git metadata remain unavailable; external browser changes retain exact approvals.
A complete assistant and web UI are still in preparation. No browser binary is bundled/downloaded.

## What we are preparing

A complete self-hosted assistant for developers and heavy users, in the spirit of [OpenClaw](https://github.com/openclaw/openclaw)
and [Hermes Agent](https://github.com/NousResearch/hermes-agent):

- A persistent personal agent with memory, files, prompts and skills.
- Terminal, browser and tool execution with explicit permissions and durable recovery.
- Messaging adapters, reminders, schedules and background work.
- A web interface for settings, files, results and approvals.
- Documented self-hosting using your own infrastructure and provider credentials, without a
  Soft Axiom Cloud account or subscription.

Managed hosting, commercial billing and service operations belong to a separate private cloud
repository. The cloud composition consumes pinned reviewed versions of this shared assistant through explicit host adapters, with shared implementations owned here.

See [the source boundary and release checklist](docs/OPEN_SOURCE_PREPARATION.md),
[contributing](CONTRIBUTING.md), and [security reporting](SECURITY.md).

See [CI and build policy](docs/CI_AND_BUILDS.md): our runners build artifacts; Vercel receives
prebuilt output only. Public contribution checks require isolated disposable runners.

## License

[Apache License 2.0](LICENSE). Third-party components retain their own licenses and notices.

The license covers the original core source, prompts, docs, tests and configuration. Managed
hosting, subscription billing, fleet operations and customer data remain private in the cloud
repositories. User memories and journals are user data, not licensed source contributions.
See [the public/private boundary and redistribution review](docs/LICENSING.md) and
[third-party component notices](THIRD_PARTY_NOTICES.md).
