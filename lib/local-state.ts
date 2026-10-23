// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { join, resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { check, cleanText, tokens } from "./common.js";

export function localDirectory(workspace: string, name = "") {
  const base = join(resolve(workspace), ".softaxiom");
  for (const path of [resolve(workspace), base, ...(name ? [join(base, name)] : [])]) {
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    check(
      fs.lstatSync(path).isDirectory() && !fs.lstatSync(path).isSymbolicLink(),
      "INVALID_LOCAL_DIRECTORY",
    );
    if (path !== resolve(workspace)) fs.chmodSync(path, 0o700);
  }
  return name ? join(base, name) : base;
}

export function saveJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, path);
  const dir = fs.openSync(dirname(path), "r");
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}

export function text(value: unknown, limit = 4096) {
  check(typeof value === "string" && value.trim() && tokens(value) <= limit, "INVALID_TEXT");
  return cleanText(value);
}

export function httpUrl(value: string, { local = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    check(false, "INVALID_URL");
  }
  check(!url.username && !url.password && (!local || !url.hash), "INVALID_URL");
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  check(
    local
      ? loopback && ["http:", "ws:"].includes(url.protocol)
      : url.protocol === "https:" || (url.protocol === "http:" && loopback),
    "URL_NOT_ALLOWED",
  );
  // Do not let a hostname lookup redirect a local control channel away from loopback.
  if (local && url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url;
}

export const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export function jsonInput<T = unknown>(): T {
  const input = fs.readFileSync(0, "utf8");
  check(Buffer.byteLength(input) <= 1024 * 1024, "INPUT_TOO_LARGE");
  try {
    return JSON.parse(input) as T;
  } catch {
    check(false, "INVALID_JSON_INPUT");
  }
}
