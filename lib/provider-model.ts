// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { generateText, jsonSchema, type ModelMessage, type ToolSet } from "ai";
import { providerModel } from "./core/agent/gateway/providers.js";
import { executionLimits } from "./core/agent/limits.js";
import { canonical } from "./core/contracts/canonical.js";
import { modelAccess } from "./model-access.js";
import { check, hash, MemoryError, tokens, type Settings } from "./common.js";
import type { ChatMessage, LocalTool } from "./runtime.js";

// Provider replay envelopes stay in process memory, never in readable workspace evidence.
export type ModelHistory = Map<string, ModelMessage[]>;
const historyKey = (scope: string, messages: ChatMessage[]) =>
  hash(scope + canonical(messages));

function promptMessages(
  messages: ChatMessage[],
  scope: string,
  history: ModelHistory,
): ModelMessage[] {
  const names = new Map<string, string>();
  return messages.flatMap((message, index): ModelMessage[] => {
    if (message.role === "system") return [];
    if (message.role === "user") return [{ role: "user", content: message.content ?? "" }];
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) names.set(call.id, call.function.name);
      const cached = history.get(historyKey(scope, messages.slice(0, index + 1)));
      if (cached) return cached;
      return [
        {
          role: "assistant",
          content: [
            ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
            ...(message.tool_calls ?? []).map((call) => {
              return {
                type: "tool-call" as const,
                toolCallId: call.id,
                toolName: call.function.name,
                input: JSON.parse(call.function.arguments) as unknown,
              };
            }),
          ],
        },
      ];
    }
    check(
      message.role === "tool" && message.tool_call_id && names.has(message.tool_call_id),
      "INVALID_TOOL_HISTORY",
    );
    return [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.tool_call_id,
            toolName: names.get(message.tool_call_id)!,
            output: { type: "text", value: message.content ?? "" },
          },
        ],
      },
    ];
  });
}

export async function completeModel(
  settings: Settings,
  messages: ChatMessage[],
  tools: LocalTool[],
  history: ModelHistory,
  cancellation?: AbortSignal,
): Promise<ChatMessage> {
  const profile = await modelAccess(settings);
  const scope = hash(JSON.stringify(profile));
  const signal = cancellation ? AbortSignal.any([cancellation, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
  const boundedFetch: typeof fetch = async (input, options) => {
    check(
      typeof options?.body === "string" && tokens(options.body) <= settings.context.request,
      "REQUEST_CAPACITY_EXCEEDED",
    );
    const response = await fetch(input, {
      ...options,
      signal,
      redirect: "error",
    });
    check(response.ok, "MODEL_HTTP_ERROR", { status: response.status });
    check(response.body, "INVALID_MODEL_RESPONSE");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      check(bytes <= executionLimits.responseBytes, "MODEL_RESPONSE_TOO_LARGE");
      chunks.push(chunk);
    }
    return new Response(Buffer.concat(chunks), {
      status: response.status,
      headers: response.headers,
    });
  };
  const toolSet: ToolSet = Object.fromEntries(
    tools.map(({ function: definition }) => [
      definition.name,
      {
        description: definition.description,
        inputSchema: jsonSchema(definition.parameters),
      },
    ]),
  );
  try {
    const result = await generateText({
      model: providerModel({
        provider: profile.provider,
        model: profile.name,
        baseURL: profile.baseUrl,
        ...(profile.apiKey && { apiKey: profile.apiKey }),
        fetch: boundedFetch,
      }),
      instructions: messages
        .filter((message) => message.role === "system")
        .map((message) => message.content ?? "")
        .join("\n"),
      messages: promptMessages(messages, scope, history),
      tools: toolSet,
      maxOutputTokens: settings.agent.maxOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
      providerOptions: { openai: { store: false } },
    });
    check(!result.toolCalls.some((call) => call.invalid), "INVALID_MODEL_RESPONSE");
    // The existing runtime owns authorization, tool execution and journaling. Hidden reasoning
    // and provider metadata never enter its readable journal or the command output.
    const answer: ChatMessage = {
      role: "assistant",
      content: result.text || null,
      ...(result.toolCalls.length
        ? {
            tool_calls: result.toolCalls.map((call) => ({
              id: call.toolCallId,
              type: "function",
              function: {
                name: call.toolName,
                arguments: JSON.stringify(call.input),
              },
            })),
          }
        : {}),
    };
    history.set(historyKey(scope, [...messages, answer]), result.response.messages);
    if (history.size > 30) history.delete(history.keys().next().value!);
    return answer;
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError("MODEL_CONNECTION_FAILED");
  }
}
