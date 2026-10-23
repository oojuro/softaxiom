// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Who may let an effect (a send, a payment, a deletion) go ahead. Only the person's own words
// authorize one, and only a check of those words against this very effect says whether they do.
// What Soft Axiom started on its own (a schedule, a finding, a helper's idea) asks once. A check
// that could not be made never allows: the person is asked.

/** Where the chain of runs behind an effect began. */
export type Root = "person" | "automation" | "agent";
/** What an independent check made of the person's words against one effect. */
export type Judgement = "allow" | "deny" | "ambiguous";
export type Requirement = "allow" | "ask" | "deny";

export function requirement(root: Root, judgement: Judgement | undefined): Requirement {
  if (root !== "person") return "ask";
  if (judgement === "allow") return "allow";
  return judgement === "deny" ? "deny" : "ask";
}

const textChannels = new Set(["imessage", "rcs", "sms", "whatsapp"]);

/** A call's yes is read back and decided on the call itself, and the page decides by its buttons. */
export const answersByText = (channel: string | undefined): boolean =>
  channel !== undefined && textChannels.has(channel);
