# Radar and the local inbox

Complete the locked install/build in [local setup](MEMORY.md#local-setup) before source-checkout commands.

Radar collects events into `.softaxiom/radar/inbox.sqlite` before routing work. It runs locally,
without a hosted scheduler, account or subscription. SQLite comes from Node's built-in
`node:sqlite` (experimental warning on Node 22). No npm dependency is installed. Examples run from your selected workspace; use `--workspace DIR`
before `radar` when working from another directory.

## Sources and freshness

Configure sources using JSON on stdin. Keep credentials in environment variables referenced by
name; do not put token values in JSON, URLs, command arguments or tracked files.

```sh
node bin/softaxiom.js radar source <<'JSON'
{"id":"github","account":"my-github-account","kind":"github","config":{"repository":"OWNER/REPO","pulls":[1,2],"tokenEnv":"GITHUB_TOKEN","intervalMs":60000}}
JSON
node bin/softaxiom.js radar sources
node bin/softaxiom.js radar poll
node bin/softaxiom.js radar inbox --unread
```

GitHub coverage is explicit PR numbers: current-head failed check runs/commit statuses and new
changes-requested reviews. The first poll includes currently active failures/change requests;
reviews superseded by an approval/dismissal are excluded. A durable review high-water mark and
stable check/status IDs avoid repeated wakeups. GitHub's APIs are polled to reconcile current
state; this is not an organization-wide notification feed. Limits: 20 PRs/source, 1,000 reviews,
100 checks/statuses per head; excess is an explicit error. Use narrower sources if needed.

Other source configurations:

| kind | config fields | contract |
| --- | --- | --- |
| `http` | `url`, optional `tokenEnv` | HTTPS GET; literal loopback HTTP allowed; persisted cursor passed as `cursor` query parameter |
| `mcp` | `command` argv array, `tool`, optional `arguments`, `cursorArgument` | User-installed trusted stdio server; MCP initialize/tools-call handshake, newline JSON-RPC; persisted cursor injected into arguments |
| `browser` | `url`, `selector`, `readySelector`, `idAttribute`, optional `revisionAttribute`, `emitInitial`, `eventKind`, `maxItems` | Explicitly configured page in the local authorized browser; stable item identity and content revision; baseline first poll unless emitInitial |
| `manual` | none | Operator `radar ingest SOURCE` with an events envelope; no polling |

HTTP/MCP must return `{ "events": [...], "cursor": "next" }`. Each event requires `id`, `kind`
and `summary`; `url`, `occurredAt` and `group` are optional. IDs must identify a stable change,
not the current polling time. Cursor advancement and event inserts commit together. Requests are
bounded (20-second HTTP/MCP calls, 1 MiB JSON, 500 events/batch); errors remain visible.

Browser watchers open their own temporary tab and close it after checking. `readySelector` must
identify the authenticated feed, not a login screen; the check waits up to three seconds for it. Rows need stable IDs; duplicates or truncation
fail visibly. Default maxItems is 100 (maximum 500). Browser support means configured selectors
on specific pages, not universal notifications. Changed/reappearing content revisions produce
one event per stable ID/revision; deletions alone do not emit events. The browser must be running
and logged in. MCP push subscriptions and packaged site-specific notification watchers are not implemented.
The [portable adapter SDK](ADAPTER_SDK.md) provides GitHub identity/health mappings for API, MCP
and browser connections; scheduling and credential storage belong to its caller.

`radar sources` reports `last_attempt`, `last_success`, `last_error`, cursor and enabled state.
A failed check never advances last_success or reports the source as quiet. Replacing a source
configuration resets its cursor and cancels its pending work; source account/kind cannot change.

## Signed webhook ingress

Set a source's `config.hmacEnv` to an environment variable holding a strong HMAC secret (at least
16 characters), then run `radar run --port 8787` or ingress-only `radar listen --port 8787`.
The server binds **127.0.0.1 only**, accepts POST `/events/SOURCE_ID`, rejects browser Origin
requests and verifies `x-hub-signature-256` against the exact raw body before persistence.
Generic sources accept the events envelope. GitHub sources accept submitted changes-requested
reviews and completed failed check runs for the configured repo/PRs. GitHub check runs without
PR associations rely on polling. Webhook and poll IDs deduplicate each other.

