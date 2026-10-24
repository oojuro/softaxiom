// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { resolve, relative, join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { z } from "zod";
import { check, cleanText, excerpt, hash, MemoryError } from "./common.js";
import { authDirectory, authRecordExists, withAuth } from "./local-auth.js";

const Grant = z.object({
  version: z.literal(1), id: z.uuid(), workspace: z.string(), folder: z.string(),
  device: z.number(), inode: z.number(), write: z.boolean(), terminal: z.boolean(),
}).strict();
const Result = z.object({
  operation: z.uuid(), status: z.enum(["completed", "uncertain"]),
  stdout: z.string(), stderr: z.string(), exitCode: z.number().nullable(),
  signal: z.string().nullable(), reason: z.string().nullable(),
}).strict();
const Receipt = z.object({
  digest: z.string(), status: z.enum(["running", "completed", "uncertain"]),
  result: Result.optional(),
}).strict();
const Active = z.object({ operation: z.uuid() }).strict();
const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
const hidden = (name: string) =>
  [".git", ".softaxiom", ".ssh", ".aws", ".azure", ".config", ".local", ".secrets", ".sendblue", "memory"].includes(name) ||
  /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);

function parts(path: unknown, empty = false): string[] {
  check(typeof path === "string" && path.length <= 1024, "INVALID_FILE_PATH");
  if (empty && path === "") return [];
  const names = path.split("/");
  check(names.length <= 32 && names.every(name =>
    name.length > 0 && name.length <= 255 && name !== "." && name !== ".." &&
    !hidden(name) && !/[\x00-\x1f\x7f\\]/.test(name)), "FILE_PATH_NOT_ALLOWED");
  return names;
}

function openDirectory(path: string) {
  let fd = fs.openSync("/", flags);
  try {
    for (const name of resolve(path).split("/").filter(Boolean)) {
      const next = fs.openSync(`/proc/self/fd/${fd}/${name}`, flags);
      fs.closeSync(fd); fd = next;
    }
    return fd;
  } catch {
    fs.closeSync(fd);
    throw new MemoryError("UNSAFE_EXECUTION_DIRECTORY");
  }
}

function within<T>(root: number, names: string[], use: (fd: number) => T): T {
  // Keep the root descriptor owned by the caller; child descriptors close on every path.
  if (!names.length) return use(root);
  const fd = fs.openSync(`/proc/self/fd/${root}/${names[0]}`, flags);
  try {
    const stat = fs.fstatSync(fd);
    check(stat.uid === process.getuid?.() && !(stat.mode & 0o022), "UNSAFE_EXECUTION_DIRECTORY");
    return within(fd, names.slice(1), use);
  }
  finally { fs.closeSync(fd); }
}

function bytes(fd: number, name: string) {
  const file = fs.openSync(`/proc/self/fd/${fd}/${name}`,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(file);
    check(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.(), "UNSAFE_FILE");
    check(stat.size <= 1024 * 1024, "FILE_TOO_LARGE");
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    const length = fs.readSync(file, buffer, 0, buffer.length, 0);
    check(length <= 1024 * 1024, "FILE_TOO_LARGE");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { throw new MemoryError("INVALID_FILE_TEXT"); }
    cleanText(text);
    return { text, revision: hash(text), mode: stat.mode & 0o777 };
  } finally { fs.closeSync(file); }
}

export class LocalExecution {
  readonly workspace: string;
  readonly state: string;
  readonly key: string;
  readonly receipts: string;
  constructor(workspace: string, state = authDirectory(), namespace = "project") {
    check(["project", "specialist"].includes(namespace), "INVALID_EXECUTION_NAMESPACE");
    this.workspace = resolve(workspace); this.state = resolve(state);
    this.key = "execution-" + hash(this.workspace + (namespace === "project" ? "" : ":" + namespace)).slice(0, 32);
    this.receipts = join(this.state, this.key);
  }

  private async grant() {
    check(authRecordExists(this.key, this.state), "EXECUTION_NOT_GRANTED");
    const grant = await withAuth(records => records.read(this.key, Grant), this.state);
    check(grant && grant.workspace === this.workspace, "EXECUTION_NOT_GRANTED");
    return grant;
  }

