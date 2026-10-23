# Local browser and Radar verification

Verification uses synthetic local fixtures, an installed Chrome and the actual reviewed Oojuro
binary documented in THIRD_PARTY_NOTICES.md. No real-model call, private account, hosted browser,
customer event or provider credential is used. Real-model quality evaluation is deferred.

The regression suite covers actual browser navigation, snapshots, input, click, screenshot,
origin checks, stale approvals, browser watcher baselines/changes/login failure, and a scripted
model task that pauses for approval and resumes with a single real browser effect and Oojuro
receipts. A lost receipt after an actual click must become uncertain and require reconciliation.

Inbox checks cover fresh-process recovery, concurrent claims, batches beyond 30 events, stable
deduplication, per-person read state, bounded retries, permission revision changes, atomic cursor
commits, stale lease rejection, consistent SQLite backup/restore, retention tombstones and source
deletion. HTTP, signed webhooks, GitHub review supersession/cursors and MCP stdio initialization
are exercised against real local protocol fixtures.

Observed on October 23, 2026: all 32 checks pass on Node 24.20, including 5 actual-browser
checks and the existing 17 memory/licensing checks. All 15 browser/Radar checks pass on Node
22.19 with no skips. The actual packed CLI also passes fresh-workspace browser navigation/click,
inbox ingestion, model-unconfigured behavior and consistent backup checks; shipped legal files
are byte-identical to the reviewed source. No model/provider call is made by these checks.

Run on Linux with Node 22.19+:

```sh
SOFTAXIOM_TEST_BROWSER=/absolute/path/to/google-chrome OOJURO_BIN=/absolute/path/to/oojuro npm run check
```

Without SOFTAXIOM_TEST_BROWSER the real-browser cases explicitly skip; those skips do not prove
browser execution. The test launcher uses an empty disposable Chrome profile with a basic password
store solely to avoid an unattended OS keyring prompt. It has no logins/credentials and is deleted
afterward. Product startup retains Chrome's normal OS credential protection and sandbox.

Live GitHub authorization/rate limits, third-party website selector stability, signed public
relay setup, actual model tool quality, desktop login/keyring interaction, macOS, native Windows,
Safari and Firefox are not certified by these fixture tests. Public Actions remain disabled until
isolated contribution runners exist; no Vercel CPU or private persistent runner is used here.
