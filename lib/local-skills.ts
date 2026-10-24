// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import * as fs from "node:fs";
import { resolve } from "node:path";
import { loadSkills, skillIndex } from "./core/agent/harness/skills.js";
import { secretLines } from "./core/agent/harness/secrets.js";
import { check, excerpt, MemoryError } from "./common.js";

const slug = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const directoryFlags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;

// Linux/WSL: pin every directory through an open descriptor so a concurrent rename cannot
// redirect a later component through a symlink. No recursive read or script execution.
function directory<T>(path: string[], use: (fd: number) => T): T {
  let fd = fs.openSync("/", directoryFlags);
  try {
    for (const component of path) {
      const child = fs.openSync(`/proc/self/fd/${fd}/${component}`, directoryFlags);
      fs.closeSync(fd);
      fd = child;
    }
    return use(fd);
  } catch (error) {
    if (error instanceof MemoryError) throw error;
    throw new MemoryError(
      (error as NodeJS.ErrnoException).code === "ENOENT" ? "SKILL_NOT_FOUND" : "UNSAFE_SKILL_PATH",
    );
  } finally {
    fs.closeSync(fd);
  }
}

function read(fd: number, name: string, maximum: number) {
  const file = fs.openSync(
    `/proc/self/fd/${fd}/${name}`,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const stat = fs.fstatSync(file);
    check(
      stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.(),
      "UNSAFE_SKILL_FILE",
    );
    check(stat.size <= maximum, "SKILL_FILE_TOO_LARGE");
    const bytes = Buffer.alloc(maximum + 1);
    const length = fs.readSync(file, bytes, 0, bytes.length, 0);
    check(length <= maximum, "SKILL_FILE_TOO_LARGE");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    } catch {
      throw new MemoryError("INVALID_SKILL_TEXT");
    }
    check(!text.includes("\0"), "INVALID_SKILL_TEXT");
    check(secretLines(text).length === 0, "SKILL_CONTAINS_CREDENTIAL");
    return text;
  } finally {
    fs.closeSync(file);
  }
}

export class LocalSkills {
  private readonly root: string[];
  constructor(workspace: string) {
    this.root = [...resolve(workspace).split("/").filter(Boolean), "skills"];
  }

  list(offset = 0) {
    check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000, "INVALID_SKILL_OFFSET");
    try {
      return directory(this.root, (fd) => {
        const entries = fs.opendirSync(`/proc/self/fd/${fd}`),
          skills = [];
        let position = 0,
          scanned = 0,
          skipped = 0,
          limited = false,
          next: number | null = null;
        try {
          for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
            if (position++ < offset) continue;
            if (scanned === 256 || skills.length === 20) {
              limited = position - 1 > 10000;
              next = limited ? null : position - 1;
              break;
            }
            scanned++;
            if (!entry.isDirectory() || !slug.test(entry.name)) {
              skipped++;
              continue;
            }
            try {
              const tree = directoryFrom(
                fd,
                entry.name,
                (child) => new Map([[`${entry.name}/SKILL.md`, read(child, "SKILL.md", 16000)]]),
              );
              const skill = loadSkills(tree)[0];
              check(
                skill &&
                  skill.name === entry.name &&
                  skill.description.startsWith("Use when") &&
                  skill.description.length <= 200,
                "INVALID_SKILL_METADATA",
              );
              skills.push(skill);
            } catch {
              skipped++;
            }
          }
        } finally {
          entries.closeSync();
        }
        return { index: skillIndex(skills, "skills", "workspace"), next, skipped, limited };
      });
    } catch (error) {
      if (error instanceof MemoryError && error.code === "SKILL_NOT_FOUND")
        return { index: "", next: null, skipped: 0, limited: false };
      throw error;
    }
  }

  read(path: unknown, offset = 0) {
    check(Number.isSafeInteger(offset) && offset >= 0, "INVALID_SKILL_OFFSET");
    check(typeof path === "string" && path.length <= 512, "INVALID_SKILL_PATH");
    const parts = path.split("/");
    check(
      parts.length >= 2 &&
        parts.length <= 8 &&
        slug.test(parts[0]!) &&
        parts.every((part) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(part)),
      "INVALID_SKILL_PATH",
    );
    const name = parts.pop()!;
    const text = directory([...this.root, ...parts], (fd) =>
      read(fd, name, name === "SKILL.md" ? 16000 : 64000),
    );
    return { path: `skills/${path}`, source: "workspace", ...excerpt(text, 8000, offset) };
  }

  call(operation: string, args: Record<string, unknown>) {
    check(
      Object.keys(args).every((key) => ["path", "offset"].includes(key)),
      "INVALID_SKILL_ARGUMENTS",
    );
    check(args.offset === undefined || typeof args.offset === "number", "INVALID_SKILL_OFFSET");
    if (operation === "list") {
      check(args.path === undefined, "INVALID_SKILL_ARGUMENTS");
      return this.list(args.offset);
    }
    check(operation === "read", "INVALID_SKILL_OPERATION");
    return this.read(args.path, args.offset);
  }
}

function directoryFrom<T>(parent: number, name: string, use: (fd: number) => T): T {
  const fd = fs.openSync(`/proc/self/fd/${parent}/${name}`, directoryFlags);
  try {
    return use(fd);
  } finally {
    fs.closeSync(fd);
  }
}
