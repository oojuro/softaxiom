# Browser tasks from terminal chat

Source-preview capability; the README's pinned installer is promoted separately after review.
Build the source and complete local model/Oojuro setup first. No E2B, Kernel or Cloud account
is used. Start or explicitly attach your installed browser as described in [LOCAL_BROWSER.md](LOCAL_BROWSER.md).

```sh
sa browser start
sa chat --local --origins https://github.com 'Inspect my PR notifications and prepare a response.'
sa chat --local --tasks
sa radar approvals
```

`--origins` grants exact origins for browser tasks delegated from this chat invocation. It
does not accept URL paths, query strings, credentials, fragments or insecure remote HTTP.
It applies to the whole interactive session; without it, chat can inspect its earlier tasks
but cannot start new browser work. Cloud chat rejects these local-only options.

## One conversation, durable delegated work

The main agent uses `browser_task start {instruction}`, `state {subscription}` and `list {}`.
The child runs through the same Radar inbox, browser adapter, worker, leases, step counter and
approval ledger as direct local tasks. There is no second browser execution or approval path.
It receives only `browser.read`/`browser.write` and the granted origins: no parent conversation
history, private memory, skills, project files, terminal tools or ability to delegate recursively.

One child can be created per chat message. An exact repeated start reads the existing task;
different instructions or origins with that identity are refused. The child and main agent
each have the existing bounded model-step allowance. The child's saved step count continues
across approval/resume; it does not reset on each worker invocation. Automatic failure retries
are zero for delegated browser tasks. Model-provider billing still applies to actual calls.

The main reply can finish while the browser task waits. A completed **chat message** is not a
completed **browser task**. One-shot CLI output includes the delegated task's actual state;
interactive chat prints its task state separately. `/tasks` or `sa chat --local --tasks` lists
the current conversation's ten latest delegated tasks, including pending action IDs. The model
can inspect them on demand. Results are bounded to 2,000 UTF-8 bytes with evidence/partial markers.
Use `sa radar task TASK_ID` and journal evidence for fuller inspection.

## Approval, resumption and cancellation

Inspect the exact prepared operation with `sa radar approvals`. The model has no approval tool.

```sh
sa radar approve ACTION_ID
sa radar work chat_MESSAGE_UUID
sa chat --local 'Check the result of that browser task.'
```

Approval queues work; it does not execute an action by itself. A running Radar worker may
execute an approved action. Its exact page/control/form binding and live subscription scope
are rechecked. Rejection cancels the task. Completed actions are receipted and not sent twice.

```sh
sa radar reject ACTION_ID
sa chat --local --cancel-task chat_MESSAGE_UUID
```

Cancellation disables that conversation's subscription and cancels pending/approved work;
lease checks stop subsequent effects. An action already in flight may be uncertain. New chat
browser tasks are blocked while a prior chat action is executing or uncertain. Inspect the
actual site before `sa radar resolve-action ACTION_ID succeeded|failed`; reconciliation does
not repeat an effect. Resolving an interrupted parent chat message also cancels its delegated
subscription, but does not erase uncertain browser effects or their reconciliation gate.

The host checks conversation ownership for task status/cancellation. Neither origin arguments
inside a model tool call nor outside page instructions can widen the operator's grant. A new
chat context does not erase older tasks; the operator can still manage those through Radar.

## Persistence and remaining acceptance

The chat transcript remains in Oojuro. Delegated task specifications, progress, prepared actions
and results live in the existing `.softaxiom/radar/inbox.sqlite` ledger. Keep the complete
workspace when restarting. Use Radar's consistent SQLite backup interface rather than copying
a live WAL database. A memory-only checkpoint preserves chat evidence/receipts, not the separate
Radar/browser state; restore that state consistently before continuing an active browser task.
No task is reconstructed from an old chat reply. Browser profiles and live website sessions
have their own lifecycle; an expired login requires the person's normal reauthentication.

Synthetic model tests and an installed-browser fixture verify permissions, exact approvals,
cross-process task inspection, cancellation and unknown-effect recovery. Actual provider/model
quality, personal browser sessions, hosted acceptance and full clean-machine installation are
separate release gates. This does not establish paired-device execution or the OpenUI web app.
