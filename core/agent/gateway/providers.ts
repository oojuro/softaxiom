// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { providerStream, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "../provider.ts";
import { assertFireworks, FIREWORKS_BASE_URL, FIREWORKS_MODEL, fireworksFetch } from "./fireworks.ts";
import { CodedError } from "../../contracts/codes.ts";
import { ProviderHttpError } from "../../money/ports.ts";
import { executionLimits } from "../limits.ts";
import { ContextLimitError } from "./errors.ts";
import type { ModelRoute } from "./catalog.ts";

export interface ProviderEndpoint {
  model: Model;
  complete(context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage>;
}
export type Models = (route: ModelRoute) => ProviderEndpoint;
export interface ProviderKeys { fireworks?: string }

/** Hosted policy only. Local model-agnostic profiles bind the same upstream protocols separately. */
export function fireworksModels({ keys, fetch: transport = globalThis.fetch }: {
  keys: ProviderKeys; fetch?: typeof globalThis.fetch;
}): Models {
  return route => {
    assertFireworks(route.provider);
    if (route.model !== FIREWORKS_MODEL) throw new CodedError("invalid_input");
    const apiKey = keys.fireworks;
    if (!apiKey) throw new CodedError("unavailable");
    const model: Model = { id: route.model, name: route.model, provider: "fireworks", api: "openai-completions",
      baseUrl: FIREWORKS_BASE_URL, reasoning: false, input: ["text"], contextWindow: route.maxInputTokens,
      maxTokens: route.maxOutputTokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    return { model, async complete(context, options) {
      const signal = options?.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(540000)]) : AbortSignal.timeout(540000);
      let failure: unknown, dispatched = false;
      const send = fireworksFetch(async (input, request) => {
        try {
          if (dispatched) throw new CodedError("outcome_unknown");
          const headers = new Headers(request?.headers);
          const affinity = options?.headers?.["x-session-affinity"];
          if (affinity) headers.set("x-session-affinity", affinity);
          dispatched = true;
          const response = await transport(input, { ...request, headers, signal, redirect: "error" });
          const bytes: Uint8Array[] = []; let size = 0;
          if (response.body) for await (const chunk of response.body) {
            size += chunk.length;
            if (size > executionLimits.responseBytes) throw new CodedError("outcome_unknown");
            bytes.push(chunk);
          }
          const body = Buffer.concat(bytes);
          if (!response.ok) {
            let contextRefusal = false;
            try { contextRefusal = [400, 413].includes(response.status) && JSON.parse(body.toString()).error?.code === "context_length_exceeded"; } catch { /* Ordinary definite refusal. */ }
            throw contextRefusal ? new ContextLimitError(response.status) : new ProviderHttpError(response.status);
          }
          return new Response(body, { status: response.status, headers: response.headers });
        } catch (error) { failure = error; throw error; }
      });
      const stream = providerStream(model, context, { ...options, apiKey, signal, transport: "sse",
        maxTokens: route.maxOutputTokens, maxRetryDelayMs: 0 }, send);
      for await (const _ of stream) { /* Retain upstream lifecycle ownership until settlement. */ }
      const message = await stream.result();
      if (failure) throw failure;
      if (message.stopReason === "error" || message.stopReason === "aborted") throw new CodedError("outcome_unknown");
      return message;
    } };
  };
}
