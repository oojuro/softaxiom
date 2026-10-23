// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import type { FileSource } from "../context/ports.ts";
import { secretLines } from "./secrets.ts";

// One loader and one validator for shipped skills (agent-text/skills, a CI gate) and personal
// skills (the person's skills/ folder, advice only). Both arrive as a tree of files, so the same
// code serves the repo, the worker image and the person's encrypted workspace.

/** Files under a skills root: path relative to it (`book-travel/SKILL.md`) to its text. */
export type SkillTree = ReadonlyMap<string, string>;

export type Skill = { folder: string; name: string; description: string; body: string };

export type SkillRule =
  | "missing_skill_file"
  | "front_matter_missing"
  | "front_matter_unreadable"
  | "name_not_folder"
  | "description_not_use_when"
  | "description_too_long"
  | "too_large"
  | "missing_linked_file"
  | "link_outside_skill"
  | "secret";

export type SkillProblem = { path: string; rule: SkillRule; message: string };

const skillFile = "SKILL.md";
// Every description is always in context through the index, so it stays one short sentence.
const maxDescriptionLength = 200;
// An opened skill is read whole into context.
const maxSkillBytes = 16_000;
const frontMatter = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const markdownLink = /\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
// URLs, in-page anchors and absolute paths (like /opt/sa/docs) are not files of the skill.
const notASkillFile = /^(?:[a-z][a-z\d+.-]*:|#|\/)/i;

export function readSkillTree(root: string): SkillTree {
  if (!existsSync(root)) return new Map();
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) =>
    entry.isFile(),
  );
  return new Map(
    files.map((entry) => {
      const absolute = join(entry.parentPath, entry.name);
      return [relative(root, absolute).split(sep).join("/"), readFileSync(absolute, "utf8")];
    }),
  );
}

/** Every problem in the tree; never throws, whatever the files hold. */
export function validateSkills(tree: SkillTree): SkillProblem[] {
  return [...skillFolders(tree)]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([folder, paths]) => [
      ...checkSkillFile(tree, folder),
      ...paths.flatMap((path) => secretProblems(path, tree.get(path) ?? "")),
    ]);
}

/** The skills that can be indexed: each has a readable name and description. */
export function loadSkills(tree: SkillTree): Skill[] {
  return [...skillFolders(tree).keys()].sort().flatMap((folder) => {
    const parsed = parseSkillFile(tree.get(`${folder}/${skillFile}`) ?? "");
    if ("problem" in parsed) return [];
    const { name, description } = parsed.fields;
    if (typeof name !== "string" || typeof description !== "string") return [];
    return [
      { folder, name, description: description.replace(/\s+/g, " ").trim(), body: parsed.body },
    ];
  });
}

/** One always-on line per skill: where it is and when to open it. */
export function skillIndex(skills: Skill[], root: string, source: FileSource): string {
  return skills
    .map(
      ({ folder, description }) =>
        `- ${root}/${folder}/SKILL.md (source: ${source}): ${description}`,
    )
    .join("\n");
}

// A personal skill is the agent's own note: a flaw is reported back to it, and nothing it wrote is
// refused or fails the command that wrote it (R11-052).
/** Advice for personal skills, one line per problem, or undefined when all are well-formed. */
export function skillAdvice(tree: SkillTree, root: string): string | undefined {
  const problems = validateSkills(tree);
  if (problems.length === 0) return undefined;
  const text = problems
    .slice(0, 20)
    .map(({ path, message }) => `${root}/${path}: ${message}`)
    .join("\n");
  const bytes = Buffer.from(text);
  const suffix = problems.length > 20 || bytes.length > 4000 ? "\n[skill advice truncated]" : "";
  return bytes.subarray(0, 4000).toString("utf8") + suffix;
}

// Loose files at the root belong to no skill and are left alone.
function skillFolders(tree: SkillTree): Map<string, string[]> {
  const folders = new Map<string, string[]>();
  for (const path of tree.keys()) {
    const slash = path.indexOf("/");
    if (slash < 0) continue;
    const folder = path.slice(0, slash);
    folders.set(folder, [...(folders.get(folder) ?? []), path]);
  }
  return folders;
}

type ParsedSkillFile =
  | { fields: Record<string, unknown>; body: string }
  | { problem: "front_matter_missing" | "front_matter_unreadable" };

function parseSkillFile(text: string): ParsedSkillFile {
  const match = frontMatter.exec(text);
  if (!match) return { problem: "front_matter_missing" };
  try {
    const fields: unknown = parseYaml(match[1] ?? "");
    if (fields !== null && typeof fields === "object" && !Array.isArray(fields)) {
      return { fields: fields as Record<string, unknown>, body: text.slice(match[0].length) };
    }
  } catch {
    // Unreadable YAML is reported below like YAML that is not a mapping.
  }
  return { problem: "front_matter_unreadable" };
}

function checkSkillFile(tree: SkillTree, folder: string): SkillProblem[] {
  const path = `${folder}/${skillFile}`;
  const text = tree.get(path);
  if (text === undefined) return [problem(folder, "missing_skill_file", `has no ${skillFile}`)];
  const parsed = parseSkillFile(text);
  if ("problem" in parsed) {
    return [problem(path, parsed.problem, "needs front matter: a YAML mapping between --- lines")];
  }
  const { name, description } = parsed.fields;
  const problems: SkillProblem[] = [];
  if (name !== folder) {
    const message = "name must equal its folder";
    problems.push(problem(path, "name_not_folder", message));
  }
  if (typeof description !== "string" || !description.startsWith("Use when")) {
    problems.push(problem(path, "description_not_use_when", 'description must start "Use when"'));
  } else if (description.length > maxDescriptionLength) {
    const message = `description must be at most ${maxDescriptionLength} characters`;
    problems.push(problem(path, "description_too_long", message));
  }
  if (Buffer.byteLength(text) > maxSkillBytes) {
    problems.push(problem(path, "too_large", `must be at most ${maxSkillBytes} bytes`));
  }
  return [...problems, ...linkProblems(tree, folder, path, parsed.body)];
}

function linkProblems(tree: SkillTree, folder: string, path: string, body: string) {
  return [...body.matchAll(markdownLink)].flatMap(([, target = ""]) => {
    if (notASkillFile.test(target)) return [];
    const linked = posix.normalize(posix.join(folder, target.split("#")[0] ?? ""));
    if (!linked.startsWith(`${folder}/`)) {
      return [problem(path, "link_outside_skill", "links outside its folder")];
    }
    if (tree.has(linked)) return [];
    return [problem(path, "missing_linked_file", "links to a missing file")];
  });
}

// The message names the line, never the text: advice and CI logs must not repeat a credential.
function secretProblems(path: string, text: string): SkillProblem[] {
  return secretLines(text).map((line) =>
    problem(path, "secret", `line ${line} looks like a credential; keep credentials out of skills`),
  );
}

function problem(path: string, rule: SkillRule, message: string): SkillProblem {
  return { path, rule, message };
}
