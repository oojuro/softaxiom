// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { check } from "./common.js";

const id = z.uuid().transform(value => value.toLowerCase());
const evidence = z.string().regex(/^\d+$/).max(30);
const Turn = z.object({
  sequence: z.number().int().positive(), id, conversation: id,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["running", "completed", "uncertain", "resolved"]),
  user: evidence.nullable(), assistant: evidence.nullable(), session: id.nullable(),
  error: z.string().max(80).nullable(),
}).strict();
export type ChatTurn = z.infer<typeof Turn>;
const Input = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("begin"), id, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ operation: z.literal("request"), id, user: evidence, session: id }).strict(),
  z.object({ operation: z.literal("finish"), id, assistant: evidence }).strict(),
  z.object({ operation: z.literal("fail"), id, error: z.string().regex(/^[A-Z_]{1,80}$/) }).strict(),
  z.object({ operation: z.literal("get"), id }).strict(),
  z.object({ operation: z.literal("resolve"), id }).strict(),
  z.object({ operation: z.literal("new") }).strict(),
  z.object({ operation: z.literal("history"), before: z.number().int().positive().optional() }).strict(),
]);
export interface ChatIndexResult {
  conversation: string;
  turn: ChatTurn | null;
  turns: ChatTurn[];
  active: string | null;
  created: boolean;
}

// Open only inside Memory's process lock, close before returning. Checkpoints take that same
// lock; no live SQLite/WAL file is copied and no transcript is duplicated in this index.
export function chatIndex(root: string, input: unknown): ChatIndexResult {
  const parsed = Input.safeParse(input);
  check(parsed.success, "INVALID_CHAT_INDEX_REQUEST");
  const request = parsed.data, path = join(root, ".chat.sqlite");
  try {
    const stat = fs.lstatSync(path);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 &&
      stat.uid === process.getuid?.() && !(stat.mode & 0o077) && stat.size <= 64 * 1024 * 1024,
      "UNSAFE_CHAT_INDEX");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = new DatabaseSync(path);
  try {
    fs.chmodSync(path, 0o600);
    const version = db.prepare("PRAGMA user_version").get();
    check(version && Number(version.user_version) <= 1, "CHAT_INDEX_VERSION_UNSUPPORTED");
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS conversation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS turns (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, conversation TEXT NOT NULL,
        digest TEXT NOT NULL, status TEXT NOT NULL, user TEXT, assistant TEXT, session TEXT, error TEXT);
      CREATE INDEX IF NOT EXISTS chat_history ON turns(conversation,sequence);
      CREATE INDEX IF NOT EXISTS chat_active ON turns(status);
      PRAGMA user_version=1;
      BEGIN IMMEDIATE;`);
    db.prepare("INSERT OR IGNORE INTO conversation VALUES(1,?)").run(randomUUID());
    const current = () => id.parse(db.prepare("SELECT id FROM conversation").get()?.id);
    const active = () => {
      const row = db.prepare("SELECT id FROM turns WHERE status IN ('running','uncertain') LIMIT 1").get();
      return row ? id.parse(row.id) : null;
    };
    const get = (key: string) => {
      const row = db.prepare("SELECT * FROM turns WHERE id=?").get(key);
      if (!row) return null;
      const value = Turn.safeParse(row);
      check(value.success, "INVALID_CHAT_INDEX"); return value.data;
    };
    let turn: ChatTurn | null = null, turns: ChatTurn[] = [], created = false;
    if (request.operation === "begin") {
      turn = get(request.id);
      if (turn) check(turn.digest === request.digest, "CHAT_OPERATION_CONFLICT");
      else {
        const pending = active();
        check(!pending, "CHAT_RECONCILIATION_REQUIRED", { operationId: pending });
        db.prepare("INSERT INTO turns(id,conversation,digest,status) VALUES(?,?,?,'running')")
          .run(request.id, current(), request.digest);
        turn = get(request.id);
        created = true;
      }
    } else if (request.operation === "new") {
      const pending = active();
      check(!pending, "CHAT_RECONCILIATION_REQUIRED", { operationId: pending });
      db.prepare("UPDATE conversation SET id=? WHERE singleton=1").run(randomUUID());
    } else if (request.operation === "history") {
      const rows = db.prepare("SELECT * FROM turns WHERE conversation=? AND sequence<? ORDER BY sequence DESC LIMIT 10")
        .all(current(), request.before ?? Number.MAX_SAFE_INTEGER);
      turns = rows.map(row => {
        const value = Turn.safeParse(row); check(value.success, "INVALID_CHAT_INDEX"); return value.data;
      });
    } else {
      turn = get(request.id);
      check(turn, "CHAT_OPERATION_NOT_FOUND");
      if (request.operation !== "get") {
        check(["running", "uncertain"].includes(turn.status), "CHAT_OPERATION_FINISHED");
        if (request.operation === "request") {
          check(turn.status === "running" && !turn.user, "CHAT_OPERATION_CONFLICT");
          db.prepare("UPDATE turns SET user=?,session=? WHERE id=?").run(request.user, request.session, request.id);
        } else if (request.operation === "finish") {
          check(turn.status === "running" && turn.user && turn.session, "CHAT_OPERATION_CONFLICT");
          db.prepare("UPDATE turns SET status='completed',assistant=? WHERE id=?").run(request.assistant, request.id);
        } else if (request.operation === "fail") {
          db.prepare("UPDATE turns SET status='uncertain',error=? WHERE id=?").run(request.error, request.id);
        } else db.prepare("UPDATE turns SET status='resolved' WHERE id=?").run(request.id);
        turn = get(request.id);
      }
    }
    const result = { conversation: current(), turn, turns, active: active(), created };
    db.exec("COMMIT");
    return result;
  } finally { db.close(); }
}
