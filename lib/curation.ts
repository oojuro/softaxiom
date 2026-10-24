// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Pure readable-file validation shared by local storage and hosted Files projections.
import { check, cleanText, hash, tokens, MemoryError, type Tier } from "./common.js";
export const memoryId = /^[a-z0-9][a-z0-9-]{0,63}$/;
export interface MemoryMeta {
  id: string;
  title: string;
  status: string;
  supersededBy: string[];
  sources: string[];
  origin: string;
}
export interface MemoryRecord extends MemoryMeta {
  tier: Tier;
  body: string;
  revision: string;
  tokens: number;
  raw: string;
}
export function parseMemory(text: string, tier: Tier, file: string): MemoryRecord {
  cleanText(text);
  const match = /^---\n([^\n]+)\n---\n([\s\S]*)$/.exec(text);
  check(match, "INVALID_MEMORY_FILE", { file });
  let meta: MemoryMeta;
  try {
    meta = JSON.parse(match[1]!);
  } catch {
    throw new MemoryError("INVALID_MEMORY_FILE", { file });
  }
  const allowed = ["id", "title", "status", "supersededBy", "sources", "origin"];
  check(
    meta && typeof meta === "object" && Object.keys(meta).every((k) => allowed.includes(k)),
    "INVALID_MEMORY_METADATA",
    { file },
  );
  check(
    typeof meta.id === "string" && memoryId.test(meta.id) && `${meta.id}.md` === file,
    "INVALID_MEMORY_ID",
  );
  check(
    typeof meta.title === "string" && meta.title.trim() && tokens(meta.title) <= 200,
    "INVALID_TITLE",
  );
  check(["active", "superseded"].includes(meta.status), "INVALID_MEMORY_STATUS");
  check(["user", "agent", "tool"].includes(meta.origin), "INVALID_MEMORY_ORIGIN");
  check(
    Array.isArray(meta.sources) &&
      meta.sources.length <= 20 &&
      meta.sources.every(
        (s) =>
          typeof s === "string" &&
          /^(journal:\d+|diary:\d{4}-\d{2}-\d{2}|memory:[a-z0-9][a-z0-9-]{0,63})$/.test(s),
      ),
    "INVALID_SOURCES",
  );
  check(
    Array.isArray(meta.supersededBy) &&
      meta.supersededBy.length <= 20 &&
      meta.supersededBy.every((id) => memoryId.test(id) && id !== meta.id),
    "INVALID_SUPERSESSION",
  );
  check(meta.status === "superseded" || meta.supersededBy.length === 0, "INVALID_SUPERSESSION");
  check(match[2]!.trim().length > 0, "EMPTY_MEMORY");
  const memory = { ...meta, tier, body: match[2]!, revision: hash(text), tokens: tokens(text) };
  Object.defineProperty(memory, "raw", { value: text });
  return memory as MemoryRecord;
}

