# Shared engine and host boundary

**Replacement in progress.** The owner superseded the incremental loop-wrapper design on
October 24. [ENGINE_REPLACEMENT.md](ENGINE_REPLACEMENT.md) records the deletion ledger.
The drafts are unmerged; previous pinned artifacts remain historical evidence.

| Owner | Responsibilities |
| --- | --- |
| OpenClaw engine | Agent state, lifecycle, turn/tool sequencing, interruption, session context, pairing and compaction |
| OpenClaw protocol transports | Native provider messages, opaque reasoning replay and usage normalization |
| Soft Axiom extensions | Real tiered memory/diary, Oojuro cold access, lexical retrieval, Radar, Bridge, Compass, scoped specialists and filesystem discovery |
| Soft Axiom enforcement | Grants, exact approvals, revocation, context/usage limits, prepared/dispatched/settled receipts and uncertainty reconciliation |
| Private sa-cloud | Tenant accounts/keys, commercial billing, encrypted storage, fleet/browser provisioning and Temporal durable coordination |

The local path uses upstream `Agent` and session/compaction functions. Its old message loop and
AI SDK replay cache are removed. Hosted lifecycle/context wiring still requires migration. The current source removes
`runs/model-round` and `tools/runtime`: `runs/sample` admits/persists a single engine-selected
request and `tools/executor` authorizes/receipts one engine-selected call. Neither schedules
the next model call or tool. The older private pin still needs its callers migrated.
The historical transcript decoder is retained only to read existing records. Custom context
windows and compaction cuts are removed; `context/frame` adds product prompts and bounded
outside data to the engine-selected messages. These ports do not establish final hosted
OpenClaw composition until their private callers migrate. Do not deploy the wrapper-era candidate as this replacement.

## Enforced boundaries

- Local CLI/internal specialists are model agnostic under an explicit operator profile. Cloud
  composition is Fireworks-only and never imports local profiles or falls back to another provider.
- Transport policy stays in request-scoped async context. It binds credentials, host/path, timeout,
  byte limits, headers and retry admission. SDK logging and ambient billing identities are disabled.
- No E2B, Kernel, Temporal, AWS, Supabase or Stripe dependency is imported by the public core.
  Local operation needs the person's computer/browser and its documented local prerequisites.
- Actual person ingress or a trusted subscription supplies authority. Files, pages, tool results,
  watcher events and specialist reports are outside data. Their labels cannot grant permissions.
- Effects keep durable dispatch marks and receipts. A missing result is uncertain; neither an
  engine restart nor a transport retry authorizes repeating it. Changed actions need fresh grants.
- Specialists receive explicit task text only by default, with bounded time/steps/cost/concurrency,
  no implicit workspace/history/credential transfer, cancellation and revocation fences.
- Memory files, journals and the Radar inbox retain their existing consistent backup protocols.
  Session projection does not create an upstream competing database, scheduler or embedding index.
- Context limits remain independent of on-disk capacity. Compaction persists its sanitized summary
  through the host before projection uses it, preserving current requests and tool-result pairing.
- Local tools enforce operator folder grants, revisions, Bubblewrap limits and separate browser
  approvals. Model-supplied configuration cannot expand those permissions.

## Verification

The replacement requires strict builds, regression/security/recovery checks, exact mixed-license
packaging, fresh source/package installation, upgrade and rollback before review. Synthetic provider
fixtures prove protocols without a paid model campaign. Tests of the previous package do not prove
this replacement. Hosted storage/Files/specialist binding and staging acceptance remain outstanding.

Public contribution CI must use isolated disposable runners without private credentials. Trusted
publication is separate; Vercel receives prebuilt output only. Neither source pins nor installers
advance automatically. No merge, installer promotion or deployment is authorized by this document.
