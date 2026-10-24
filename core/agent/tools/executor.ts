// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Executes one engine-selected tool call and records what happened. The calls are already in the transcript
// (the model round wrote them first), so the input is read from there and never passed through the
// workflow. A cut-off, unknown or invalid call never runs. OpenClaw owns sequencing and
// concurrency; this adapter owns authorization, effects and durable result receipts.
import { assertCalls } from "../limits.ts";
import type { PlannedCall, RunOutcome, ToolsInput, ToolsOutcome } from "../../contracts/agent.ts";
import { CodedError, type ErrorCode } from "../../contracts/codes.ts";
import { currentCorrelation } from "../../telemetry/correlation.ts";
import { report } from "../../telemetry/report.ts";
import type {
  Channel,
  Json,
  NewLine,
  Placement,
  StoredLine,
  Target,
  TranscriptReader,
  TranscriptWriter,
} from "../context/ports.ts";

import { type Admission, admit, type EffectGate } from "./effect-gate.ts";
import { learningFacts } from "./learning-facts.ts";
import type { Registry, Tool } from "./registry.ts";

export interface ToolInput extends Omit<ToolsInput, "calls"> {
  call: PlannedCall;
  signal?: AbortSignal;
}

export interface ToolContext<Commit = never> {
  personId: string;
  runId: string;
  round: number;
  signal?: AbortSignal;
  replyChannel: string;
  // Set when the call is a work task's: the task whose transcript holds it.
  taskId?: string;
  // The call's id and the op of its `tool_call` line, which effects and deliveries refer to.
  call: { id: string; op: string };
  // Adds a reply to the conversation and says where it went. The transcript's one writer for
  // this run is the activity, so a tool never writes a line any other way. `parts` are the
  // separate texts a delivery sends; without them the whole text is one.
  say(channel: Channel, text: string, parts?: string[], commit?: Commit): Promise<Placement>;
}

export interface ToolResult {
  result: Json;
  finish?: { outcome: RunOutcome };
}

export type Handler<Commit = never> = (
  input: unknown,
  context: ToolContext<Commit>,
) => Promise<ToolResult>;

export interface RuntimeDeps<Commit = never> {
  failure?(error: unknown): Error;
  registry: Registry;
  handlers: Record<string, Handler<Commit>>;
  transcript: TranscriptReader & TranscriptWriter<Commit>;
  // Decides the calls of tools that declare an effect. Without one such a tool is unavailable.
  gate?: EffectGate;
  now?: () => Date;
}

interface StoredCall {
  id: string;
  name: string;
  input: unknown;
  cutOff?: boolean;
}

interface Done {
  result: Json;
  finish?: RunOutcome;
  said: number;
}

const baseOf = (call: PlannedCall) => call.line.op.replace(/:call$/, "");
// An outcome we cannot know is uncertain, never failed: it may have happened.
const failed = (result: Json, code: ErrorCode, said = 0): Done => {
  report("agent", "tool_call", code === "outcome_unknown" ? "uncertain" : "failed", code);
  return { result, said };
};
// A work task writes its own file; a chat run writes the conversation.
const targetOf = ({ taskId }: Pick<ToolInput, "taskId">): Target =>
  taskId ? { kind: "task", taskId } : { kind: "main" };

