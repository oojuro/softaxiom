// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// One model round as an activity. It builds the context, asks the gateway once, and writes the
// answer to the transcript itself (the model's message and one line per tool call, each under an
// op derived from the round's operation id). What goes back to the workflow is ids and placements:
// never the words, so nothing a person said is ever in Temporal's history.

import { assertAnswer } from "../limits.ts";
import { createHmac } from "node:crypto";
import type { PlannedCall, RoundInput, RoundOutcome } from "../../contracts/agent.ts";
import { CodedError } from "../../contracts/codes.ts";
import { OperationId, PersonId } from "../../contracts/ids.ts";
import type { PaidResult } from "../../money/ports.ts";
import type { AssembleInput } from "../context/assemble.ts";
import type {
  Json,
  NewLine,
  Placement,
  StoredLine,
  Target,
  TranscriptReader,
  TranscriptWriter,
} from "../context/ports.ts";
import { taskPath } from "../context/tail.ts";
import type { ModelAnswer } from "../gateway/generate.ts";
import type { ModelRequest } from "../gateway/prompt.ts";

export interface ModelRoundDeps {
  failure?(error: unknown): Error;
  assembler: { assemble(input: AssembleInput): Promise<ModelRequest> };
  gateway: { call(personId: PersonId, request: ModelRequest): Promise<PaidResult<ModelAnswer>> };
  transcript: TranscriptReader & TranscriptWriter;
  tools: { readOnly(name: string): boolean | undefined };
  // The person's blind key: calls are fingerprinted with it, so a repeat can be noticed without
  // anyone but the person's own key being able to tell what the call was.
  blindKey(personId: string): Promise<Uint8Array>;
  now?: () => Date;
  typing?: (personId: string, runId: string) => () => void;
  runFunding?(personId: string, runId: string): Promise<"person" | "platform">;
}

/** Lines at the end of the newest day file searched for a round that was already written. */
const lookback = 200;
const mainFile = /^conversations\/\d{4}-\d{2}-\d{2}\.jsonl$/;

// Parsed JSON, so what is written is exactly what a later read returns.
const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null));

export function createModelRound(deps: ModelRoundDeps) {
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

  // A worker that died after writing the answer but before replying finds it here and does not ask,
  // or pay, again.
  async function writtenAnswer(
    personId: string,
    base: string,
    taskId?: string,
  ): Promise<PlannedCall[] | undefined> {
    const files = await deps.transcript.list(personId);
    const newest = taskId
      ? files.find(({ path }) => path === taskPath(taskId))
      : files
          .filter(({ path }) => mainFile.test(path))
          .sort((a, b) => a.path.localeCompare(b.path))
          .at(-1);
    if (!newest) return undefined;
    const lines = await deps.transcript.read(personId, newest.path, {
      from: Math.max(1, newest.lineCount - lookback),
    });
    if (!lines.some(({ op }) => op === `${base}:model`)) return undefined;
    const calls = lines.filter(
      ({ kind, op }) => kind === "tool_call" && op.startsWith(`${base}:c`) && op.endsWith(":call"),
    );
    return Promise.all(
      calls.map((line) => planned(personId, line, { path: newest.path, lineNo: line.seq })),
    );
  }

  async function write(input: RoundInput, answer: ModelAnswer): Promise<PlannedCall[]> {
    assertAnswer(answer);
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

  return async function modelRound(input: RoundInput): Promise<RoundOutcome> {
    let stopTyping: (() => void) | undefined;
    try {
      const earlier = await writtenAnswer(input.personId, input.operationId, input.taskId);
      if (earlier) return { status: "answered", calls: earlier };
      const funding = !input.taskId && (await deps.runFunding?.(input.personId, input.runId));
      const assembleInput: AssembleInput = {
        personId: input.personId,
        runId: input.runId,
        operationId: OperationId.parse(input.operationId),
        // A work task is asked as work, from its own transcript.
        role: input.taskId ? "work" : "chat",
        replyChannel: input.replyChannel,
        ...(input.taskId && { taskId: input.taskId }),
        ...((input.platformFunded || funding === "platform") && { platformFunded: true }),
      };
      const call = async (compact?: true) => {
        const request = await deps.assembler.assemble({
          ...assembleInput,
          ...(compact && { compact }),
        });
        return deps.gateway.call(PersonId.parse(input.personId), {
          ...request,
          ...(funding === "platform" && { funding }),
          ...(input.platformFunded && { fundedBy: "platform" as const }),
        });
      };
      if (!input.taskId) stopTyping = deps.typing?.(input.personId, input.runId);
      const paid = await call().catch((error: unknown) => {
        // This typed boundary rejects before paid admission or provider dispatch; the same op is safe.
        if (!(error instanceof CodedError) || error.code !== "context_overflow") throw error;
        return call(true);
      });
      if (paid.status === "declined") return { status: "declined", reason: paid.reason };
      if (paid.status === "already_settled") return { status: "lost" };
      return { status: "answered", calls: await write(input, paid.value) };
    } catch (error) {
      throw (
        deps.failure?.(error) ?? (error instanceof CodedError ? error : new CodedError("internal"))
      );
    } finally {
      stopTyping?.();
    }
  };
}
