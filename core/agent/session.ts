// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { buildSessionContext, compact, prepareCompaction, type AgentMessage, type SessionTreeEntry, type StreamFn } from "./engine.ts";
import type { Model } from "./provider.ts";

/** Storage/policy adapter. Pairing, retained windows and summaries are selected by OpenClaw. */
export class SessionProjection {
  private readonly entries: SessionTreeEntry[] = [];
  private readonly ids = new WeakMap<AgentMessage, string>();

  private append(messages: AgentMessage[]) {
    for (const message of messages) {
      if (this.ids.has(message)) continue;
      const id = randomUUID();
      this.entries.push({ type: "message", id, parentId: this.entries.at(-1)?.id ?? null,
        timestamp: new Date().toISOString(), message });
      this.ids.set(message, id);
    }
  }

  async context(messages: AgentMessage[], options: {
    limit: number;
    bytes(messages: AgentMessage[]): number;
    model: Model;
    summaryContextWindow?: number;
    stream: StreamFn;
    signal?: AbortSignal | undefined;
    preserve?: AgentMessage | undefined;
    persist(entry: Extract<SessionTreeEntry, { type: "compaction" }>): string | Promise<string>;
  }) {
    this.append(messages);
    let context = buildSessionContext(this.entries).messages;
    if (options.bytes(context) <= options.limit) return context;
    const preserved = options.preserve && this.ids.get(options.preserve);
    const prepared = prepareCompaction(this.entries, {
      enabled: true, reserveTokens: Math.max(1024, options.model.maxTokens ?? 1024),
      keepRecentTokens: Math.max(256, Math.floor(options.limit / 8)),
    }, "unresolved", {
      ...(preserved ? { preserveFromEntryId: preserved } : {}),
      budget: { maxTokens: options.limit, reserveTokens: 0, estimateTokens: message => options.bytes([message]) },
    });
    if (!prepared.ok || !prepared.value) throw new Error("Context cannot be compacted safely");
    const reserve = prepared.value.settings.reserveTokens;
    const window = options.summaryContextWindow ?? (Math.floor(options.limit / 4) + reserve + 1024);
    if (!Number.isSafeInteger(window) || window <= 0) throw new Error("Invalid summary context window");
    const contextWindow = options.model.contextWindow ?? window;
    const model = { ...options.model, contextWindow: contextWindow > 0
      ? Math.min(contextWindow, window) : window };
    const result = await compact(prepared.value, model, undefined, undefined, undefined,
      options.signal, "off", options.stream);
    if (!result.ok) throw new Error("Context compaction failed");
    const entry = { type: "compaction" as const, id: randomUUID(),
      parentId: this.entries.at(-1)?.id ?? null, timestamp: new Date().toISOString(), ...result.value };
    // A failed durable write leaves the previous context authoritative.
    entry.summary = await options.persist(entry);
    this.entries.push(entry);
    context = buildSessionContext(this.entries).messages;
    if (options.bytes(context) > options.limit) throw new Error("Compacted context exceeds its limit");
    return context;
  }
}
