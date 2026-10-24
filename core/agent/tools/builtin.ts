// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// The three tools the runtime itself provides: `read` opens a place the model was pointed to,
// `activity_result` pages through a result that was too long to show, and `finish` ends the run.
// All of them are read-only except `finish`, which only says how the run ended.
import { CodedError } from "../../contracts/codes.ts";
import { clip, pageChars, viewChars } from "../context/clip.ts";
import type { FileReader, FileSource, TranscriptReader } from "../context/ports.ts";
import type { Handler } from "./executor.ts";

// Paths come from the model, so only these shapes reach the transcript store; anything else is a
// file in the person's workspace and must stay inside it.
const transcriptPath = /^(?:conversations\/\d{4}-\d{2}-\d{2}|tasks\/[0-9a-f-]{36})\.jsonl$/;
const rangeOf = /^(\d+)(?:-(\d+))?$/;
const defaultSpan = 100;
const maxSpan = 200;

const insideWorkspace = (path: string) =>
  path.length > 0 &&
  path.length <= 300 &&
  !path.includes("\0") &&
  !path.startsWith("/") &&
  !path.split("/").some((part) => part === "" || part === "..");

function linesWanted(range: unknown) {
  if (range === undefined) return { from: 1, to: defaultSpan };
  const parsed = rangeOf.exec(String(range));
  if (!parsed) throw new CodedError("invalid_input");
  const from = Math.max(1, Number(parsed[1]));
  const to = Math.min(Number(parsed[2] ?? from), from + maxSpan - 1);
  if (to < from) throw new CodedError("invalid_input");
  return { from, to };
}

// Numbered lines up to the size the model is shown; if the page is full it says where to go on.
function numbered(rows: { n: number; text: string }[]) {
  const shown: string[] = [];
  let size = 0;
  for (const { n, text } of rows) {
    const row = `${n}\t${text}`;
    if (size + row.length > viewChars - 300 && shown.length > 0) {
      shown.push(`[stopped before line ${n}: the page is full; read from line ${n}]`);
      break;
    }
    shown.push(row);
    size += row.length + 1;
  }
  return shown.join("\n");
}

export function createReadTool(deps: { transcript: TranscriptReader; files: FileReader }): Handler {
  return async (input, { personId }) => {
    const { path, lines, source } = input as {
      path: string;
      lines?: unknown;
      source?: FileSource;
    };
    const { from, to } = linesWanted(lines);
    if (source !== "shipped" && transcriptPath.test(path)) {
      const found = await deps.transcript.read(personId, path, { from, to });
      if (found.length === 0) return { result: { error: "not_found" } };
      return {
        result: numbered(
          found.map(({ seq, at, kind, role, channel, run, body }) => ({
            n: seq,
            text: JSON.stringify({ at, kind, role, channel, run, body }),
          })),
        ),
      };
    }
    if (!insideWorkspace(path)) return { result: { error: "invalid_path" } };
    const text = await deps.files.read(personId, path, source);
    if (text === undefined) return { result: { error: "not_found" } };
    const all = text.split("\n");
    const rows = all.slice(from - 1, to).map((row, index) => ({ n: from + index, text: row }));
    return {
      result: `${path}: lines ${from}-${from + rows.length - 1} of ${all.length}\n${numbered(rows)}`,
    };
  };
}

const resultRef = /^((?:conversations\/\d{4}-\d{2}-\d{2}|tasks\/[0-9a-f-]{36})\.jsonl):(\d+)$/;

export function createActivityResultTool(deps: { transcript: TranscriptReader }): Handler {
  return async (input, { personId }) => {
    const { ref, offset = 0 } = input as { ref: string; offset?: number };
    const parsed = resultRef.exec(ref);
    if (!parsed) return { result: { error: "invalid_input" } };
    const lineNo = Number(parsed[2]);
    const [line] = await deps.transcript.read(personId, parsed[1] as string, {
      from: lineNo,
      to: lineNo,
    });
    const body = line?.body as { result?: unknown; clipped?: { total: number } } | undefined;
    if (line?.kind !== "tool_result" || body === undefined)
      return { result: { error: "not_found" } };
    const full =
      typeof body.result === "string" ? body.result : JSON.stringify(body.result ?? null);
    const page = clip(full, ref, pageChars, offset);
    const lost =
      body.clipped && !page.clipped
        ? `\n[only the first ${full.length} of ${body.clipped.total} characters were kept]`
        : "";
    return { result: page.text + lost };
  };
}

export const finish: Handler = async (input) => ({
  result: "ok",
  finish: { outcome: (input as { outcome: "done" | "waiting" | "blocked" }).outcome },
});
