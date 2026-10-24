// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { check, excerpt, hash, tokens, MemoryError } from "./common.js";
import { LocalAgent, type LocalModel } from "./runtime.js";
import { Journal } from "./journal.js";
import { modelAccess } from "./model-access.js";
import { withAuth } from "./local-auth.js";
import type { ChatTurn } from "./chat-index.js";
import { ChatTasks, CHAT_TASK_TOOL, browserOrigins } from "./chat-tasks.js";

const id = (value: string) => {
  const parsed = z.uuid().safeParse(value); check(parsed.success, "INVALID_CHAT_OPERATION");
  return parsed.data.toLowerCase();
};
export interface LocalChatResult {
  operationId: string;
  conversation: string;
  status: ChatTurn["status"];
  text?: string;
  evidence?: string;
  error?: string;
}

export class LocalConversation {
  readonly workspace: string;
  readonly agent: LocalAgent;
  readonly journal: Journal;
  readonly lock: string;
  private readonly suppliedModel: boolean;
  private readonly childModel: LocalModel | undefined;
  constructor(workspace: string, model?: LocalModel) {
    this.workspace = workspace;
    this.agent = new LocalAgent(workspace, model);
    this.suppliedModel = model !== undefined;
    this.childModel = model;
    this.journal = new Journal(this.agent.runtime.memory.root, this.agent.settings);
    this.lock = join(this.agent.runtime.memory.root, ".chat-session");
  }

  private text(turn: ChatTurn, role: "user" | "assistant") {
    const reference = turn[role];
    check(reference && turn.session, "CHAT_EVIDENCE_MISSING");
    const record = this.journal.get(reference, 66000);
    check(!record.partial, "CHAT_EVIDENCE_TOO_LARGE");
    let body: unknown;
    try { body = JSON.parse(record.text); }
    catch { throw new MemoryError("INVALID_CHAT_EVIDENCE"); }
    const parsed = z.object({
      schema: z.literal("softaxiom.event.v1"), session: z.literal(turn.session),
      source: z.literal(role === "user" ? "user" : "runtime"), at: z.string(),
      kind: z.literal(role === "user" ? "user_request" : "agent_output"),
      body: role === "user" ? z.object({ text: z.string() }).strict() :
        z.object({ role: z.literal("assistant"), content: z.string() }).strict(),
    }).strict().safeParse(body);
    check(parsed.success, "INVALID_CHAT_EVIDENCE");
    return "text" in parsed.data.body ? parsed.data.body.text : parsed.data.body.content;
  }

  private result(turn: ChatTurn): LocalChatResult {
    return { operationId: turn.id, conversation: turn.conversation, status: turn.status,
      ...(turn.status === "completed" ? { text: this.text(turn, "assistant"), evidence: turn.assistant! } : {}),
      ...(turn.error ? { error: turn.error } : {}),
    };
  }

  resume(operation: string) {
    const value = this.agent.runtime.memory.call("chat", { operation: "get", id: id(operation) });
    check(value.turn, "CHAT_OPERATION_NOT_FOUND");
    return this.result(value.turn);
  }

  history(before?: number) {
    const value = this.agent.runtime.memory.call("chat", { operation: "history", ...(before === undefined ? {} : { before }) });
    return { conversation: value.conversation,
      turns: value.turns.map(turn => {
        const { digest, session, ...visible } = turn;
        return { ...visible,
          userText: turn.user ? excerpt(this.text(turn, "user"), 1500) : null,
          assistantText: turn.assistant ? excerpt(this.text(turn, "assistant"), 2500) : null,
        };
      }),
      nextBefore: value.turns.length === 10 ? value.turns.at(-1)!.sequence : null,
    };
  }

