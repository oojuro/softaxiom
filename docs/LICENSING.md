# Core license and public/private boundary

The owner licenses the original Soft Axiom open-source core under **Apache-2.0**. The complete,
unmodified terms are in [LICENSE](../LICENSE). This covers project-authored source, prompts,
documentation, tests and configuration in this repository unless a file states otherwise. Preserve
[NOTICE](../NOTICE). Contributions intentionally submitted for inclusion use the same license.

The repository remains private during preparation; this license decision does not publish it.
The runnable core today is the memory CLI/library, not the complete planned assistant.

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
JavaScript artifact, followed by this licensing/documentation change.

| Included material | Provenance and verified scope |
| --- | --- |
| bin/, lib/, agent-text/ | Original project implementation from the memory feature; Node built-ins and public Oojuro command interfaces, no imported private runtime or third-party source |
| test/ and scripts/ | Original synthetic fixtures and project verification tooling; no user transcripts or downloaded datasets |
| README, docs, contribution/security documents and config | Original project documentation/configuration; external reference links do not bundle their contents |
| LICENSE / NOTICE | Standard Apache-2.0 terms retained unchanged; original project copyright/notice retained |
| npm dependencies, including transitive dependencies | None: package.json declares none; package-lock.json contains the root package only |
| Vendor code, fonts, images, dictionaries, model weights and native binaries | None included in the reviewed source or npm artifact |

The project's copyright/license metadata and original-file SPDX identifiers agree. The artifact
check confirms the legal files are shipped and rejects a changed dependency graph or unexpected
binary payload pending a new review. It does not establish authorship of future submissions:
contributors must have redistribution rights, and maintainers must review provenance.

The separately installed Node, flock and Oojuro programs are listed in
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
