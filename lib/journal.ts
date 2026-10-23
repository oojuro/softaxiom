// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Settings } from "./common.js";
import { check, MemoryError, excerpt } from "./common.js";

export class Journal {
  readonly root: string;
  readonly settings: Settings;
  constructor(root: string, settings: Settings) {
    this.root = root;
    this.settings = settings;
  }

  call<T = NativeRecord>(args: string[], input = ""): T {
    const result = spawnSync(
      this.settings.oojuro,
      [
        "--home",
        join(this.root, ".oojuro"),
        "--store",
        join(this.root, "cold"),
        "--direct",
        "--json",
        ...args,
      ],
      {
        input,
        encoding: "utf8",
        cwd: this.root,
        timeout: 30000,
        maxBuffer: (args[0] === "range" ? 64 : 4) * 1024 * 1024,
      },
    );
    // Do not echo subprocess stderr: failures may contain private input or local paths.
    check(!result.error && result.status === 0, "OOJURO_FAILED", { command: args[0] });
    try {
      return JSON.parse(result.stdout) as T;
    } catch {
      throw new MemoryError("INVALID_OOJURO_RESPONSE");
    }
  }

  record<T>(
    kind: string,
    body: T,
    {
      session = "operator",
      at = new Date().toISOString(),
      source = "runtime",
    }: { session?: string; at?: string; source?: string } = {},
  ): JournalReceipt<T> {
    const envelope = { schema: "softaxiom.event.v1", kind, session, at, source, body };
    const receipt = this.call(
      [
        "remember",
        "--writer",
        "softaxiom:local",
        "--at",
        at,
        "--key",
        `event:${randomUUID()}`,
        "-",
      ],
      JSON.stringify(envelope),
    );
    check(Number.isSafeInteger(receipt.id), "INVALID_OOJURO_RESPONSE");
    const stored = this.call(["get", String(receipt.id)]);
    check(stored && typeof stored.text === "string", "INVALID_OOJURO_RESPONSE");
    let event: {
      schema: string;
      kind: string;
      session: string;
      at: string;
      source: string;
      body: T;
    };
    try {
      event = JSON.parse(stored.text);
    } catch {
      throw new MemoryError("INVALID_REDACTED_EVENT");
    }
    return { id: String(receipt.id), event, redacted: receipt.redacted };
  }

  get(id: string, limit: number, offset = 0) {
    check(typeof id === "string" && /^\d+$/.test(id), "INVALID_EVIDENCE_ID");
    const record = this.call(["get", id]);
    check(record && record.writer === "softaxiom:local", "EVIDENCE_NOT_FOUND");
    return { id, at: record.ts, ...excerpt(record.text, limit, offset) };
  }

  search(query: string, limit: number, bytes: number) {
    check(
      typeof query === "string" && query.trim() && Buffer.byteLength(query) <= 8192,
      "INVALID_QUERY",
    );
    return this.call<NativeHit[]>(
      [
        "search",
        "-",
        "--writer",
        "softaxiom:local",
        "-k",
        String(limit),
        "--excerpt-bytes",
        String(bytes),
      ],
      query,
    ).map((hit) => ({
      id: String(hit.id),
      at: hit.ts,
      text: hit.excerpt,
      start: hit.start,
      end: hit.end,
      bytes: hit.len,
      partial: hit.start > 0 || hit.end < hit.len,
    }));
  }

  range(from: string, to: string, limit: number) {
    const records = this.call<NativeRecord[]>([
      "range",
      "--from",
      from,
      "--to",
      to,
      "--writer",
      "softaxiom:local",
      "--limit",
      String(limit),
    ]);
    return { records, partial: records.length === limit };
  }
}

export interface NativeRecord {
  id: number;
  writer: string;
  text: string;
  ts: string;
  redacted?: boolean;
}
interface NativeHit {
  id: number;
  ts: string;
  excerpt: string;
  start: number;
  end: number;
  len: number;
}
export interface JournalReceipt<T = unknown> {
  id: string;
  event: { schema: string; kind: string; session: string; at: string; source: string; body: T };
  redacted?: boolean | undefined;
}
