// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// What the tool runtime asks before it runs a tool that declares an effect (a send, a payment, a
// deletion): whether code finds the person's own word covers this call, and then that the effect
// starts at most once. The call is described from the tool's declared kind and its validated
// input; nothing the model says about who asked for it is read. A runtime with no gate refuses such
// a tool: it is unavailable, never ungated.
import type { EffectKind } from "../../contracts/canvas.ts";
import type { ErrorCode } from "../../contracts/codes.ts";
import type { ProposedAction } from "../authority/action.ts";
import type { Authorized, EffectCall } from "../authority/authorize.ts";
import type { EffectStatus, Settled } from "../authority/ports.ts";
import { prefix } from "../context/clip.ts";
import type { Json } from "../context/ports.ts";
import type { Tool } from "./registry.ts";

export interface EffectGate {
  authorize(call: EffectCall): Promise<Authorized>;
  effects: {
    begin(personId: string, operation: string, action: ProposedAction): Promise<EffectStatus>;
    dispatch(personId: string, operation: string): Promise<boolean>;
    settle(personId: string, operation: string, status: Settled): Promise<void>;
  };
}

export type Admission =
  | { run: true; settle(status: Settled): Promise<void> }
  | { run: false; result: Json; code?: ErrorCode };

const summaryChars = 500;

const actionOf = (tool: Tool, input: unknown): ProposedAction => ({
  kind: tool.effect as EffectKind,
  target: tool.name,
  summary: prefix(JSON.stringify(input) ?? "", summaryChars),
  call: { tool: tool.name, input },
});

export async function admit(
  gate: EffectGate | undefined,
  tool: Tool,
  input: unknown,
  who: { personId: string; runId: string; operation: string; replyChannel: string },
): Promise<Admission> {
  if (!gate) return { run: false, result: { error: "unavailable" }, code: "unavailable" };
  const { personId, operation } = who;
  const action = actionOf(tool, input);
  const verdict = await gate.authorize({ ...who, action });
  if (verdict.status === "denied") return { run: false, result: { status: "denied" } };
  if (verdict.status === "needs_approval") {
    return { run: false, result: { status: "needs_approval", approval: verdict.approval } };
  }
  const state = await gate.effects.begin(personId, operation, action);
  // Started before, so it may have happened: it is not started again.
  if (state !== "prepared" || !(await gate.effects.dispatch(personId, operation))) {
    return { run: false, result: { error: "outcome_unknown" }, code: "outcome_unknown" };
  }
  return { run: true, settle: (status) => gate.effects.settle(personId, operation, status) };
}
