# Core license and public/private boundary

The owner licenses the original Soft Axiom open-source core under **Apache-2.0**. The complete,
unmodified terms are in [LICENSE](../LICENSE). This covers project-authored source, prompts,
documentation, original logo artwork, tests and configuration in this repository unless a file
states otherwise. Preserve
[NOTICE](../NOTICE). Contributions intentionally submitted for inclusion use the same license.

Source publication is separate from native/package releases and hosted deployment.
The runnable core includes memory, local browser execution and Radar; it is not the complete planned assistant.

## Repository boundary

| Public core: oojuro/softaxiom | Private managed service: oojuro/sa-cloud |
| --- | --- |
| Personal agent runtime, prompts, skills and model adapters | Hosted account/customer administration and commercial onboarding |
| Terminal/browser interfaces and generic provider adapters | Company provider accounts, service credentials and fleet provisioning |
| Memory, diary, Oojuro integration and portable state/storage interfaces | Production/staging targets, account migration and rollout operations |
| Self-host configuration, portable UI and permission/approval controls | Subscription billing, commercial entitlements and support operations |
| Isolation, encryption, idempotency and configurable spend safeguards | Customer records, operational reports and internal infrastructure |
| Generic synthetic tests and install/recovery documentation | Internal datasets, service-specific fixtures and deployment secrets |

The separate `oojuro/o-cloud` service also remains private. Apache-2.0 on the core does not license
either private repository or its history. Shared functionality belongs upstream in the core;
private services consume reviewed pinned versions. Generic model/provider adapters and security
safeguards remain self-hostable without a cloud subscription. Company account credentials and
commercial operations do not become core dependencies.

Workspace memories, diaries, journals and user artifacts are **user data**, not contributions or
software covered by this repository's license merely because the application stores them. API
access, model weights, datasets, logos and other third-party content have their own applicable
rights/terms. Apache-2.0 does not grant trademark rights or relicense third-party components.

## Current redistribution review

Reviewed baseline: source commit `7197b7adab991582356f676dc9c0a30f5f4cd1b6` and its packaged
JavaScript artifact, followed by the licensing follow-up, original local browser/Radar implementation
and owner-authorized shared-runtime extraction. No private Git history was imported.

| Included material | Provenance and verified scope |
| --- | --- |
| bin/, lib/, core/, agent-text/ | Original project memory/browser/inbox and owner-authorized portable runtime extraction; no customer data, hosted implementations or third-party implementation source |
| test/, fixtures/ and scripts/ | Original synthetic fixtures and project verification tooling; no user transcripts or downloaded datasets |
| README, docs, contribution/security documents and config | Original project documentation/configuration; external reference links do not bundle their contents |
| LICENSE / NOTICE | Standard Apache-2.0 terms retained unchanged; original project copyright/notice retained |
| npm dependencies | Six exact direct runtime dependencies (AI SDK/provider clients, YAML and Zod); 18 locked runtime/build packages total, reviewed in [DEPENDENCIES.json](DEPENDENCIES.json). Apache-2.0, MIT, ISC and the BSD-3-Clause option of json-schema; no copyleft dependency is included. |
| assets/softaxiom-logo.svg | Owner-authorized, unchanged copy of the current Soft Axiom web app favicon; original project artwork under Apache-2.0. SHA-256: `9acc0e66739db7758d6e97312f25502fb01fd9912940639f556a850f9b6277ec`. No third-party image or font is embedded; trademark rights remain separate. |
| Vendor code, third-party fonts/images, dictionaries, model weights and native binaries | None included in the reviewed source or npm artifact |

The project's copyright/license metadata and original-file SPDX identifiers agree. The artifact
check confirms the legal files are shipped and rejects a changed dependency graph or unexpected
binary payload pending a new review. It does not establish authorship of future submissions:
contributors must have redistribution rights, and maintainers must review provenance.

The separately installed Node (including built-in SQLite), flock, Oojuro and locally installed browser programs are listed in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Their exact binary builds, linked libraries
and embedded assets are **not** cleared for a combined installer/image by this source-only review.
In particular, Oojuro's upstream NOTICE includes dataset/dictionary attribution that must survive
any distribution carrying the relevant material. Do not label an entire future image Apache-2.0.

## Maintaining redistribution rights and notices

For every newly imported dependency, vendored file, asset or native binary:

1. Record upstream URL, exact revision/version/hash, origin, license, affected paths and whether it
   is modified or bundled. Inspect the actual license/NOTICE and transitive dependency/build graph;
   a repository badge or package license field alone is insufficient.
2. Verify that the contributor or upstream grants the rights needed for the intended source,
   package, installer or image distribution. Review incompatible, noncommercial, source-available
   or ambiguous terms before inclusion; do not treat them as Apache-2.0 automatically.
3. Preserve applicable copyright, attribution, patent and trademark notices. Ship upstream license
   texts and required NOTICE/attribution material with the artifact in readable form. Preserve
   existing notices when updating, and identify modifications to third-party files.
4. Complete any applicable source provision, license-copy or other distribution obligations for
   the exact bundled components. Audit native linked libraries and embedded dictionaries/datasets.
5. Update this inventory, THIRD_PARTY_NOTICES.md and the distribution check together. Recheck the
   actual archive/image contents. Licensing scope must match what is actually shipped.

Apache-2.0 redistribution requires recipients to receive its license, preservation of applicable
notices and prominent change notices in modified files; NOTICE attribution requirements also
apply where relevant. See [the official terms, section 4](https://www.apache.org/licenses/LICENSE-2.0#redistribution)
and [Apache's licensing FAQ](https://www.apache.org/foundation/license-faq.html). This document is
a project inventory and workflow; it adds no restrictions to the license grants.

Run `npm run check:licenses`; `npm pack` runs the same check before packing. Publication remains
gated on the owner's review and the broader [preparation checklist](OPEN_SOURCE_PREPARATION.md).

The shared-core follow-up ships exact upstream license/NOTICE files under `licenses/npm/`.
The provider-utils 5.0.62 archive omitted LICENSE; its supplement comes from that version's
[exact upstream revision](https://github.com/vercel/ai/blob/b7f6255acaae7724adc0fd37aac3dae3f3466578/LICENSE).
The full Apache-2.0 terms also accompany dependencies whose upstream notice references them.
The published npm shrinkwrap and cloud lockfile pin transitive resolution; the inventory records
registry integrity and notice hashes. No npm dependency implementation is bundled into our JS.
