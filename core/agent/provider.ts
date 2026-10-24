// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createAiTransportHost, runWithAiTransportHost } from "../upstream/openclaw/ai/src/host.js";
import { streamOpenAICompletions } from "../upstream/openclaw/ai/src/providers/openai-completions.js";
import { streamOpenAIResponses } from "../upstream/openclaw/ai/src/providers/openai-responses.js";
import { streamAnthropic } from "../upstream/openclaw/ai/src/providers/anthropic.js";
import type { Model, Context, SimpleStreamOptions } from "../upstream/openclaw/llm-core/src/types.js";
export type { Model, Context, AssistantMessage, Message, SimpleStreamOptions } from "../upstream/openclaw/llm-core/src/types.js";
export { createAssistantMessageEventStream } from "../upstream/openclaw/llm-core/src/utils/event-stream.js";

/** Explicit credentials and request-scoped egress; no process-global provider configuration. */
export function providerStream(model: Model, context: Context, options: SimpleStreamOptions,
  fetcher: typeof fetch) {
  const apiKey = options.apiKey;
  if (!apiKey) throw new Error("Explicit model credentials required");
  const scopedFetch: typeof fetch = (input, request) => {
    const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
    if (model.api === "anthropic-messages") {
      headers.set("x-api-key", apiKey);
      headers.set("anthropic-version", "2023-06-01");
      const allowed = new Set(["fine-grained-tool-streaming-2025-05-14", "interleaved-thinking-2025-05-14"]);
      const beta = (new Headers(request?.headers).get("anthropic-beta") ?? "").split(",").filter(value => allowed.has(value));
      if (beta.length) headers.set("anthropic-beta", beta.join(","));
    } else headers.set("authorization", `Bearer ${apiKey}`);
    // SDK environment headers never become transport authority or cross-provider credentials.
    return fetcher(input, { ...request, headers });
  };
  const host = createAiTransportHost({ buildModelFetch: () => scopedFetch,
    requiresManagedTransport: () => true, logDebug: () => {}, logInfo: () => {}, logWarn: () => {} });
  return runWithAiTransportHost(host, () => {
    switch (model.api) {
      case "openai-completions": return streamOpenAICompletions(model as Model<"openai-completions">, context, { ...options, streaming: false });
      case "openai-responses": return streamOpenAIResponses(model as Model<"openai-responses">, context, options);
      case "anthropic-messages": return streamAnthropic(model as Model<"anthropic-messages">, context, options);
      default: throw new Error("Unsupported model protocol");
    }
  });
}
