# Local defaults and optional adapters

The default open-source product runs on the person's own computer, using its filesystem and
terminal and, when browser execution is implemented, the person's installed browser. It must
not require E2B, Kernel, a cloud sandbox, a downloaded managed browser, our account or subscription.
There are no E2B/Kernel SDKs, credentials, endpoints or provider branches in the current CLI/library.
The current runnable slice is memory; browser/task execution is not implemented by this slice.

Hosted provisioning and provider-specific implementations belong in the separate private cloud
repository. An optional adapter calls generic core interfaces; core code never imports that
adapter. A hosted deployment can run the same CLI in its terminal without becoming the default.

## Workspace and execution contract

- Select one real workspace root. Files, terminal and filesystem operations must use that same
  tree, including all five real `memory/{hot,warm,cool,diary,cold}` directories and empty folders.
- Keep readable memories and diaries editable with ordinary local tools. Access cold storage
  through Oojuro commands; do not treat journal internals as editable text or a parallel transcript.
- Instrument actual user ingress, tool calls/results and agent outputs through `MemoryRuntime`.
  Historical memory and watcher content are outside data; the current person's authorization
  comes from their request or a previously approved subscription, never sandbox-written labels.
- Validate/recount after filesystem changes, including failures. Surface overflow and revision
  conflicts; assemble bounded context independently even after direct edits.
- Before replacement/restart, quiesce writers and use a complete closed-journal checkpoint.
  Preserve every file, directory entry and native evidence ID. Restore verified generations to
  fresh memory. Never copy a live journal one file at a time or merge its internals.
- A remote persistence adapter must encrypt complete generations, verify uploads, then CAS-publish
  one generation pointer. Files editors and agents share revision semantics. A failed upload or
  stale editor cannot overwrite the last valid generation. This remote adapter is not implemented.

## Browser contract

Use an explicitly authorized local browser/profile/session and its existing login state. Browser
providers are replaceable adapters; no provider is selected by the memory configuration. A hosted
operator owns its separately licensed browser/image and its own deployment checks. Shipping a
third-party browser requires its actual binary licenses/notices and any applicable source duties.

## Events and background work

Use the [unified event inbox design](EVENT_INBOX.md) for API, MCP and supported browser watchers.
The local implementation must not depend on a hosted scheduler. A managed service may connect
its existing workflow engine through a wake adapter; that dependency stays outside the core.
This is an agreed design boundary, not a claim that watchers or the inbox runtime have shipped.
