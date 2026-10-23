// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// The tools the model can call, read from plain files (`agent-text/tools/<name>.md`): a front
// matter that says what the tool is and what its input looks like, and a body that is the
// description the model reads. Tool descriptions are harness text like prompts and skills, so
// they can be read, changed and tested without touching code. Code only decides what is safe:
// whether a call may run beside others, and whether its result is outside content.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type EffectKind, effectKinds } from "../../contracts/canvas.ts";
import { CodedError } from "../../contracts/codes.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ModelRole } from "../gateway/catalog.ts";
import type { ToolDefinition } from "../gateway/prompt.ts";
import { agentTextDirectory } from "../harness/prompts.ts";

/** File name (`read.md`) to text. */
export type ToolTree = ReadonlyMap<string, string>;
export type ToolProblem = { file: string; message: string };

const frontMatter = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const header = z
  .strictObject({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    // A read-only call changes nothing, so calls of one round may run together; anything else runs
    // alone, in the order the model gave.
    access: z.enum(["read_only", "effect"]),
    // What kind of effect the tool has, for one that sends, pays or deletes. The runtime then
    // lets a call through only when code finds the person's own word covers it (authority).
    effect: z.enum(effectKinds).optional(),
    // Results are outside content (a page, a mail, a file) unless the tool says they are ours.
    outside: z.boolean().default(true),
    roles: z
      .array(z.enum(["chat", "work", "authority"]))
      .min(1)
      .default(["chat", "work"]),
    input: z.looseObject({ type: z.literal("object") }),
  })
  .refine(({ access, effect }) => effect === undefined || access === "effect", {
    path: ["effect"],
    message: "only a tool with access effect declares an effect",
  });

export type CheckedInput = { ok: true; value: unknown } | { ok: false; issues: string[] };

export interface Tool {
  name: string;
  description: string;
  readOnly: boolean;
  effect?: EffectKind;
  outside: boolean;
  roles: readonly ModelRole[];
  inputSchema: Record<string, unknown>;
  // Validates a model-made input. Issues name the field and the kind of mistake, never the value.
  check(input: unknown): CheckedInput;
}

function parseTool(file: string, text: string): Tool {
  const split = frontMatter.exec(text);
  if (!split) throw new Error("has no front matter");
  const parsed = header.safeParse(parseYaml(split[1] ?? ""));
  if (!parsed.success) {
    const what = parsed.error.issues.map(
      ({ path, message }) => `${path.join(".") || "front matter"}: ${message}`,
    );
    throw new Error(what.join("; "));
  }
  const fields = parsed.data;
  if (`${fields.name}.md` !== file) throw new Error(`is named ${fields.name}, not after its file`);
  const description = text.slice(split[0].length).trim();
  if (description === "") throw new Error("has no description");
  const schema = z.fromJSONSchema(fields.input as Parameters<typeof z.fromJSONSchema>[0]);
  return {
    name: fields.name,
    description,
    readOnly: fields.access === "read_only",
    ...(fields.effect && { effect: fields.effect }),
    outside: fields.outside,
    roles: fields.roles,
    inputSchema: fields.input,
    check(input) {
      const result = schema.safeParse(input);
      if (result.success) return { ok: true, value: result.data };
      return {
        ok: false,
        issues: result.error.issues.map(
          ({ path, code }) => `${path.join(".") || "input"}: ${code}`,
        ),
      };
    },
  };
}

/** Every problem in the tree; never throws, whatever the files hold. */
export function toolProblems(tree: ToolTree): ToolProblem[] {
  const problems: ToolProblem[] = [];
  for (const [file, text] of tree) {
    try {
      parseTool(file, text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "cannot be read";
      problems.push({ file, message });
    }
  }
  return problems;
}

export function readToolTree(directory = join(agentTextDirectory, "tools")): ToolTree {
  const files = readdirSync(directory).filter((file) => file.endsWith(".md"));
  return new Map(files.sort().map((file) => [file, readFileSync(join(directory, file), "utf8")]));
}

export type Registry = ReturnType<typeof loadTools>;

/** The registry, or a coded `invalid_input` failure at start if any file is malformed. */
export function loadTools(tree: ToolTree) {
  if (toolProblems(tree).length > 0) throw new CodedError("invalid_input");
  const tools = new Map(
    [...tree].map(([file, text]) => [file.replace(/\.md$/, ""), parseTool(file, text)]),
  );
  return {
    get: (name: string) => tools.get(name),
    readOnly: (name: string) => tools.get(name)?.readOnly,
    isOutside: (name: string) => tools.get(name)?.outside ?? true,
    definitions(role: ModelRole): ToolDefinition[] {
      return [...tools.values()]
        .filter((tool) => tool.roles.includes(role))
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    },
  };
}
