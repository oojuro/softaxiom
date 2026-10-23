// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import type { ProposedAction } from "./action.ts";
export interface BlindKeys {
  blindKey(personId: string): Promise<Uint8Array>;
}
export type EffectStatus = "prepared" | "dispatched" | "succeeded" | "refused" | "uncertain";
export type Settled = Extract<EffectStatus, "succeeded" | "refused" | "uncertain">;
export interface Approvals {
  approved(personId: string, digest: Uint8Array): Promise<string[]>;
  declined(personId: string, digest: Uint8Array): Promise<boolean>;
  request(
    personId: string,
    runId: string,
    action: ProposedAction,
    digest: Uint8Array,
    replyChannel?: string,
  ): Promise<{ id: string }>;
}
export interface Uses {
  spend(
    personId: string,
    use: {
      sourceOp: string;
      digest: Uint8Array;
      operation: string;
      by: "instruction" | "approval";
      action: ProposedAction;
    },
  ): Promise<boolean>;
}
