# Soft Axiom

A personal AI assistant you can run yourself, with your own model credentials and data.

**Status: early source preview.** The runnable core includes workspace memory, local installed-browser execution and a durable
Radar inbox with scoped background tasks for developers and heavy users. The shared runtime now includes context assembly, model/tool execution, authority checks and
skill loading, consumed by the hosted product through the same package. See [the shared core](docs/SHARED_CORE.md). This is not a supported complete assistant release.

## Workspace memory

The default product runs on your own computer, with your files, terminal and installed browser.
Hosted computer/browser providers are optional private adapters, not core dependencies. The product CLI manages real
`memory/hot`, `warm`, `cool`, `diary` and Oojuro-managed `cold` directories in the visible workspace.
The AI curates importance and writes its diary; the runtime accounts for capacity, assembles
bounded context and preserves complete checkpoint generations.

With Node 22.19+, Linux `flock`, and the Oojuro front-door CLI on PATH:

```sh
node bin/softaxiom.js --workspace /path/to/workspace init
node bin/softaxiom.js --workspace /path/to/workspace usage
node bin/softaxiom.js --workspace /path/to/workspace search 'resume compiler work'
```

Read [architecture](docs/ARCHITECTURE.md), [setup, configuration and limitations](docs/MEMORY.md), and
[local defaults and adapter contracts](docs/ADAPTERS.md). No cloud migration or deployment
is performed by these commands. Model access is optional for CLI operations and configured by
the operator for `chat`. Real-model evaluation is deferred.

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
This runner has no arbitrary shell/code-edit/push tool. A complete assistant and web UI are still
in preparation. No browser binary is bundled or downloaded.

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
