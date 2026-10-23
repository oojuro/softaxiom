// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { CodedError } from "../../contracts/codes.ts";
import type { LanguageModel } from "ai";
import type { ModelRoute } from "./catalog.ts";

export type Models = (route: ModelRoute) => LanguageModel;

export interface ProviderKeys {
  anthropic?: string;
  openai?: string;
  fireworks?: string;
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
        return createAnthropic(options)(model);
      case "openai":
        return createOpenAI(options).responses(model);
      case "fireworks":
        return createOpenAICompatible({
          name: "fireworks",
          baseURL: "https://api.fireworks.ai/inference/v1",
          ...options,
        })(model);
    }
  };
}
