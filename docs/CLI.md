# One CLI, shared features

`sa` is the primary command. `softaxiom` and the older `sa-memory` name invoke the same
entry point. This source preview supports Linux and WSL2. Build before invoking
`node bin/softaxiom.js`; npm and installer launchers invoke that compiled entry point.

## Available command families

| Command | What executes today |
| --- | --- |
| `sa chat REQUEST` | Existing hosted conversation after Cloud login; independent local memory conversation otherwise |
| `sa chat --local REQUEST` | Explicit independent local memory conversation, even after Cloud login |
| `sa login [--server HTTPS_ORIGIN]` | Email/phone-code sign-in to an existing Cloud account; requires deployed CLI API |
| `sa logout` / `sa status` | Remove this CLI's Cloud session / inspect saved session metadata without printing tokens |
| `sa agent [--origins ORIGIN,...] REQUEST` | Durable local memory/browser task; browser changes require exact approval |
| `sa radar …` | Source collection, durable inbox, subscriptions, tasks, approvals and foreground worker |
| `sa bridge github configure api` | Read-only GitHub adapter descriptor; also supports `mcp` and `browser` |
| `sa bridge github check api --token-env GITHUB_TOKEN --account LOGIN` | One explicit account-identity probe |
| `sa bridge github check mcp --token-env GITHUB_TOKEN --account LOGIN` | One read-only MCP account-identity probe |
| `sa bridge github check browser --account LOGIN` | Account check through the configured local installed browser |
| `sa compass plan [--origins ORIGIN,...] [REQUEST]` | On-demand planning task using available memory and permitted browser reads |

`--workspace DIR` precedes the command family. Each family has `--help`, which needs no
model, journal or initialized workspace. Current memory/terminal/browser commands retain
their existing names and behavior. `sa run -- COMMAND` is an explicitly invoked operator
command, runs with the operator's OS privileges, and is **not an agent sandbox**.

## Cloud account and conversation

Cloud login uses the existing account's linked email or phone, never creates a second agent,
and does not upload your workspace. Cloud chat joins the same conversation as iMessage;
replies are read here rather than sent to iMessage again. Later proactive updates retain the
account's messaging route. Model-provider credentials and Cloud-account credentials are separate.

The server must deploy the versioned CLI/conversation API first. Older deployments are refused
before requesting a verification code. Until that deployment passes acceptance, these commands
are source-preview capabilities, not a claim that production Cloud chat is available.

`sa chat --operation UUID REQUEST` uses one stable ID for one message. The CLI prints the ID
before sending. After an uncertain connection failure, retry the exact request with the same ID;
do not issue a new ID for that message. `sa chat --resume UUID` only reads progress. A pending
turn returns its ID after a minute; it does not claim completion or automatically resubmit work.
Completed turns page their actual conversation replies, excluding model reasoning and tool data.

Session files live outside the workspace under `~/.local/state/softaxiom` (or the explicit
`SOFTAXIOM_STATE_DIR`), with a private directory, owner-only files, atomic replacement and an
OS lock across refresh/save/logout. This is private filesystem storage, not encryption against
other programs running as you. Do not share this directory or include it in workspace backups.
Only HTTPS origins, or explicit loopback HTTP for development, are accepted. Credentials never
follow redirects. `sa status` checks saved metadata, not live reachability. Logout always removes
the local session and reports whether remote revocation was confirmed; access-token expiry and
provider revocation semantics still apply. Local files and model access remain intact.

## Radar, Bridge and Compass

Radar observes changes and routes durable events into scoped tasks. Bridge describes and
checks connections; its portable adapter SDK is shared with the managed host. A Bridge probe
does not grant agent write permission, configure Radar subscriptions or create a background
maintenance service. Hosted automatic connection maintenance belongs to the private host.
Session revocation, absolute expiry and provider challenges still require reconnection.

Compass prepares a proposed plan from what the local agent can actually read. It uses the
same durable task/approval queue as Radar; inspect `sa radar tasks`, `results` and `approvals`.
It does not install daily timers, query unconfigured calendars or execute arbitrary terminal
commands. Persistent day schedules and a complete terminal agent remain release work.

Bridge checks read a credential only from the explicitly named environment variable. Do not
put a token in the command line, a task instruction, a watched event or a skill. `--account`
detects a switched account. No credential is returned by these commands.

## Local and cloud target

The accepted product design is [PRODUCT.md](PRODUCT.md). The following commands describe that
target and **are not available in this preview**:

```text
sa setup                         # configure your own model access locally
sa login                         # connect to an existing Soft Axiom Cloud account
sa chat --local REQUEST           # independent local runtime even when logged in
sa cloud tasks                   # hosted tasks for the authenticated person
sa device pair / start / revoke  # scoped, revocable paired-device execution
sa web                           # local web interface using Thesys OpenUI
```

Today `sa chat` remains local; there is no cloud session to select. After cloud login is
implemented, its default will be the same ongoing hosted agent/conversation as iMessage.
Local model-provider login and Soft Axiom Cloud account login are separate credentials and
separate billing relationships. No source-preview command silently uploads a local workspace.

Use [memory configuration](MEMORY.md), [local browser setup](LOCAL_BROWSER.md),
[Radar configuration](RADAR.md) and the [adapter SDK](ADAPTER_SDK.md) for runnable examples.