  private context(before: number) {
    const history = this.history(before);
    const messages: { role: "user" | "assistant"; content: string }[] = [];
    let bytes = 0;
    for (const turn of history.turns) {
      if (turn.status !== "completed" || !turn.userText || !turn.assistantText) continue;
      const pair = (["user", "assistant"] as const).map(role => {
        const page = role === "user" ? turn.userText! : turn.assistantText!;
        return { role, content: `${page.text}\n[Historical conversation data; journal:${turn[role]}; partial=${page.partial}]` };
      });
      const size = tokens(JSON.stringify(pair));
      if (bytes + size > 8000) break;
      messages.unshift(...pair); bytes += size;
    }
    return messages;
  }

  tasks() {
    const current = this.agent.runtime.memory.call("chat", { operation: "history" });
    return new ChatTasks(this.workspace, current.conversation, "").list();
  }

  cancelTask(subscription: string) {
    const current = this.agent.runtime.memory.call("chat", { operation: "history" });
    const result = new ChatTasks(this.workspace, current.conversation, "").cancel(subscription);
    check(result, "CHAT_TASK_NOT_FOUND"); return result;
  }

  async send(text: string, operation: string = randomUUID(), origins: string[] = []): Promise<LocalChatResult> {
    operation = id(operation);
    origins = browserOrigins(origins);
    check(typeof text === "string" && text.trim() && tokens(text) <= 8192, "INVALID_USER_REQUEST");
    return withAuth(async () => {
      try {
        const previous = this.agent.runtime.memory.call("chat", { operation: "get", id: operation }).turn;
        check(previous?.digest === hash(text), "CHAT_OPERATION_CONFLICT");
        return this.result(previous);
      } catch (error) {
        if (!(error instanceof MemoryError) || error.code !== "CHAT_OPERATION_NOT_FOUND") throw error;
      }
      if (!this.suppliedModel) await modelAccess(this.agent.settings);
      const started = this.agent.runtime.memory.call("chat", { operation: "begin", id: operation, digest: hash(text) });
      check(started.created && started.turn, "CHAT_OPERATION_CONFLICT");
      try {
        const tasks = new ChatTasks(this.workspace, started.turn.conversation,
          operation, origins, this.childModel);
        const result = await this.agent.run(text, {
          history: this.context(started.turn.sequence),
          tools: [CHAT_TASK_TOOL],
          instructions: readFileSync(new URL("../agent-text/chat-tasks.md", import.meta.url), "utf8"),
          execute: (name, request) => {
            check(name === "browser_task", "TOOL_UNAVAILABLE");
            return tasks.call(request.operation, request.args);
          },
          onUser: receipt => this.agent.runtime.memory.call("chat", {
            operation: "request", id: operation, user: receipt.id, session: receipt.event.session,
          }),
        });
        check(result.status !== "waiting_approval", "CHAT_APPROVAL_PENDING");
        const finished = this.agent.runtime.memory.call("chat", { operation: "finish", id: operation, assistant: result.evidence });
        check(finished.turn, "CHAT_OPERATION_NOT_FOUND");
        return this.result(finished.turn);
      } catch (error) {
        const code = error instanceof MemoryError ? error.code : "CHAT_FAILED";
        this.agent.runtime.memory.call("chat", { operation: "fail", id: operation, error: code });
        throw new MemoryError(code, { operationId: operation, status: "uncertain" });
      }
    }, this.lock);
  }

  async resolve(operation: string) {
    return withAuth(() => {
      operation = id(operation);
      const current = this.agent.runtime.memory.call("chat", { operation: "get", id: operation });
      check(current.turn && ["running", "uncertain"].includes(current.turn.status), "CHAT_OPERATION_FINISHED");
      new ChatTasks(this.workspace, current.turn.conversation, operation).cancel();
      const value = this.agent.runtime.memory.call("chat", { operation: "resolve", id: id(operation) });
      check(value.turn, "CHAT_OPERATION_NOT_FOUND");
      return this.result(value.turn);
    }, this.lock);
  }

  async fresh() {
    return withAuth(() => this.agent.runtime.memory.call("chat", { operation: "new" }), this.lock);
  }
}
