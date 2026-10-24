#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Soft Axiom contributors
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

# Maintainers advance this pair only after verifying the exact public source archive.
revision='80b22c8d864a95eaa4fb6a5cd8d87f71f8902502'
digest='edd160ee9a5c93cddd1ebf957ea748eb7055e4605efc47543b391382e091c5d1'
prefix="${SOFTAXIOM_INSTALL_ROOT:-${HOME}/.local/share/softaxiom}"
stage=''

die() { printf 'Soft Axiom install: %s\n' "$*" >&2; exit 1; }
main() {
  while (($#)); do
    case "$1" in
      --version|--sha256|--prefix)
        (($# >= 2)) || die "Missing value for $1"
        case "$1" in
          --version) revision="$2" ;;
          --sha256) digest="$2" ;;
          --prefix) prefix="$2" ;;
        esac
        shift 2 ;;
      --help)
        printf '%s\n' 'Install the source preview: install.sh [--prefix /absolute/path] [--version FULL_COMMIT --sha256 ARCHIVE_SHA256]' \
          'Requires Linux/WSL2, Node 22.19+ with npm, curl, tar, sha256sum, and flock.' \
          'Oojuro and an installed Chrome/Chromium browser are separate runtime prerequisites.'
        return ;;
      *) die "Unknown option: $1" ;;
    esac
  done
  [[ "$(uname -s)" == Linux ]] || die 'This preview supports Linux/WSL2. Native Windows and macOS are not supported yet.'
  ((EUID != 0)) || die 'Run as your normal user, without sudo.'
  [[ "$revision" =~ ^[a-f0-9]{40}$ && "$digest" =~ ^[a-f0-9]{64}$ ]] || die 'An exact reviewed --version and --sha256 pair is required.'
  [[ "$prefix" == /* && "$prefix" != *$'\n'* && "$prefix" != *$'\r'* ]] || die 'The install prefix must be an absolute path.'
  for command in node npm curl tar sha256sum flock stat; do
    command -v "$command" >/dev/null || die "Missing $command; install the prerequisites first."
  done
  node --input-type=module -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<19))process.exit(1); await import("node:sqlite");' \
    || die 'Node 22.19+ with built-in SQLite is required.'
  umask 077
  for directory in "$prefix" "$prefix/versions" "$prefix/bin"; do
    [[ ! -L "$directory" ]] || die 'Install directories must not be symlinks.'
    mkdir -p -- "$directory"
    [[ -d "$directory" && -O "$directory" ]] || die 'Install directories must be owned by you.'
    local mode
    mode="$(stat -c '%a' "$directory")"
    (( (8#$mode & 022) == 0 )) || die 'Install directories must not be writable by other users.'
  done
  [[ ! -L "$prefix/.install.lock" ]] || die 'Unsafe installer lock.'
  exec 9>>"$prefix/.install.lock"
  flock --exclusive --timeout 60 9 || die 'Another install is running.'
  for name in sa softaxiom sa-memory; do
    local launcher="$prefix/bin/$name"
    if [[ -e "$launcher" || -L "$launcher" ]]; then
      [[ -f "$launcher" && ! -L "$launcher" && -O "$launcher" ]] && \
        grep -q '^# Soft Axiom installer-managed launcher$' "$launcher" || die "Refusing to replace an unmanaged $name launcher."
    fi
  done
  stage="$(mktemp -d "$prefix/.install.XXXXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --tlsv1.2 --connect-timeout 15 --max-time 300 --max-filesize 104857600 --retry 2 \
    "https://codeload.github.com/oojuro/softaxiom/tar.gz/$revision" --output "$stage/source.tgz"
  printf '%s  %s\n' "$digest" "$stage/source.tgz" | sha256sum --check --status || die 'Source checksum mismatch; nothing was installed.'
  tar --list --gzip --file "$stage/source.tgz" > "$stage/paths"
  awk -v root="softaxiom-$revision/" 'index($0,root)!=1 || /(^|\/)\.\.(\/|$)/ {exit 1}' "$stage/paths" || die 'Unsafe source archive paths.'
  tar --list --verbose --gzip --file "$stage/source.tgz" | awk 'substr($0,1,1)!~/[-d]/ {exit 1}' || die 'Source archive must not contain links or special files.'
  mkdir "$stage/source"
  tar --extract --gzip --file "$stage/source.tgz" --strip-components=1 --no-same-owner --no-same-permissions --directory "$stage/source"
  (
    cd "$stage/source"
    npm ci --include=dev --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
    npm run build
    npm run check:licenses
    node --input-type=module -e 'import {assertWalRuntime} from "./lib/inbox.js"; try { assertWalRuntime(); } catch { console.error("Upgrade Node: Radar needs SQLite 3.51.3+ or the 3.50.7/3.44.6 backports. See docs/INSTALL.md."); process.exit(1); }'
    node bin/softaxiom.js --help >/dev/null
  )
  local destination="$prefix/versions/$revision.${stage##*.}" node_path
  node_path="$(command -v node)"
  mv -- "$stage/source" "$destination"
  for name in sa softaxiom sa-memory; do
    {
      printf '%s\n' '#!/usr/bin/env bash' '# SPDX-FileCopyrightText: 2026 Soft Axiom contributors' \
        '# SPDX-License-Identifier: Apache-2.0' '# Soft Axiom installer-managed launcher'
      printf 'exec %q %q "$@"\n' "$node_path" "$destination/bin/softaxiom.js"
    } > "$stage/$name"
    chmod 700 "$stage/$name"
    mv -f -- "$stage/$name" "$prefix/bin/$name"
  done
  printf 'Installed Soft Axiom source preview %s\n' "$revision"
  printf 'Add this to your shell PATH: %s\n' "$prefix/bin"
  printf 'Verify: %q --help\n' "$prefix/bin/sa"
  if ! command -v oojuro >/dev/null; then
    printf '%s\n' 'Memory and agent tasks still need the separately installed Oojuro CLI. See docs/MEMORY.md.'
  fi
  printf '%s\n' 'No workspace, browser profile, credentials, model calls, daemon or shell startup files were created or changed.'
}
main "$@"
