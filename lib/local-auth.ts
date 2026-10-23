// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { join, resolve, parse } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import type { z } from "zod";
import { check, MemoryError } from "./common.js";
import { saveJson } from "./local-state.js";

export const authDirectory = () =>
  resolve(process.env.SOFTAXIOM_STATE_DIR ?? join(homedir(), ".local/state/softaxiom"));

function recordPath(root: string, name: string) {
  check(/^[a-z][a-z0-9-]{0,59}$/.test(name), "INVALID_AUTH_NAME");
  return join(root, name + ".json");
}

// An unused Cloud account must not create state or make local work require a writable home.
// Presence is only metadata; an existing record still goes through the locked security checks.
export function authRecordExists(name: string, root = authDirectory()) {
  const path = recordPath(resolve(root), name);
  try { fs.lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new MemoryError("UNSAFE_AUTH_FILE");
  }
}

function directory(path: string) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/").filter(Boolean)) {
    current = join(current, part);
    try { fs.mkdirSync(current, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const stat = fs.lstatSync(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), "UNSAFE_AUTH_DIRECTORY");
    check((stat.uid === 0 || stat.uid === process.getuid?.()) &&
      ((stat.mode & 0o022) === 0 || (stat.mode & 0o1000) !== 0), "UNSAFE_AUTH_DIRECTORY");
  }
  const stat = fs.lstatSync(path);
  check(stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0, "UNSAFE_AUTH_DIRECTORY");
}

function regular(fd: number) {
  const stat = fs.fstatSync(fd);
  check(
    stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() &&
    (stat.mode & 0o077) === 0 && stat.size <= 65536,
    "UNSAFE_AUTH_FILE",
  );
}

function inspect(path: string) {
  let fd;
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    regular(fd);
    return fs.readFileSync(fd, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof MemoryError) throw error;
    throw new MemoryError("UNSAFE_AUTH_FILE");
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

class AuthRecords {
  active = true;
  readonly root: string;
  constructor(root: string) { this.root = root; }
  path(name: string) {
    check(this.active, "AUTH_LOCK_RELEASED");
    return recordPath(this.root, name);
  }
  read<T>(name: string, schema: z.ZodType<T>): T | undefined {
    const body = inspect(this.path(name));
    if (body === undefined) return;
    let value: unknown;
    try { value = JSON.parse(body); }
    catch { throw new MemoryError("INVALID_AUTH_RECORD"); }
    const parsed = schema.safeParse(value);
    check(parsed.success, "INVALID_AUTH_RECORD");
    return parsed.data;
  }
  write(name: string, value: unknown) {
    const path = this.path(name);
    inspect(path);
    const body = JSON.stringify(value);
    check(body && Buffer.byteLength(body) <= 65536, "INVALID_AUTH_RECORD");
    saveJson(path, value);
  }
  remove(name: string) {
    const path = this.path(name);
    if (inspect(path) === undefined) return;
    fs.unlinkSync(path);
    const fd = fs.openSync(this.root, "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
}

// The child holds an OS lock until this process closes its pipe, including after a crash.
// Serialize refresh, save and logout across CLI processes without passing credentials to a shell.
export async function withAuth<T>(
  run: (records: AuthRecords) => Promise<T> | T,
  root = authDirectory(),
): Promise<T> {
  root = resolve(root);
  directory(root);
  const path = join(root, "auth.lock");
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try { regular(fd); } finally { fs.closeSync(fd); }
  const child = spawn("flock", ["--exclusive", "--timeout", "30", path,
    "/bin/sh", "-c", "printf ready; /bin/cat >/dev/null"], {
    stdio: ["pipe", "pipe", "ignore"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  let acquired = false;
  const closed = new Promise<void>((done) => child.once("close", () => {
    records.active = false;
    done();
  }));
  child.stdin.on("error", () => {});
  const records = new AuthRecords(root);
  try {
    await new Promise<void>((done, fail) => {
      child.once("error", () => fail(new MemoryError("AUTH_LOCK_UNAVAILABLE")));
      child.once("close", () => {
        if (!acquired) fail(new MemoryError("AUTH_LOCK_UNAVAILABLE"));
      });
      child.stdout.once("data", (data: Buffer) => {
        if (data.toString() !== "ready") return fail(new MemoryError("AUTH_LOCK_UNAVAILABLE"));
        acquired = true;
        done();
      });
    });
    return await run(records);
  } finally {
    records.active = false;
    child.stdin.end();
    await closed;
  }
}
