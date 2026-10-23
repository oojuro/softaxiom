# Core architecture

This slice serves programmers and heavy users through a product CLI (`sa`, aliases `softaxiom` and `sa-memory`), readable
workspace files and an optional local memory/browser assistant on the person's computer. Hosted
computer/browser providers are optional external adapters; the core imports no hosted computer/browser provider SDK.

## Owners and data flow

| Concern | Owner / source of truth |
| --- | --- |
| Importance and diary prose | AI curation; stable Markdown IDs and daily accounts |
| Tier | Real folder placement in workspace/memory/hot, warm or cool |
| Raw observed experience | Oojuro journal in workspace/memory/cold |
| Revisions | SHA-256 of actual complete curated files |
| Accounting / limits | Runtime; conservative UTF-8-byte token estimate, separate context limits |
| Local concurrency | One kernel lock plus revision preconditions |
| Multi-file durability | Validated/fsynced intent followed by atomic per-file replacements; locked roll-forward recovery |
| Sandbox replacement | Complete closed-journal generation, manifest and verified fresh-directory restore |
| Hosted authorization / encrypted persistence | Existing trusted host boundary; not sandbox source labels |

`bin/softaxiom.ts` is the terminal interface; `lib/product-cli.ts` exposes explicit Bridge checks and
on-demand Compass planning through the same local task queue. [PRODUCT.md](PRODUCT.md) maps the
accepted local/cloud/device design; [CLI.md](CLI.md) distinguishes runnable commands from release work.
`lib/account-cli.ts`, `lib/cloud-client.ts` and `lib/chat-cli.ts` compose existing-account Cloud
sign-in and conversation requests. `lib/local-auth.ts` serializes private credential changes
outside the workspace; shared versioned surface schemas live in `core/contracts/cloud.ts`.
Cloud login does not create a local agent, pair a device, or transfer workspace files.
`lib/store.ts` implements curation, accounting,
retrieval, daily state and transactions; short workers execute under OS locks. `lib/journal.ts`
only calls Oojuro's real front-door commands. `lib/checkpoint.ts` freezes both memory and journal
writers for a consistent complete generation. `lib/runtime.ts` instruments user/tool/output events
and assembles bounded outside-data context; the optional local assistant uses an operator-selected
compatible endpoint. Plain-file edits and tier moves are discovered without an independently
editable tier index. The memory subsystem has no second editable transcript. Radar uses Node's built-in SQLite for
event routing, leases, progress and action receipts, separate from Oojuro's raw experience journal.

## Request path

1. Instrument an actual user request in Oojuro and observe the configured timezone day.
2. Validate current files; recount storage. Assemble bounded active hot content and related warm/
   cool excerpts. Report overflow/omissions. Retrieved history is data, never authorization.
3. The AI consults diaries or original journal evidence as needed and curates via filesystem or
   CLI operations. Capture tool calls/results and agent output, excluding hidden reasoning.
4. Recount after file changes, including failed commands. CAS/overflow failures return structured
   usage/revision information for bounded maintenance. Failed writes preserve the valid state.
5. The AI writes or consolidates meaningful diary entries. On next resume, previous active days
   become pending; no diary scheduler is required.
6. Before durable handoff/replacement, close journal calls, hold both locks, copy a complete
   generation and publish its verified manifest. Restore only to fresh memory with original IDs.

All five directories belong to the same visible Files workspace. Complete-generation encrypted
upload/CAS publication, directory-aware Files listing and connection of the host's ingress/tools
are required [adapter contracts](ADAPTERS.md). Individual-file backup is not that protocol.
No hosted deployment or migration is performed by this source preview.

See [configuration, commands, invariants and limitations](MEMORY.md). Deterministic tests use the
real Oojuro binary and scripted protocol fixtures. Real-model quality evaluation is deferred.

## Local browser and event path

`lib/browser.ts` speaks CDP to the installed local browser over verified loopback endpoints.
`lib/watchers.ts` adapts explicit GitHub/HTTP/MCP/browser sources and signed webhook ingress.
`lib/inbox.ts` atomically commits source cursors/events and per-subscription deliveries, then
claims bounded related task batches under fencing leases. Human read state is independent.
`lib/local-agent.ts` reuses the instrumented bounded model loop with typed browser/task tools.
The trusted subscription supplies authority; incoming events/pages are outside data. Every
browser interaction persists an exact approval and execution intent before dispatch. Recovery
parks unknown outcomes for operator reconciliation rather than replaying mutations.
`lib/local-cli.ts` runs the foreground local poller/worker and exposes results/approvals.

See [browser execution](LOCAL_BROWSER.md) and [Radar](RADAR.md) for supported adapters and limits.
There are no hosted provider SDKs, remote browser downloads or mandatory managed schedulers.

## Shared engine

`lib/model-cli.ts` configures local API access through a masked prompt. `lib/model-access.ts`
keeps the selected endpoint/model and its key together in owner-only application state using
the same locked atomic credential store as Cloud login. It never writes keys to memory.
`lib/provider-model.ts` supplies one bounded SDK request through the shared provider factory;
the existing local loop retains tool authorization, evidence, context and step limits. Explicit
workspace model settings must match that trusted selection and never select an environment secret.

Portable context, model/tool rounds, authority, harness, contracts and time policies live in
`core/`; cloud compatibility imports call this implementation through explicit host ports.
See [the source/host boundary, limits and checks](SHARED_CORE.md).

## Source and distribution

Runtime, CLI and build/audit modules are maintained as strict TypeScript. `npm run build`
compiles `core/` with tsconfig.core.json, then local modules with tsconfig.local.json and the
consumer type contract with tsconfig.types.json. Generated JavaScript and declarations retain
the existing package paths and are ignored by Git. Tests execute those actual compiled modules.
The package contains compiled code and declarations, not an additional maintained JS implementation.
