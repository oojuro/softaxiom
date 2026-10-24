# Local project files and terminal

Linux/WSL2 source preview. Local chat and direct `sa agent --project` tasks can inspect/edit an explicitly
granted project and run commands on the person's computer. No Cloud account, E2B or Kernel.
Build source before invoking `node bin/softaxiom.js`; pinned installers are promoted separately.

## Operator setup

```sh
sa --workspace "$PWD" permissions grant . --write --terminal
sa --workspace "$PWD" permissions status
sa --workspace "$PWD" chat --local 'Inspect src and prepare a small fix with a focused test.'
sa --workspace "$PWD" permissions revoke
```

Grant one existing folder inside the workspace, or the workspace itself. A new grant replaces
the previous one. Omit `--write` for read-only files; omit `--terminal` to forbid commands.
Requests, skills, project config and Cloud login cannot grant these permissions. Records live
privately outside the workspace beside account state. Symlinks or a replaced grant root fail
closed. Regrant after a deliberate replacement. Select only intended project data: recognized
credential paths/content are blocked, but pattern detection cannot identify every possible secret.

Radar additionally requires explicit `files.read`, `files.write` or `terminal` subscription
actions. Existing subscriptions receive none automatically. Both current grants must permit an
operation; a read-only subscription cannot edit even with an operator write grant. Revocation,
replacement or task-lease/subscription loss stops active terminal work. External actions retain
their integration/browser approvals. The terminal never gains networking through an approval.

## Files

`sa files list|read|write|mkdir` accepts JSON on stdin; model tools use the same operations.
Paths are relative to the granted folder, not the shell's current directory.

```sh
printf '%s' '{"path":"src"}' | sa files list
printf '%s' '{"path":"src/example.ts"}' | sa files read
printf '%s' '{"path":"notes.txt","text":"A synthetic note","expectedRevision":null}' | sa files write
```

Reads return a SHA-256 revision and at most 8,000 UTF-8 bytes from files up to 1 MiB. Use `end`
as the next offset; `partial` reports incomplete coverage. Listings inspect at most 256 entries
and return 50 names plus a continuation offset. Writes are at most 64 KiB and require the last
read's revision; `null` creates without overwriting. Replacement uses a synced temporary file
and rename. The revision check catches stale edits; it is not a filesystem transaction against
a concurrent external editor. Coordinate same-file edits. `mkdir` creates one existing-parent
directory; no recursive delete is exposed. The terminal can delete within its write scope.

Traversal, symlinks, hardlinked files, special files, invalid UTF-8 and recognized credentials
fail closed. Runtime state, Git metadata, `memory/`, common secret directories, `.env*` and
PEM/key/P12/PFX files are protected. Memory/Oojuro tools retain independent accounting/context
limits; use them for memory rather than editing a journal through project tools.

## Terminal isolation

Install Bubblewrap and util-linux (`prlimit`, `flock`) through your distribution. Tested with
Bubblewrap **0.11.1**, working unprivileged user namespaces and `/proc/self/fd`. Missing required
flags/namespaces fail closed, with no unsandboxed fallback. No native program is bundled or
downloaded by this JavaScript package. It invokes `/usr/bin/bwrap`, `/usr/bin/prlimit` and
`flock` on the operator's trusted PATH.

`sa exec -- COMMAND ARG...` uses the sandbox. Existing `sa run -- COMMAND` is an explicitly
invoked operator command with the operator's OS privileges; the model cannot use it to bypass
its sandbox. Commands see the granted folder as `/work`, read-only unless write was granted.
Host `/usr` and library directories provide read-only system tools. The CLI's Node executable
appears at `/tools/node`; PATH is `/tools:/usr/bin:/bin`. Node defaults to JIT-less execution
and a 256 MiB heap to fit the address-space cap; some JIT/Wasm tooling will not work here.

Host home, environment credentials, SSH/Git/browser sockets, host processes and external network
are absent. HOME is empty/ephemeral. Setup closes inherited directory descriptors; the process
has a new terminal session, no capabilities and no nested user namespaces. Existing protected
paths are masked. Preflight rejects sockets/devices/FIFOs, foreign-owned files and hardlinks;
scanning stops at 50,000 entries / 32 directory levels. Large/hardlink-based dependency trees
may require a smaller project scope.

One command runs per workspace at a time. Limits: **20 seconds wall time**, **32 KiB combined
output**, per-process **1 GiB address space**, **10 CPU seconds**, **16 MiB file size**, **128
descriptors**, **64 processes**; ephemeral `/tmp` is **64 MiB**. Encoded output is bounded too.
These local shared-kernel boundaries are not a VM or an aggregate project disk/process-tree
memory quota. A write grant permits destructive local changes. A compromised host or malicious
program already running as the operator is outside this boundary. Public hosted CI still needs
separate disposable contribution isolation; do not run public contributor jobs on private runners.

## Retry and uncertainty

The CLI prints an operation UUID before starting. Reuse the exact UUID and command after a lost
response. Completed receipts return without execution; conflicting reuse is rejected.

```sh
sa exec --operation 9a6336c4-6e14-46cd-bf97-222d9dffad15 -- python3 -m compileall src
sa exec --receipt 9a6336c4-6e14-46cd-bf97-222d9dffad15
```

Interrupted/over-limit/revoked commands can have partial file effects. Their active receipt blocks
new commands until the operator inspects actual files and runs `sa exec --resolve UUID`. This
acknowledges uncertainty without repeating a command or claiming rollback. A running receipt
left by a crash also requires reconciliation. The model has no resolve operation. Nonzero exit
is an inspectable completed command, not task success. Descendants cannot continue after exit.
Keep receipts with private CLI state; they are outside workspace backups. At **256 receipts per
workspace**, execution stops instead of deleting deduplication evidence. Receipt archival tooling
remains release work. [Persistent chat](CHAT.md) uses the same granted tools and keeps separate
turn-level recovery receipts. Subscription login, paired devices, OpenUI and deployment
acceptance remain release work. Real-model evaluation remains deferred.
