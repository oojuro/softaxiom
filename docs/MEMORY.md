# Workspace memory

This is the first runnable open-source slice: a product CLI and library for memory, plus a small
local memory-only assistant. It is intended for developers and heavy users. It is not the full
assistant or a replacement for its tool harness. Publication, merging
and deployment are separate owner decisions. Real-model evaluation is deferred at the owner's request.

## Architecture

```text
Files / workspace root (a local directory; optional adapters use the same contract)
└── memory/
    ├── hot/       automatically supplied, bounded working knowledge
    ├── warm/      selectively retrieved reusable knowledge
    ├── cool/      selectively retrieved older/less immediate curated knowledge
    ├── diary/     AI-written daily Markdown in the user's timezone
    └── cold/      real Oojuro-managed journal; commands, never manual database edits
```

These are real directories. CLI, agent filesystem tools and Files must refer to this one workspace.
The runtime creates private directory permissions. Files below memory/ are readable local plaintext;
use the host's existing encrypted persistence for hosted checkpoints. No independent transcript
database, SQLite store or JSONL event archive is introduced. Runtime JSON files contain settings,
day cursors and a transient crash-recovery intent, not a parallel raw-experience source of truth.

The model chooses importance. The runtime enforces budgets, revision checks, locking and bounded
context. Neither stored memories nor source labels grant permissions. Journal evidence means
observed/reported, not independently proven. The enclosing assistant's authorization checks still apply.

## Local setup

Linux/WSL is the supported first target; Node 22.19+ and util-linux `flock` are required.
The package now includes the shared runtime and its reviewed npm dependencies. Source setup
needs registry access; runtime needs no database server or Soft Axiom account.

Install the Oojuro front-door CLI, separately licensed Apache-2.0. The interface was inspected at
Oojuro commit `3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd` and verified with an installed front-door
binary. Until the public source release, access to its preparation repository is required:

```sh
git clone https://github.com/oojuro/oojuro.git
cd oojuro
git checkout 3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd
cargo build --release --locked -p oojuro --bin oojuro
# Put target/release/oojuro on PATH, or set its absolute path in memory config.
```

From the Soft Axiom checkout, install the locked dependencies and compile the shared core once:

```sh
npm ci --ignore-scripts
npm run build
mkdir -p ~/work/assistant
node bin/softaxiom.js --workspace ~/work/assistant init
node bin/softaxiom.js --workspace ~/work/assistant usage
```

An artifact installed with npm exposes the same commands as `sa-memory` and `softaxiom`. The
workspace defaults to `SOFTAXIOM_WORKSPACE` or the current directory; it never silently chooses
a separate global memory home. `memory/cold` is passed to every Oojuro call via `--store`.
The runtime uses an isolated `--home memory/.oojuro` and direct calls that close the journal after
each operation. It does not launch a recorder over private files, use Oojuro's default user journal,
or record hidden model reasoning.

## Configuration and limits

Pass an optional nonsecret JSON config path to `init`; thereafter edit `memory/config.json`.
Unknown keys or invalid values fail closed. Re-running init preserves existing configuration/data.

```json
{
  "timezone": "America/New_York",
  "tiers": { "hot": 4000, "warm": 32000, "cool": 256000 },
  "context": { "hot": 4000, "related": 4000, "excerpt": 1000, "request": 32000 },
  "diary": { "day": 8000, "excerpt": 2000 },
  "agent": { "maxSteps": 10, "maintenanceAttempts": 3, "maxOutputTokens": 2048 },
  "model": {
    "baseUrl": "http://127.0.0.1:11434/v1",
    "name": "",
    "apiKeyEnv": "SOFTAXIOM_API_KEY"
  },
  "oojuro": "oojuro"
}
```

All memory/context accounting uses the same **conservative estimate: one unit per UTF-8 byte**.
It is intentionally more conservative than typical English BPE token counts; it is not an exact
tokenizer for every model. A 4,000-unit hot budget therefore stores at most 4,000 UTF-8 bytes,
including the full Markdown document and metadata. Choose capacities with this convention in mind.
The provider's output-token limit is separate and uses the provider's own token definition.

| Limit | Meaning |
| --- | --- |
| Tier capacities | Sum of complete curated files in that directory, including superseded content |
| hot / related context | Separate serialized record budgets for automatic hot and relevant warm/cool context |
| excerpt | Maximum body bytes in a memory or evidence excerpt; byte offsets and partial flags returned |
| request | Whole local-assistant request budget; tool schema/history count too; stop instead of silently dropping history |
| diary day / excerpt | Maximum consolidated daily account and independently bounded read excerpt |
| maxSteps / maintenanceAttempts | Model round limit and total capacity/revision-repair attempts per turn |

