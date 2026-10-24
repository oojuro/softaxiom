# Replace the engine, preserve the product

Owner decision, 2026-10-24: replace the complete superseded Soft Axiom runtime with
OpenClaw. Keep `sa` commands as thin product extensions. Do not ship a selectable legacy
runtime. This decision supersedes the incremental loop-wrapper design in PR #28.

## Ownership

| Responsibility | Owner after replacement |
| --- | --- |
| Agent state, turn lifecycle, message/tool sequencing, interruption | OpenClaw agent engine |
| Session replay, tool-result pairing, context estimation and compaction | OpenClaw engine and harness; host storage ports |
| Provider protocols, reasoning replay and usage normalization | OpenClaw provider transports |
| Tiered files, diary, lexical retrieval and cold journal | Soft Axiom memory extension and Oojuro |
| Radar, Bridge, Compass and specialist journeys | Soft Axiom extensions, using the same engine |
| Grants, approval, revocation, bounded spending, effect receipts | Soft Axiom enforcement at engine and tool boundaries |
| Hosted durable tasks, tenant credentials, billing and fleet | Private sa-cloud adapters; Temporal remains durable owner |

The public CLI remains model agnostic. The hosted composition admits only Fireworks.
No embedding model, vector service or automatic model download is enabled.

## Removal ledger

An item is only removed when its callers, security/recovery tests and packaging have moved.
Passing tests of the previous implementation are historical evidence, not replacement acceptance.

| Superseded implementation | Replacement | State |
| --- | --- | --- |
| `core/agent/engine.ts` callback loop wrapper | OpenClaw `Agent` lifecycle | Removed locally; verification in progress |
| Local `LocalAgent` message/tool loop and parallel model history | Engine state and tool hooks | Removed locally; verification in progress |
| Local AI SDK provider projection and replay cache | Upstream provider protocols | Removed locally; verification in progress |
| Custom context compaction and tool-batch cut logic | Upstream session/context/compaction harness | Local uses upstream; hosted replacement pending |
| Hosted one-turn wrapper around `generateText` | Same engine with hosted effect and billing ports | Wrapper removed; hosted integration pending |
| Hosted hand-written agent round/tool scheduler | Temporal lifecycle around the shared engine | Pending |

Storage adapters must preserve operation IDs, uncertain effects, durable receipts, account isolation
and historical readers. Retaining a historical reader does not permit retaining an executable
legacy engine. Neither draft is ready for review or merge until replacement verification passes.

Installer promotion, merging and deployment remain unauthorized for these drafts.
