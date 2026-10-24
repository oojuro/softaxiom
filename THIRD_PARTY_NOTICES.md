# Third-party components and notices

## Included in the current core source / npm artifact

Original Soft Axiom additions are Apache-2.0. The inherited OpenClaw engine, session/context
and provider transports retain MIT attribution. The exact upstream revision and source/compiled
hashes are in [OPENCLAW_PROVENANCE.json](docs/OPENCLAW_PROVENANCE.json); the upstream MIT license
and Pi/Hermes notices are preserved in `licenses/openclaw/`. No upstream code is exclusively relicensed Apache.

The source candidate imports the required agent lifecycle, session-context/compaction and selected
native protocol closures, rather than the earlier loop-only wrapper. No native executable, browser,
model weights, font or private repository history is bundled. `assets/softaxiom-logo.svg` remains
owner-approved original project artwork; trademark rights are separate.

Exact direct/transitive dependency versions, registry integrity, license terms and notice hashes
are recorded in [DEPENDENCIES.json](docs/DEPENDENCIES.json). Their unchanged license/NOTICE files
are shipped in `licenses/npm/`. Terms include MIT, Apache-2.0, ISC, BSD alternatives and Unlicense.
`fast-sha256` 1.3.0 supplies its complete Unlicense public-domain dedication and warranty disclaimer;
its own terms remain attached. For json-schema we select BSD-3-Clause from its offered alternatives.
The standardwebhooks package omits its notice: we preserve the **libraries** MIT license from its
exact npm source revision, not the monorepo root Apache license. Supplemental provenance is explicit
in the inventory. No third-party lifecycle/install hooks run in the verified installation procedure.

## Separately installed runtime programs

These are runtime prerequisites, not files redistributed in the current JavaScript package.
Their upstream notices and licenses remain applicable to their own distributions. This list
is not a complete license manifest for a future native installer or container image.

| Component reviewed | Upstream evidence | Bundling requirements to carry forward |
| --- | --- | --- |
| Node.js 22.19.0 | [Versioned LICENSE](https://github.com/nodejs/node/blob/v22.19.0/LICENSE): Node's MIT terms plus its included third-party notices | Preserve the exact build's complete LICENSE and applicable bundled-component notices; do not replace them with this core's Apache license |
| util-linux flock 2.41.3 | [Versioned flock.c](https://github.com/util-linux/util-linux/blob/v2.41.3/sys-utils/flock.c): MIT identifier and copyright/permission notice | Preserve its copyright/permission notice and review linked libraries and the actual distro package. The util-linux repository contains components with other licenses; flock.c's identifier alone does not license every binary/image component |
| Bubblewrap 0.11.1 | [Versioned COPYING](https://github.com/containers/bubblewrap/blob/v0.11.1/COPYING) and [source](https://github.com/containers/bubblewrap/blob/v0.11.1/bubblewrap.c) | Separately installed command; no executable/source is bundled or linked into our JavaScript. Any future native/image distribution needs the exact upstream license, notices, source obligations and linked-library audit. |
| util-linux prlimit 2.41.3 | [Versioned prlimit.c](https://github.com/util-linux/util-linux/blob/v2.41.3/sys-utils/prlimit.c): GPL-2.0-or-later | Separately invoked program, not bundled or linked. Preserve applicable license/notices and corresponding-source obligations if distributing it in a future native bundle/image. |
| Oojuro source 3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd | [LICENSE](https://github.com/oojuro/oojuro/blob/3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd/LICENSE), [NOTICE](https://github.com/oojuro/oojuro/blob/3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd/NOTICE), [dictionary provenance](https://github.com/oojuro/oojuro/blob/3a17d1d4fbb519cb013afc492a7e9cc84cb1efcd/crates/oojuro-store/dict/README.md) | Keep its Apache-2.0 license and applicable NOTICE/dictionary attributions; review the exact Cargo/build graph, linked libraries and embedded assets before bundling a native binary |

Oojuro's reviewed NOTICE identifies compression-dictionary material derived from Nebius SWE-agent
trajectories (CC BY 4.0), SWE-Gym/OpenHands trajectories (MIT), Hermes function-calling data
(Apache-2.0) and OpenThoughts data (Apache-2.0). These attributions are present upstream; that is
not an independent clearance of every upstream dataset. The current Soft Axiom artifact includes
none of those datasets/dictionaries or the Oojuro binary. A future bundle must retain the complete
applicable upstream notice rather than substitute this summary, and verify the exact assets shipped.

The installed Oojuro binary used for storage tests has a recorded hash in
[MEMORY_VERIFICATION.md](docs/MEMORY_VERIFICATION.md); its source-build provenance is not asserted.
It is not a distributable native release artifact for this project.

## Native-build follow-up

A separate clean-source Linux x86-64 build of Oojuro's `3a17d1d` code was audited with the locked
default front-door graph: 101 external production/build crates, their actual license files from
checksum-verified Cargo archives, Rust library notices and the embedded starter dictionary.
The review found a BSD notice missing from alloc-stdlib 0.2.4's crate archive; the native release
bundle restores it from that version's exact upstream commit. Dictionary attributions and full
applicable license terms accompany the native bundle. This JavaScript artifact still ships none
of those executables, dependencies or dictionary bytes. Native release publication is separate.

The audited executable's SHA-256 is
`3f3c89b220fa9139d9e3a5814ccc0372246805b07ac30524aea7484dc59b3197`.
This records the specific reviewed artifact, not provenance for an arbitrary PATH binary. Local
operators must preserve the complete notices of the native build and OS packages they install.

## Local browser and inbox additions

The CDP client, SQLite inbox, portable adapter SDK, source adapters and tests are original Apache-2.0 code using Node
standard-library APIs. SQLite is supplied by the user's Node installation, not vendored here;
preserve the complete Node distribution notices if bundling Node in a future installer.
Chrome/Chromium/Edge and MCP servers are separately installed operator tools. This package does
not download, copy or redistribute their binaries, profiles, SDKs or implementation code.
Their own distribution licenses continue to apply. Protocol documentation informed the original
implementation; no OpenClaw, Hermes, CDP client or MCP SDK implementation was copied.

## Adding bundled components

Record exact origin, version/hash, license, shipped paths and modification status. Add complete
required license/notice files to the distribution and verify inclusion in the actual artifact.
Keep third-party license grants separate from project-owned Apache-2.0 material. See
[the redistribution review and boundary](docs/LICENSING.md).

## OpenClaw engine fork (MIT)

Inherited engine/contract source from openclaw/openclaw `15ae101a0d854480cfb500a5e241055450da39da`. Complete MIT license and unchanged upstream notices, including Pi (Mario Zechner) and the Hermes-derived repetition guard (Nous Research), are shipped in `licenses/openclaw/`. Upstream notices also mention SQLite/Octicons; those binaries/assets are not included by this source selection. Source/build hashes and local changes are recorded in `docs/OPENCLAW_PROVENANCE.json`.
