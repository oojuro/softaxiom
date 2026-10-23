// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// May this effect run now? Three things can say yes, in this order: a yes the person gave to
// exactly this action (spent once), or their own words, checked independently against this very
// effect (spent once), or nothing, and then the person is asked. A no they gave to exactly this
// stops it. What decides is found by code: who started the work from the records of the runs,
// what the person said from their lines in the transcript. What the agent says about itself, in a
// tool's input or anywhere else, is never read for it.

import type { TranscriptReader } from "../context/ports.ts";
import type { BlindKeys } from "./ports.ts";
import type { Root } from "./requirement.ts";
import { digestOf, type ProposedAction } from "./action.ts";
import type { Approvals } from "./ports.ts";
import type { createEvaluator } from "./evaluator.ts";
import { readConversation } from "./provenance.ts";
import { requirement } from "./requirement.ts";
import type { Uses } from "./ports.ts";

/** One effect a run is about to have; `operation` names the call, so a retry is the same call. */
export interface EffectCall {
  personId: string;
  runId: string;
  operation: string;
  action: ProposedAction;
  // Where the run answers the person, which is where an ask about this effect is texted.
  replyChannel?: string;
  // Server policy can require a fresh approval even when the original instruction is explicit.
  requireApproval?: boolean;
}

export type Authorized =
  | { status: "allowed"; by: "instruction" | "approval" }
  | { status: "needs_approval"; approval: string }
  | { status: "denied" };

export interface AuthorizeDeps {
  keys: BlindKeys;
  rootOf(personId: string, runId: string): Promise<Root>;
  transcript: TranscriptReader;
  approvals: Approvals;
  uses: Uses;
  evaluator: ReturnType<typeof createEvaluator>;
  now?: () => Date;
}

export function createAuthorize(deps: AuthorizeDeps) {
  const now = deps.now ?? (() => new Date());

  // Their own words, when this work is the person's and the check finds they cover the effect.
  async function byInstruction(
    call: EffectCall,
    digest: Uint8Array,
  ): Promise<Authorized | undefined> {
    const { personId, runId, operation, action } = call;
    const root = await deps.rootOf(personId, runId);
    if (root !== "person") return undefined;
    const messages = (await readConversation(deps.transcript, personId)).personMessages(now());
    const verdict = await deps.evaluator.judgeEffect({ personId, operation, action, messages });
    const needed = requirement(root, verdict.decision);
    if (needed === "deny") return { status: "denied" };
    if (needed === "ask" || verdict.message === undefined) return undefined;
    const source = messages.find(({ id }) => id === verdict.message);
    if (source?.voiceReadback !== undefined) {
      if (!source.voiceReadback) return undefined;
      const confirmed = await deps.evaluator.judgeAnswer({
        personId,
        operation: `${operation}:voice-confirmation`,
        action,
        sent: source.voiceReadback,
        reply: source,
        voiceConfirmation: true,
      });
      if (confirmed.decision === "deny") return { status: "denied" };
      if (confirmed.decision !== "allow" || confirmed.message !== source.id) return undefined;
    }
    const spent = await deps.uses.spend(personId, {
      sourceOp: verdict.message,
      digest,
      operation,
      by: "instruction",
      action,
    });
    return spent ? { status: "allowed", by: "instruction" } : undefined;
  }

  async function byApproval(call: EffectCall, digest: Uint8Array): Promise<Authorized | undefined> {
    const { personId, operation, action } = call;
    for (const approval of await deps.approvals.approved(personId, digest)) {
      const spent = await deps.uses.spend(personId, {
        sourceOp: `approval:${approval}`,
        digest,
        operation,
        by: "approval",
        action,
      });
      if (spent) return { status: "allowed", by: "approval" };
    }
    return undefined;
  }

  return async function authorize(call: EffectCall): Promise<Authorized> {
    const { personId, runId, action, replyChannel } = call;
    const digest = await digestOf(deps.keys, personId, action);
    const yes = await byApproval(call, digest);
    if (yes) return yes;
    if (await deps.approvals.declined(personId, digest)) return { status: "denied" };
    const words = call.requireApproval ? undefined : await byInstruction(call, digest);
    if (words) return words;
    const asked = await deps.approvals.request(personId, runId, action, digest, replyChannel);
    return { status: "needs_approval", approval: asked.id };
  };
}
