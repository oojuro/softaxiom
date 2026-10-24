// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../../contracts/codes.ts";
import { ProviderHttpError, type Usage } from "../../money/ports.ts";
import { APICallError, generateText, type LanguageModel, type ModelMessage } from "ai";
import type { ModelRoute } from "./catalog.ts";
import type { ShapedPrompt } from "./prompt.ts";

// A definite HTTP refusal still releases its reservation before the gateway exposes overflow.
export class ContextLimitError extends ProviderHttpError {}

function contextLimit(error: APICallError, provider: ModelRoute["provider"]) {
  if (error.statusCode !== 400 && error.statusCode !== 413) return false;
  const data = error.data as
    | { error?: { code?: unknown; type?: unknown; message?: unknown } }
    | undefined;
  const detail = data?.error;
  if (provider !== "anthropic") return detail?.code === "context_length_exceeded";
  // Anthropic has no context-specific code. Accept only its complete numeric refusal format;
  // other invalid requests and changed wording remain ordinary refusals.
  if (
    error.statusCode !== 400 ||
    detail?.type !== "invalid_request_error" ||
    typeof detail.message !== "string" ||
    detail.message.length > 120
  )
    return false;
  const counts = /^prompt is too long: ?([1-9][0-9]{0,9}) tokens > ([1-9][0-9]{0,9}) maximum$/.exec(
    detail.message,
  );
  return counts !== null && Number(counts[1]) > Number(counts[2]);
}

export interface ModelAnswer {
  text: string;
  // Tool calls to run. Nothing here executes them: each one is its own activity.
  // `invalid` marks a call the provider's SDK could not parse (an answer cut off mid-call).
  calls: { id: string; name: string; input: unknown; invalid?: true }[];
  // The assistant message exactly as the provider needs it back next round, with any signed
  // reasoning it carries. Storing and replaying these as they are keeps the cache prefix stable.
  messages: ModelMessage[];
  finishReason: string;
}

// The four kinds the rate card prices. `inputTokens` is the uncached input alone, so a token is
// priced once; providers report totals, so the cached kinds come off the total.
function priced({
  inputTokens,
  outputTokens,
  inputTokenDetails,
}: Awaited<ReturnType<typeof run>>["usage"]) {
  if (inputTokens === undefined || outputTokens === undefined) throw new Error("no usage");
  const cacheReadTokens = inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWriteTokens = inputTokenDetails.cacheWriteTokens ?? 0;
  const uncached =
    inputTokenDetails.noCacheTokens ?? inputTokens - cacheReadTokens - cacheWriteTokens;
  const usage: Usage = { inputTokens: uncached, outputTokens, cacheReadTokens, cacheWriteTokens };
  // Numbers that do not add up are a provider fault we cannot price: leave the hold for review.
  if (Object.values(usage).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    throw new Error("inconsistent usage");
  }
  return usage;
}

const run = (model: LanguageModel, route: ModelRoute, prompt: ShapedPrompt, signal?: AbortSignal) =>
  generateText({
    model,
    instructions: prompt.instructions,
    messages: prompt.messages,
    tools: prompt.tools,
    maxOutputTokens: route.maxOutputTokens,
    providerOptions: prompt.providerOptions as never,
    headers: prompt.headers,
    // Temporal retries the activity; a second retry layer would send the same paid call twice.
    maxRetries: 0,
    ...(signal && { abortSignal: signal }),
  });

/**
 * One request to one provider, shaped for `paidCall`: the answer and its usage, or an error that
 * says whether the provider refused (an HTTP status, nothing charged) or simply did not answer.
 */
export async function generate(
  model: LanguageModel,
  route: ModelRoute,
  prompt: ShapedPrompt,
  signal?: AbortSignal,
): Promise<{ value: ModelAnswer; usage: Usage }> {
  if (typeof model === "string") throw new CodedError("invalid_input");
  const result = await run(model, route, prompt, signal).catch((error: unknown) => {
    if (APICallError.isInstance(error) && (error.statusCode ?? 0) >= 400) {
      throw contextLimit(error, route.provider)
        ? new ContextLimitError(error.statusCode as number)
        : new ProviderHttpError(error.statusCode as number);
    }
    throw error;
  });
  return {
    usage: priced(result.usage),
    value: {
      text: result.text,
      calls: result.toolCalls.map(({ toolCallId, toolName, input, invalid }) => ({
        id: toolCallId,
        name: toolName,
        input,
        ...(invalid && { invalid: true as const }),
      })),
      messages: result.response.messages,
      finishReason: result.finishReason,
    },
  };
}
