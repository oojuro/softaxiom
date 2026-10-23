// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
export const modelRoles = ["chat", "work", "upkeep", "authority"] as const;
export type ModelRole = (typeof modelRoles)[number];

export interface ModelRoute {
  provider: "anthropic" | "openai" | "fireworks";
  // The provider's own id for the model.
  model: string;
  // How hard it thinks; left out where the model has no such setting.
  effort?: "medium" | "xhigh";
  // The largest request and answer the route accepts. A call's money hold is the price of both, so
  // these are also what one round may cost at most. Estimates until the release owner confirms them
  // in each provider's console.
  maxInputTokens: number;
  maxOutputTokens: number;
}

export const voiceRouterLimits = { maxInputTokens: 8192, maxOutputTokens: 512 } as const;
