// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Read old encrypted transcripts and write rollback-compatible projections. No legacy engine runs.
import type { ModelMessage } from "../../contracts/historical-model.ts";
import type { AssistantMessage, Message } from "../provider.ts";
import { createEmptyTransportUsage } from "../../upstream/openclaw/ai/src/transports/transport-stream-shared.js";
import { CodedError } from "../../contracts/codes.ts";

export function legacyHistory(history: ModelMessage[]): Message[] {
  return history.flatMap((message): Message[] => {
    if (message.role === "system") return [];
    if (message.role === "user") {
      if (typeof message.content === "string") return [{ role: "user", content: message.content, timestamp: 0 }];
      const content = message.content.map(part => {
        if (part.type !== "text") throw new CodedError("invalid_input");
        return { type: "text" as const, text: part.text };
      });
      return [{ role: "user", content, timestamp: 0 }];
    }
    if (message.role === "assistant") {
      const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
      const content: AssistantMessage["content"] = [];
      for (const part of parts) {
        if (part.type === "text") content.push({ type: "text", text: part.text });
        else if (part.type === "tool-call") content.push({ type: "toolCall", id: part.toolCallId,
          name: part.toolName, arguments: part.input as Record<string, unknown> });
        else if (part.type !== "reasoning") throw new CodedError("invalid_input");
      }
      return [{ role: "assistant", content, api: "openai-completions", provider: "legacy-transcript",
        model: "historical", usage: createEmptyTransportUsage(), timestamp: 0,
        stopReason: content.some(part => part.type === "toolCall") ? "toolUse" : "stop" }];
    }
    return message.content.map(part => {
      if (part.type !== "tool-result" || !["text", "json", "error-text", "error-json"].includes(part.output.type))
        throw new CodedError("invalid_input");
      const output = part.output;
      const text = "value" in output ? (typeof output.value === "string" ? output.value : JSON.stringify(output.value)) : "";
      return { role: "toolResult" as const, toolCallId: part.toolCallId, toolName: part.toolName,
        content: [{ type: "text" as const, text }], isError: output.type.startsWith("error"), timestamp: 0 };
    });
  });
}

export function rollbackMessages(message: AssistantMessage): ModelMessage[] {
  const content: Exclude<Extract<ModelMessage, { role: "assistant" }>["content"], string> = [];
  for (const part of message.content) {
    if (part.type === "text") content.push({ type: "text", text: part.text });
    else if (part.type === "thinking") content.push({ type: "reasoning", text: part.thinking });
    else if (part.type === "toolCall") content.push({ type: "tool-call", toolCallId: part.id,
      toolName: part.name, input: part.arguments });
  }
  return [{ role: "assistant", content }];
}