CLI writes over capacity return current/proposed usage and exact overflow under this estimate,
leaving the existing state intact. Direct filesystem edits are allowed to exist on disk; `usage`,
terminal completion and context assembly recount them and surface overflow. Context stays bounded
even then. The runtime cannot prevent an external editor from physically writing a large file.
The agent must consolidate, demote or retire curated knowledge to repair overflow; it is never
silently truncated or deleted. Lowering configured limits can likewise require maintenance.

## Agent curation and ordinary files

A memory is inspectable Markdown with a single-line JSON header. The stable filename is the ID;
there is **no tier field** in the file. Moving it to another tier directory changes its importance.

```markdown
---
{"id":"compiler-style","title":"Compiler examples","status":"active","supersededBy":[],"sources":[],"origin":"agent"}
---
Use Rust 2024 examples for the compiler project.
```

Origins are `user`, `agent` or `tool`; an API-written user-origin memory requires a reference to an
actual runtime user-request event. Terminal `record` labels events as tool reports, not user ingress.
These labels are not cryptographic attestations: a local owner or an agent with unrestricted shell
access can forge files or call Oojuro directly. They must never be accepted as authorization by a
hosted worker. The trusted host must identify the real user from its own ingress/session.

The agent can use its ordinary editor and `mv`, then run `sa-memory usage`. Unknown metadata,
duplicate IDs, invalid content, symlinks and hard links are rejected before context use. Metadata
contains title, status, supersededBy, sources and origin; content revisions are computed SHA-256
hashes, not a second editable version counter. External edits change the revision automatically.

Use the CLI for revision-checked multi-file changes. JSON comes from stdin, so content does not
need to appear in command-line arguments:

```sh
sa-memory list
sa-memory read compiler-style
sa-memory curate <<'JSON'
{"changes":[{"id":"compiler-style","title":"Compiler examples","body":"Use Rust 2024 examples.","tier":"warm","status":"active","supersededBy":[],"sources":[],"origin":"agent","expectedRevision":null}]}
JSON
sa-memory search 'compiler examples'
sa-memory context 'resume compiler work'
```

`expectedRevision: null` creates a new ID only. For updates/moves, use the revision from `read`.
Submit the surviving updated memory plus `{id, expectedRevision, retire: true}` for duplicates in
one batch to consolidate atomically. Alternatively mark an old entry `superseded` with surviving
IDs in `supersededBy`; superseded files count toward capacity but are excluded from active recall.
References may be `journal:ID`, `diary:YYYY-MM-DD` and `memory:ID`. Relevant retrieval uses Unicode
word overlap, not embeddings or an assumed Oojuro semantic index. It excludes zero-overlap results;
short synonyms and semantic paraphrases may need an explicit search. `list` is paged; the library
accepts offset/limit. `read`, diary and evidence have continuation byte offsets and partial flags.

## Diary and raw experience

The AI writes the diary. The runtime does not turn every tool result into a diary entry. The shipped
prompt asks for consolidated meaningful outcomes, decisions, corrections/lessons, open threads and
references, without transcripts or hidden chain-of-thought. `write-diary` accepts the complete daily
account and expected revision; capacity and CAS apply independently of tier storage. Diary files
stay chronological. Retiring or moving a memory never relocates its supporting diary.

```sh
sa-memory days
sa-memory diary 2026-10-22
sa-memory write-diary < daily-account.json
sa-memory journal-day 2026-10-22
sa-memory journal-search 'compiler failure'
sa-memory evidence 123 0
```

Daily-account JSON is `{day, text, expectedRevision}` with a `# YYYY-MM-DD` heading. A session records
its active day in the configured IANA timezone. On resume, previous active days become pending so
the AI can finish their diary using `journal-day`; no scheduler is required. Day ranges handle DST and include the final microsecond. The chronological tool reads at most
40 records per day call and marks partial coverage; omitted returned IDs can be fetched with
`evidence`. For a larger full-day inspection, use Oojuro's native `range --limit N` / `export`
through the terminal. Chronological subprocess replies are capped at 64 MiB; other journal replies
at 4 MiB. Exceeding a transport limit reports failure, never a successful truncated record.
The runtime marks a pending day finished after a successful diary write. It cannot guarantee an
uncooperative model writes a useful diary; missing diary work stays discoverable on next resume.

`MemoryRuntime.userRequest`, `runTool` and local agent outputs automatically record the supported
observations to Oojuro. The event envelope includes kind, session, time, source and body. Oojuro's
supported `remember` interface stores these as explicit records; no new native capture-kind API
is assumed. Tool calls/results, output/artifact references and exit outcomes are captured by the
runtime rather than relying on the model. Raw capture failure blocks the local action/continuation;
uncertain journal writes are not retried automatically. Original records are fetched by ID.

