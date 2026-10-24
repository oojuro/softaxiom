// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { runAgentLoop } from "../upstream/openclaw/agent-core/src/agent-loop.js";
import { createAssistantMessageEventStream } from "../upstream/openclaw/llm-core/src/utils/event-stream.js";
import { createEmptyTransportUsage } from "../upstream/openclaw/agent-core/fireworks-compat.js";
import type { AgentTool } from "../upstream/openclaw/agent-core/src/types.js";
import type { AssistantMessage } from "../upstream/openclaw/llm-core/src/types.js";

export interface EngineMessage { content: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }
/** Ephemeral OpenClaw loop only. The caller retains transcripts, effects and durable coordination. */
export async function runEngine(options: {
  tools: { function: { name: string; description: string } }[];
  sample(): Promise<EngineMessage>;
  execute(id: string, name: string, args: unknown): Promise<unknown>;
  stopped(): boolean;
}) {
  const controller = new AbortController();
  let failure: unknown, failed = false;
  const model = { id: "host-model", name: "Host-supplied model", api: "openai-completions" as const,
    provider: "host", baseUrl: "", reasoning: false, input: ["text" as const],
    maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const tools: AgentTool[] = options.tools.map(({ function: tool }) => ({
    name: tool.name, label: tool.name, description: tool.description,
    // The existing typed host dispatcher validates arguments without upstream coercion.
    parameters: { type: "object", additionalProperties: true } as AgentTool["parameters"],
    executionMode: "sequential",
    execute: async (id, args) => {
      try {
        const result = await options.execute(id, tool.name, args);
        if (options.stopped()) controller.abort();
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: undefined };
      } catch (error) { failed = true; failure = error; throw error; }
    },
  }));
  await runAgentLoop([], { systemPrompt: "", messages: [], tools }, {
    model, convertToLlm: () => [], toolExecution: "sequential",
    shouldStopAfterTurn: () => options.stopped(),
  }, event => { if (event.type === "tool_execution_end" && failed) throw failure; }, controller.signal,
  async () => {
    const value = await options.sample();
    const message: AssistantMessage = { role: "assistant", api: model.api, provider: "host",
      model: model.id, usage: createEmptyTransportUsage(), timestamp: Date.now(),
      stopReason: value.tool_calls?.length ? "toolUse" : "stop",
      content: [...(value.content ? [{ type: "text" as const, text: value.content }] : []),
        ...(value.tool_calls ?? []).map(call => ({ type: "toolCall" as const, id: call.id,
          name: call.function.name, arguments: JSON.parse(call.function.arguments) as Record<string, unknown> }))] };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
    return stream;
  }, { streamSimple: () => { throw new Error("Explicit sample required"); }, isLocalError: () => true });
  if (failed) throw failure;
}
