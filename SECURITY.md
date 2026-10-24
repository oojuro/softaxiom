# Security

This is an early source preview. There is no supported complete assistant release yet.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/oojuro/softaxiom/security/advisories/new).
Do not put credentials, customer content or exploitable
details in public issues, pull requests or logs.

Maintainers review reports privately. No response deadline or long-term support commitment is
promised for this preview. Report against the current main revision and include a minimal
synthetic reproduction and impact; never send private memories, journals or provider keys.

Runtime trust boundaries, resource limits and contribution checks are documented in
[SHARED_CORE.md](docs/SHARED_CORE.md). Local user execution is not an operating-system sandbox;
never run untrusted contribution builds on a machine with private credentials or cloud access.

## OpenClaw source candidate

The October 23 accepted architecture is implemented as a pinned OpenClaw engine-source fork; see [OPENCLAW.md](docs/OPENCLAW.md) for retained owners, provenance and migration. The local CLI remains [model agnostic](docs/MODELS.md); private hosted inference is Fireworks-only. Memory starts without embeddings. [Scoped specialists](docs/DELEGATION.md) support an internal workflow and an independent offline JSONL implementation. Existing installer pins are not promoted by this candidate; package/source and hosted acceptance remain separate gates.
