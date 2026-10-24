// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import type { SQLInputValue } from "node:sqlite";
import type { PreparedAction, BrowserItems } from "./browser.js";
import { DatabaseSync, backup } from "node:sqlite";
import * as fs from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { check, hash } from "./common.js";
import { localDirectory, text, httpUrl } from "./local-state.js";

const encode = (value: unknown) => JSON.stringify(value);
const decode = <T>(value: SQLInputValue | undefined): T => JSON.parse(String(value ?? "null")) as T;
const ACTIVE = "('queued','running','waiting_approval')";
const sourceKinds = ["http", "github", "mcp", "browser", "manual"];
const identifier = (value: string) => {
  text(value, 120);
  check(/^[a-zA-Z0-9_-]+$/.test(value), "INVALID_IDENTIFIER");
  return value;
};

export class Inbox {
  readonly workspace: string;
  readonly clock: () => number;
  readonly leaseMs: number;
  readonly db: DatabaseSync;
  constructor(workspace: string, { clock = Date.now, leaseMs = 60000 } = {}) {
    assertWalRuntime();
    this.workspace = workspace;
    this.clock = clock;
    this.leaseMs = leaseMs;
    const directory = localDirectory(workspace, "radar"),
      file = join(directory, "inbox.sqlite");
    check(!fs.existsSync(file) || !fs.lstatSync(file).isSymbolicLink(), "INVALID_INBOX_FILE");
    this.db = new DatabaseSync(file);
    fs.chmodSync(file, 0o600);
    check(
      this.get<{ user_version: number }>("PRAGMA user_version")!.user_version <= 1,
      "INBOX_VERSION_UNSUPPORTED",
    );
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, kind TEXT NOT NULL, config TEXT NOT NULL,
        enabled INTEGER NOT NULL, revision INTEGER NOT NULL, cursor TEXT, last_attempt INTEGER,
        last_success INTEGER, last_error TEXT, next_poll INTEGER NOT NULL DEFAULT 0,
        lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, config TEXT NOT NULL, enabled INTEGER NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), account TEXT NOT NULL,
        external_id TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, url TEXT,
        occurred_at TEXT NOT NULL, observed_at INTEGER NOT NULL, group_key TEXT NOT NULL, read_at INTEGER,
        UNIQUE(source_id, external_id));
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES subscriptions(id), group_key TEXT NOT NULL,
        status TEXT NOT NULL, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
        subscription_revision INTEGER NOT NULL, progress TEXT NOT NULL DEFAULT '{}', steps INTEGER NOT NULL DEFAULT 0,
        retries INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT, result TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (
        event_id TEXT NOT NULL REFERENCES events(id), subscription_id TEXT NOT NULL REFERENCES subscriptions(id),
        status TEXT NOT NULL DEFAULT 'pending', task_id TEXT REFERENCES tasks(id), PRIMARY KEY(event_id,subscription_id));
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), operation TEXT NOT NULL, status TEXT NOT NULL,
        result TEXT, error TEXT, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS pending_deliveries ON deliveries(status,task_id);
      CREATE INDEX IF NOT EXISTS pending_tasks ON tasks(status,next_attempt);
      CREATE INDEX IF NOT EXISTS task_groups ON tasks(subscription_id,group_key,status);
      PRAGMA user_version=1;`);
  }
  close() {
    this.db.close();
  }
  get<T = { id: string }>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }
  all<T = { id: string }>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }
  run(sql: string, ...args: SQLInputValue[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  source(id: string): Source {
    const row = this.get<SourceRow>("SELECT * FROM sources WHERE id=?", id);
    check(row, "SOURCE_NOT_FOUND");
    return {
      ...row,
      config: decode<SourceConfig>(row.config),
      cursor: decode<unknown>(row.cursor),
    } as Source;
  }
  sources() {
    return this.all("SELECT id FROM sources ORDER BY id").map((r) => this.source(r.id));
  }
  putSource(input: {
    id: string;
    account: string;
    kind: SourceKind;
    config?: Partial<SourceConfig>;
    enabled?: boolean | number;
  }) {
    const id = identifier(input.id),
      account = text(input.account, 200),
      kind = input.kind;
    check(sourceKinds.includes(kind), "INVALID_SOURCE_KIND");
    const config = structuredClone(input.config ?? {});
    check(Buffer.byteLength(encode(config)) <= 16000, "SOURCE_CONFIG_TOO_LARGE");
    if (config.tokenEnv) check(/^[A-Z_][A-Z0-9_]*$/.test(config.tokenEnv), "INVALID_KEY_ENV");
    if (config.hmacEnv) check(/^[A-Z_][A-Z0-9_]*$/.test(config.hmacEnv), "INVALID_KEY_ENV");
    if (["http", "browser"].includes(kind)) config.url = httpUrl(text(config.url)).href;
    if (kind === "browser") {
      text(config.selector, 1000);
      text(config.readySelector, 1000);
      text(config.idAttribute ?? "href", 100);
    }
    if (kind === "github") {
      check(
        typeof config.repository === "string" && /^[\w.-]+\/[\w.-]+$/.test(config.repository),
        "INVALID_GITHUB_REPOSITORY",
      );
      check(
        Array.isArray(config.pulls) &&
          config.pulls.length > 0 &&
          config.pulls.length <= 20 &&
          config.pulls.every((n) => Number.isSafeInteger(n) && n > 0),
        "INVALID_PULL_REQUESTS",
      );
      const api = httpUrl(config.api ?? "https://api.github.com");
      check(!api.search && !api.hash, "INVALID_GITHUB_API");
      config.api = api.href.replace(/\/$/, "");
    }
    if (kind === "mcp") {
      check(
        Array.isArray(config.command) &&
          config.command.length > 0 &&
          config.command.length <= 30 &&
          config.command.every((s) => typeof s === "string" && s.length < 2000),
        "INVALID_MCP_COMMAND",
      );
      text(config.tool, 200);
    }
    const intervalMs = config.intervalMs ?? 60000;
    check(
      Number.isSafeInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 86400000,
      "INVALID_POLL_INTERVAL",
    );
    config.intervalMs = intervalMs;
    const enabled = input.enabled === false ? 0 : 1;
    return this.transaction(() => {
      const old = this.get<SourceRow>("SELECT * FROM sources WHERE id=?", id);
      check(!old || (old.account === account && old.kind === kind), "SOURCE_IDENTITY_IMMUTABLE");
      if (old && old.config === encode(config) && old.enabled === enabled) return this.source(id);
      this.run(
        `INSERT INTO sources(id,account,kind,config,enabled,revision) VALUES(?,?,?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET config=excluded.config,enabled=excluded.enabled,revision=sources.revision+1,
        cursor=NULL,lease_token=NULL,lease_until=0,next_poll=0`,
        id,
        account,
        kind,
        encode(config),
        enabled,
      );
      if (old)
        for (const t of this.all(
          `SELECT DISTINCT t.id FROM tasks t JOIN deliveries d ON d.task_id=t.id
        JOIN events e ON e.id=d.event_id WHERE e.source_id=? AND t.status IN ${ACTIVE}`,
          id,
        ))
          this.cancel(t.id);
      if (old)
        this.run(
          "UPDATE deliveries SET status='cancelled' WHERE status='pending' AND event_id IN (SELECT id FROM events WHERE source_id=?)",
          id,
        );
      return this.source(id);
    });
  }
  subscription(id: string) {
    const row = this.get<SubscriptionRow>("SELECT * FROM subscriptions WHERE id=?", id);
    check(row, "SUBSCRIPTION_NOT_FOUND");
    return { ...row, config: decode<SubscriptionConfig>(row.config) };
  }
  subscriptions() {
    return this.all("SELECT id FROM subscriptions ORDER BY id").map((r) => this.subscription(r.id));
  }
  putSubscription(input: {
    id: string;
    sources: string[];
    kinds?: string[];
    instruction: string;
    allowedActions?: string[];
    origins?: string[];
    notify?: boolean;
    maxRetries?: number;
    enabled?: boolean;
  }) {
    const id = identifier(input.id);
    check(
      Array.isArray(input.sources) && input.sources.length > 0 && input.sources.length <= 30,
      "INVALID_SUBSCRIPTION_SOURCES",
    );
    for (const source of input.sources) this.source(identifier(source));
    const kinds = input.kinds ?? ["*"];
    check(
      Array.isArray(kinds) &&
        kinds.length > 0 &&
        kinds.length <= 30 &&
        kinds.every((k) => typeof k === "string" && /^[\w.*:-]{1,80}$/.test(k)),
      "INVALID_EVENT_KINDS",
    );
    const allowedActions = input.allowedActions ?? ["memory", "browser.read"];
    check(
      Array.isArray(allowedActions) &&
        allowedActions.every((a) =>
          ["memory", "skills.read", "browser.read", "browser.write"].includes(a),
        ),
      "INVALID_ACTION_SCOPE",
    );
    const origins = (input.origins ?? []).map((value) => {
      const url = httpUrl(value);
      check(url.pathname === "/" && !url.search, "ORIGIN_REQUIRED");
      return url.origin;
    });
    check(origins.length <= 30, "INVALID_ORIGINS");
    const config = {
      sources: [...new Set(input.sources)],
      kinds: [...new Set(kinds)],
      instruction: text(input.instruction, 4000),
      allowedActions: [...new Set(allowedActions)],
      origins,
      notify: input.notify !== false,
      maxRetries: input.maxRetries ?? 3,
    };
    check(
      Number.isSafeInteger(config.maxRetries) && config.maxRetries >= 0 && config.maxRetries <= 5,
      "INVALID_RETRY_LIMIT",
    );
    const enabled = input.enabled === false ? 0 : 1;
    return this.transaction(() => {
      const old = this.get<SubscriptionRow>("SELECT * FROM subscriptions WHERE id=?", id);
      if (old && old.config === encode(config) && old.enabled === enabled)
        return this.subscription(id);
      this.run(
        `INSERT INTO subscriptions(id,config,enabled,revision) VALUES(?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET config=excluded.config,enabled=excluded.enabled,revision=subscriptions.revision+1`,
        id,
        encode(config),
        enabled,
      );
      if (old)
        for (const task of this.all(
          `SELECT id FROM tasks WHERE subscription_id=? AND status IN ${ACTIVE}`,
          id,
        ))
          this.cancel(task.id);
      if (old)
        this.run(
          "UPDATE deliveries SET status='cancelled' WHERE subscription_id=? AND status='pending'",
          id,
        );
      return this.subscription(id);
    });
  }
  cancel(id: string) {
    this.run(
      "UPDATE tasks SET status='cancelled',lease_token=NULL,lease_until=0,updated_at=? WHERE id=?",
      this.clock(),
      id,
    );
    this.run("UPDATE deliveries SET status='cancelled' WHERE task_id=? AND status='pending'", id);
    this.run(
      "UPDATE actions SET status=CASE WHEN status='executing' THEN 'uncertain' ELSE 'cancelled' END WHERE task_id=? AND status IN ('pending','approved','executing')",
      id,
    );
  }
  claimSource(id: string) {
    return this.transaction(() => {
      const now = this.clock(),
        token = randomUUID();
      const { changes } = this.run(
        `UPDATE sources SET lease_token=?,lease_until=?,last_attempt=?
        WHERE id=? AND enabled=1 AND next_poll<=? AND lease_until<=?`,
        token,
        now + this.leaseMs,
        now,
        id,
        now,
        now,
      );
      return changes ? this.source(id) : null;
    });
  }
  renewSource(source: Source) {
    check(
      this.run(
        "UPDATE sources SET lease_until=? WHERE id=? AND lease_token=? AND enabled=1 AND lease_until>?",
        this.clock() + this.leaseMs,
        source.id,
        source.lease_token,
        this.clock(),
      ).changes === 1,
      "SOURCE_LEASE_LOST",
    );
  }
  failSource(source: Source, code: string) {
    this.run(
      "UPDATE sources SET last_error=?,next_poll=?,lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=? AND lease_until>?",
      code,
      this.clock() + source.config.intervalMs,
      source.id,
      source.lease_token,
      this.clock(),
    );
  }
  ingest(
    sourceId: string,
    events: SourceEvent[],
    { cursor, leaseToken }: { cursor?: unknown; leaseToken?: string | null } = {},
  ) {
    check(Array.isArray(events) && events.length <= 500, "EVENT_BATCH_TOO_LARGE");
    const valid = events.map((event) => {
      const id = text(event.id, 1000),
        kind = text(event.kind, 80),
        summary = text(event.summary, 4000);
      check(/^[\w.:-]+$/.test(kind), "INVALID_EVENT_KIND");
      const at = event.occurredAt ?? new Date(this.clock()).toISOString();
      check(Number.isFinite(Date.parse(at)), "INVALID_EVENT_TIME");
      return {
        id,
        kind,
        summary,
        url: event.url ? httpUrl(event.url).href : null,
        group: text(event.group ?? id, 1000),
        at: new Date(at).toISOString(),
      };
    });
    check(cursor === undefined || Buffer.byteLength(encode(cursor)) <= 128000, "CURSOR_TOO_LARGE");
    return this.transaction(() => {
      const source = this.source(sourceId);
      check(source.enabled, "SOURCE_DISABLED");
      if (leaseToken)
        check(
          source.lease_token === leaseToken && source.lease_until > this.clock(),
          "SOURCE_LEASE_LOST",
        );
      const subscriptions = this.subscriptions().filter(
        (s) => s.enabled && s.config.sources.includes(sourceId),
      );
      let inserted = 0;
      for (const event of valid) {
        const id = hash(encode([sourceId, source.account, event.id]));
        const added = Number(
          this.run(
            `INSERT OR IGNORE INTO events(id,source_id,account,external_id,kind,summary,url,occurred_at,observed_at,group_key)
          VALUES(?,?,?,?,?,?,?,?,?,?)`,
            id,
            sourceId,
            source.account,
            event.id,
            event.kind,
            event.summary,
            event.url,
            event.at,
            this.clock(),
            event.group,
          ).changes,
        );
        inserted += added;
        if (!added) continue;
        for (const sub of subscriptions)
          if (sub.config.kinds.includes("*") || sub.config.kinds.includes(event.kind)) {
            this.run(
              "INSERT OR IGNORE INTO deliveries(event_id,subscription_id) VALUES(?,?)",
              id,
              sub.id,
            );
          }
      }
      if (leaseToken)
        this.run(
          `UPDATE sources SET cursor=?,last_success=?,last_error=NULL,next_poll=?,lease_token=NULL,lease_until=0 WHERE id=?`,
          encode(cursor ?? null),
          this.clock(),
          this.clock() + source.config.intervalMs,
          sourceId,
        );
      return { inserted, duplicates: valid.length - inserted };
    });
  }
  events({ unread = false, limit = 50 } = {}) {
    check(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, "INVALID_LIMIT");
    return this.all<EventRow & { processed: number }>(
      `SELECT e.*, (SELECT count(*) FROM deliveries d WHERE d.event_id=e.id AND d.status='processed') AS processed
      FROM events e ${unread ? "WHERE read_at IS NULL" : ""} ORDER BY observed_at DESC,id LIMIT ?`,
      limit,
    );
  }
  markRead(id: string) {
    check(
      this.run("UPDATE events SET read_at=? WHERE id=?", this.clock(), id).changes === 1,
      "EVENT_NOT_FOUND",
    );
    return { read: id };
  }
  task(id: string) {
    const row = this.get<TaskRow>("SELECT * FROM tasks WHERE id=?", id);
    check(row, "TASK_NOT_FOUND");
    return {
      ...row,
      progress: decode<Record<string, unknown>>(row.progress),
      result: decode<unknown>(row.result),
      events: this.all<EventRow>(
        "SELECT e.* FROM events e JOIN deliveries d ON d.event_id=e.id WHERE d.task_id=? ORDER BY observed_at,e.id",
        id,
      ),
      actions: this.all<ActionRow>(
        "SELECT * FROM actions WHERE task_id=? ORDER BY created_at,id",
        id,
      ).map((a) => ({
        ...a,
        operation: decode<PreparedAction>(a.operation),
        result: decode<unknown>(a.result),
      })),
    };
  }
  tasks(limit = 30) {
    check(Number.isSafeInteger(limit) && limit > 0 && limit <= 100, "INVALID_LIMIT");
    return this.all(
      "SELECT id,subscription_id,status,error,created_at,updated_at FROM tasks ORDER BY created_at DESC LIMIT ?",
      limit,
    );
  }
  recover() {
    const expired = this.all(
      "SELECT id FROM tasks WHERE status='running' AND lease_until<=?",
      this.clock(),
    );
    for (const task of expired) {
      this.run(
        "UPDATE actions SET status='uncertain',error='WORKER_INTERRUPTED' WHERE task_id=? AND status='executing'",
        task.id,
      );
      const uncertain = this.get(
        "SELECT id FROM actions WHERE task_id=? AND status='uncertain'",
        task.id,
      );
      this.run(
        "UPDATE tasks SET status=?,lease_token=NULL,lease_until=0 WHERE id=?",
        uncertain ? "waiting_approval" : "queued",
        task.id,
      );
    }
  }
  claimTask(subscriptionId: string | null = null) {
    return this.transaction(() => {
      this.recover();
      let task = this.get<TaskRow>(
        "SELECT * FROM tasks WHERE status='queued' AND next_attempt<=? AND (? IS NULL OR subscription_id=?) ORDER BY created_at LIMIT 1",
        this.clock(),
        subscriptionId,
        subscriptionId,
      );
      if (!task) {
        for (const d of this.all<{
          event_id: string;
          subscription_id: string;
          source_id: string;
          group_key: string;
        }>(
          `SELECT d.event_id,d.subscription_id,e.source_id,e.group_key FROM deliveries d
          JOIN events e ON e.id=d.event_id JOIN subscriptions s ON s.id=d.subscription_id
          WHERE d.status='pending' AND d.task_id IS NULL AND s.enabled=1 AND (? IS NULL OR d.subscription_id=?)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.subscription_id=d.subscription_id
            AND t.group_key=json_array(e.source_id,e.group_key) AND t.status IN ${ACTIVE})
          ORDER BY e.observed_at,e.id LIMIT 1`,
          subscriptionId,
          subscriptionId,
        )) {
          const group = encode([d.source_id, d.group_key]);
          const sub = this.subscription(d.subscription_id),
            id = randomUUID(),
            now = this.clock();
          this.run(
            "INSERT INTO tasks(id,subscription_id,group_key,status,subscription_revision,created_at,updated_at) VALUES(?,?,?,'queued',?,?,?)",
            id,
            sub.id,
            group,
            sub.revision,
            now,
            now,
          );
          this.run(
            `UPDATE deliveries SET task_id=? WHERE subscription_id=? AND status='pending' AND task_id IS NULL AND event_id IN
            (SELECT e.id FROM events e JOIN deliveries pending ON pending.event_id=e.id
              WHERE e.source_id=? AND e.group_key=? AND pending.subscription_id=? AND pending.status='pending' AND pending.task_id IS NULL
              ORDER BY e.observed_at,e.id LIMIT 30)`,
            id,
            sub.id,
            d.source_id,
            d.group_key,
            sub.id,
          );
          task = this.get<TaskRow>("SELECT * FROM tasks WHERE id=?", id);
          break;
        }
      }
      if (!task) return null;
      const sub = this.subscription(task.subscription_id);
      if (!sub.enabled || sub.revision !== task.subscription_revision) {
        this.cancel(task.id);
        return null;
      }
      const token = randomUUID();
      this.run(
        "UPDATE tasks SET status='running',lease_token=?,lease_until=?,updated_at=? WHERE id=?",
        token,
        this.clock() + this.leaseMs,
        this.clock(),
        task.id,
      );
      return this.task(task.id);
    });
  }
  assertLease(id: string, token: string) {
    const task = this.get<TaskRow>("SELECT * FROM tasks WHERE id=?", id);
    check(task, "TASK_NOT_FOUND");
    const sub = this.subscription(task.subscription_id);
    check(
      task.status === "running" &&
        task.lease_token === token &&
        task.lease_until > this.clock() &&
        sub.enabled &&
        sub.revision === task.subscription_revision,
      "TASK_LEASE_LOST",
    );
    return sub;
  }
  renew(id: string, token: string) {
    this.transaction(() => {
      this.assertLease(id, token);
      this.run(
        "UPDATE tasks SET lease_until=? WHERE id=? AND lease_token=?",
        this.clock() + this.leaseMs,
        id,
        token,
      );
    });
  }
  progress(id: string, token: string, progress: Record<string, unknown>, incrementStep = false) {
    check(Buffer.byteLength(encode(progress)) <= 8192, "TASK_PROGRESS_TOO_LARGE");
    this.transaction(() => {
      this.assertLease(id, token);
      this.run(
        "UPDATE tasks SET progress=?,steps=steps+?,updated_at=? WHERE id=?",
        encode(progress),
        incrementStep ? 1 : 0,
        this.clock(),
        id,
      );
    });
  }
  complete(id: string, token: string, result: { text: string; evidence: string }) {
    text(result.text, 12000);
    return this.transaction(() => {
      this.assertLease(id, token);
      check(
        !this.get(
          "SELECT id FROM actions WHERE task_id=? AND status IN ('pending','approved','executing','uncertain')",
          id,
        ),
        "TASK_HAS_PENDING_ACTION",
      );
      this.run(
        "UPDATE tasks SET status='completed',result=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?",
        encode(result),
        this.clock(),
        id,
      );
      this.run("UPDATE deliveries SET status='processed' WHERE task_id=?", id);
      return this.task(id);
    });
  }
  fail(id: string, token: string, code: string) {
    return this.transaction(() => {
      const sub = this.assertLease(id, token),
        task = this.get<TaskRow>("SELECT * FROM tasks WHERE id=?", id);
      const uncertain = this.get(
        "SELECT id FROM actions WHERE task_id=? AND status IN ('executing','uncertain')",
        id,
      );
      this.run(
        "UPDATE actions SET status='uncertain',error=? WHERE task_id=? AND status='executing'",
        code,
        id,
      );
      check(task, "TASK_NOT_FOUND");
      const retries = task.retries + 1,
        status = uncertain
          ? "waiting_approval"
          : retries > sub.config.maxRetries
            ? "failed"
            : "queued";
      this.run(
        "UPDATE tasks SET status=?,retries=?,error=?,next_attempt=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=?",
        status,
        retries,
        code,
        this.clock() + Math.min(300000, 1000 * 2 ** retries),
        this.clock(),
        id,
      );
      if (status === "failed") {
        this.run("UPDATE deliveries SET status='failed' WHERE task_id=?", id);
        this.run("UPDATE actions SET status='cancelled' WHERE task_id=? AND status IN ('pending','approved')", id);
      }
      return this.task(id);
    });
  }
  propose(id: string, token: string, operation: PreparedAction) {
    check(Buffer.byteLength(encode(operation)) <= 16000, "ACTION_TOO_LARGE");
    return this.transaction(() => {
      const sub = this.assertLease(id, token);
      check(sub.config.allowedActions.includes("browser.write"), "ACTION_NOT_ALLOWED");
      const actionId = hash(encode([id, operation]));
      this.run(
        "INSERT OR IGNORE INTO actions(id,task_id,operation,status,created_at) VALUES(?,?,?,'pending',?)",
        actionId,
        id,
        encode(operation),
        this.clock(),
      );
      return this.action(actionId);
    });
  }
  action(id: string) {
    const row = this.get<ActionRow>("SELECT * FROM actions WHERE id=?", id);
    check(row, "ACTION_NOT_FOUND");
    return {
      ...row,
      operation: decode<PreparedAction>(row.operation),
      result: decode<unknown>(row.result),
    };
  }
  waitApproval(id: string, token: string) {
    this.transaction(() => {
      this.assertLease(id, token);
      this.run(
        "UPDATE tasks SET status='waiting_approval',lease_token=NULL,lease_until=0 WHERE id=?",
        id,
      );
    });
  }
  approve(id: string, approve = true) {
    return this.transaction(() => {
      const action = this.action(id),
        task = this.task(action.task_id),
        sub = this.subscription(task.subscription_id);
      check(
        action.status === "pending" &&
          task.status === "waiting_approval" &&
          sub.enabled &&
          sub.revision === task.subscription_revision,
        "ACTION_NOT_PENDING",
      );
      this.run("UPDATE actions SET status=? WHERE id=?", approve ? "approved" : "rejected", id);
      this.run(
        "UPDATE tasks SET status=?,updated_at=? WHERE id=?",
        approve ? "queued" : "cancelled",
        this.clock(),
        task.id,
      );
      if (!approve) this.run("UPDATE deliveries SET status='cancelled' WHERE task_id=?", task.id);
      return this.action(id);
    });
  }
  beginAction(id: string, token: string) {
    return this.transaction(() => {
      const action = this.action(id);
      const sub = this.assertLease(action.task_id, token);
      check(
        sub.config.allowedActions.includes("browser.write") && action.status === "approved",
        "ACTION_NOT_APPROVED",
      );
      this.run("UPDATE actions SET status='executing' WHERE id=?", id);
      return action;
    });
  }
  finishAction(id: string, token: string, result: unknown) {
    return this.transaction(() => {
      const action = this.action(id);
      this.assertLease(action.task_id, token);
      check(action.status === "executing", "ACTION_NOT_EXECUTING");
      check(Buffer.byteLength(encode(result)) <= 8192, "ACTION_RESULT_TOO_LARGE");
      this.run("UPDATE actions SET status='succeeded',result=? WHERE id=?", encode(result), id);
      return this.action(id);
    });
  }
  resolveAction(id: string, outcome: string) {
    return this.transaction(() => {
      const action = this.action(id);
      check(
        action.status === "uncertain" && ["succeeded", "failed"].includes(outcome),
        "ACTION_NOT_UNCERTAIN",
      );
      this.run(
        "UPDATE actions SET status=?,result=? WHERE id=?",
        outcome,
        encode({ operatorResolved: true, outcome }),
        id,
      );
      const task = this.task(action.task_id);
      if (task.status === "waiting_approval")
        this.run("UPDATE tasks SET status='queued' WHERE id=?", task.id);
      return this.action(id);
    });
  }
  async backup(destination: string) {
    check(!fs.existsSync(destination), "BACKUP_DESTINATION_EXISTS");
    await backup(this.db, destination);
    fs.chmodSync(destination, 0o600);
    return { path: destination };
  }
  prune(before: string) {
    check(Number.isFinite(Date.parse(before)), "INVALID_RETENTION_DATE");
    return this.transaction(() => {
      const eligible = this.all(
        `SELECT e.id FROM events e WHERE e.read_at IS NOT NULL AND e.observed_at<?
        AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id=e.id AND d.status='pending')
        AND NOT EXISTS (SELECT 1 FROM deliveries d JOIN actions a ON a.task_id=d.task_id
          WHERE d.event_id=e.id AND a.status='uncertain')`,
        Date.parse(before),
      );
      for (const e of eligible)
        this.run(
          "UPDATE events SET summary='Content removed by owner',url=NULL,external_id=? WHERE id=?",
          hash(e.id),
          e.id,
        );
      for (const t of this.all(
        `SELECT id FROM tasks t WHERE status IN ('completed','cancelled','failed')
        AND NOT EXISTS (SELECT 1 FROM deliveries d JOIN events e ON e.id=d.event_id WHERE d.task_id=t.id AND (e.read_at IS NULL OR e.observed_at>=?))
        AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.task_id=t.id AND a.status='uncertain')`,
        Date.parse(before),
      )) {
        this.run(
          "UPDATE tasks SET progress='{}',result=? WHERE id=?",
          encode({ pruned: true }),
          t.id,
        );
        this.run(
          "UPDATE actions SET operation='{}',result=? WHERE task_id=?",
          encode({ pruned: true }),
          t.id,
        );
      }
      return { pruned: eligible.length, deduplicationTombstonesRetained: true };
    });
  }
  forgetSource(id: string) {
    const source = this.source(id);
    this.putSource({ ...source, enabled: false });
    return this.transaction(() => {
      const tasks = this.all(
        "SELECT DISTINCT task_id AS id FROM deliveries d JOIN events e ON e.id=d.event_id WHERE e.source_id=? AND task_id IS NOT NULL",
        id,
      );
      for (const task of tasks)
        check(
          !this.get("SELECT id FROM actions WHERE task_id=? AND status='uncertain'", task.id),
          "RESOLVE_UNCERTAIN_ACTION_FIRST",
        );
      this.run(
        "DELETE FROM deliveries WHERE event_id IN (SELECT id FROM events WHERE source_id=?)",
        id,
      );
      this.run("DELETE FROM events WHERE source_id=?", id);
      for (const task of tasks) {
        this.run("DELETE FROM actions WHERE task_id=?", task.id);
        this.run("DELETE FROM tasks WHERE id=?", task.id);
      }
      for (const sub of this.subscriptions().filter((s) => s.config.sources.includes(id))) {
        sub.config.sources = sub.config.sources.filter((s) => s !== id);
        for (const task of this.all(
          `SELECT id FROM tasks WHERE subscription_id=? AND status IN ${ACTIVE}`,
          sub.id,
        ))
          this.cancel(task.id);
        this.run(
          "UPDATE deliveries SET status='cancelled' WHERE subscription_id=? AND status='pending'",
          sub.id,
        );
        this.run(
          "UPDATE subscriptions SET config=?,enabled=0,revision=revision+1 WHERE id=?",
          encode(sub.config),
          sub.id,
        );
      }
      this.run("DELETE FROM sources WHERE id=?", id);
      return { deleted: id, relatedSubscriptionsDisabled: true, journalAndBackupsUnchanged: true };
    });
  }
}

export type SourceKind = "http" | "github" | "mcp" | "browser" | "manual";
interface CommonSourceConfig {
  intervalMs: number;
  tokenEnv?: string;
  hmacEnv?: string;
}
export interface SourceConfig extends CommonSourceConfig, BrowserItems {
  url: string;
  api: string;
  repository: string;
  pulls: number[];
  command: string[];
  tool: string;
  arguments?: Record<string, unknown>;
  cursorArgument?: string;
  emitInitial?: boolean;
  eventKind?: string;
}
interface ConfigByKind {
  http: CommonSourceConfig & { url: string };
  github: CommonSourceConfig & { api: string; repository: string; pulls: number[] };
  mcp: CommonSourceConfig & Pick<SourceConfig, "command" | "tool" | "arguments" | "cursorArgument">;
  browser: CommonSourceConfig &
    BrowserItems &
    Pick<SourceConfig, "url" | "emitInitial" | "eventKind">;
  manual: CommonSourceConfig;
}
interface CursorByKind {
  github: { reviews?: Record<number, number> };
  browser: { items?: Record<string, string> };
  http: unknown;
  mcp: unknown;
  manual: unknown;
}
interface SourceRow {
  id: string;
  account: string;
  kind: SourceKind;
  config: string;
  enabled: number;
  revision: number;
  cursor: string | null;
  lease_token: string | null;
  lease_until: number;
  last_attempt: number | null;
  last_success: number | null;
  last_error: string | null;
  next_poll: number;
}
export type Source<K extends SourceKind = SourceKind> = {
  [P in K]: Omit<SourceRow, "config" | "cursor" | "kind"> & {
    kind: P;
    config: ConfigByKind[P];
    cursor: CursorByKind[P] | null;
  };
}[K];
interface SubscriptionConfig {
  sources: string[];
  kinds: string[];
  instruction: string;
  allowedActions: string[];
  origins: string[];
  notify: boolean;
  maxRetries: number;
}
interface SubscriptionRow {
  id: string;
  config: string;
  enabled: number;
  revision: number;
}
interface TaskRow {
  id: string;
  subscription_id: string;
  group_key: string;
  status: string;
  lease_token: string | null;
  lease_until: number;
  subscription_revision: number;
  progress: string;
  result: string | null;
  steps: number;
  retries: number;
  next_attempt: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}
interface ActionRow {
  id: string;
  task_id: string;
  operation: string;
  status: string;
  result: string | null;
  error: string | null;
  created_at: number;
}
export interface EventRow {
  id: string;
  source_id: string;
  account: string;
  external_id: string;
  kind: string;
  summary: string;
  url: string | null;
  occurred_at: string;
  observed_at: number;
  group_key: string;
  read_at: number | null;
}
export interface SourceEvent {
  id: string;
  kind: string;
  summary: string;
  url?: string;
  occurredAt?: string;
  group?: string;
}
export type Task = ReturnType<Inbox["task"]>;

// https://sqlite.org/wal.html#walresetbug: test the linked engine, including known backports.
export function supportsWal(version: string): boolean {
  const match = /^3\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const minor = Number(match[1]),
    patch = Number(match[2]);
  return (
    minor > 51 ||
    (minor === 51 && patch >= 3) ||
    (minor === 50 && patch >= 7) ||
    (minor === 44 && patch >= 6)
  );
}

export function assertWalRuntime(): void {
  const probe = new DatabaseSync(":memory:");
  try {
    const row = probe.prepare("SELECT sqlite_version() AS version").get();
    check(
      row && typeof row.version === "string" && supportsWal(row.version),
      "SQLITE_UPGRADE_REQUIRED",
    );
  } finally {
    probe.close();
  }
}
