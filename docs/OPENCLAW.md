# OpenClaw engine fork

Accepted architecture: [#23](https://github.com/oojuro/softaxiom/issues/23), with memory #24,
delegation #25, provider policy #26 and distribution #27. This source candidate is not a release.

## Immutable upstream and source boundary

Upstream: https://github.com/openclaw/openclaw at
`15ae101a0d854480cfb500a5e241055450da39da` (2026-10-18). This is an **engine-source fork**,
not a redistribution of the entire OpenClaw gateway or a claim to support every upstream feature.
The 35-file transitive agent-loop closure lives in `core/upstream/openclaw/`. The original
revision, paths and upstream/modified SHA-256 values are in `OPENCLAW_PROVENANCE.json`.
Upstream history remains available at that immutable commit; existing Soft Axiom history and
candidate commits are retained. No private repository history is imported.

The local `LocalAgent` uses OpenClaw's `runAgentLoop`, sequential tool scheduling and typed event
stream. Soft Axiom host callbacks retain journal capture, context admission, skill discovery,
folder grants, browser approvals and execution receipts. The old local loop coordinator is
replaced. The public `generate` path uses one ephemeral OpenClaw planning turn per hosted
activity; Temporal retains durable rounds, tool activities, task ownership and retries. No
OpenClaw gateway, cron worker, session database or second durable scheduler starts in the host.

Patch inventory: local relative imports; explicit undefined in optional type declarations to
pass our strict/exact-optional checks; a small transport seam disabling upstream-specific Responses
truncation recovery and provider-side compaction. No upstream executable provider registry/authentication,
embedding plugin, vector index, updater, browser binary or telemetry integration is distributed.
Broad provider names in inherited **type contracts** are not executable provider adapters.

## Current-work reconciliation

Inventory taken from main `391bb91b1eae80d306bc3d697910495b3d6ecccb` and current open work.
No existing PR is automatically closed, merged or described as migrated solely by this table.

| Feature / candidate | Disposition in this integration |
| --- | --- |
| Main memory/Oojuro, journal, checkpoints, adapters and Radar | Retained authoritative owners; no upstream memory/session index starts |
| #20 skills `d1c299c6…` | Retained commits through combined candidate; bounded on-demand skill/resource reads |
| #22 project files/terminal `7d1a7918…` | Retained through combined candidate; descriptor scope, revocation, Bubblewrap and uncertain receipts |
| Persistent chat `d5f4d583…` | Retained journal transcript/reference index, operation IDs, PTY and restart recovery |
| Combined CLI `4fe3d824…`, browser tasks `88306fbb…` | Retained; chat/browser work still uses Radar approvals and receipts |
| Local model setup/credential-boundary candidates | Trust boundary retained; model-agnostic provider selection retained, separate from the hosted Fireworks-only policy |
| #17 README | General personal-agent scope retained; model-agnostic local scope retained; hosted Fireworks policy remains separate; remains open for owner reconciliation |
| #21 CodeRabbit policy | Separate review/billing work; not merged or used as a spending boundary |
| Vault #7/#8/#10/#14 | Separate active ownership; not included/replaced; require rebase and compatibility verification |
| Bridge / Compass | Explicit adapter checks and on-demand planning retained; no automatic local scheduler added |
| Local browser | Existing installed-browser CDP adapter/isolated profile retained; no E2B, Kernel or Cloud requirement |
| Hosted contracts | Public portable contracts retained; account keys, money, infrastructure and service maintenance stay private |
| Paired devices / local OpenUI | Remain unfinished; this engine fork does not claim to implement them |

## One memory owner

`memory/hot`, `warm`, `cool`, `diary`, `cold` are real directories in the visible workspace.
Readable files and folder placement are authoritative. Recount happens after tools, on usage
and before context assembly, including direct edits/moves. Context is separately bounded;
overflow on disk never expands the model request. Revisions are content hashes; no embedding
cache can retain revoked data. Diaries use the configured timezone. Oojuro alone owns cold
journal writes/search/get. Supported retrieval is bounded lexical/file/metadata retrieval.
No upstream MEMORY.md/vector/session mirror is created. `memory/cold` is not an ordinary
Markdown curation target. Whole-memory checkpoints close journal/index operations under their
locks and preserve IDs. Radar's separate inbox needs its existing consistent backup protocol;
copying a live SQLite database or only the readable tiers is insufficient.

Internal and external specialists get **no memory, parent history, credentials or workspace by
default**. This first specialist adapter accepts explicit task text only; arbitrary shared/private
memory-scope expansion is unsupported and rejected. The operator can choose separate workspaces
for independent personal agents. Future shared-memory adapters must enforce selected record
scopes and provenance; a model's request is never a grant.

## Upstream security and updates

Soft Axiom maintainers own this patch set and releases. Monitor upstream GitHub security
advisories/releases daily and dependency advisories before each promotion. For a relevant
advisory, identify whether it reaches the recorded closure; record the conclusion and affected
revisions. Urgent affected updates block release. There is no automatic executable updater.

Fetch a candidate immutable revision into an isolated checkout, compare every selected file and
its transitive imports, update the provenance inventory and notices, then run strict compilation,
provider-denial, permission/revocation, receipt/recovery, checkpoint and fresh-package journeys.
New imports/provider hooks/native assets require an explicit scope/license review. Open a PR;
never follow upstream main dynamically. Keep the prior artifact and workspace checkpoint for
rollback. The current pin has local deterministic evidence only; external security review and
hosted acceptance remain promotion gates.