A remote GitHub webhook needs an operator-managed authenticated relay to loopback; the CLI
creates no public tunnel. The relay must preserve the exact body and signature. Polling alone
works without a relay. HTTP redirects are refused, including when credentials are configured.

## Subscription, worker and approvals

Initialize memory/Oojuro and select your model using MEMORY.md first. Radar collection itself
needs no model. Configure your provider endpoint/name and environment credential reference;
local and compatible remote model endpoints are supported by the existing model adapter.
No credentials or hosted provider subscription are included.

```sh
node bin/softaxiom.js radar subscribe <<'JSON'
{"id":"investigate","sources":["github"],"kinds":["github.ci_failed","github.changes_requested"],"instruction":"Investigate failures and report likely causes. Ask before interacting with the page.","allowedActions":["memory","browser.read","browser.write"],"origins":["https://github.com"],"maxRetries":3,"notify":true}
JSON
node bin/softaxiom.js radar run
```

`run` stays in the foreground, polls due sources and handles one task at a time. Run it under
your own local service manager for continuous operation; exiting stops monitoring. `--once`
performs one cycle; `--watch-only` collects without model calls. Multiple processes use SQLite
transactions and expiring leases; tasks batch at most 30 related events per source/subscription.
A running task retains its batch; later events get the next task. Progress, cumulative model
steps and receipts survive retries. Subscription/source changes revoke queued and running work.

`allowedActions`: memory, skills.read, browser.read, browser.write. `origins` is an exact origin allowlist.
`skills.read` explicitly permits bounded workspace skill/resource reads independently of memory;
existing subscriptions do not receive it automatically. See [skill discovery](SKILLS.md).
`kinds` supports exact names or `*` for all. Event text cannot edit these rules or grant permission.
The trusted subscription instruction supplies authority. Memory operations use the same Oojuro
instrumentation and independent context limits as the memory assistant. Saved task state is a
bounded note and receipts, not a parallel raw transcript. Max model steps/output/request bounds
come from memory settings; maxRetries is 0–5 with bounded backoff. There is no dollar wallet or
arbitrary terminal tool in this worker. Real-model quality evaluation remains deferred.

```sh
node bin/softaxiom.js radar tasks
node bin/softaxiom.js radar task TASK_ID
node bin/softaxiom.js radar approvals
node bin/softaxiom.js radar approve ACTION_ID
node bin/softaxiom.js radar reject ACTION_ID
node bin/softaxiom.js radar work
node bin/softaxiom.js radar results
```

Approval queues an exact prepared action; `work`/`run` dispatches it. The agent cannot approve
its own actions. If execution began but no receipt committed, the action becomes `uncertain`
after lease expiry. Inspect the website first, then use `radar resolve-action ACTION_ID succeeded`
or `failed`. Neither outcome automatically repeats that action. A deliberate new attempt needs
a fresh task/approval. Do not resolve an uncertain action while the old worker is still running.
Disabling a subscription cancels pending work; an already dispatched website request cannot be
undone. Results and approval notices print to the local terminal; messaging/UI delivery is future work.

A direct local task uses the same inbox, scopes and approvals:

```sh
node bin/softaxiom.js agent --origins https://github.com 'Inspect my PR page and summarize the failed checks.'
```

## Processing, read state and retention

`radar read EVENT_ID` marks the person's read state only. Completing a task marks its delivery
processed only. Duplicate events do not wake new work, including after retention pruning.
Subscriptions are prospective; creating one does not retroactively route stored events.

Use `radar backup /absolute/new/inbox.sqlite` for a consistent SQLite backup, not a copy of a live
WAL/database pair. To restore, stop all local workers and ingress, then place that backup at
`.softaxiom/radar/inbox.sqlite` in a fresh workspace with no old WAL/SHM files. Preserve the browser
profile separately with the browser closed; use memory's complete-generation checkpoint for the
five memory directories. There is no atomic cross-component snapshot; quiesce every writer before
coordinating a complete workspace backup. Unknown external effects still require reconciliation.

`radar prune ISO_TIMESTAMP` removes bounded payloads for old read events whose deliveries are
terminal, preserving hashed deduplication tombstones. `radar source-delete SOURCE_ID` disables
and deletes that source's inbox/task payloads and disables related subscriptions. Uncertain actions
must be resolved first. These operations do not erase Oojuro evidence or existing backups; use
your separate retention policy for those. State/profile directories are private and gitignored.
