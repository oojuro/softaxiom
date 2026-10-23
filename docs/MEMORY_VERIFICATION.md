# Memory verification

## Observed results

| Check | Result |
| --- | --- |
| Node 24.20.0, deterministic suite | 16 passed, 0 failed |
| Node 22.19.0 (current E2B image floor), deterministic suite | 16 passed, 0 failed |
| Packaged CLI on Node 22.19.0 | Fresh init, curate, search, checkpoint and restore passed |
| Complete directory persistence | All five real directories survived restore, including empty folders |
| Original evidence | Native Oojuro record IDs and references survived replacement |
| Native writer exclusion | Both the checkpoint and Oojuro refuse an already-held native lock |
| Package | No npm runtime dependencies; licenses, executable, workers, prompt and referenced docs included |
| Static checks | JavaScript syntax, local Markdown links and git diff whitespace checks passed |
| Real-model evaluation | Deferred by the owner; no live model calls made |
| Hosted E2B/Files rollout | Not performed; host integration gates remain explicit |

Tests use synthetic content and the actual Oojuro executable, SHA-256
`2cb6294aa65d7c176ce86b2bf1074977936dfd4871e3ff9cd73640c9a3c6d827`.
Its front-door interfaces were inspected against Oojuro source revision
`3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd`; that is not a claim the installed binary was
built from this later source revision. Node 22.19.0 was checked against the existing E2B image's
published artifact checksum before the compatibility run.

## Scenarios exercised

1. A real runtime user correction creates/updates one stable memory; a later related task retrieves
   it, while an unrelated task receives no warm/cool project history.
2. A capacity overflow returns current usage and excess without changing the existing valid files.
3. Promotion, demotion, supersession and consolidation preserve IDs/evidence; retirement leaves
   the underlying journal record accessible.
4. Ordinary edits and moves are recounted. Overflow remains inspectable and repairable; context
   stays bounded. Stale revisions cannot overwrite external changes.
5. Invalid UTF-8, malformed/duplicate metadata, symlinks and duplicate IDs fail validation.
6. AI-scripted diary updates remain chronological, use the configured timezone and carry unfinished
   prior days across resume. DST boundaries and inclusive microseconds are checked.
7. Failed precommit leaves the old state intact. An interrupted committed multi-file move recovers
   to one coherent state; two separate processes cannot both replace the same revision.
8. Real native redaction masks a synthetic token; curated credential patterns and tool-quoted fake
   user corrections are rejected.
9. Raw tool results survive accounting failure. Full immutable checkpoints restore memories,
   diaries, directory entries and original Oojuro IDs into a fresh workspace.
10. Scripted agent and local HTTP fixtures verify tool-call correlation, correction/diary wiring,
    independent context limits, bounded maintenance and exclusion of hidden reasoning fields.

The scripted repeated-task fixture proves that stored corrections reach later model input. Its
answers are prescribed by a fixture, so it does **not** establish improved model work quality.

## Remaining limits

Linux/WSL only initially; conservative byte-based token estimates; lexical curated search; bounded
chronological transport; heuristic credential detection; no automatic journal/back-up erasure.
Editors that ignore the kernel lock are not fully serialized. See [memory behavior](MEMORY.md).

Hosted promotion still requires connecting the real host's ingress/tools/context, directory-aware
Files access and encrypted complete-generation upload/CAS publication. The existing cloud per-file
checkpoint is insufficient. See [hosted integration gates](HOSTED_MEMORY.md). No R11 candidate
code, migration, template deployment or merge was changed to obtain these results.
