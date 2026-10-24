// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../../contracts/codes.ts";

export const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference/v1";
export const FIREWORKS_MODEL = "accounts/fireworks/models/glm-5p3-flash";
export function assertFireworks(provider: string, baseURL = FIREWORKS_BASE_URL) {
  if (provider !== "fireworks" || baseURL !== FIREWORKS_BASE_URL)
    throw new CodedError("invalid_input");
}
/** No redirects, alternate hosts, embeddings, discovery or automatic downloads. */
export function fireworksFetch(transport: typeof fetch = globalThis.fetch): typeof fetch {
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${FIREWORKS_BASE_URL}/chat/completions` || init?.method !== "POST")
      throw new CodedError("invalid_input");
    return transport(input, { ...init, redirect: "error" });
  };
}
