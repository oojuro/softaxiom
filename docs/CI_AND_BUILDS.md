# CI and builds

Owner policy, October 22, 2026: use our own build compute; do not run builds on Vercel.
This applies to Soft Axiom, its private cloud services and organization websites. Ahikara
owns CI/CD. Vercel may serve an existing application; this policy concerns build compute.

AI PR reviews use the [free OSS GitHub App policy](AI_CODE_REVIEW.md). They do not require an
Actions workflow, private runner, cloud credential or Vercel build. Provider billing controls
are verified independently of repository review preferences.

## Where work runs

| Work | Compute and credentials |
| --- | --- |
| Trusted private checks and builds | Maintainer-controlled compute, with serial verification limits |
| Public contribution checks | Fresh disposable VM per job, isolated from maintainer hosts and private runners; no service credentials |
| Releases and hosted deployment | Separate trusted job for a reviewed exact commit; narrowly scoped publishing credentials |
| Public documentation | Build static files in CI; publish an artifact to GitHub Pages or the chosen static host |
| A site hosted on Vercel | Build on our runner; upload only the prebuilt output |

Public contribution CI is not implemented. The source preview keeps GitHub Actions disabled
and has no workflows or attached repository runners. Do not attach persistent private runners
to a public repository. Before enabling checks, the CI/CD maintainer must prove disposable VM isolation, including
no host filesystem mounts, Docker socket, private network access, cloud metadata access, service
credentials or shared writable caches. Destroy the VM and its disks after each job. Runner
deregistration alone is not isolation. If that cannot be supplied, choose an approved managed
ephemeral CI service before enabling public checks; do not fall back to private runners.

Use read-only contents permissions for contribution checks, SHA-pinned actions and checkout with
`persist-credentials: false`. Never execute untrusted PR code through `pull_request_target` or a
credential-bearing release job. A fork condition in a PR-editable workflow is not an isolation
boundary. Keep model credentials and paid integration checks in a separate trusted, capped lane.

## Vercel controls

- Keep `git.deploymentEnabled: false` in `vercel.json` at the Vercel project's configured root.
- Set project previews disabled and the ignored build command to `exit 0`, including production
  branches. There is no nightly source-build exception.
- Build locally with `vercel build` for the intended environment, then use
  `vercel deploy --prebuilt`. A missing/failed artifact fails deployment; never retry by uploading
  source or calling a Vercel deploy hook.
- Supply the intended build-time configuration before building. Upload metadata cannot change
  configuration already embedded in the artifact. Verify source commit, environment and artifact
  identity before promotion. Handle build configuration privately; never log its values.
- Scope deployment credentials to the trusted release lane. Project settings do not prevent a
  credential holder from explicitly submitting a source build; release scripts and operator
  instructions must preserve the prebuilt-only rule.

Self-hosted users build and run the assistant themselves. They must not need our Vercel account,
private CI runners or cloud subscription. Runtime extraction and a clean-machine install are
still tracked in the preparation checklist.

## What the reference projects do

Reviewed upstream workflows on October 22, 2026; patterns only, no source copied:

- [OpenClaw CI](https://github.com/openclaw/openclaw/blob/main/.github/workflows/ci.yml)
  (file blob `89bc31671f9572855f862bf37f5622e740dc7cf5`) supports configurable GitHub,
  Blacksmith and RunsOn runner lanes, includes GitHub-hosted fallbacks, restricts some cache
  reuse to trusted jobs, and disables checkout credential persistence. Its configuration is
  substantially more complex than we need; do not treat every upstream job as a security model.
- [Hermes tests](https://github.com/NousResearch/hermes-agent/blob/main/.github/workflows/tests.yml)
  (blob `9a126213c8ba44ad71259e284ad6246da5d43ab8`) use Blacksmith runners and read-only contents
  permissions. Its [site workflow](https://github.com/NousResearch/hermes-agent/blob/main/.github/workflows/deploy-site.yml)
  (blob `92e50b55e3e988fbb14a347a2ce4f0572d34c448`) builds documentation on CI for GitHub Pages,
  but also has a separate Vercel deploy-hook job. That hook does not meet our prebuilt-only rule.
- [GitHub's runner security guidance](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)
  warns against public repositories using persistent self-hosted runners and describes clean
  isolated environments for just-in-time runners.
- Vercel documents [disabling automatic Git deployments](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments)
  and [deploying prebuilt output](https://vercel.com/docs/cli/deploy#prebuilt).
