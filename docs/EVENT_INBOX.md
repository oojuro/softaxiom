# Radar: unified event inbox

The local CLI implements this boundary through Radar. See [commands, coverage and recovery](RADAR.md)
and [verification](LOCAL_VERIFICATION.md). Managed workflow integration and MCP push subscriptions
remain future adapter work.

```text
API webhooks / incremental polls ─┐
MCP checks / subscriptions ───────┼─> durable inbox -> subscription rules -> scoped task
Supported browser watchers ──────┘                                      -> result / approval
```

## Source adapters

Prefer webhooks; otherwise poll incrementally with a durable source cursor. MCP adapters call
available tools or use subscriptions if that server supports them. Browser watchers check a
specific supported site's inbox, activity feed or notification page in the user's authorized
browser. There is no universal interface for every website's notifications.

Expose each adapter's coverage and last successful check, cursor and bounded failure status.
Never report a source as quiet when its watcher has stopped checking. Browser support is explicit
per site; the core has no default dependency on a hosted browser or remote computer provider.

## Durable inbox contract

Persist an event before waking a task. Its versioned envelope includes source, account, stable
source event ID, occurrence/observation times, bounded change summary, original link/evidence,
processing status, retry history and subscription/task routing. Keep content out of diagnostic logs.

- Deduplicate on source + account + source event ID. A polling adapter without an event ID must
  derive a stable key from the source's object identity and change revision, never observation time.
- Keep task processing separate from the person's read state. A task result does not mark the
  person's notification as read, and a person reading it does not acknowledge task completion.
- Persist delivery/task identity before effects. Claim related batches with a lease or equivalent
  transaction; only one active owner may handle an item. Preserve saved progress across retries.
- Retry safely with bounded backoff and a visible terminal failure state. Duplicate wake signals
  must resume the same work rather than create duplicate effects. Enforce retention and deletion.

Inbox task/routing state is distinct from Oojuro's observed-experience journal. Do not make a
second editable raw transcript or use the cold journal as an undocumented queue database.

## Subscription supplies authority

Product target example: “Watch my GitHub PRs. When CI fails or someone requests changes, investigate and
prepare a fix. Ask before pushing.” Record the person's source/account scope, wake conditions,
allowed actions, approval boundaries, notification preference and enabled/revision state.

Incoming notification text cannot extend that grant. Recheck the current subscription and
permissions before every effect; disabling or narrowing it applies to queued work too. The
example describes the product target; the current local runner has memory/browser tools and
can investigate/report, but has no code-edit or push tool. Browser interactions require approval.

## Wake the relevant task

Subscription rules route and batch related events into a scoped background task with its saved
progress and evidence. The local core exposes generic durable inbox/task/wake boundaries. A
local runner handles these on the user's machine; an optional managed adapter signals its existing
workflow engine. Hosted Soft Axiom uses Temporal through the private adapter, not a second hosted
durability engine or a mandatory Temporal service for local users.

Radar watches; the inbox holds incoming work; background agents investigate; the main agent
surfaces meaningful results or approvals. No automatic send, push, payment or deletion gains
authority merely because a watcher delivered an event.
