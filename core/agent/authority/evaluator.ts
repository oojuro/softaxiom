// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// The independent check. A separate model call on its own role, with its own prompt
// (agent-text/AUTHORITY.md), shown only the effect and the person's own messages: never a page, a
// mail, a tool's output or a work report, and nothing of the conversation around them. It answers
// through one tool. A check that fails, is declined, answers oddly or names a message it was not
// shown is no decision, which asks the person and never allows.
import { operationId, PersonId } from "../../contracts/ids.ts";
import type { PaidResult } from "../../money/ports.ts";
import { codeOf, report } from "../../telemetry/report.ts";
import { z } from "zod";
import type { ModelAnswer } from "../gateway/generate.ts";
import type { ModelRequest, ToolDefinition } from "../gateway/prompt.ts";
import { readPrompt } from "../harness/prompts.ts";
import { type ProposedAction, viewOf } from "./action.ts";
import type { PersonMessage } from "./provenance.ts";
import type { Judgement } from "./requirement.ts";

export interface EvaluatorDeps {
  prompt?: typeof readPrompt;
  gateway: { call(personId: PersonId, request: ModelRequest): Promise<PaidResult<ModelAnswer>> };
  registry: { definitions(role: "authority"): ToolDefinition[] };
}

export interface Verdict {
  decision: Judgement;
  // The person's message that settles it.
  message?: string;
}

const decide = z.object({
  decision: z.enum(["allow", "deny", "ambiguous"]),
  message: z.string().optional(),
});

const ambiguous: Verdict = { decision: "ambiguous" };

function interpret(paid: PaidResult<ModelAnswer>, shown: string[]): Verdict {
  if (paid.status !== "settled") {
    report("authority", "judge", "blocked");
    return ambiguous;
  }
  const call = paid.value.calls.find(({ name, invalid }) => name === "decide" && !invalid);
  const answer = decide.safeParse(call?.input);
  if (!answer.success) return ambiguous;
  const { decision, message } = answer.data;
  // An id the check was not given is not a message of the person's.
  if (decision === "allow" && !(message && shown.includes(message))) return ambiguous;
  return { decision, ...(message && { message }) };
}

export function createEvaluator(deps: EvaluatorDeps) {
  async function judge(personId: string, operation: string, input: object, shown: string[]) {
    const request: ModelRequest = {
      operationId: operationId("authority", operation),
      role: "authority",
      system: (deps.prompt ?? readPrompt)("AUTHORITY"),
      tools: deps.registry.definitions("authority"),
      history: [{ role: "user", content: JSON.stringify(input) }],
    };
    try {
      const person = PersonId.parse(personId);
      let paid = await deps.gateway.call(person, request);
      // An answer paid for before a crash and then lost is asked for again at the platform's cost.
      if (paid.status === "already_settled") {
        paid = await deps.gateway.call(person, {
          ...request,
          operationId: operationId(request.operationId, "platform"),
          fundedBy: "platform",
        });
      }
      return interpret(paid, shown);
    } catch (error) {
      report("authority", "judge", "failed", codeOf(error));
      return ambiguous;
    }
  }

  return {
    /** Do the person's own messages ask for this effect? */
    async judgeEffect(input: {
      personId: string;
      operation: string;
      action: ProposedAction;
      messages: PersonMessage[];
    }): Promise<Verdict> {
      const { personId, operation, action, messages } = input;
      // Nothing they wrote recently: there is nothing to read, and nothing to pay a model for.
      if (messages.length === 0) return ambiguous;
      const view = { effect: viewOf(action), messages };
      return judge(
        personId,
        operation,
        view,
        messages.map(({ id }) => id),
      );
    },

    /** Is this message a clear yes or no to the request Soft Axiom sent them? */
    async judgeAnswer(input: {
      personId: string;
      operation: string;
      action: ProposedAction;
      sent: string;
      // The agent's last message before the reply, when it was not the ask: untrusted context.
      replyingTo?: string;
      reply: PersonMessage;
      voiceConfirmation?: true;
    }): Promise<Verdict> {
      const { personId, operation, action, sent, replyingTo, reply, voiceConfirmation } = input;
      const view = {
        request: { ...viewOf(action), sent },
        ...(voiceConfirmation && { voiceConfirmation }),
        ...(replyingTo !== undefined && replyingTo !== sent && { replyingTo }),
        reply: { id: reply.id, text: reply.text },
      };
      return judge(personId, operation, view, [reply.id]);
    },
  };
}
