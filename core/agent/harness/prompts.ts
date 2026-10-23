// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../../contracts/codes.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The shipped prompts and the texts code sends in the person's name live in agent-text/ as plain
// files. This reads them, fills the one placeholder, and holds the always-on prompts to a budget
// (ARCHITECTURE 7: small always-on prompt, skills on demand).

// The worker image bundles our code into one file and ships agent-text/ beside it (see
// services/worker/build.ts); a checkout reads the folder at the repo root.
const shippedBeside = fileURLToPath(new URL("./agent-text", import.meta.url));
export const agentTextDirectory = existsSync(shippedBeside)
  ? shippedBeside
  : fileURLToPath(new URL("../../../../agent-text", import.meta.url));

// Bytes. A prompt rides in front of every model round and sits in the cached prefix, so each
// rule in it is paid for on every round. About a quarter of a token per byte puts chat near 1,000
// tokens. The ceilings sit 10% to 15% above today's text: new behavior goes into a skill, and a
// ceiling only rises in a reviewed change to this file.
export const promptBudgets = {
  CHAT: 4_200,
  WORK: 3_100,
  VOICE: 1_600,
  AUTHORITY: 2_100,
} as const;

export type PromptName = keyof typeof promptBudgets;

/** One line per prompt over its budget; empty when all fit. */
export function overBudget(texts: Record<PromptName, string>): string[] {
  return (Object.keys(promptBudgets) as PromptName[]).flatMap((name) => {
    const bytes = Buffer.byteLength(texts[name]);
    if (bytes <= promptBudgets[name]) return [];
    return [`${name}.md is ${bytes} bytes, over its ${promptBudgets[name]}; move rules to a skill`];
  });
}

const personNameMaxLength = 80;

/** How the person's name reads in the prompt: as given, or "user" until the agent has it. */
export function personLabel(
  name: string | null | undefined,
  fallback = "user",
  maxLength = personNameMaxLength,
): string {
  const cleaned = (name ?? "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
  return cleaned || fallback;
}

/** The prompt for one person: its last line, "Be wise for {{person}}.", gets their name. */
export function renderPrompt(text: string, personName?: string | null, agentName?: string): string {
  return text
    .replaceAll("{{person}}", () => personLabel(personName))
    .replaceAll("{{agent}}", () =>
      JSON.stringify(personLabel(agentName, "the person's agent", 100)),
    );
}

const bindings = {
  chatEnvironment: "chat-environment",
  workEnvironment: "work-environment",
  workTools: "work-tools",
  productPage: "product-page",
} as const;

/** Raw shared template plus host facts; person/agent placeholders remain for each request. */
export function readPromptTemplate(
  name: PromptName,
  directory = agentTextDirectory,
  bindingDirectory = directory,
): string {
  if (!Object.hasOwn(promptBudgets, name)) throw new CodedError("invalid_input");
  let text = readFileSync(join(directory, `${name}.md`), "utf8");
  for (const [field, file] of Object.entries(bindings)) {
    const marker = `{{${field}}}`;
    if (!text.includes(marker)) continue;
    const candidate = join(bindingDirectory, `${file}.md`);
    const path = existsSync(candidate) ? candidate : join(agentTextDirectory, `${file}.md`);
    text = text.replaceAll(marker, () => readFileSync(path, "utf8").trimEnd());
  }
  return text;
}
export function readPrompt(
  name: PromptName,
  personName?: string | null,
  directory = agentTextDirectory,
  agentName?: string,
  bindingDirectory = directory,
): string {
  return renderPrompt(readPromptTemplate(name, directory, bindingDirectory), personName, agentName);
}

/** A text code sends as written (agent-text/notices/<name>.md); throws when there is no such file. */
export function readNotice(name: string, directory = agentTextDirectory): string {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(name)) throw new CodedError("invalid_input");
  return readFileSync(join(directory, "notices", `${name}.md`), "utf8").trim();
}
