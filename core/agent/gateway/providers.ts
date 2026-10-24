// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { assertFireworks, FIREWORKS_BASE_URL, FIREWORKS_MODEL, fireworksFetch } from "./fireworks.ts";
import { CodedError } from "../../contracts/codes.ts";
import type { LanguageModel } from "ai";
import type { ModelRoute } from "./catalog.ts";

export type Models = (route: ModelRoute) => LanguageModel;

export interface ProviderKeys {
  anthropic?: string;
  openai?: string;
  fireworks?: string;
}

/** Direct provider adapters shared by local and hosted execution. No ambient credentials. */
export function providerModel(options: {
  provider: "anthropic" | "openai" | "compatible";
  model: string;
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof globalThis.fetch;
}): LanguageModel {
  const { provider, model, ...connection } = options;
  if (provider !== "compatible" && !connection.apiKey) throw new CodedError("unavailable");
  if (provider === "anthropic") return createAnthropic(connection)(model);
  if (provider === "openai") return createOpenAI(connection).responses(model);
  if (!connection.baseURL) throw new CodedError("invalid_input");
  return createOpenAICompatible({
    name: "compatible",
    ...connection,
    baseURL: connection.baseURL,
  })(model);
}

/**
 * The AI SDK adapter for each route. Keys are passed in (the worker loads them from its secrets);
 * a route whose key is missing fails here, at the first call, with a coded error and no detail.
 * `fetch` is only for tests.
 */
export function languageModels({
  keys,
  fetch,
}: {
  keys: ProviderKeys;
  fetch?: typeof globalThis.fetch;
}): Models {
  return ({ provider, model }) => {
    const apiKey = keys[provider];
    if (!apiKey) throw new CodedError("unavailable");
    const options = { apiKey, ...(fetch && { fetch }) };
    switch (provider) {
      case "anthropic":
        return providerModel({ provider, model, ...options });
      case "openai":
        return providerModel({ provider, model, ...options });
      case "fireworks":
        return createOpenAICompatible({
          name: "fireworks",
          baseURL: "https://api.fireworks.ai/inference/v1",
          ...options,
        })(model);
    }
  };
}

/** Hosted-only policy factory. No ambient keys, provider selection, endpoint override or fallback. */
export function fireworksModels({ keys, fetch }: { keys: { fireworks?: string }; fetch?: typeof globalThis.fetch }): Models {
  return ({ provider, model }) => {
    assertFireworks(provider);
    if (model !== FIREWORKS_MODEL) throw new CodedError("invalid_input");
    if (!keys.fireworks) throw new CodedError("unavailable");
    return createOpenAICompatible({ name: "fireworks", apiKey: keys.fireworks,
      baseURL: FIREWORKS_BASE_URL, fetch: fireworksFetch(fetch) })(model);
  };
}
