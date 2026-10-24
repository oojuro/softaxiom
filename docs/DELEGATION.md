# Scoped specialists (source candidate)

A specialist can use our engine internally or an independent implementation. The main agent
remains responsible for conversation and decisions. The current versioned contract is
`core/contracts/delegation.ts`; task/operation IDs, progress, results and cancellation are
transport-independent. The first external transport is **local offline Python JSONL**, not
universal A2A/MCP compatibility or a remote-agent service.

`sa specialist start` accepts JSON on stdin, for example:

```json
{"version":1,"operationId":"11111111-1111-4111-8111-111111111111","agent":"external-jsonl","input":"The release is ready. Audit the supplied evidence only.","limits":{"milliseconds":20000,"steps":1,"concurrency":1,"retries":0,"maxMicros":0}}
```

- `sa specialist grant ./specialist-code`: grant a separate read-only module folder. Place
  `examples/specialists/evidence-audit.py` there as `specialist.py` first. This operator grant is
  separate from the project's file/terminal grant. It authorizes execution of code in that folder;
  inspect it first. Replacing the grant changes the execution identity.
- `sa specialist work specialist_OPERATION_UUID`: run one task through the existing Radar inbox.
- `sa specialist state specialist_OPERATION_UUID`: inspect durable status/results after restart.
- `sa specialist cancel specialist_OPERATION_UUID`: revoke that subscription; active work is fenced.
- `sa specialist revoke`: remove the external module grant, including active process authority.
- `sa specialist receipt UUID` / `resolve UUID`: inspect or acknowledge uncertain external
  command effects; resolution does not rerun the task or convert uncertainty into success.

The external example imports neither Soft Axiom nor OpenClaw. It audits supplied source claims
without a model or provider account. It receives task-specific text/IDs/limits only. Its sandbox
has no network, parent process environment, personal home, sockets, memory/history or workspace
mount. Only the separately granted module folder is mounted read-only. System binaries are
read-only; wall/CPU/address-space/process/output limits are inherited from the execution owner.
It emits at most ten validated JSONL progress/result messages, bound to the exact operation ID.
Results/artifact digests are untrusted evidence, never permissions or executable instructions.
No artifact path is automatically opened. No external data-retention/provider guarantee is
asserted: this particular adapter is offline; future remote adapters need separate approval,
egress/credential scopes and documented retention/provider boundaries.

`internal-auditor` is a built-in evidence-audit workflow, using OpenClaw and the locally configured provider. It gets
only explicit task text and its specialist instruction, with **no tools** or parent memory/history.
Local internal work requires an operator-supplied price quote outside workspace configuration:
`sa specialist quote INPUT_MICROS_PER_MILLION OUTPUT_MICROS_PER_MILLION`.
The quote is bound to the exact private provider/model/key profile. Setup/key changes invalidate
it; the model, external content and workspace files cannot set it. Before the one allowed model
call, the runtime computes the worst request/output charge at that quote and refuses if it
exceeds the task's `maxMicros`. Quote actual provider pricing; this is an admission ceiling,
not control over a provider's tariff or account billing. The example main-chat grant below caps
an internal child at $0.340480; explicit task JSON supports a lower cap or up to $1.
Deadline/revocation aborts the request; an in-flight provider call may already be charged.
There is no paid retry, nested delegation or automatic budget reset. No price quote is required
for the offline external specialist (zero spend).

One coordinator lock limits local specialist execution to one task at a time. Task identity and
results live in Radar's existing inbox; provenance/evidence lives in Oojuro. A durable dispatch
mark is written before work. Lost process/model/command receipts cannot trigger automatic
redispatch. Recovered dispatched work is parked as failed with
`SPECIALIST_RECONCILIATION_REQUIRED`; inspect provider/command evidence and explicitly decide
what to do. A new operator task requires a new UUID/budget. A completed main reply and a child
pending/failed/cancelled/uncertain result are separate states.

## Main-agent coordination

`sa chat --local --specialists internal-auditor,external-jsonl "Audit this claim…"` explicitly
permits those specialists for the request. Internal delegation admits up to $0.340480 at the
operator quote above; external delegation is offline/zero spend. No specialist tool is exposed without
this flag. The main model can start/list specialists but cannot supply extra context: the host
forwards **only the current redacted user request**, never model-selected parent history or keys.
One stable child operation is allowed per message; a second differing delegation conflicts.
Later messages with the flag can list only that conversation's children. Use the operator CLI
for cancellation and reconciliation. Pending/failed child state remains separate from chat completion.
