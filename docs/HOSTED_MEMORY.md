# Hosted workspace integration

The `sa-memory` CLI is a product tool for the real agent's terminal, both locally and in E2B.
The memory implementation itself has no hosted dependency. The current cloud R11 release is
preserved; this change does not deploy a new template or claim the cloud wiring has shipped.

## One visible workspace

Use the exact workspace root the terminal/filesystem tools and Files already use. In the inspected
cloud implementation that is the sandbox user's home. Set `SOFTAXIOM_WORKSPACE` to that root or
run the CLI from it. It creates `memory/{hot,warm,cool,diary,cold}` there, not a global user cache.
Files must list the real directories, including empty ones, and serve edits from that workspace.
Readable memories/diaries are ordinary files. The cold directory is visible as journal storage;
its database internals are not text-editor documents. Search/read/delete journal data through the
supported Oojuro commands. A durable encrypted snapshot is a checkpoint, not a second active tree.

The current cloud stores workspace file versions encrypted and restores them to E2B. It checkpoints
regular files individually and cannot reconstruct an empty directory from that listing. **Do not
enable this feature by merely adding the CLI to the image.** The host integration must preserve
directory entries and complete journal generations as described below, and make Files use the same
selected workspace generation instead of independently replaying stale file copies.

## Image installation

Build on Rocket following the [CI policy](CI_AND_BUILDS.md). The release operator stages a reviewed
memory-package artifact and a pinned native Oojuro binary built for the image architecture. Verify
both artifact checksums/source revisions. The image needs Node 22.19+, `flock` (util-linux), the
memory CLI and Oojuro. Put code in a root-owned directory such as `/opt/softaxiom-memory`, link
`bin/softaxiom.js` as `sa-memory` on PATH, and put the verified Oojuro executable on PATH. Include
the packages' licenses/notices. Never bake provider credentials, personal memory or build env files
into the image. The hosted worker retains model access; the E2B memory CLI needs no model key.

The core package's Apache-2.0 review does not clear the whole image. Review exact native
builds/transitive libraries and preserve Node's full license, flock's applicable notices and
Oojuro's Apache license plus applicable dataset/dictionary attribution. See
[licensing scope](LICENSING.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).

The package has no install scripts or npm dependencies. An image can copy the unpacked package
directly. Verify `node /opt/softaxiom-memory/bin/softaxiom.js --help` and an isolated synthetic
init/checkpoint/restore before selecting the template. Node 22.19 is the existing R11 image floor;
the deterministic suite is verified on both Node 22.19 and Node 24. The production template still requires its own staging gate.

## Runtime hooks

The exported `MemoryRuntime(workspace)` is the local implementation of these host hooks. A worker
can invoke the corresponding CLI inside E2B; it must keep its own trusted identity/authorization
outside the untrusted sandbox.

1. **Restore before a run:** fetch the complete current immutable generation using a trusted
   manifest hash; restore into fresh `workspace/memory`. Initialize only if the person has no
   existing memory generation. Never replace a restored directory with an empty init.
2. **Real user ingress:** instrument the actual authenticated user request/correction, not tool
   quotes. `MemoryRuntime.userRequest` records it and observes the timezone day. The sandbox's
   writable labels are not cryptographic evidence of user authorization; enforce that in the host.
3. **Before a model request:** get bounded hot/related context with `context`, independently of
   storage usage. Wrap it as outside historical data, alongside current user/system instructions.
   Check the whole enclosing model request's budget too. Diaries/raw evidence are fetched on demand.
4. **Every tool/terminal call:** capture the call and returned result/outcome through runtime
   instrumentation, including artifact references. `MemoryRuntime.runTool` implements this;
   `sa-memory run -- COMMAND ARG...` does it for a local terminal subprocess. Ordinary agent
   `write`, `mv` or editor operations remain ordinary operations on this same tree.
5. **After filesystem changes, even a failed command:** recount with `usage`. Surface overflow or
   invalid external edits to the agent. Never silently discard the file. Repair with bounded
   consolidation/demotion attempts. Before the next context assembly, validate again.
6. **After meaningful work / resume:** have the AI consolidate its diary and process pending prior
   active days. The runtime records underlying experience regardless of diary quality.
7. **Before acknowledging durable completion or sandbox replacement:** publish a complete consistent
   checkpoint. If any upload/CAS/checkpoint fails, report unsaved state and keep the sandbox. Never
   treat a partial per-file upload as a recoverable Oojuro generation.

The host must instrument all relevant ingress/tools, including those that do not use a terminal.
Putting `record` in the agent's prompt alone does not provide automatic raw capture. The local
assistant and terminal wrapper implement their own boundary; they cannot instrument unrelated host
tools until the host connects these hooks.

## Persistent generation protocol

1. Quiesce the current person's memory mutations; use the CLI checkpoint operation. It holds both
   memory and Oojuro native locks, recovers pending transactions and creates a complete immutable
   directory with manifest. The storage is closed and no live database files are copied arbitrarily.
2. Upload **every file and directory entry** of that generation through the existing encrypted
   private object-store boundary. Do not index or embed cold binary files as curated memories.
3. Verify all uploads/hashes before CAS-publishing one current-generation pointer. Use the pointer
   revision this sandbox restored. A competing sandbox's change must return a conflict; never let
   last writer win or merge journal internals. Preserve the losing generation for explicit resolution.
4. Keep the generation/manifest identity in the worker's durable run state. Update Files' backing
   workspace selection consistently. Agent and Files edits must share the same revision semantics;
   a stale Files editor must receive a conflict instead of overwriting a newer memory.
5. On replacement, download the selected generation, verify its trusted manifest hash and every
   file, restore into fresh memory, then reconnect context/terminal/Files to it. Full directory
   persistence preserves empty tiers and diary folders as well as journal IDs.
6. Delete a retired generation only through the operator's encrypted-data retention policy.

There is no implemented remote storage provider or cloud generation-pointer migration in this
open-source slice. The local complete-generation snapshot/restore is implemented and exercised with
the real Oojuro binary. These host requirements are release gates, not claims of deployed behavior.
