// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../../contracts/codes.ts";
import type { ModelRoute } from "./catalog.ts";
import type { ModelRequest } from "./prompt.ts";

// A conservative local text-admission policy, not an exact provider tokenizer count: count
// UTF-8 bytes, double the wire representation, then add fixed and per-entry framing headroom.
// Provider ceilings and approved tariffs remain release acceptance requirements.
// Images/files and mixed tool-result content have no trustworthy local text bound and are refused
// before the SDK could fetch a URL. A future media adapter must provide its own verified bound.
export function assertInputBound(
  route: Pick<ModelRoute, "maxInputTokens">,
  request: ModelRequest,
): void {
  let entries = request.tools.length;
  for (const message of request.history) {
    entries++;
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      entries++;
      if (!["text", "reasoning", "tool-call", "tool-result"].includes(part.type))
        throw new CodedError("invalid_input");
      if (
        part.type === "tool-result" &&
        !["text", "json", "error-text", "error-json"].includes(part.output.type)
      )
        throw new CodedError("invalid_input");
    }
  }
  let encoded: string;
  try {
    encoded = JSON.stringify({
      system: request.system,
      tools: request.tools,
      history: request.history,
      context: request.context,
    });
  } catch {
    throw new CodedError("invalid_input");
  }
  const bound = Buffer.byteLength(encoded, "utf8") * 2 + 512 + entries * 64;
  if (
    !Number.isSafeInteger(route.maxInputTokens) ||
    route.maxInputTokens <= 0 ||
    bound > route.maxInputTokens
  )
    throw new CodedError("context_overflow");
}
