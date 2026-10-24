// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createAssistantMessageEventStream, type AssistantMessage } from "./core/agent/provider.js";
import { createEmptyTransportUsage } from "./core/upstream/openclaw/ai/src/transports/transport-stream-shared.js";
import type { AgentMessage, StreamFn } from "./core/agent/engine.js";
import type { ChatMessage, LocalModel, LocalTool } from "./runtime.js";
import { check, MemoryError } from "./common.js";

/** Compatibility at the caller boundary; the engine owns the live transcript. */
export function toEngineMessages(messages: ChatMessage[]): AgentMessage[] {
  return messages.filter(message => message.role !== "system").map(message => {
    if (message.role === "user") return { role: "user", content: message.content ?? "", timestamp: Date.now() };
    if (message.role === "tool") return { role: "toolResult", toolCallId: message.tool_call_id!, toolName: "tool",
      content: [{ type: "text", text: message.content ?? "" }], isError: false, timestamp: Date.now() };
    check(message.role === "assistant", "INVALID_CHAT_HISTORY");
    return { role: "assistant", api: "openai-completions", provider: "host", model: "injected",
      content: [...(message.content ? [{ type: "text" as const, text: message.content }] : []),
        ...(message.tool_calls ?? []).map(call => ({ type: "toolCall" as const, id: call.id,
          name: call.function.name, arguments: JSON.parse(call.function.arguments) as Record<string, unknown> }))],
      usage: createEmptyTransportUsage(), stopReason: message.tool_calls?.length ? "toolUse" : "stop", timestamp: Date.now() };
  });
}

export function fromEngineMessage(message: AssistantMessage): ChatMessage {
  const calls = message.content.filter(part => part.type === "toolCall");
  return { role: "assistant", content: message.content.filter(part => part.type === "text").map(part => part.text).join("") || null,
    ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: "function", function: {
      name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) };
}

/** Injected completion fixtures/custom transports use the same upstream engine and tool lifecycle. */
export function fixtureStream(model: LocalModel, tools: LocalTool[], profile?: string): StreamFn {
  return async (_model, context, options) => {
    const messages: ChatMessage[] = [{ role: "system", content: context.systemPrompt ?? "" },
      ...context.messages.map((message): ChatMessage => {
        if (message.role === "assistant") return fromEngineMessage(message);
        if (message.role === "user") return { role: "user", content: typeof message.content === "string" ? message.content : message.content.map(part => part.type === "text" ? part.text : "").join("\n") };
        return { role: "tool", tool_call_id: message.toolCallId, content: message.content.map(part => part.type === "text" ? part.text : "").join("") };
      })];
    const returned = await model.complete(messages, tools, options?.signal, profile);
    check(returned?.role === "assistant" && (returned.content === null || typeof returned.content === "string"), "INVALID_MODEL_RESPONSE");
    let message: AssistantMessage;
    try { message = toEngineMessages([returned])[0] as AssistantMessage; }
    catch { throw new MemoryError("INVALID_TOOL_CALLS"); }
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
    return stream;
  };
}
