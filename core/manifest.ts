// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
export const sharedFiles = [
  {
    cloud: "packages/contracts/src/cloud.ts",
    core: "contracts/cloud.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/context/assemble.ts",
    core: "agent/context/assemble.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/context/clip.ts",
    core: "agent/context/clip.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/context/compact.ts",
    core: "agent/context/compact.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/context/outside.ts",
    core: "agent/context/outside.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/context/ports.ts",
    core: "agent/context/ports.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/context/tail.ts",
    core: "agent/context/tail.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/context/view.ts",
    core: "agent/context/view.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/harness/prompts.ts",
    core: "agent/harness/prompts.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/harness/secrets.ts",
    core: "agent/harness/secrets.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/harness/skills.ts",
    core: "agent/harness/skills.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/timeline/ask.ts",
    core: "agent/timeline/ask.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/timeline/block.ts",
    core: "agent/timeline/block.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/timeline/certainty.ts",
    core: "agent/timeline/certainty.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/timeline/load.ts",
    core: "agent/timeline/load.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/timeline/records.ts",
    core: "agent/timeline/records.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/timeline/rules.ts",
    core: "agent/timeline/rules.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/gateway/input-bound.ts",
    core: "agent/gateway/input-bound.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/gateway/prompt.ts",
    core: "agent/gateway/prompt.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/gateway/generate.ts",
    core: "agent/gateway/generate.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/gateway/providers.ts",
    core: "agent/gateway/providers.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/authority/action.ts",
    core: "agent/authority/action.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/authority/requirement.ts",
    core: "agent/authority/requirement.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/authority/evaluator.ts",
    core: "agent/authority/evaluator.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/authority/authorize.ts",
    core: "agent/authority/authorize.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/authority/own-call.ts",
    core: "agent/authority/own-call.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/tools/registry.ts",
    core: "agent/tools/registry.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/tools/effect-gate.ts",
    core: "agent/tools/effect-gate.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/tools/runtime.ts",
    core: "agent/tools/runtime.ts",
    adapter: true,
  },
  {
    cloud: "packages/agent/src/tools/learning-facts.ts",
    core: "agent/tools/learning-facts.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/tools/builtin.ts",
    core: "agent/tools/builtin.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/tools/bridge.ts",
    core: "agent/tools/bridge.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/tools/connect.ts",
    core: "agent/tools/connect.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/runs/model-round.ts",
    core: "agent/runs/model-round.ts",
    adapter: true,
  },
  {
    cloud: "packages/contracts/src/agent.ts",
    core: "contracts/agent.ts",
    adapter: false,
  },
  {
    cloud: "packages/contracts/src/canvas.ts",
    core: "contracts/canvas.ts",
    adapter: false,
  },
  {
    cloud: "packages/contracts/src/codes.ts",
    core: "contracts/codes.ts",
    adapter: false,
  },
  {
    cloud: "packages/contracts/src/envelope.ts",
    core: "contracts/envelope.ts",
    adapter: false,
  },
  {
    cloud: "packages/contracts/src/ids.ts",
    core: "contracts/ids.ts",
    adapter: false,
  },
  {
    cloud: "packages/contracts/src/time.ts",
    core: "contracts/time.ts",
    adapter: false,
  },
  {
    cloud: "packages/policy/src/clock.ts",
    core: "policy/clock.ts",
    adapter: false,
  },
  {
    cloud: "packages/policy/src/quiet.ts",
    core: "policy/quiet.ts",
    adapter: false,
  },
  {
    cloud: "packages/policy/src/recurrence.ts",
    core: "policy/recurrence.ts",
    adapter: false,
  },
  {
    cloud: "packages/policy/src/occurrence.ts",
    core: "policy/occurrence.ts",
    adapter: false,
  },
  {
    cloud: "packages/telemetry/src/correlation.ts",
    core: "telemetry/correlation.ts",
    adapter: false,
  },
  {
    cloud: "packages/agent/src/authority/provenance.ts",
    core: "agent/authority/provenance.ts",
    adapter: true,
  },
] as const;
