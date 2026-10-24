// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { check, excerpt, hash, tokens, MemoryError } from "./common.js";
import { LocalAgent, type LocalModel } from "./runtime.js";
import { Journal } from "./journal.js";
import { modelAccess } from "./model-access.js";
import { withAuth } from "./local-auth.js";
import type { ChatTurn } from "./chat-index.js";

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
  readonly agent: LocalAgent;
  readonly journal: Journal;
  readonly lock: string;
  private readonly suppliedModel: boolean;
  constructor(workspace: string, model?: LocalModel) {
    this.agent = new LocalAgent(workspace, model);
    this.suppliedModel = model !== undefined;
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

  async send(text: string, operation: string = randomUUID()): Promise<LocalChatResult> {
    operation = id(operation);
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
        const result = await this.agent.run(text, {
          history: this.context(started.turn.sequence),
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
      const value = this.agent.runtime.memory.call("chat", { operation: "resolve", id: id(operation) });
      check(value.turn, "CHAT_OPERATION_NOT_FOUND");
      return this.result(value.turn);
    }, this.lock);
  }

  async fresh() {
    return withAuth(() => this.agent.runtime.memory.call("chat", { operation: "new" }), this.lock);
  }
}
