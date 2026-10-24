// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Hosted request policy and read-only compatibility with encrypted historical transcripts.
import type { Message } from "../provider.ts";
import { createHash } from "node:crypto";
import type { OperationId, PersonId } from "../../contracts/ids.ts";
import type { Budget } from "../../money/ports.ts";
import type { ModelMessage, SystemModelMessage } from "../../contracts/historical-model.ts";
import type { ModelRole, ModelRoute } from "./catalog.ts";
import { assertFireworks } from "./fireworks.ts";
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
  // Live engine state; history above is only the legacy stored-record input.
  engineHistory?: Message[];
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
 * The cache a person's hosted requests share at Fireworks, where routing decides whether a
 * prefix is found again. It is a hash, so no provider learns a person id; roles get their own so
 * a work run never crowds out the chat prefix.
 */
export const cacheKeyFor = (personId: PersonId, role: ModelRole) =>
  `sa-${createHash("sha256").update(`${personId}:${role}`).digest("hex").slice(0, 32)}`;

export interface ShapedPrompt {
  instructions: SystemModelMessage;
  messages: ModelMessage[];
  engineHistory?: Message[];
  tools: Record<string, { description: string; inputSchema: Record<string, unknown> }>;
  providerOptions: Record<string, Record<string, unknown>>;
  headers: Record<string, string>;
}

export function shapePrompt(route: ModelRoute, request: ModelRequest, key: string): ShapedPrompt {
  assertFireworks(route.provider);
  assertInputBound(route, request);
  const history = request.history.map((message) => ({ ...message }));
  const context: ModelMessage[] = request.context
    ? [{ role: "user", content: request.context }]
    : [];
  const tools = Object.fromEntries(
    [...request.tools]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map(({ name, description, inputSchema }) => [
        name,
        { description, inputSchema },
      ]),
  );
  return {
    instructions: {
      role: "system",
      content: request.system,
    },
    messages: [...history, ...context],
    ...(request.engineHistory && { engineHistory: [...request.engineHistory, ...(request.context ? [{ role: "user" as const, content: request.context, timestamp: 0 }] : [])] }),
    tools,
    providerOptions: {},
    headers: { "x-session-affinity": key },
  };
}
