// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Own-number calls use the person's actual instruction without a second confirmation.
// Their destination is fixed in code. Model descriptions and schedule keys confer no authority.
import { digestOf, type ProposedAction } from "./action.ts";
import type { AuthorizeDeps } from "./authorize.ts";
import { readConversation } from "./provenance.ts";

export function createOwnCallAuthority(deps: Omit<AuthorizeDeps, "approvals">) {
  return async (personId: string, runId: string, operation: string, timing?: object) => {
    if ((await deps.rootOf(personId, runId)) !== "person") return false;
    const action: ProposedAction = {
      kind: "send",
      target: "your verified phone",
      summary: timing ? "Call your own phone at the requested times" : "Call your own phone now",
      ...(timing && { call: { tool: "schedule_call", input: timing } }),
    };
    // This own-phone policy explicitly does not require a separate spoken readback.
    const messages = (await readConversation(deps.transcript, personId))
      .personMessages(deps.now?.() ?? new Date())
      .map(({ voiceReadback: _, ...message }) => message);
    const verdict = await deps.evaluator.judgeEffect({ personId, operation, action, messages });
    if (verdict.decision !== "allow" || !verdict.message) return false;
    return deps.uses.spend(personId, {
      sourceOp: verdict.message,
      digest: await digestOf(deps.keys, personId, action),
      operation,
      by: "instruction",
      action,
    });
  };
}
