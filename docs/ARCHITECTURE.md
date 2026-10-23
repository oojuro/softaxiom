# Memory architecture

This slice serves programmers and heavy users through a product CLI (`sa-memory`), readable
workspace files and an optional local memory-only assistant. The same CLI is intended for the
hosted agent's E2B terminal. It contains no cloud credentials or Vercel build/runtime dependency.

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
editable tier index. No framework, remote persistence service, SQLite or JSONL transcript is added.

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
are required [hosted integration gates](HOSTED_MEMORY.md). The existing R11 per-file checkpoint
must not be mistaken for that protocol. This source change does not deploy or migrate R11.

See [configuration, commands, invariants and limitations](MEMORY.md). Deterministic tests use the
real Oojuro binary and scripted protocol fixtures. Real-model quality evaluation is deferred.
