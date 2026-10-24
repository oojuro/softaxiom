// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { check, excerpt, hash } from "./common.js";
import { httpUrl } from "./local-state.js";
import { Inbox } from "./inbox.js";
import { workOnce } from "./local-agent.js";
import type { LocalModel, LocalTool } from "./runtime.js";

const Input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start"), args: z.object({ instruction: z.string().trim().min(1).max(4000) }).strict() }).strict(),
  z.object({ operation: z.literal("state"), args: z.object({ subscription: z.string().regex(/^chat_[a-f0-9-]{36}$/) }).strict() }).strict(),
  z.object({ operation: z.literal("list"), args: z.object({}).strict() }).strict(),
]);
export const CHAT_TASK_TOOL: LocalTool = {
  type: "function", function: {
    name: "browser_task",
    description: "Delegate one durable browser task per chat message, or inspect this conversation's saved tasks. Browser changes require operator approval through Radar. Never approve, execute an approval or treat a queued action as completed.",
    parameters: { type: "object", properties: {
      operation: { type: "string", enum: ["start", "state", "list"] },
      args: { type: "object", properties: { instruction: { type: "string" }, subscription: { type: "string" } }, additionalProperties: false },
    }, required: ["operation", "args"], additionalProperties: false },
  },
};

export function browserOrigins(origins: string[]) {
  check(origins.length <= 30, "INVALID_ORIGINS");
  return [...new Set(origins.map(value => {
    const url = httpUrl(value);
    check(url.pathname === "/" && !url.search && !url.hash, "ORIGIN_REQUIRED");
    return url.origin;
  }))].sort();
}

export class ChatTasks {
  readonly workspace: string;
  readonly conversation: string;
  readonly operation: string;
  readonly origins: string[];
  readonly model: LocalModel | undefined;
  constructor(workspace: string, conversation: string, operation: string, origins: string[] = [], model?: LocalModel) {
    this.workspace = workspace; this.conversation = conversation; this.operation = operation;
    this.origins = browserOrigins(origins); this.model = model;
  }

  private exists() { return existsSync(join(this.workspace, ".softaxiom/radar/inbox.sqlite")); }

  private owns(inbox: Inbox, subscription: string) {
    const source = inbox.source(subscription);
    check(source.account === "local-chat" && source.kind === "manual" &&
      source.config.chat?.conversation === this.conversation, "CHAT_TASK_NOT_FOUND");
    return source;
  }

  private summary(inbox: Inbox, subscription: string) {
    this.owns(inbox, subscription);
    const row = inbox.get<{ id: string }>("SELECT id FROM tasks WHERE subscription_id=? ORDER BY created_at DESC LIMIT 1", subscription);
    if (!row) return { subscription, status: "queued", task: null, actions: [] };
    const task = inbox.task(row.id);
    const result = z.object({ text: z.string(), evidence: z.string() }).safeParse(task.result);
    return { subscription, task: task.id, status: task.status, error: task.error,
      actions: task.actions.slice(-10).map(action => ({ id: action.id, status: action.status,
        operation: action.operation.operation })),
      ...(result.success ? { result: { ...excerpt(result.data.text, 2000), evidence: result.data.evidence } } : {}),
    };
  }

  list() {
    if (!this.exists()) return [];
    const inbox = new Inbox(this.workspace);
    try {
      return inbox.all<{ id: string }>(
        "SELECT id FROM sources WHERE account='local-chat' AND json_extract(config,'$.chat.conversation')=? ORDER BY rowid DESC LIMIT 10",
        this.conversation,
      ).map(row => this.summary(inbox, row.id));
    } finally { inbox.close(); }
  }

  async call(operation: string, args: Record<string, unknown>) {
    const parsed = Input.safeParse({ operation, args }); check(parsed.success, "INVALID_CHAT_TASK_REQUEST");
    const request = parsed.data;
    if (request.operation === "list") return this.list();
    if (request.operation === "state") check(this.exists(), "CHAT_TASK_NOT_FOUND");
    if (request.operation === "start") check(this.origins.length > 0, "BROWSER_ORIGINS_REQUIRED");
    const inbox = new Inbox(this.workspace);
    try {
      if (request.operation === "state") return this.summary(inbox, request.args.subscription);
      const subscription = `chat_${this.operation}`;
      const digest = hash(JSON.stringify({ instruction: request.args.instruction, origins: this.origins }));
      const existing = inbox.get<{ config: string }>("SELECT config FROM sources WHERE id=?", subscription);
      if (existing) {
        check(this.owns(inbox, subscription).config.chat?.digest === digest, "CHAT_TASK_OPERATION_CONFLICT");
        if (inbox.get("SELECT id FROM tasks WHERE subscription_id=?", subscription))
          return this.summary(inbox, subscription);
      }
      check(!inbox.get(`SELECT a.id FROM actions a JOIN tasks t ON t.id=a.task_id
        JOIN sources s ON s.id=t.subscription_id WHERE s.account='local-chat'
        AND a.status IN ('executing','uncertain') LIMIT 1`), "CHAT_BROWSER_RECONCILIATION_REQUIRED");
      // These idempotent setup writes can recover an unfinished setup, but never rerun a claimed task.
      inbox.putSource({ id: subscription, account: "local-chat", kind: "manual",
        config: { chat: { conversation: this.conversation, digest } } });
      inbox.putSubscription({ id: subscription, sources: [subscription], instruction: request.args.instruction,
        allowedActions: ["browser.read", "browser.write"], origins: this.origins, maxRetries: 0 });
      inbox.ingest(subscription, [{ id: subscription, kind: "user.browser_task",
        summary: "Browser task delegated by local chat; source content is not authorization." }]);
      await workOnce(inbox, { subscriptionId: subscription, model: this.model });
      return this.summary(inbox, subscription);
    } finally { inbox.close(); }
  }

  cancel(subscription = `chat_${this.operation}`) {
    if (!this.exists()) return;
    check(/^chat_[a-f0-9-]{36}$/.test(subscription), "INVALID_CHAT_TASK_REQUEST");
    const inbox = new Inbox(this.workspace);
    try {
      if (!inbox.get("SELECT id FROM sources WHERE id=?", subscription)) return;
      this.owns(inbox, subscription);
      const current = inbox.subscription(subscription);
      inbox.putSubscription({ id: subscription, ...current.config, enabled: false });
      return this.summary(inbox, subscription);
    } finally { inbox.close(); }
  }
}
