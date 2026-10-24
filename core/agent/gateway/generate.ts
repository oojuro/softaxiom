// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../../contracts/codes.ts";
import type { Usage } from "../../money/ports.ts";
import type { ModelMessage } from "../../contracts/historical-model.ts";
import type { AssistantMessage } from "../provider.ts";
import type { ProviderEndpoint } from "./providers.ts";
import type { ModelRoute } from "./catalog.ts";
import type { ShapedPrompt } from "./prompt.ts";
import { legacyHistory, rollbackMessages } from "./legacy-history.ts";
export { ContextLimitError } from "./errors.ts";

export interface ModelAnswer {
  text: string;
  calls: { id: string; name: string; input: unknown; invalid?: true }[];
  // A read-only projection for the prior artifact's encrypted transcript readers.
  messages: ModelMessage[];
  finishReason: string;
  engine?: { version: 1; message: AssistantMessage };
}

function priced(message: AssistantMessage): Usage {
  const usage = message.usage;
  if (usage.usageReport?.state !== "available" || usage.contextUsage?.state !== "available")
    throw new CodedError("outcome_unknown");
  const result = { inputTokens: usage.input, outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite };
  const counts = [...Object.values(result), usage.contextUsage.promptTokens, usage.contextUsage.totalTokens];
  if (counts.some(value => !Number.isSafeInteger(value) || value < 0) ||
    usage.input + usage.cacheRead + usage.cacheWrite !== usage.contextUsage.promptTokens ||
    Object.values(result).reduce((sum, value) => sum + value, 0) !== usage.contextUsage.totalTokens)
    throw new CodedError("outcome_unknown");
  return result;
}

/** One admitted sample; the upstream Agent owns the surrounding lifecycle and tool loop. */
export async function generate(endpoint: ProviderEndpoint, route: ModelRoute, prompt: ShapedPrompt,
  signal?: AbortSignal): Promise<{ value: ModelAnswer; usage: Usage }> {
  if (typeof endpoint !== "object" || !endpoint || typeof endpoint.complete !== "function")
    throw new CodedError("invalid_input");
  const message = await endpoint.complete({ systemPrompt: prompt.instructions.content,
    messages: prompt.engineHistory ?? legacyHistory(prompt.messages),
    tools: Object.entries(prompt.tools).map(([name, definition]) => ({ name, description: definition.description,
      parameters: definition.inputSchema as NonNullable<Parameters<ProviderEndpoint["complete"]>[0]["tools"]>[number]["parameters"] })),
  }, { ...(signal && { signal }), headers: prompt.headers, maxTokens: route.maxOutputTokens });
  return { usage: priced(message), value: {
    text: message.content.filter(part => part.type === "text").map(part => part.text).join(""),
    calls: message.content.filter(part => part.type === "toolCall").map(part => ({
      id: part.id, name: part.name, input: part.arguments,
      ...(message.stopReason === "length" && { invalid: true as const }),
    })),
    messages: rollbackMessages(message), finishReason: message.stopReason === "toolUse" ? "tool-calls" : message.stopReason,
    engine: { version: 1, message },
  } };
}
