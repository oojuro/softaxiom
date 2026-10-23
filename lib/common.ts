// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";

export class MemoryError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

export function check(
  condition: unknown,
  code: string,
  details: Record<string, unknown> = {},
): asserts condition {
  if (!condition) throw new MemoryError(code, details);
}

export const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
// Conservative model-independent estimate: one capacity unit per UTF-8 byte, including metadata.
export const tokens = (text: string) => Buffer.byteLength(text, "utf8");
export const TIERS = ["hot", "warm", "cool"] as const;
export type Tier = (typeof TIERS)[number];
export const DEFAULTS = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  tiers: { hot: 4000, warm: 32000, cool: 256000 },
  context: { hot: 4000, related: 4000, excerpt: 1000, request: 32000 },
  diary: { day: 8000, excerpt: 2000 },
  agent: { maxSteps: 10, maintenanceAttempts: 3, maxOutputTokens: 2048 },
  model: { baseUrl: "http://127.0.0.1:11434/v1", name: "", apiKeyEnv: "SOFTAXIOM_API_KEY" },
  oojuro: "oojuro",
};

export type Settings = typeof DEFAULTS;

export function config(input: unknown = {}) {
  const result = structuredClone(DEFAULTS);
  check(input && typeof input === "object" && !Array.isArray(input), "INVALID_CONFIG");
  for (const [key, value] of Object.entries(input)) {
    check(Object.hasOwn(result, key), "UNKNOWN_CONFIG_KEY", { key });
    if (typeof result[key as keyof Settings] === "object") {
      check(value && typeof value === "object" && !Array.isArray(value), "INVALID_CONFIG");
      for (const [sub, val] of Object.entries(value)) {
        check(Object.hasOwn(result[key as keyof Settings] as object, sub), "UNKNOWN_CONFIG_KEY", {
          key: `${key}.${sub}`,
        });
        Reflect.set(result[key as keyof Settings] as object, sub, val);
      }
    } else Reflect.set(result, key, value);
  }
  for (const group of ["tiers", "context", "diary", "agent"]) {
    for (const value of Object.values(result[group as "tiers" | "context" | "diary" | "agent"])) {
      check(Number.isSafeInteger(value) && value > 0 && value <= 10000000, "INVALID_LIMIT");
    }
  }
  check(
    result.tiers.hot < result.tiers.warm && result.tiers.warm < result.tiers.cool,
    "INVALID_TIER_ORDER",
  );
  check(
    result.context.request >= result.context.hot + result.context.related + 4000,
    "REQUEST_BUDGET_TOO_SMALL",
  );
  check(
    result.agent.maxSteps <= 30 && result.agent.maintenanceAttempts <= 5,
    "INVALID_AGENT_LIMIT",
  );
  check(typeof result.timezone === "string", "INVALID_TIMEZONE");
  try {
    new Intl.DateTimeFormat("en", { timeZone: result.timezone });
  } catch {
    throw new MemoryError("INVALID_TIMEZONE");
  }
  check(typeof result.oojuro === "string" && result.oojuro.length > 0, "INVALID_OOJURO_EXECUTABLE");
  check(typeof result.model.name === "string" && tokens(result.model.name) < 200, "INVALID_MODEL");
  check(
    typeof result.model.apiKeyEnv === "string" && /^[A-Z_][A-Z0-9_]*$/.test(result.model.apiKeyEnv),
    "INVALID_KEY_ENV",
  );
  let url;
  try {
    url = new URL(result.model.baseUrl);
  } catch {
    throw new MemoryError("INVALID_MODEL_URL");
  }
  check(!url.username && !url.password && !url.search && !url.hash, "INVALID_MODEL_URL");
  check(
    url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
    "MODEL_REQUIRES_HTTPS",
  );
  return result;
}

export function cleanText(text: unknown): string {
  check(typeof text === "string" && !text.includes("\0"), "INVALID_TEXT");
  // Curated text is rejected, never silently rewritten. Raw capture uses Oojuro's redactor.
  const patterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{12,}/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /\b(?:password|api[_-]?key|access[_-]?token|secret)\s*[=:]\s*["']?[^\s"'<>]{6,}/i,
    /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
  ];
  check(!patterns.some((p) => p.test(text)), "SECRET_IN_CURATED_CONTENT");
  return text;
}

export function dayAt(at: string | number | Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validDay(day: unknown): number {
  check(typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day), "INVALID_DAY");
  const time = Date.parse(`${day}T00:00:00Z`);
  check(Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day, "INVALID_DAY");
  return time;
}

export function dayBounds(day: string, timezone: string) {
  const midnight = validDay(day);
  const next = new Date(midnight + 86400000).toISOString().slice(0, 10);
  const start = (target: string, guess: number) => {
    let lo = guess - 36 * 3600000,
      hi = guess + 36 * 3600000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (dayAt(mid, timezone) < target) lo = mid + 1;
      else hi = mid;
    }
    check(dayAt(lo, timezone) === target, "DAY_NOT_IN_TIMEZONE");
    return lo;
  };
  return {
    from: new Date(start(day, midnight)).toISOString(),
    to: new Date(start(next, midnight + 86400000) - 1).toISOString().replace(/999Z$/, "999999Z"),
  };
}

export function excerpt(text: string, limit: number, offset = 0) {
  check(Number.isSafeInteger(offset) && offset >= 0, "INVALID_OFFSET");
  const data = Buffer.from(text);
  let start = Math.min(offset, data.length);
  while (start < data.length && (data[start]! & 0xc0) === 0x80) start++;
  let end = Math.min(start + limit, data.length);
  while (end < data.length && (data[end]! & 0xc0) === 0x80) end--;
  return {
    text: data.subarray(start, end).toString(),
    start,
    end,
    bytes: data.length,
    partial: start > 0 || end < data.length,
  };
}
