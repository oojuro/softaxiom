# Third-party components and notices

## Included in the current core source / npm artifact

No third-party implementation, native executable, font, image, model weight,
dataset or compression dictionary is bundled. Original Soft Axiom material uses Apache-2.0;
[LICENSE](LICENSE) and [NOTICE](NOTICE) accompany the package. OpenClaw and Hermes are design
references only; no implementation or assets from either are included.

`assets/softaxiom-logo.svg` is the unchanged, owner-approved current Soft Axiom logo,
licensed here as original project artwork under Apache-2.0. It contains no third-party font
or image. See [the asset inventory](docs/LICENSING.md); trademark rights remain separate.

The shared runtime uses six exact direct npm dependencies and 18 locked packages in total.
Their unchanged license/NOTICE files are shipped in `licenses/npm/`; versions, registry integrity,
notice hashes and supplementary provenance are recorded in [DEPENDENCIES.json](docs/DEPENDENCIES.json).
AI SDK/provider clients and TypeScript use Apache-2.0; Zod, standard-schema, Node types, Undici and
eventsource-parser use MIT; YAML uses ISC; json-schema offers BSD-3-Clause or AFL-2.1, and we
select BSD-3-Clause. Implementations remain external dependencies and keep their own licenses.

## Separately installed runtime programs

These are runtime prerequisites, not files redistributed in the current JavaScript package.
Their upstream notices and licenses remain applicable to their own distributions. This list
is not a complete license manifest for a future native installer or container image.

| Component reviewed | Upstream evidence | Bundling requirements to carry forward |
| --- | --- | --- |
| Node.js 22.19.0 | [Versioned LICENSE](https://github.com/nodejs/node/blob/v22.19.0/LICENSE): Node's MIT terms plus its included third-party notices | Preserve the exact build's complete LICENSE and applicable bundled-component notices; do not replace them with this core's Apache license |
| util-linux flock 2.41.3 | [Versioned flock.c](https://github.com/util-linux/util-linux/blob/v2.41.3/sys-utils/flock.c): MIT identifier and copyright/permission notice | Preserve its copyright/permission notice and review linked libraries and the actual distro package. The util-linux repository contains components with other licenses; flock.c's identifier alone does not license every binary/image component |
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