export function createToolExecutor<Commit = never>(deps: RuntimeDeps<Commit>) {
  const now = deps.now ?? (() => new Date());

  // What the transcript already holds of these calls: a result line is a receipt.
  async function receipts(input: ToolInput) {
    const { path, lineNo } = input.call.line;
    const found = new Map<string, StoredLine>();
    for (const line of await deps.transcript.read(input.personId, path, {
      from: Math.max(1, lineNo - 200),
    })) found.set(line.op, line);
    return found;
  }

  async function execute(
    input: ToolInput,
    planned: PlannedCall,
    call: StoredCall,
    started: { has(op: string): boolean },
    signal?: AbortSignal,
  ): Promise<Done> {
    const tool = deps.registry.get(call.name);
    const handler = deps.handlers[call.name];
    // A run is offered the tools made for its role, and a call to any other is refused here
    // whatever the model made up: a work agent has no `message`, a chat agent no `terminal`.
    if (!tool?.roles.includes(input.taskId ? "work" : "chat")) {
      return failed({ error: "unknown_tool" }, "invalid_input");
    }
    // A call the answer was cut off in the middle of may have lost its tail: it is never run.
    if (call.cutOff) return failed({ error: "cut_off" }, "invalid_input");
    try {
      assertCalls([{ id: call.id, name: call.name, input: call.input }]);
    } catch {
      return failed({ error: "invalid_input" }, "invalid_input");
    }
    const checked = tool.check(call.input);
    if (!checked.ok)
      return failed({ error: "invalid_input", issues: checked.issues }, "invalid_input");
    if (!handler) return failed({ error: "unavailable" }, "unavailable");

    // An effect leaves a mark before it runs. A mark with no result means an earlier run of this
    // batch died somewhere in the call: it is not run again (a terminal command, a send, a payment
    // may already have happened), and the model is told the outcome is unknown.
    const base = baseOf(planned);
    let admission: Admission | undefined;
    if (!tool.readOnly) {
      if (started.has(`${base}:started`))
        return failed({ error: "outcome_unknown" }, "outcome_unknown");
      // A tool that declares an effect runs only when code finds the person's own word covers it;
      // otherwise the model is told what happened instead (asked, or denied), and nothing starts.
      admission = tool.effect
        ? await admit(deps.gate, tool, checked.value, {
            personId: input.personId,
            runId: input.runId,
            operation: base,
            replyChannel: input.replyChannel,
          }, signal)
        : undefined;
      if (admission && !admission.run) {
        if (admission.code) return failed(admission.result, admission.code);
        report("agent", "tool_call", "blocked");
        return { result: admission.result, said: 0 };
      }
      const claimed = await deps.transcript.append(input.personId, targetOf(input), [
        {
          op: `${base}:started`,
          at: now().toISOString(),
          kind: "tool_call",
          role: "assistant",
          provenance: "agent",
          run: input.runId,
          body: { id: call.id, started: true },
        },
      ]);
      if (!claimed[0]?.added) {
        if (admission?.run) await admission.settle("uncertain");
        return failed({ error: "outcome_unknown" }, "outcome_unknown");
      }
    }
    if (signal?.aborted) {
      if (admission?.run) await admission.settle("refused");
      return failed({ error: "cancelled" }, "cancelled");
    }
    return run(input, planned, call, { tool, handler, value: checked.value }, admission, signal);
  }

  async function run(
    input: ToolInput,
    planned: PlannedCall,
    call: StoredCall,
    what: { tool: Tool; handler: Handler<Commit>; value: unknown },
    admission?: Admission,
    signal?: AbortSignal,
  ): Promise<Done> {
    const { tool, handler, value } = what;
    const base = baseOf(planned);
    let said = 0;
    let saying = 0;
    const replies: Promise<Placement>[] = [];
    const context: ToolContext<Commit> = {
      personId: input.personId,
      runId: input.runId,
      round: input.round,
      ...(signal && { signal }),
      replyChannel: input.replyChannel,
      ...(input.taskId && { taskId: input.taskId }),
      call: { id: call.id, op: planned.line.op },
      say(channel, text, parts = [text], commit) {
        const correlationId = currentCorrelation();
        const line: NewLine = {
          op: `${base}:say${saying++}`,
          at: now().toISOString(),
          kind: "message",
          role: "assistant",
          channel,
          provenance: "agent",
          run: input.runId,
          body: { text, parts, ...(correlationId && { correlationId }) },
        };
        const writing = deps.transcript.append(
          input.personId,
          { kind: "main" },
          [line],
          commit,
        ).then(([placed]) => {
          if (!placed) throw new CodedError("internal");
          said++;
          return placed;
        });
        replies.push(writing);
        void writing.catch(() => undefined);
        return writing;
      },
    };
    const settle = admission?.run ? admission.settle : undefined;
    try {
      const done = await handler(value, context);
      await Promise.allSettled(replies);
      report("agent", "tool_call", "ok");
      await settle?.("succeeded");
      return { result: done.result, ...(done.finish && { finish: done.finish.outcome }), said };
    } catch (error) {
      await Promise.allSettled(replies);
      // A call that may already have had its effect is unknown, never failed and never repeated.
      const code =
        error instanceof CodedError ? error.code : tool.readOnly ? "internal" : "outcome_unknown";
      await settle?.(code === "outcome_unknown" ? "uncertain" : "refused");
      return failed({ error: code }, code, said);
    }
  }

  const resultLine = (
    input: ToolInput,
    planned: PlannedCall,
    name: string,
    done: Done,
  ): NewLine => ({
    op: `${baseOf(planned)}:result`,
    at: now().toISOString(),
    kind: "tool_result",
    role: "tool",
    provenance: "agent",
    run: input.runId,
    body: {
      id: planned.id,
      name,
      result: done.result,
      ...(done.finish && { finish: done.finish }),
    },
  });

  return async function executeTool(
    input: ToolInput,
  ): Promise<ToolsOutcome & { result: Json }> {
    try {
      if (input.signal?.aborted) throw new CodedError("cancelled");
      const planned = input.call;
      const [line] = await deps.transcript.read(input.personId, planned.line.path, {
        from: planned.line.lineNo, to: planned.line.lineNo,
      });
      if (line?.op !== planned.line.op) throw new CodedError("not_found");
      const call = line.body as StoredCall;
      if (call.id !== planned.id || call.name !== planned.name) throw new CodedError("conflict");
      const have = await receipts(input);
      const prior = have.get(`${baseOf(planned)}:result`);
      if (prior) {
        const receipt = prior.body as { result: Json; finish?: RunOutcome };
        return { result: receipt.result,
          messageLines: [...have.keys()].filter(op => op.startsWith(`${baseOf(planned)}:say`)).length,
          ...(receipt.finish && { finish: { outcome: receipt.finish } }),
        };
      }
      if (input.signal?.aborted) throw new CodedError("cancelled");
      const done = await execute(input, planned, call, have, input.signal);
      let result = resultLine(input, planned, call.name, done);
      const [placed] = await deps.transcript.append(input.personId, targetOf(input), [result]);
      if (!placed) throw new CodedError("internal");
      if (!placed.added) {
        const [recorded] = await deps.transcript.read(input.personId, placed.path, {
          from: placed.lineNo, to: placed.lineNo,
        });
        if (recorded?.op !== result.op || recorded.kind !== "tool_result")
          throw new CodedError("conflict");
        result = { ...result, body: recorded.body as Json };
      }
      const facts = learningFacts([...have.values()], [result], input.runId, now().toISOString());
      if (facts.length) await deps.transcript.append(input.personId, targetOf(input), facts);
      const committed = result.body as { result: Json; finish?: RunOutcome };
      return { result: committed.result, messageLines: done.said,
        ...(committed.finish && { finish: { outcome: committed.finish } }),
      };
    } catch (error) {
      throw (
        deps.failure?.(error) ?? (error instanceof CodedError ? error : new CodedError("internal"))
      );
    }
  };
}
