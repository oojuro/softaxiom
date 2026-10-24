# Persistent terminal chat

Source-preview capability. Build with `npm ci --ignore-scripts && npm run build`, initialize the
workspace with `node bin/softaxiom.js init`, and configure independent model access with
`node bin/softaxiom.js setup`. Oojuro must be installed separately. Source commands below use
`sa` for a freshly packaged candidate; use `node bin/softaxiom.js` from a checkout. The README's
pinned installer is promoted independently after review.

## Interactive or one message

```sh
sa chat --local                       # interactive terminal conversation
sa chat --local 'Continue my project'  # one message; JSON result
sa chat                              # same cloud/iMessage agent after login; local otherwise
```

Interactive chat accepts `/exit` or `/quit`, `/help`, and local `/history`, `/new` and `/tasks` commands.
Requests are processed sequentially; pasted lines are queued rather than silently discarded.
Use one request per line. Control sequences in model/history output are escaped before display;
they cannot manipulate the terminal or clipboard. The CLI does not write a separate readline
history file. The terminal emulator's own scrollback remains under the person's control.

`/new` or `sa chat --local --new REQUEST` starts a new local conversation context. Existing
memories and evidence remain; it is not a memory erase, permission grant or new cloud agent.
Local conversations are scoped to their workspace. No local history/files are uploaded by
cloud chat. Model-provider billing and Cloud authentication remain independent.

Cloud mode is selected once when an interactive session opens. It pins the saved login's
generation, follows token refreshes and stops before sending if another login replaces it.
Logout/authentication failure does not silently switch to local mode. Cloud replies stay in
the terminal; later proactive messaging retains the existing account route. Local `/new` and
`/history` never create or modify a cloud conversation. Cloud CLI APIs still need deployed
acceptance; a local synthetic test is not production verification.

## Saved history and context

```sh
sa chat --local --history
sa chat --local --history --before 25
```

History pages contain at most ten indexed turns, newest first, with operation IDs, sequence,
status and journal evidence references. User/assistant excerpts are bounded to 1,500/2,500
UTF-8 bytes; offsets and `partial` expose truncation. `nextBefore` pages older entries. Use
the existing `sa evidence ID BYTE_OFFSET` interface for complete original evidence.

The next model request receives at most 8,000 bytes of recent completed conversation context.
Historical messages are marked as data and retain their evidence/partial labels. Old tool calls,
results, hidden reasoning and provider replay envelopes are not replayed from history. Only
user/assistant text pairs are allowed; source content cannot insert system or tool roles.
Initial context admission can drop whole oldest pairs if needed, preserving the current request;
later model/tool/context limits are still enforced independently. Full history stays in Oojuro
even when it is outside active model context. Existing memory tools can retrieve older evidence.

## Retry, interruption and concurrency

```sh
sa chat --local --operation 9a6336c4-6e14-46cd-bf97-222d9dffad15 'One request'
sa chat --local --resume 9a6336c4-6e14-46cd-bf97-222d9dffad15
```

The CLI prints one operation UUID before submission. Reuse the exact UUID and request after a
lost response. A completed turn returns its saved journal reply without a model/tool call;
different text with that UUID is refused. `--resume` only inspects state and never submits work.
Interactive cloud work still pending after a minute prints its UUID and leaves the session;
resume it before sending another message.

An interrupted local turn may have model costs or partial tool effects. It remains `running`
after a process crash, or `uncertain` after a caught failure. Neither state proves the original
work completed. New local turns/conversations are blocked until the operator inspects its
evidence/files and acknowledges it with `sa chat --local --resolve UUID`. Resolving never
repeats work, rolls effects back or recovers an unrecorded answer. Old IDs remain deduplicated
after resolution or `/new`. The model has no resolve command. Tool-specific uncertain receipts
and permissions remain independently enforced.

One local turn holds an OS lock across execution. Concurrent CLI processes serialize; waiting
longer than 30 seconds reports lock unavailability without bypassing the active turn. History
and receipt inspection remain available. Ctrl-C while waiting for input leaves the session;
Ctrl-C during work exits with the printed operation ID for reconciliation. EOF closes the input
without automatically resending anything.

## Storage and consistent recovery

Oojuro stores the actual redacted user/assistant events in `memory/cold/`. The private
`memory/.chat.sqlite` index stores only operation IDs, request digests, status and evidence
references; it is not a second transcript or credential store. `memory/.chat-session/` contains
the process lock. These are runtime metadata; use CLI interfaces rather than editing them.
Model/Cloud credentials remain outside workspace memory and are not copied into checkpoints.

Each index operation opens and closes SQLite under the existing memory process lock, with
rollback-journal mode and full synchronization. The whole-memory checkpoint takes that same
lock and Oojuro's native lock, so it copies a closed index and a consistent journal generation.
A checkpoint taken while a model request is in flight preserves its incomplete intent; restore
does not resume/repeat it. Quiesce the old owner before cutover, retain the complete memory
generation and reconcile incomplete operations before new effects. The index fails closed at
64 MiB; raw journal/storage retention remains the operator's responsibility.

This does not establish subscription-provider login, paired devices, OpenUI, native installation
or hosted deployment/real-model acceptance. Those remain separate complete-release gates.

Browser work is delegated through the [existing Radar workflow](CHAT_BROWSER.md) with explicit
origin grants. Its task/approval state lives in Radar's ledger separately from this transcript;
a finished main reply can still have a pending child task. `/tasks` inspects that state.
