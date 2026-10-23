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

## TypeScript migration and installer verification — October 23, 2026

- Core/local strict compilation and a consumer type contract pass; invalid operations, adapter
  transports, model responses, nulls and unchecked indexes must remain compiler errors.
- All 50 deterministic checks pass on Node 24.20 and patched Node 22.23.4 with actual installed
  Chrome, the reviewed Oojuro binary and the real PowerShell interpreter; no tests skipped.
- Source and generated local declarations have no explicit `any` or type-check suppression.
- Corrupt download, symlink prefix and unmanaged-launcher cases preserve prior commands.
  The PowerShell bridge checks bytes/arguments and propagates errors through a synthetic WSL
  transport; no actual Windows/WSL acceptance is claimed.
- Affected Node 22.19/SQLite 3.50.4 is explicitly rejected before a Radar workspace is created.
  Both accepted test runtimes link SQLite 3.53.4. WAL fixes and backports have a regression.
- A thrown `undefined`, null, false, zero or empty string is a tool failure; it cannot produce
  a successful receipt or falsely settle an approved action.

Real-model evaluation remains deferred. Native Oojuro distribution and actual Windows acceptance
remain separate maintainer gates. The shell/PowerShell code is original Apache-2.0 source.
# Dependency validation limits — October 23, 2026

Zod is pinned to 4.6.7 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
The [upstream correction](https://github.com/colinhacks/zod/pull/6652) checks leading collection
bounds before parsing elements. A 1,000-item synthetic case reproduced 1,000 element visits on
4.6.5. The permanent regression requires zero visits and one size issue, including the shared
Cloud reply schema. Request byte bounds remain independently required; unbounded schemas are
not made safe by a version change alone. The MIT notice is unchanged and retained.

