# Shared runtime and host boundary

`softaxiom` owns the portable runtime. The cloud imports an immutable revision of the same package;
it does not maintain another implementation. Source is `core/`; a clean TypeScript build emits
`lib/core/` JavaScript and declarations for Node 22.19+. Generated files are not maintained by hand.

| Public owner | Responsibility |
| --- | --- |
| `core/agent/context` | Outside-content framing, history/tool-result views, retrieval assembly and bounded compaction |
| `core/agent/runs/model-round` | Durable transcript receipts, model-answer recovery, planned calls and keyed fingerprints |
| `core/agent/tools` | Registry/schema validation, role restrictions, effect admission, intent-before-dispatch and replay protection |
| `core/agent/authority` | Exact action fingerprints, bounded trusted ancestry, instruction/approval decisions and independent checks |
| `core/agent/gateway` | Explicit model adapters, input bounds, cache shaping and provider refusal classification |
| `core/agent/harness` | Prompt budgets/rendering, skill validation and secret detection |
| `core/contracts`, `core/policy` | Versioned data contracts, identifiers, error codes, time/quiet-hour/recurrence calculations |
| `lib/` local adapters | Filesystem/Oojuro memory, local browser/CDP, SQLite event inbox and foreground CLI driver |

Hosted database queries, encrypted object storage, account leases, commercial plans/rates,
subscription billing, carrier delivery, provider provisioning and Temporal coordination stay private.
The host supplies these through ports; it may specialize product prompts. Those implementations
must not be copied into this package. There is no E2B, Kernel, Supabase, AWS, Temporal or Stripe
import in `core/`, and the local default requires none of those services.

## Contracts and security

- Only actual user ingress or a trusted subscription supplies authority. Retrieved files, pages,
  watcher events, tool output and delegated reports remain outside data. Labels in their text
  cannot create a user instruction or approval.
- Effects require a host authorization gate and a durable prepared/dispatched/settled store.
  Missing gates fail closed. The transcript must commit before acknowledging append; an intent
  without a result is uncertain and cannot be blindly repeated. A changed action has a different
  keyed fingerprint. The real cloud database adapter retains its atomic operations and isolation.
- Host ancestry is followed at most eight levels; missing/cyclic/deeper chains grant no user
  authority. The independent check may only cite the actual user messages it was shown.
- Context limits are independent of storage limits. Unverified image/file content is rejected
  before a provider SDK can fetch it. Compaction preserves complete tool exchanges and receipts.
- Shared model batches have at most 64 calls, unique bounded IDs, 64 KiB JSON arguments per call,
  and a 1 MiB answer bound. Local CLI retains its stricter eight-call limit and configured
  step/maintenance/request/output limits (default ten steps; maximum thirty).
- Model adapters require an explicit model object and caller-supplied credentials. Passing a
  model string to imply an AI Gateway route is rejected. No model call or service account is
  configured by installing/importing the package. The AI SDK is a local library; this does not
  enable Vercel compute or an AI Gateway subscription.
- The cloud supplies its durable reservation/settlement gateway. The local HTTP adapter bounds
  steps and tokens; it does not claim a dollar spending ceiling without a priced budget adapter.
- Diagnostics accept bounded codes/labels only, have no network sink by default and cannot
  change execution if a sink fails. Hidden reasoning is excluded by the local model adapter.

A host port is a trust boundary, not an excuse for a fake-success implementation. Storage,
authority and paid-operation adapters need meaningful persistence and isolation tests. Tests use
synthetic in-memory ports; the product CLI uses the actual Oojuro interface and durable inbox.
Local execution is under the operating-system user account, not an isolation sandbox for arbitrary
untrusted code. This preview does not expose an arbitrary shell/code-edit/push tool.

## Engineering and distribution gates

Run `npm ci --ignore-scripts`, then `npm run check`. The source/lockfile uses exact direct versions
and a published shrinkwrap. The build checks module boundaries before compiling, cleans generated
output and preserves Apache identifiers in JavaScript and declarations. The distribution check
requires an exact reviewed dependency inventory and byte-identical upstream license/NOTICE files.
No third-party implementation or native binary is bundled in the core archive.

`check-core.js` inspects imports with the TypeScript parser: hosted/private or escaped imports,
ambient credential lookup and dynamic code/module loading are rejected. This catches accidental
coupling; it does not replace review of contributed code. Keep public contribution CI disabled
until [disposable isolation](CI_AND_BUILDS.md) is available. Tests must have no production credentials.

`core/manifest.ts` names the extracted owners. Cloud compatibility files are imports or small host
adapters, checked by cloud tests to prevent restoring the removed implementation. Fix shared bugs
here, retain synthetic regressions here, then update the cloud's single immutable dependency pin.
Never synchronize private Git history or customer data into the public repository.

The extraction tests cover permission bypass, outside-content spoofing, unknown-outcome replay,
cyclic ancestry, batch/context floods, unverified media, content-free diagnostics and prohibited
imports. Existing cloud regression suites also exercise the public implementation with real
Postgres roles and encrypted storage. Real-model evaluation remains deferred by the owner;
real-account staging and deployment remain separate decisions for the host maintainer.
