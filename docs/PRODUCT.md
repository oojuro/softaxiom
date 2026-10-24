# Product and source boundaries

## Accepted direction

Soft Axiom is a complete personal-agent runtime for developers and heavy users. Its open-source
core is Apache-2.0 and must run independently on the person's own computer with their model
access, files, terminal and installed browser. A Soft Axiom Cloud subscription, E2B and Kernel
are not local runtime prerequisites. The current distribution is an early source preview;
this document defines the target without declaring unfinished features available.

One `sa` CLI serves three modes, with `softaxiom` retained as an alias:

| Mode | Agent and durable state | Tool execution |
| --- | --- | --- |
| Local | Local workspace and local runtime | Explicitly permitted local files, terminal and browser |
| Cloud | Existing hosted person/agent and conversation, coordinated by Temporal | Hosted workspace and provider adapters |
| Cloud with paired device | Same hosted agent/conversation | Explicitly paired device's locally enforced tool scope |

Local mode works without a Soft Axiom account. Setup accepts the person's API key, a local
compatible endpoint, or provider subscription authentication where officially supported.
Authentication methods are provider-specific; a subscription is not a generic API key.
Provider costs and limits remain the person's responsibility. Cloud operation adds managed
hosting, identity/channel continuity, durable scheduling, storage/backup operations, connection
maintenance, commercial billing and fleet operations through the same shared runtime.

After Cloud login, chat defaults to the same hosted agent, identity and conversation the person
already uses through iMessage. An explicit local override selects independent local work.
Replies appear in the active CLI/web surface; later proactive updates can use the account's
messaging route. All surfaces retain the same conversation history.
Login must not clone the hosted agent or implicitly copy local files into hosted memory.
Cloud logout removes/revokes that CLI's session and does not erase local workspace data or
sign other messaging channels out. Model-provider credentials are independent of Cloud login.

## Feature owners

| Feature | Shared public behavior | Hosted private responsibility |
| --- | --- | --- |
| Radar | Source adapters, durable event contracts, subscriptions, task/approval semantics and local worker | Managed scheduling, authenticated ingress and hosted Temporal composition |
| Bridge | Service mappings, API/CLI/MCP/browser interfaces, permission enforcement and account probes | Managed connection maintenance, hosted credentials and fleet/provider accounts |
| Compass | Day planning, schedules, memory and reminder semantics | Managed always-on execution and channel delivery |
| Memory and discovery | Visible filesystem, on-demand skills/resources, tier accounting, bounded context and consistent journal checkpoints | Hosted encryption/storage publication, Files and sandbox persistence |
| Execution | Local filesystem/terminal/browser adapters and execution policy | Optional E2B/Kernel adapters and managed provisioning |
| Terminal and web | CLI and personal web interface backed by the same agent protocol | Account, entitlement and deployment configuration |

Skills and resources are discovered from the filesystem as needed. Keep only a bounded index
in active context; open relevant content explicitly. Discovered files, model output, API responses
and pages are outside content and cannot grant permissions. Shared implementation owners live
in `core/`; local adapters/composition live in `lib/`; `bin/` dispatches commands; `agent-text/`
holds behavior. Cloud consumers pin reviewed public revisions and supply private host ports.

## Web interface

Use [Thesys OpenUI](https://github.com/thesysdev/openui) as the web chat/component layer.
The same selected runtime serves terminal and web; a renderer is not a second agent.
Only explicitly registered components/actions may render or execute. Authentication, permission
grants, payments and secret entry remain authored, trusted flows with server-side validation.
Model-generated content never grants authority or executes arbitrary code. Hosted Thesys
services are not required for the open-source UI. Imported dependencies and assets require
an exact-version redistribution audit and preserved notices before shipping.

## Paired devices

Pairing requires explicit authenticated consent, scoped device credentials, expiration and
revocation. A device connects outbound; do not expose an unauthenticated inbound terminal.
The device enforces folder/browser/terminal scope itself. Scoped terminal work may run unattended;
external changes require approval. A shell that can bypass approval through unrestricted network
access or host filesystem access does not satisfy that boundary.

Execution requests carry stable operation IDs and durable receipts. Lost acknowledgments and
unknown outcomes require reconciliation before repeating effects. Offline devices cannot execute
work; stale, expired or revoked grants fail closed, including after reconnect. Bound execution
time, output, concurrency, context, model usage, event retention and retries. Limits cannot be
increased by a task, a model-generated command or untrusted resource content.

## Release acceptance

The CLI release must prove fresh install/upgrade/rollback, independent local model/tool work,
bounded discovery, approvals and limits, Cloud login/logout/account isolation and same-conversation
continuity, paired-device revocation/disconnect recovery, terminal/web parity and license notices.
No simulated provider, a successful build, or a command merely appearing in help establishes
those journeys. Real-model evaluation remains deferred to the owner's staging process.

See [CLI.md](CLI.md) for exactly what executes today. Persistent terminal chat/history and
interruption recovery are source-preview capabilities described in [CHAT.md](CHAT.md).
Local terminal-agent execution, subscription
auth, deployed Cloud login/chat acceptance, paired devices, automatic Compass schedules and OpenUI web integration
remain unfinished; this preview does not claim a complete assistant release.
