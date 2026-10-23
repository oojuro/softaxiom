// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// One effect an agent is about to have in the world, described so that the person can say yes to
// it as written and code can tell a changed one from the same one. Whatever the agent writes in
// it is words only: who started the work and what the person said are found by code, elsewhere.
import { effectKinds } from "../../contracts/canvas.ts";
import { microsPerDollar } from "../../contracts/money.ts";
import { canonical } from "../../contracts/canonical.ts";
import { createHmac } from "node:crypto";
import type { BlindKeys } from "./ports.ts";
import { z } from "zod";

export const ProposedAction = z.strictObject({
  kind: z.enum(effectKinds),
  // Who or what it reaches, and what will happen, in words the person reads on a card.
  target: z.string().min(1).max(200),
  summary: z.string().min(1).max(500),
  amountMicros: z.int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  // The call itself when a tool that declares its effect made it, so its exact input is bound.
  call: z.object({ tool: z.string(), input: z.unknown() }).optional(),
});
export type ProposedAction = z.infer<typeof ProposedAction>;

/** The action's fingerprint. Keyed by the person's own key, so it says nothing of the content. */
export async function digestOf(
  keys: BlindKeys,
  personId: string,
  action: ProposedAction,
): Promise<Uint8Array> {
  return new Uint8Array(
    createHmac("sha256", await keys.blindKey(personId))
      .update(JSON.stringify(["authority:action", canonical(action)]))
      .digest(),
  );
}

export const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/** What the independent check is shown of the effect: the facts, in dollars, and nothing else. */
export const viewOf = ({ kind, target, summary, amountMicros, call }: ProposedAction) => ({
  kind,
  target,
  summary,
  ...(amountMicros !== undefined && { amountUsd: amountMicros / microsPerDollar }),
  ...(call && { call }),
});
