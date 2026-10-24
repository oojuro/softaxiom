// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// One engine-selected paid sample. The host supplies a captured request and indexed receipt
// lookup; this port does not assemble context, compact it or decide whether to sample again.

import { assertAnswer } from "../limits.ts";
import { createHmac } from "node:crypto";
import type { PlannedCall, RoundInput, RoundOutcome } from "../../contracts/agent.ts";
import { CodedError } from "../../contracts/codes.ts";
import { PersonId } from "../../contracts/ids.ts";
import type { PaidResult } from "../../money/ports.ts";
import type {
  Json,
  NewLine,
  Placement,
  StoredLine,
  Target,
  TranscriptWriter,
} from "../context/ports.ts";
import type { ModelAnswer } from "../gateway/generate.ts";
import type { ModelRequest } from "../gateway/prompt.ts";

export interface SampleReceipt {
  answer: ModelAnswer;
  calls: PlannedCall[];
}

export type SampleOutcome = Exclude<RoundOutcome, { status: "answered" }> |
  ({ status: "answered" } & SampleReceipt);

export interface SampleDeps {
  failure?(error: unknown): Error;
  receipt(personId: string, operation: string, taskId?: string): Promise<SampleReceipt | undefined>;
  gateway: { call(personId: PersonId, request: ModelRequest): Promise<PaidResult<ModelAnswer>> };
  transcript: TranscriptWriter;
  tools: { readOnly(name: string): boolean | undefined };
  // The person's blind key: calls are fingerprinted with it, so a repeat can be noticed without
  // anyone but the person's own key being able to tell what the call was.
  blindKey(personId: string): Promise<Uint8Array>;
  now?: () => Date;
  typing?: (personId: string, runId: string) => () => void;
  runFunding?(personId: string, runId: string): Promise<"person" | "platform">;
}

// Parsed JSON, so what is written is exactly what a later read returns.
const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null));

export function createSample(deps: SampleDeps) {
  const now = deps.now ?? (() => new Date());

  async function planned(
    personId: string,
    line: Pick<StoredLine, "body" | "op">,
    at: { path: string; lineNo: number },
  ): Promise<PlannedCall> {
    const { id, name, input } = line.body as { id: string; name: string; input: unknown };
    const key = await deps.blindKey(personId);
    const fingerprint = createHmac("sha256", key)
      .update(JSON.stringify([name, input ?? null]))
      .digest("hex")
      .slice(0, 16);
    return {
      id,
      name,
      readOnly: deps.tools.readOnly(name) ?? false,
      fingerprint,
      line: { op: line.op, path: at.path, lineNo: at.lineNo },
    };
  }

  async function write(input: RoundInput, answer: ModelAnswer): Promise<PlannedCall[]> {
    assertAnswer(answer);
    if (answer.engine?.version !== 1) throw new CodedError("invalid_input");
    const base = input.operationId;
    const at = now().toISOString();
    const cutOff = (index: number, invalid?: true) =>
      invalid === true || (answer.finishReason === "length" && index === answer.calls.length - 1);
    const common = {
      at,
      run: input.runId,
      provenance: "agent" as const,
      role: "assistant" as const,
    };
    const lines: NewLine[] = [
      {
        ...common,
        op: `${base}:model`,
        kind: "model",
        body: {
          text: answer.text,
          calls: answer.calls.map(({ id }) => id),
          messages: asJson(answer.messages),
          engine: asJson(answer.engine),
          finishReason: answer.finishReason,
          ...(input.platformFunded && { platformFunded: true }),
        },
      },
      ...answer.calls.map(
        (call, index): NewLine => ({
          ...common,
          op: `${base}:c${index}:call`,
          kind: "tool_call",
          body: {
            id: call.id,
            name: call.name,
            input: asJson(call.input),
            ...(cutOff(index, call.invalid) && { cutOff: true }),
          },
        }),
      ),
    ];
    const target: Target = input.taskId ? { kind: "task", taskId: input.taskId } : { kind: "main" };
    const placed = await deps.transcript.append(input.personId, target, lines);
    return Promise.all(
      answer.calls.map((call, index) =>
        planned(
          input.personId,
          {
            op: `${base}:c${index}:call`,
            body: { id: call.id, name: call.name, input: call.input },
          },
          placed[index + 1] as Placement,
        ),
      ),
    );
  }

  return async function sample(input: RoundInput, request: ModelRequest): Promise<SampleOutcome> {
    let stopTyping: (() => void) | undefined;
    try {
      if (request.operationId !== input.operationId || request.role !== (input.taskId ? "work" : "chat"))
        throw new CodedError("invalid_input");
      const earlier = await deps.receipt(input.personId, input.operationId, input.taskId);
      if (earlier) return { status: "answered", ...earlier };
      const funding = !input.taskId && (await deps.runFunding?.(input.personId, input.runId));
      if (!input.taskId) stopTyping = deps.typing?.(input.personId, input.runId);
      const paid = await deps.gateway.call(PersonId.parse(input.personId), {
        ...request,
        ...(funding === "platform" && { funding }),
        ...(input.platformFunded && { fundedBy: "platform" as const }),
      });
      if (paid.status === "declined") return { status: "declined", reason: paid.reason };
      if (paid.status === "already_settled") return { status: "lost" };
      return { status: "answered", answer: paid.value, calls: await write(input, paid.value) };
    } catch (error) {
      throw (
        deps.failure?.(error) ?? (error instanceof CodedError ? error : new CodedError("internal"))
      );
    } finally {
      stopTyping?.();
    }
  };
}
