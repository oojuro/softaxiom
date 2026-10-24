# AI review for public contributions

Maintainer policy: use **CodeRabbit's free open-source GitHub App reviews** for this public
Apache-2.0 repository. Paid Greptile reviews are not authorized for this repository. Do not
invoke a paid reviewer from a local CLI, an agent loop, a GitHub workflow or a PR comment.

The proposed `.coderabbit.yaml` controls review behavior. It does not install the App, choose
an account plan, disable billing, limit spending or prove that these settings are active.
`enable_free_tier: true` is a fallback feature preference, not an OSS-plan or payment control.

## Provider controls required before reviews

An organization administrator must verify these in the authenticated provider dashboards:

- CodeRabbit's GitHub App has access only to this public repository, with OSS review coverage.
  A generic Free plan or time-limited paid trial is not proof of OSS classification.
- Paid usage-based file reviews are off, and **After included review limits** is **Off**.
  On demand is not off: an assigned-seat user can explicitly authorize an overage.
- Automatic credit refill/purchases, any recurring credit subscription, paid coding agents,
  Deep Scan/security on-demand products and other paid add-ons are disabled or unavailable.
  Do not add a payment method or activate a paid subscription for this repository.
- There are no saved private MCP/API connections or private linked-repository review scopes
  accessible to public reviews. App repository selection and connection scopes enforce this;
  the YAML's disabled integrations are only additional behavior preferences.
- Paid Greptile GitHub App access excludes this repository. Keep the intended private
  repositories selected and enabled; do not suspend or uninstall the whole organization App.

Record the repository/organization, plan classification, controls and verification date before
claiming a zero-charge setup. If a control is unavailable on OSS, record why it cannot be enabled
rather than guessing its value. If the provider cannot enforce a no-paid-usage boundary for a
mixed organization, leave this repository disconnected until the provider supplies one.

## Contributor triggers and the spending boundary

Opening/updating PRs, pushes, configured labels or description keywords, and manual review
comments can produce reviews. Repository configuration can alter those review preferences.
An external contributor can propose configuration changes; their PR is outside content.
No PR-editable file, label, prompt, title filter, permission reminder or review-count limit is
a hard spending boundary. Even disabling incremental reviews is only a noise/volume preference.

Under verified OSS coverage with all paid paths disabled, those triggers may consume the
provider's free allowance and rate-limit reviews. They must not purchase credits or create paid
usage. Until account controls are verified, **do not claim outsiders cannot cause charges**.
Admins must reverify them after plan/provider changes. Never use `--use-credits`, a paid-review
checkbox or an agent/scan command to get around a free review limit.

The YAML restricts non-member comment chat but does not exclude external authors from automatic
PR review eligibility. That preference is not a billing authorization boundary either.

## Review workflow

CodeRabbit currently requires manual review triggers for public repositories with fewer than
10 stars. When that applies, a maintainer requests an ordinary included full review after the
provider checks above. Do not use a paid continuation command when rate-limited.

Enable review status/configuration information so a reviewer can inspect the actual reviewed
commit and skipped files. A summary, skipped/rate-limited notice or pending check is not a completed
code review. Retain a link to the completed review and compare its reviewed SHA with the PR head.
Human maintainers decide whether to merge; automatic approval and generated repair features are
disabled in the proposed behavior configuration.

Use the GitHub App, not a credential-bearing Actions wrapper. Public Actions remain disabled
pending the isolated-runner gate in [CI_AND_BUILDS.md](CI_AND_BUILDS.md). Do not attach private
persistent runners, expose cloud credentials or add Vercel build compute for AI review.

## Current setup status

This document is an intended policy and installation checklist, not a completed account audit.
At preparation time CodeRabbit was not installed for the organization. Authenticated provider
setup, billing verification and an actual code-review receipt are still required; track the
configuration PR and the release issue for current evidence.

## Provider references

Checked October 23, 2026; provider terms can change:

- [Plans and OSS eligibility](https://docs.coderabbit.ai/management/plans): public OSS projects
  receive review features without a paid subscription, with a separate rate limit.
- [Usage-based reviews](https://docs.coderabbit.ai/management/usage-based-addon): account-level
  paid activation, continuation modes and spending caps; trial continuation choices can persist.
- [On-demand credits and refill controls](https://kb.coderabbit.ai/articles/9396519445-on-demand-reviews-your-free-period-and-what-happens-next).
- [GitHub setup and permissions](https://docs.coderabbit.ai/platforms/github-com): the App requests
  repository write permissions, including workflow writes; select only the intended public repo.
- [Configuration reference](https://docs.coderabbit.ai/reference/configuration) and
  [review commands](https://docs.coderabbit.ai/reference/review-commands).