  async status() {
    if (!authRecordExists(this.key, this.state)) return { granted: false as const };
    const grant = await this.grant();
    return { granted: true as const, folder: grant.folder, write: grant.write, terminal: grant.terminal };
  }

  async allow(folder: string, write = false, terminal = false) {
    folder = resolve(this.workspace, folder);
    const path = relative(this.workspace, folder);
    check(!path.startsWith(".." + sep) && path !== ".." && !path.startsWith(sep), "FOLDER_OUTSIDE_WORKSPACE");
    parts(path, true);
    const overlap = (a: string, b: string) => a === b || a.startsWith(b + sep);
    check(!overlap(folder, this.state) && !overlap(this.state, folder), "AUTH_DIRECTORY_IN_SCOPE");
    const fd = openDirectory(folder);
    try {
      const stat = fs.fstatSync(fd);
      check(stat.uid === process.getuid?.() && !(stat.mode & 0o022), "UNSAFE_EXECUTION_DIRECTORY");
      await withAuth(records => records.write(this.key, {
        version: 1, id: randomUUID(), workspace: this.workspace, folder,
        device: stat.dev, inode: stat.ino, write, terminal,
      }), this.state);
    } finally { fs.closeSync(fd); }
    return this.status();
  }

  async revoke() {
    if (authRecordExists(this.key, this.state))
      await withAuth(records => records.remove(this.key), this.state);
    return { granted: false as const };
  }

  private root(grant: z.infer<typeof Grant>) {
    const fd = openDirectory(grant.folder), stat = fs.fstatSync(fd);
    if (stat.dev !== grant.device || stat.ino !== grant.inode ||
      stat.uid !== process.getuid?.() || (stat.mode & 0o022)) {
      fs.closeSync(fd); throw new MemoryError("EXECUTION_SCOPE_CHANGED");
    }
    return fd;
  }

