// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Turns transcript lines into the messages a model reads. The lines are the truth and are never
// rewritten; this is only the model's view of them: the provider's own assistant messages replayed
// as they were stored, every tool call answered (a call with no recorded result is answered as
// interrupted, because providers refuse a call left open), results clipped for size, and anything
// that did not come from the person marked as data.
import type { ModelMessage, ToolModelMessage } from "ai";
import { z } from "zod";
import { clip } from "./clip.ts";
import { outside } from "./outside.ts";
import type { StoredLine } from "./ports.ts";

export interface ViewLine extends StoredLine {
  // The file the line was read from, which is how a clipped result is found again.
  path: string;
}

export interface ViewOptions {
  allowAssistantStart?: boolean;
  /** Whether a tool's results are outside content (pages, mail, files) rather than our own words. */
  isOutside(tool: string): boolean;
}

const messageBody = z.looseObject({
  text: z.string().default(""),
  attachments: z
    .array(z.object({ path: z.string().nullable(), contentType: z.string().nullable() }))
    .default([]),
});
const modelBody = z.looseObject({
  text: z.string().default(""),
  messages: z.array(z.looseObject({ role: z.string() })).optional(),
});
const resultBody = z.looseObject({ id: z.string(), name: z.string(), result: z.unknown() });
export const noteBody = z.looseObject({ fact: z.string() });

const personWords = (line: ViewLine, body: z.output<typeof messageBody>) => {
  const channel = line.channel ? `[${line.channel}] ` : "";
  const files = body.attachments.map(
    ({ path, contentType }) =>
      `\n[attachment: ${path ?? "not saved"}${contentType ? ` ${contentType}` : ""}]`,
  );
  return `${channel}${body.text}${files.join("")}`;
};

// A work task's job, and a steer for it, are written by the agent that delegated it, as user turns
// of the task's own file. They are the job the work agent does (what it may do about the world is
// decided in code from the person's words), so they are not shown as outside data. Reports in the
// conversation are system lines and stay outside.
const isJob = (line: ViewLine) => line.role === "user" && line.provenance === "agent";

const noteText = ({ fact, ...detail }: z.output<typeof noteBody>) =>
  [
    `[note] ${fact}`,
    ...Object.entries(detail).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
  ].join("; ");

const isEmptyAssistant = (message: ModelMessage) => {
  if (message.role !== "assistant") return false;
  if (typeof message.content === "string") return message.content.trim() === "";
  return !message.content.some(
    (part) => part.type === "tool-call" || (part.type === "text" && part.text.trim() !== ""),
  );
};

const callsIn = (messages: ModelMessage[]) =>
  messages.flatMap((message) =>
    message.role === "assistant" && Array.isArray(message.content)
      ? message.content.flatMap((part) =>
          part.type === "tool-call" ? [[part.toolCallId, part.toolName] as const] : [],
        )
      : [],
  );

const resultMessage = (
  id: string,
  name: string,
  value: string,
  error = false,
): ToolModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: id,
      toolName: name,
      output: error ? { type: "error-text", value } : { type: "text", value },
    },
  ],
});

export function toMessages(
  lines: ViewLine[],
  { isOutside, allowAssistantStart }: ViewOptions,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  // Calls the latest assistant message made that have no result yet.
  const open = new Map<string, string>();
  const answerOpenCalls = () => {
    for (const [id, name] of open) messages.push(resultMessage(id, name, "interrupted", true));
    open.clear();
  };

  for (const line of lines) {
    if (line.kind === "tool_call") continue;
    if (line.kind === "tool_result") {
      const body = resultBody.safeParse(line.body);
      if (!body.success || !open.delete(body.data.id)) continue;
      const { id, name, result } = body.data;
      const full = typeof result === "string" ? result : JSON.stringify(result ?? null);
      const shown = clip(full, `${line.path}:${line.seq}`).text;
      messages.push(
        resultMessage(id, name, isOutside(name) ? outside(name, line.op, shown) : shown),
      );
      continue;
    }
    // A reply a run sent is already in the transcript as its model line and tool call, and the
    // tool wrote it while its call was still open: it is not a new turn, and must not end the
    // call before the call's own result, which is written after the whole batch.
    if (line.kind === "message" && line.role === "assistant" && line.run) continue;
    if (line.kind === "model") {
      const body = modelBody.safeParse(line.body);
      if (!body.success) continue;
      answerOpenCalls();
      const stored = (body.data.messages ?? [
        { role: "assistant", content: body.data.text },
      ]) as ModelMessage[];
      const kept = stored.filter((message) => !isEmptyAssistant(message));
      messages.push(...kept);
      for (const [id, name] of callsIn(kept)) open.set(id, name);
    } else if (line.kind === "note") {
      const body = noteBody.safeParse(line.body);
      if (body.success) {
        answerOpenCalls();
        messages.push({
          role: "user",
          content:
            line.provenance === "operator"
              ? outside("operator", line.op, noteText(body.data))
              : noteText(body.data),
        });
      }
    } else if (line.kind === "message") {
      const body = messageBody.safeParse(line.body);
      if (!body.success) continue;
      answerOpenCalls();
      if (line.role === "assistant") {
        messages.push({ role: "assistant", content: body.data.text });
      } else if (line.provenance === "person" || isJob(line)) {
        messages.push({ role: "user", content: personWords(line, body.data) });
      } else {
        const text = outside(line.provenance, line.op, personWords(line, body.data));
        messages.push({ role: "user", content: text });
      }
    }
  }
  answerOpenCalls();
  if (allowAssistantStart) return messages;
  const firstUser = messages.findIndex((message) => message.role === "user");
  return firstUser < 0 ? [] : messages.slice(firstUser);
}
