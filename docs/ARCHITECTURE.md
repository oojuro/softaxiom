# Core architecture

This slice serves programmers and heavy users through a product CLI (`sa-memory`), readable
workspace files and an optional local memory/browser assistant on the person's computer. Hosted
computer/browser providers are optional external adapters; the core imports no provider SDK.

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

`bin/softaxiom.js` is the terminal interface. `lib/store.js` implements curation, accounting,
retrieval, daily state and transactions; short workers execute under OS locks. `lib/journal.js`
only calls Oojuro's real front-door commands. `lib/checkpoint.js` freezes both memory and journal
writers for a consistent complete generation. `lib/runtime.js` instruments user/tool/output events
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

`lib/browser.js` speaks CDP to the installed local browser over verified loopback endpoints.
`lib/watchers.js` adapts explicit GitHub/HTTP/MCP/browser sources and signed webhook ingress.
`lib/inbox.js` atomically commits source cursors/events and per-subscription deliveries, then
claims bounded related task batches under fencing leases. Human read state is independent.
`lib/local-agent.js` reuses the instrumented bounded model loop with typed browser/task tools.
The trusted subscription supplies authority; incoming events/pages are outside data. Every
browser interaction persists an exact approval and execution intent before dispatch. Recovery
parks unknown outcomes for operator reconciliation rather than replaying mutations.
`lib/local-cli.js` runs the foreground local poller/worker and exposes results/approvals.

See [browser execution](LOCAL_BROWSER.md) and [Radar](RADAR.md) for supported adapters and limits.
There are no hosted provider SDKs, remote browser downloads or mandatory managed schedulers.