  async files(operation: string, args: Record<string, unknown>, authority: () => void = () => {}) {
    check(["list", "read", "write", "mkdir"].includes(operation), "INVALID_FILE_OPERATION");
    check(Object.keys(args).every(key => ["path", "offset", "text", "expectedRevision"].includes(key)), "INVALID_FILE_ARGUMENTS");
    return withAuth(async () => {
      const grant = await this.grant(), root = this.root(grant);
      try {
        authority();
        const names = parts(args.path ?? "", operation === "list");
        check(!["write", "mkdir"].includes(operation) || grant.write, "FILE_WRITE_NOT_GRANTED");
        const offset = args.offset ?? 0;
        check(typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0 && offset <= 1048576, "INVALID_FILE_OFFSET");
        if (operation === "list") return within(root, names, fd => {
          const directory = fs.opendirSync(`/proc/self/fd/${fd}`), entries = [];
          let index = 0, scanned = 0, next: number | null = null;
          try {
            for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
              if (index++ < offset) continue;
              if (++scanned > 256 || entries.length === 50) { next = index - 1; break; }
              if (!hidden(entry.name) && (entry.isFile() || entry.isDirectory()))
                entries.push({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file" });
            }
          } finally { directory.closeSync(); }
          return { entries, next };
        });
        const name = names.pop()!;
        return within(root, names, fd => {
          const path = `/proc/self/fd/${fd}/${name}`;
          if (operation === "mkdir") {
            check(Object.keys(args).every(key => key === "path"), "INVALID_FILE_ARGUMENTS");
            fs.mkdirSync(path, { mode: 0o700 }); return { created: true };
          }
          if (operation === "read") {
            const data = bytes(fd, name);
            return { revision: data.revision, ...excerpt(data.text, 8000, offset) };
          }
          check(typeof args.text === "string" && Buffer.byteLength(args.text) <= 65536, "INVALID_FILE_TEXT");
          cleanText(args.text);
          check(args.expectedRevision === null ||
            (typeof args.expectedRevision === "string" && /^[a-f0-9]{64}$/.test(args.expectedRevision)), "FILE_REVISION_REQUIRED");
          let current;
          try { current = bytes(fd, name); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          check((current?.revision ?? null) === args.expectedRevision, "FILE_REVISION_CONFLICT");
          const temporary = `/proc/self/fd/${fd}/.sa-write-${randomUUID()}`;
          const file = fs.openSync(temporary, "wx", current?.mode ?? 0o600);
          try {
            fs.writeFileSync(file, args.text); fs.fsyncSync(file);
            if (!current) fs.linkSync(temporary, path);
            else fs.renameSync(temporary, path);
            fs.fsyncSync(fd);
          } finally { fs.closeSync(file); fs.rmSync(temporary, { force: true }); }
          return { revision: hash(args.text), written: true };
        });
      } catch (error) {
        if (error instanceof MemoryError) throw error;
        throw new MemoryError("FILE_ACCESS_FAILED");
      } finally { fs.closeSync(root); }
    }, this.receipts);
  }

  async receipt(operation: string) {
    check(z.uuid().safeParse(operation).success, "INVALID_EXECUTION_ID");
    return withAuth(records => records.read("op-" + operation, Receipt), this.receipts);
  }

  async resolve(operation: string) {
    check(z.uuid().safeParse(operation).success, "INVALID_EXECUTION_ID");
    return withAuth(records => {
      const active = records.read("active", Active);
      check(active?.operation === operation, "NO_UNCERTAIN_EXECUTION");
      const name = "op-" + operation, previous = records.read(name, Receipt);
      check(previous, "EXECUTION_RECEIPT_MISSING");
      records.write(name, { ...previous, status: "uncertain" });
      records.remove("active");
      return { operation, acknowledged: true, repeated: false };
    }, this.receipts);
  }

  async terminal(args: Record<string, unknown>, authority: () => void = () => {}) {
    const parsed = z.object({
      operation: z.uuid(), argv: z.array(z.string().max(4096).refine(value => !value.includes("\0"))).min(1).max(64),
      cwd: z.string().default(""),
    }).strict().safeParse(args);
    check(parsed.success && Buffer.byteLength(JSON.stringify(args)) <= 16384, "INVALID_EXECUTION_REQUEST");
    const request = parsed.data;
    check(request.argv[0], "INVALID_EXECUTION_REQUEST");
    parts(request.cwd, true);
    cleanText(JSON.stringify(request.argv));
    return withAuth(async records => {
      const grant = await this.grant();
      check(grant.terminal, "TERMINAL_NOT_GRANTED");
      authority();
      const name = "op-" + request.operation, digest = hash(JSON.stringify({ grant: grant.id, request }));
      const previous = records.read(name, Receipt);
      if (previous) {
        check(previous.digest === digest, "EXECUTION_ID_CONFLICT");
        return previous.result ?? { operation: request.operation, status: "uncertain" as const };
      }
      check(!records.read("active", Active), "EXECUTION_RECONCILIATION_REQUIRED");
      check(fs.readdirSync(this.receipts).filter(name => name.startsWith("op-")).length < 256, "EXECUTION_RECEIPT_LIMIT");
      const root = this.root(grant);
      try {
        const masks = scan(root);
        const command = ["--unshare-all", "--unshare-user", "--disable-userns", "--die-with-parent", "--new-session", "--cap-drop", "ALL",
          "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin"];
        for (const directory of ["lib", "lib64", "sbin"])
          if (fs.existsSync("/" + directory)) command.push("--ro-bind", "/" + directory, "/" + directory);
        command.push("--dir", "/tools", "--ro-bind", process.execPath, "/tools/node",
          "--proc", "/proc", "--dev", "/dev", "--size", "67108864", "--tmpfs", "/tmp",
          "--dir", "/home", "--dir", "/home/agent",
          grant.write ? "--bind-fd" : "--ro-bind-fd", "3", "/work");
        for (const mask of masks) {
          const path = "/work/" + mask.path;
          if (mask.directory) command.push("--size", "4096", "--tmpfs", path, "--remount-ro", path);
          else command.push("--ro-bind", "/dev/null", path);
        }
        command.push("--chdir", "/work" + (request.cwd ? "/" + request.cwd : ""), "--clearenv",
          "--setenv", "PATH", "/tools:/usr/bin:/bin", "--setenv", "HOME", "/home/agent",
          "--setenv", "NODE_OPTIONS", "--jitless --max-old-space-size=256",
          "--setenv", "TMPDIR", "/tmp", "--setenv", "LANG", "C.UTF-8", "--",
          "/usr/bin/prlimit", "--as=1073741824", "--cpu=10", "--fsize=16777216", "--nofile=128", "--nproc=64", "--core=0", "--", ...request.argv);
        records.write(name, { digest, status: "running" });
        records.write("active", { operation: request.operation });
        const result = await this.command(command, root, grant.id, request.operation, authority);
        records.write(name, { digest, status: result.status, result });
        if (result.status === "completed") records.remove("active");
        return result;
      } finally { fs.closeSync(root); }
    }, this.receipts);
  }

  private command(argv: string[], fd: number, grantId: string, operation: string, authority: () => void): Promise<z.infer<typeof Result>> {
    return new Promise((done) => {
      const child = spawn("/usr/bin/bwrap", argv, {
        stdio: ["ignore", "pipe", "pipe", fd], detached: true, env: { PATH: "/usr/bin:/bin" },
      });
      let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), size = 0, reason: string | null = null, checking = false, closed = false;
      const stop = (code: string) => {
        if (closed) return;
        reason ??= code;
        if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch {} }
      };
      const output = (stream: "stdout" | "stderr", chunk: Buffer) => {
        size += chunk.length;
        if (size > 32768) { stop("TERMINAL_OUTPUT_LIMIT"); return; }
        if (stream === "stdout") stdout = Buffer.concat([stdout, chunk]);
        else stderr = Buffer.concat([stderr, chunk]);
      };
      child.stdout!.on("data", (data: Buffer) => output("stdout", data));
      child.stderr!.on("data", (data: Buffer) => output("stderr", data));
      child.on("error", () => { reason ??= "SANDBOX_UNAVAILABLE"; });
      const timer = setTimeout(() => stop("TERMINAL_TIME_LIMIT"), 20000);
      const watch = setInterval(() => {
        if (checking) return;
        checking = true;
        void this.grant().then(grant => {
          check(grant.id === grantId, "EXECUTION_REVOKED"); authority();
        }).catch(() => stop("EXECUTION_REVOKED")).finally(() => { checking = false; });
      }, 200);
      child.once("close", (exitCode, signal) => {
        closed = true;
        clearTimeout(timer); clearInterval(watch);
        if (signal) reason ??= "TERMINAL_INTERRUPTED";
        let out = stdout.toString("utf8"), err = stderr.toString("utf8");
        try { cleanText(out); cleanText(err); }
        catch { out = ""; err = ""; reason ??= "TERMINAL_OUTPUT_CONTAINS_CREDENTIAL"; }
        if (Buffer.byteLength(JSON.stringify({ stdout: out, stderr: err })) > 40000) {
          out = ""; err = ""; reason ??= "TERMINAL_OUTPUT_LIMIT";
        }
        done({ operation, status: reason ? "uncertain" : "completed", stdout: out, stderr: err,
          exitCode, signal, reason });
      });
    });
  }
}

