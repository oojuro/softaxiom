// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { providerStream, type Context, type Model, type SimpleStreamOptions } from "./core/agent/provider.js";
import { executionLimits } from "./core/agent/limits.js";
import { modelAccess } from "./model-access.js";
import { check, hash, MemoryError, tokens, type Settings } from "./common.js";
import { toEngineMessages, fromEngineMessage } from "./engine-messages.js";
import type { Message } from "./core/agent/provider.js";
import type { ChatMessage, LocalTool } from "./runtime.js";

/** Host credentials/egress policy only. OpenClaw owns all provider protocol and replay handling. */
export class HttpModel {
  readonly settings: Settings;
  constructor(settings: Settings) { this.settings = settings; }

  async selection(expectedProfile?: string) {
    const profile = await modelAccess(this.settings);
    const digest = hash(JSON.stringify(profile));
    check(expectedProfile === undefined || expectedProfile === digest, "MODEL_PROFILE_CHANGED");
    const model: Model = { id: profile.name, name: profile.name, provider: profile.provider,
      api: profile.provider === "openai" ? "openai-responses" : profile.provider === "anthropic" ? "anthropic-messages" : "openai-completions",
      baseUrl: profile.provider === "anthropic" ? profile.baseUrl.replace(/\/v1$/, "") : profile.baseUrl, reasoning: false, input: ["text"],
      contextWindow: this.settings.context.request, maxTokens: this.settings.agent.maxOutputTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    return { model, digest, profile };
  }

  async stream(_model: Model, context: Context, options?: SimpleStreamOptions, expectedProfile?: string) {
    const { model, profile } = await this.selection(expectedProfile);
    const signal = options?.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000);
    let failure: unknown, dispatched = false;
    const boundedFetch: typeof fetch = async (input, request) => {
      try {
      const target = new URL(input instanceof Request ? input.url : input.toString());
      const base = new URL(profile.baseUrl);
      const endpoint = model.api === "anthropic-messages" ? "messages" : model.api === "openai-responses" ? "responses" : "chat/completions";
      check(target.href === `${base.href.replace(/\/$/, "")}/${endpoint}` && request?.method?.toUpperCase() === "POST", "MODEL_ENDPOINT_DENIED");
      const body = request.body instanceof Blob
        ? (check(request.body.size <= this.settings.context.request, "REQUEST_CAPACITY_EXCEEDED"), await request.body.text())
        : request.body;
      check(typeof body === "string" && tokens(body) <= this.settings.context.request,
        "REQUEST_CAPACITY_EXCEEDED");
      const headers = new Headers(request.headers);
      if (!profile.apiKey) headers.delete("authorization");
      check(!dispatched, "MODEL_RETRY_REQUIRES_RECONCILIATION");
      dispatched = true;
      let response: Response;
      try { response = await fetch(input, { ...request, headers, signal, redirect: "error" }); }
      catch { throw new MemoryError("MODEL_CONNECTION_FAILED"); }
      check(response.ok, "MODEL_HTTP_ERROR", { status: response.status });
      check(response.body, "INVALID_MODEL_RESPONSE");
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        check(bytes <= executionLimits.responseBytes, "MODEL_RESPONSE_TOO_LARGE");
        chunks.push(chunk);
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
      } catch (error) { failure = error; throw error; }
    };
    const stream = providerStream(model, context, { ...options, apiKey: profile.apiKey ?? "local-no-key",
      maxTokens: this.settings.agent.maxOutputTokens, transport: "sse", maxRetryDelayMs: 0, signal }, boundedFetch);
    const result = stream.result.bind(stream);
    stream.result = async () => {
      const message = await result();
      if (failure) throw failure;
      check(message.stopReason !== "error" && message.stopReason !== "aborted", "MODEL_CONNECTION_FAILED");
      return message;
    };
    return stream;
  }

  /** One explicit sample for SDK consumers. Agent journeys use stream with engine-owned state. */
  async complete(messages: ChatMessage[], tools: LocalTool[] = [], signal?: AbortSignal, expectedProfile?: string): Promise<ChatMessage> {
    const selected = await this.selection(expectedProfile);
    const stream = await this.stream(selected.model, {
      systemPrompt: messages.filter(message => message.role === "system").map(message => message.content).join("\n"),
      messages: toEngineMessages(messages) as Message[],
      tools: tools.map(({ function: definition }) => ({ ...definition,
        parameters: definition.parameters as NonNullable<Context["tools"]>[number]["parameters"] })),
    }, signal ? { signal } : {}, selected.digest);
    for await (const _ of stream) { /* Provider lifecycle must settle before reading the result. */ }
    const message = await stream.result();
    check(message.stopReason !== "error" && message.stopReason !== "aborted", "MODEL_CONNECTION_FAILED");
    return fromEngineMessage(message);
  }
}
