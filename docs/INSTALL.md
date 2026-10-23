# Install the source preview

The README provides shell (`curl | bash`) and PowerShell (`irm | iex`) entry points pinned to
an immutable public installer revision. The installer itself selects one exact public source
commit and verifies its archive SHA-256 before extracting or running code. The PowerShell bridge
also verifies the downloaded shell script's SHA-256 before starting WSL. No npm release,
private GitHub access or Soft Axiom Cloud account is used to install this CLI.

## Supported systems and prerequisites

- Linux, or a normal Linux user inside WSL2. PowerShell uses the default WSL2 distribution;
  it does not install a native Windows application or create/install WSL for you.
- Node 22.19+ and npm, with a patched SQLite engine for Radar. Tested runtimes are Node
  22.23.4 and 24.20.0 (both link SQLite 3.53.4). Use a current maintained Node LTS release.
  The installer and Radar query the actual linked engine. SQLite 3.51.3+ or the documented
  3.50.7/3.44.6 backports are required; affected builds fail before Radar touches a workspace.
  See [SQLite's WAL-reset advisory](https://sqlite.org/wal.html#walresetbug).
- Bash, curl, tar, sha256sum and util-linux flock. The installer requires no root/sudo and does
  not change system packages, Node, npm settings or shell startup files.
- Registry access for the exact locked npm dependencies. The source build installs its reviewed
  compiler dependencies too; third-party lifecycle scripts are disabled.
- For memory and agent tasks: the separately installed **Oojuro** front-door CLI. Its native
  release/provenance gate remains separate. This installer neither bundles a native executable
  nor claims the full assistant is available without it. See [memory setup](MEMORY.md).
- For browser execution: your installed Linux/WSL Chrome, Chromium or Edge. No browser or
  personal login profile is downloaded/copied. Native Windows and macOS are not verified targets.

## What installation changes

The default root is `~/.local/share/softaxiom` inside Linux/WSL:

```text
softaxiom/
├── bin/softaxiom          # installer-managed launcher
├── bin/sa-memory         # same CLI, compatibility name
└── versions/COMMIT.ID/    # verified source, compiled JS/declarations, locked dependencies and notices
```

Add the printed `bin` directory to PATH yourself, then run `softaxiom --help`. No workspace,
account, model credential, model call, browser profile or background service is created.
Initialize memory explicitly in the workspace you choose after installing Oojuro.

With a downloaded/reviewed `install.sh`, `bash install.sh --prefix /absolute/user-owned/path`
selects another root. Install directories must be owned by you, not symlinks or writable by
other users. An unmanaged existing launcher is never overwritten. A failed download, checksum,
build, license check or runtime probe leaves the previous launcher in place. Successful installs
switch launchers only after verification and keep previous code generations for manual rollback.
Installers do not delete workspace data. Concurrent installs share a bounded OS lock.

For an explicit source revision, pass **both** `--version FULL_COMMIT --sha256 ARCHIVE_SHA256`;
the pair is an operator trust decision, not a way to skip integrity checking. Downloads allow
HTTPS redirects only and have size/time bounds. Node's source build emits the same `.js` entry
points and `.d.ts` contracts consumed by the local CLI and managed host.

## Inspect before running

The one-line commands execute the downloaded installer. You can instead save that exact URL
to a file, inspect it and run it explicitly (`bash install.sh`, or `& ./install.ps1`). The immutable
bootstrap URL and source digest make the selected preview reproducible; they do not substitute
for trusting the maintainer or isolate arbitrary code from your user account.

The PowerShell bridge is tested with the real PowerShell interpreter against a synthetic WSL
transport, including byte-preserving input and nonzero exits. Actual Windows/WSL acceptance is
still a maintainer check; it is not inferred from Linux tests.

## Reference patterns

Reviewed October 23, 2026: [OpenClaw installer internals](https://docs.openclaw.ai/install/installer)
offer shell/PowerShell and user-local installs, version selection and verification.
[Hermes](https://github.com/NousResearch/hermes-agent#installation) offers shell and native Windows
PowerShell entry points. Soft Axiom uses original installer code and its current Linux/WSL scope;
no upstream installer source or native Windows support claim was copied.
