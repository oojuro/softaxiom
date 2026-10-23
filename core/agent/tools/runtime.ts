// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Runs one batch of tool calls and records what happened. The calls are already in the transcript
// (the model round wrote them first), so the input is read from there and never passed through the
// workflow. A call that is cut off, unknown or invalid is never run. Read-only calls of a batch
// run together; anything else runs alone. Each result is a transcript line under an op derived
// from its call, so a repeat of the batch finds the receipts and runs nothing twice.
import { assertCalls, executionLimits } from "../limits.ts";
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

export interface ToolContext<Commit = never> {
  personId: string;
  runId: string;
  round: number;
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
const targetOf = ({ taskId }: ToolsInput): Target =>
  taskId ? { kind: "task", taskId } : { kind: "main" };

export function createToolRuntime<Commit = never>(deps: RuntimeDeps<Commit>) {
  const now = deps.now ?? (() => new Date());

  async function readCalls(input: ToolsInput) {
    return Promise.all(
      input.calls.map(async (planned) => {
        const [line] = await deps.transcript.read(input.personId, planned.line.path, {
          from: planned.line.lineNo,
          to: planned.line.lineNo,
        });
        if (line?.op !== planned.line.op) throw new CodedError("not_found");
        return { planned, call: line.body as StoredCall };
      }),
    );
  }

  // What the transcript already holds of these calls: a result line is a receipt.
  async function receipts(input: ToolsInput) {
    const paths = new Map<string, number>();
    for (const { line } of input.calls) {
      paths.set(line.path, Math.min(line.lineNo, paths.get(line.path) ?? line.lineNo));
    }
    const found = new Map<string, StoredLine>();
    for (const [path, from] of paths) {
      for (const line of await deps.transcript.read(input.personId, path, {
        from: Math.max(1, from - 200),
      })) {
        found.set(line.op, line);
      }
    }
    return found;
  }

  async function execute(
    input: ToolsInput,
    planned: PlannedCall,
    call: StoredCall,
    started: { has(op: string): boolean },
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
          })
        : undefined;
      if (admission && !admission.run) {
        if (admission.code) return failed(admission.result, admission.code);
        report("agent", "tool_call", "blocked");
        return { result: admission.result, said: 0 };
      }
      await deps.transcript.append(input.personId, targetOf(input), [
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
    }
    return run(input, planned, call, { tool, handler, value: checked.value }, admission);
  }

  async function run(
    input: ToolsInput,
    planned: PlannedCall,
    call: StoredCall,
    what: { tool: Tool; handler: Handler<Commit>; value: unknown },
    admission?: Admission,
  ): Promise<Done> {
    const { tool, handler, value } = what;
    const base = baseOf(planned);
    let said = 0;
    let saying = 0;
    const context: ToolContext<Commit> = {
      personId: input.personId,
      runId: input.runId,
      round: input.round,
      replyChannel: input.replyChannel,
      ...(input.taskId && { taskId: input.taskId }),
      call: { id: call.id, op: planned.line.op },
      async say(channel, text, parts = [text], commit) {
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
        const [placed] = await deps.transcript.append(
          input.personId,
          { kind: "main" },
          [line],
          commit,
        );
        if (!placed) throw new CodedError("internal");
        said++;
        return placed;
      },
    };
    const settle = admission?.run ? admission.settle : undefined;
    try {
      const done = await handler(value, context);
      report("agent", "tool_call", "ok");
      await settle?.("succeeded");
      return { result: done.result, ...(done.finish && { finish: done.finish.outcome }), said };
    } catch (error) {
      // A call that may already have had its effect is unknown, never failed and never repeated.
      const code =
        error instanceof CodedError ? error.code : tool.readOnly ? "internal" : "outcome_unknown";
      await settle?.(code === "outcome_unknown" ? "uncertain" : "refused");
      return failed({ error: code }, code, said);
    }
  }

  const resultLine = (
    input: ToolsInput,
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

  return async function runTools(input: ToolsInput): Promise<ToolsOutcome> {
    try {
      if (
        input.calls.length > executionLimits.toolCalls ||
        new Set(input.calls.map((c) => c.id)).size !== input.calls.length
      )
        throw new CodedError("invalid_input");
      const calls = await readCalls(input);
      const have = await receipts(input);
      const results = new Map<string, Done>();
      const pending = calls.filter(({ planned }) => !have.has(`${baseOf(planned)}:result`));
      const together = pending.every(({ call }) => deps.registry.readOnly(call.name) === true);
      const run = async ({ planned, call }: (typeof pending)[number]) => {
        results.set(planned.id, await execute(input, planned, call, have));
      };
      if (together) await Promise.all(pending.map(run));
      else for (const one of pending) await run(one);

      const lines = pending.map(({ planned, call }) =>
        resultLine(input, planned, call.name, results.get(planned.id) as Done),
      );
      if (lines.length > 0) await deps.transcript.append(input.personId, targetOf(input), lines);

      const source = calls.flatMap(({ planned }) => {
        const op = `${baseOf(planned)}:result`;
        const row = lines.find((line) => line.op === op) ?? have.get(op);
        return row ? [row] : [];
      });
      const facts = learningFacts([...have.values()], source, input.runId, now().toISOString());
      if (facts.length > 0) await deps.transcript.append(input.personId, targetOf(input), facts);

      const outcome: ToolsOutcome = { messageLines: 0 };
      for (const { planned } of calls) {
        const earlier = have.get(`${baseOf(planned)}:result`);
        const finish = earlier
          ? (earlier.body as { finish?: RunOutcome }).finish
          : results.get(planned.id)?.finish;
        if (finish && !outcome.finish) outcome.finish = { outcome: finish };
        outcome.messageLines += earlier
          ? [...have.keys()].filter((op) => op.startsWith(`${baseOf(planned)}:say`)).length
          : (results.get(planned.id)?.said ?? 0);
      }
      return outcome;
    } catch (error) {
      throw (
        deps.failure?.(error) ?? (error instanceof CodedError ? error : new CodedError("internal"))
      );
    }
  };
}
