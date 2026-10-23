// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// How a request is laid out for the provider's cache. Providers reuse work only for a request
// that starts with the same bytes as an earlier one, so the layout is the whole trick:
//
//   system text, then tools in name order      the same every round
//   history                                    only ever appended to
//   per-round context (time, recall, notes)    last, after every breakpoint
//
// Anthropic is told where to cut (two breakpoints: through the system text, through the history).
// OpenAI and Fireworks match prefixes themselves and are only told which person's cache to use.
import { createHash } from "node:crypto";
import type { OperationId, PersonId } from "../../contracts/ids.ts";
import type { Budget } from "../../money/ports.ts";
import { jsonSchema, type ModelMessage, type SystemModelMessage, type ToolSet } from "ai";
import type { ModelRole, ModelRoute } from "./catalog.ts";
import { assertInputBound } from "./input-bound.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  // JSON Schema. The model sees it; nothing here runs the tool.
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  operationId: OperationId;
  role: ModelRole;
  // Stable text for this role. Anything that changes each round belongs in `context`.
  system: string;
  tools: ToolDefinition[];
  // The conversation so far as model messages. Append only: an edit anywhere breaks the cache.
  history: ModelMessage[];
  // What is new this round and not part of the record: the time, recall matches, fact notes.
  context?: string;
  // Set on the one retry after a charged answer was lost: the platform pays and the person does
  // not (see `createGateway`). Its independent paid attempt still has a durable dispatch mark.
  fundedBy?: "platform";
  // Durable operator-alert funding, selected from the saved run by worker code.
  funding?: "platform";
  // A daily allowance the work may not exceed (the summarizer's); a call over it is declined.
  budget?: Budget;
  signal?: AbortSignal;
}

/**
 * The cache a person's requests share at OpenAI and Fireworks, where routing decides whether a
 * prefix is found again. It is a hash, so no provider learns a person id; roles get their own so
 * a work run never crowds out the chat prefix.
 */
export const cacheKeyFor = (personId: PersonId, role: ModelRole) =>
  `sa-${createHash("sha256").update(`${personId}:${role}`).digest("hex").slice(0, 32)}`;

const ephemeral = { anthropic: { cacheControl: { type: "ephemeral" } } } as const;

export interface ShapedPrompt {
  instructions: SystemModelMessage;
  messages: ModelMessage[];
  tools: ToolSet;
  providerOptions: Record<string, Record<string, unknown>>;
  headers: Record<string, string>;
}

export function shapePrompt(route: ModelRoute, request: ModelRequest, key: string): ShapedPrompt {
  assertInputBound(route, request);
  const anthropic = route.provider === "anthropic";
  const history = request.history.map((message) => ({ ...message }));
  const last = history.at(-1);
  if (anthropic && last) {
    history[history.length - 1] = {
      ...last,
      providerOptions: { ...last.providerOptions, ...ephemeral },
    } as ModelMessage;
  }
  const context: ModelMessage[] = request.context
    ? [{ role: "user", content: request.context }]
    : [];
  const tools = Object.fromEntries(
    [...request.tools]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map(({ name, description, inputSchema }) => [
        name,
        { description, inputSchema: jsonSchema(inputSchema) },
      ]),
  );
  return {
    instructions: {
      role: "system",
      content: request.system,
      ...(anthropic && { providerOptions: ephemeral }),
    },
    messages: [...history, ...context],
    tools,
    providerOptions: optionsFor(route, key),
    headers: route.provider === "fireworks" ? { "x-session-affinity": key } : {},
  };
}

function optionsFor(route: ModelRoute, key: string): ShapedPrompt["providerOptions"] {
  switch (route.provider) {
    case "anthropic":
      return { anthropic: { effort: route.effort } };
    case "openai":
      // GPT-6 caches implicitly for 30 minutes; the key sends one person's requests to one cache.
      // `store: false` keeps the exchange out of the provider's own history.
      return {
        openai: {
          reasoningEffort: route.effort,
          store: false,
          promptCacheKey: key,
          promptCacheOptions: { mode: "implicit", ttl: "30m" },
        },
      };
    case "fireworks":
      return {};
  }
}
