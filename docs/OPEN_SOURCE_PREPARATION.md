# Open-source preparation

Owner decisions, October 22, 2026: prepare the complete self-hosted assistant, use Apache-2.0,
and require owner approval for publication. The owner authorized the current source preview on
October 23, 2026. This is the full product target boundary; it does
not claim the source extraction or self-hosting work is complete.

## Repository responsibilities

The current local/cloud/device design and CLI names are defined in [PRODUCT.md](PRODUCT.md)
and [CLI.md](CLI.md), including capabilities that are still unavailable in the source preview.

The precise license scope, redistribution inventory and contribution requirements are in
[LICENSING.md](LICENSING.md); preserve [third-party notices](../THIRD_PARTY_NOTICES.md).

| Area | Soft Axiom open-source repository | Private cloud repository |
| --- | --- | --- |
| Agent | Runtime, model adapters, prompts, skills, tool loop and recovery | Managed provisioning and fleet operations |
| User experience | Personal web UI, files, results, settings and approvals | Hosted account administration and commercial onboarding |
| Execution | Generic terminal/browser interfaces and supported adapters | Our provider accounts, fleet policy and service credentials |
| State | Portable schema, encrypted storage, memory and retrieval interfaces | Hosted deployment targets, customer records and operational data |
| Safety and money | Permission checks, isolation, idempotency and configurable spend bounds | Subscription billing, commercial entitlements and customer payment operations |
| Distribution | Self-host setup, configuration, examples and generic tests | Production/staging infrastructure, rollout and account migration operations |

Security invariants remain in the shared assistant. Self-hosting must not require a cloud
subscription or disable safeguards. Supported third-party services may require the operator's
own credentials; document each required dependency honestly.

## Extraction approach

1. Select a reviewed source revision and record provenance privately. Start a fresh public-facing
   history; do not import the private repository's old commits, branches, issues or release data.
2. Map imports before moving code. Existing contracts, policy, agent text and runtime are candidates;
   persistence, channel, workflow, money and web areas mix shared and hosted responsibilities.
   A directory name alone is not approval to export its contents.
3. Extract the smallest runnable vertical slice with its dependencies and regression tests. Keep
   user authorization, tenant isolation, encryption, durable execution and spend controls intact.
4. Supply self-host configuration and explicit credentials/dependency documentation. Replace
   company-specific targets and account assumptions with operator configuration.
5. Make the cloud consume a pinned version of the shared packages. Shared fixes go upstream here;
   avoid a permanent copied runtime or an automatic mirror of the private repository.

The accepted October 23 architecture supersedes the reference-only rule: fork the immutable OpenClaw engine under its MIT license, retain its Pi/Hermes notices and keep original additions Apache-2.0. See OPENCLAW.md for source selection and updates.

## Implemented source-preview capabilities

The core now includes local installed-browser control and Radar's durable event inbox, scoped
background worker and approval/recovery flow. It has no E2B/Kernel SDK, hosted browser requirement
or mandatory cloud scheduler. See LOCAL_BROWSER.md, RADAR.md and LOCAL_VERIFICATION.md. The portable context/model/tool/authority/harness runtime is now extracted and consumed by the
cloud through host ports; [SHARED_CORE.md](SHARED_CORE.md) defines the boundary. Arbitrary code
execution, local messaging adapters and a complete local personal web UI remain separate work.

## Before a complete assistant release

- [x] Create the preparation repository privately and select Apache-2.0.
- [x] Record the complete self-hosted product scope and cloud boundary.
- [ ] Extract a runnable assistant and retain meaningful regression tests.
- [ ] Document supported local/self-host dependencies, model configuration, backup and recovery.
- [ ] Demonstrate a clean-machine install and a real model/tool journey without our cloud account.
- [ ] Review every exported file and Git revision for credentials, customer content, private
      reports, account/project identifiers, employee details and internal operating instructions.
- [ ] Review direct/transitive dependencies, bundled assets, copied code and required notices.
      Apache-2.0 on this repository does not relicense third-party material.
      The current core source/package with reviewed dependencies is inventoried in LICENSING.md; native
      bundles/images and future extracted/imported code require their own exact-artifact review.
- [ ] Verify private billing, tenant provisioning, support operations, deployment credentials,
      account migration tools and internal infrastructure were not exported.
- [ ] Enable an actual private vulnerability-reporting channel and document release support.
- [ ] Configure isolated contribution checks and release artifacts. Untrusted public PRs must not
      execute on credential-bearing production or staging runners.
      Follow [CI and build policy](CI_AND_BUILDS.md); no Vercel source builds or deploy hooks.
      The initial source preview keeps GitHub Actions disabled until isolated checks are ready.
- [x] Extract shared runtime owners and wire the cloud through pinned imports and compatibility checks.
- [ ] Obtain the owner's publication review, then explicitly change visibility to public.

No source mirror, package publication, hosted deployment or automatic visibility change is
enabled by this preview. Public source does not imply native releases or cloud promotion.