Oojuro applies its own secret redaction before persistence. Curated/diary writes and external loads
also reject common credential patterns. These are heuristics, not a guarantee that arbitrary
unlabelled passwords can be recognized. Keep credentials in the existing secret channel/environment,
not memory. Model endpoint keys come only from private setup state; a workspace cannot select an
environment secret. Do not export environment dumps, personal datasets or
user transcripts to reports.

## Local model access (optional)

Run `sa setup` for OpenAI, Anthropic or a compatible/local endpoint, without a Cloud account.
See [model setup and credential isolation](MODELS.md). Existing nonempty `model.name` settings
must match the private setup profile's name and URL; `apiKeyEnv` is ignored. Workspace files do not
authorize endpoint selection or credential access. Remote endpoints require HTTPS; HTTP is allowed
only on loopback. Provider errors are surfaced
without echoing private response bodies or retrying paid calls.

```sh
sa chat --local 'Where did we leave the compiler work?'
```

The local assistant has memory tools only. It can answer, curate and write diaries; it cannot claim
external program execution. It is a local integration boundary for this slice, not an extracted
full agent runtime. The actual hosted agent uses the CLI with its existing terminal/filesystem tools.

## Persistence, failure and deletion

All API reads/writes/recovery share a kernel `flock` on `memory/.lock`. Revision preconditions stop
two sessions from silently replacing each other's updates. Multi-file changes validate budgets
first, then fsync a transaction intent; that is the commit point. Writes/moves are rolled forward
under the same lock after interruption. Before that point a failure preserves the previous state;
after it, `COMMIT_PENDING` requires recovery, not replay with new arguments. A conflicting external
edit during recovery stops with `RECOVERY_CONFLICT`; never discard the intent or guess a winner.
Ordinary editors do not honor these locks: edit while operations are idle, or acquire the same lock.
Uncooperative simultaneous editor writes are detected where possible, not fully serialized.

```sh
sa-memory checkpoint /tmp/memory-generation-1
# Save the returned manifestSha256 with the immutable checkpoint generation.
sa-memory --workspace /path/to/fresh-workspace restore /tmp/memory-generation-1 MANIFEST_SHA256
```

A checkpoint holds the memory lock and Oojuro's native exclusive `cold/LOCK`. Each runtime journal
call closes before checkpointing; a live recorder/native writer blocks the snapshot. With both
locks held, copy the entire closed directory to a fresh immutable generation, hash every file,
fsync files/directories and atomically publish its manifest. The source is checked again for direct
editor changes. Native Oojuro uses Rust File::try_lock (Linux flock); the compatibility is exercised
in tests. This is an offline filesystem checkpoint, not a fabricated Oojuro backup API or logical
export/reimport that loses record IDs. Do not copy a live journal file by file outside this protocol.

Restore verifies the trusted manifest hash, all content hashes, paths and real directories, then
renames into a fresh memory path. Existing state is never overwritten or merged with a database.
This preserves raw IDs, curated references, diaries, settings and empty directories across restart
and sandbox replacement. The first implementation bounds a checkpoint to 1 GiB / 10,000 entries
and rejects unsupported links. Host persistence must preserve complete generations, use CAS on a
single current-generation pointer and encrypt them. See [adapter contracts](ADAPTERS.md).

Curated retirement deletes only that Markdown file. It does not delete diary references or raw
experience. Diary deletion is an ordinary deliberate file deletion. Oojuro supports explicit proven
erasure via its own `forget`; for example, `oojuro --home memory/.oojuro --store memory/cold --direct
forget --id ID --yes`. The CLI does not expose journal erasure as a model memory operation. There
is no automatic cold retention or backup erasure here: an operator must separately apply retention
to checkpoints/backups and all copies. Demotion/context eviction is never a personal-data deletion.

## Verification

Run on our own compute, serially:

```sh
OOJURO_BIN=/path/to/oojuro flock /tmp/sa11-verification.lock npm run check
```

Tests use the actual Oojuro binary and synthetic content; there is no fake-success journal. They
cover correction/update/recall, unrelated filtering, overflow preservation, direct edits, stable tier
moves, supersession/retirement, diary/timezone rollover, evidence retrieval, restart, concurrent CAS,
interrupted multi-file recovery, real redaction, consistent restore with unchanged journal IDs and
native writer exclusion. Scripted agent and local HTTP fixtures verify protocol wiring and bounded
maintenance. They do **not** establish model quality. Real-model repeat-task evaluation is deferred.