// Refuse pre-existing aliases/devices/sockets before exposing a writable mount. The command
// cannot create links to host files or sockets absent from its private mount/network namespaces.
function scan(root: number) {
  const masks: { path: string; directory: boolean }[] = [];
  let count = 0;
  function visit(fd: number, prefix: string, depth: number) {
    check(depth <= 32, "EXECUTION_TREE_LIMIT");
    const directory = fs.opendirSync(`/proc/self/fd/${fd}`);
    try {
      for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
        check(++count <= 50000, "EXECUTION_TREE_LIMIT");
        const path = prefix + entry.name, file = `/proc/self/fd/${fd}/${entry.name}`;
        if (hidden(entry.name)) {
          check(!entry.isSymbolicLink(), "UNSAFE_EXECUTION_TREE");
          check(entry.isDirectory() || entry.isFile(), "UNSAFE_EXECUTION_TREE");
          masks.push({ path, directory: entry.isDirectory() }); continue;
        }
        const stat = fs.lstatSync(file);
        check(stat.uid === process.getuid?.() && (stat.isDirectory() || stat.isSymbolicLink() ||
          (stat.isFile() && stat.nlink === 1)), "UNSAFE_EXECUTION_TREE");
        check(!stat.isDirectory() || !(stat.mode & 0o022), "UNSAFE_EXECUTION_TREE");
        if (stat.isDirectory()) within(fd, [entry.name], child => visit(child, path + "/", depth + 1));
      }
    } finally { directory.closeSync(); }
  }
  visit(root, "", 0);
  return masks;
}
