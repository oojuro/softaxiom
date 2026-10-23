// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { prefix } from "../context/clip.ts";
import type { StoredLine, TranscriptReader } from "../context/ports.ts";
/** What the person wrote and may still be relied on: this recent, and no more of it than this. */
export const instructionWindowMs = 24 * 60 * 60 * 1000;
const newestMessages = 10;
const messageChars = 1_500;
const linesRead = 200;
const dayFile = /^conversations\/\d{4}-\d{2}-\d{2}\.jsonl$/;

export interface PersonMessage {
  id: string;
  at: string;
  text: string;
  // Actual preceding speech from the same call; never a model tool argument.
  voiceReadback?: string;
}

/** The newest lines of the conversation, oldest first: the last two days, a page of each. */
export async function recentLines(transcript: TranscriptReader, personId: string) {
  const days = (await transcript.list(personId))
    .filter(({ path, lineCount }) => dayFile.test(path) && lineCount > 0)
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(-2);
  const lines: StoredLine[] = [];
  for (const { path, lineCount } of days) {
    const from = Math.max(1, lineCount - linesRead + 1);
    lines.push(...(await transcript.read(personId, path, { from })));
  }
  return lines;
}

const textOf = (line: StoredLine) => {
  const text = (line.body as { text?: unknown } | null)?.text;
  return line.kind === "message" && typeof text === "string" ? text : undefined;
};

/**
 * What the conversation holds that an authority check may be shown: the person's own recent
 * messages, oldest first (lines the channel core wrote from them, never an agent's, a work
 * report's, a schedule's or a tool's), and what the agent last said before a given moment. The id
 * of a message is the line's op, which is what an instruction is spent under.
 */
export async function readConversation(transcript: TranscriptReader, personId: string) {
  const lines = await recentLines(transcript, personId);
  return {
    personMessages(now: Date): PersonMessage[] {
      const since = now.getTime() - instructionWindowMs;
      return lines
        .flatMap((line, index) => {
          const text = textOf(line);
          const own = line.role === "user" && line.provenance === "person";
          const fresh = Date.parse(line.at) >= since;
          if (!own || text === undefined || !fresh) return [];
          if (line.channel !== "voice")
            return [{ id: line.op, at: line.at, text: prefix(text, messageChars) }];
          const call = (line.body as { call?: unknown } | null)?.call;
          // The wake ingress copies speech for the chat workflow. It is not a second authority source.
          if (typeof call !== "string" || !line.op.startsWith(`call:${call}:person:`)) return [];
          const spoken = lines
            .slice(0, index)
            .filter(
              (other) =>
                other.kind === "message" &&
                other.channel === "voice" &&
                (other.body as { call?: unknown } | null)?.call === call,
            );
          const readback: string[] = [];
          for (const previous of spoken.reverse()) {
            if (previous.role !== "assistant" || previous.provenance !== "agent") break;
            readback.unshift(textOf(previous) ?? "");
          }
          return [
            {
              id: line.op,
              at: line.at,
              text: prefix(text, messageChars),
              voiceReadback: readback.join(" ").length <= messageChars ? readback.join(" ") : "",
            },
          ];
        })
        .sort((a, b) => a.at.localeCompare(b.at))
        .slice(-newestMessages);
    },
    /** The agent's own last message to the person before `at`, which a reply may be answering. */
    agentTextBefore(at: string): string | undefined {
      const said = lines.findLast(
        (line) =>
          line.role === "assistant" && line.provenance === "agent" && line.at < at && textOf(line),
      );
      return said && prefix(textOf(said) ?? "", messageChars);
    },
  };
}

export interface Ancestry {
  origin(
    personId: string,
    runId: string,
  ): Promise<{ origin: string; taskId: string | null } | undefined>;
  parent(personId: string, taskId: string): Promise<string | null | undefined>;
}
/** Missing or excessively deep ancestry never grants user authority. */
export async function rootOf(
  records: Ancestry,
  personId: string,
  runId: string,
): Promise<import("./requirement.ts").Root> {
  let current: string | null = runId;
  for (let depth = 0; current !== null && depth < 8; depth++) {
    const run = await records.origin(personId, current);
    if (run?.origin === "person") return "person";
    if (run?.origin === "automation") return "automation";
    if (!run?.taskId) return "agent";
    current = (await records.parent(personId, run.taskId)) ?? null;
  }
  return "agent";
}
