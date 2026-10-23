// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Which lines of the conversation the model is shown. The window is the end of the newest day
// file, and it moves in whole steps rather than one line at a time: the model's cache only
// helps while the messages at the front stay the same, so the front changes once every `step`
// lines, not every round. The window always reaches back far enough to hold the run in progress
// and the texts that started it, however long the run has gone on.
import type { StoredLine, TranscriptReader } from "./ports.ts";
import type { ViewLine } from "./view.ts";

const dayFile = /^conversations\/\d{4}-\d{2}-\d{2}\.jsonl$/;
/** The least the model sees of what came before the newest lines. */
export const minTail = 20;
/** The window's front moves by this many lines at a time. */
export const step = 40;

const isPersonText = (line: StoredLine) => line.kind === "message" && line.provenance === "person";

/** The first line that has to be shown: the run in progress and the texts just before it. */
function protectedFrom(lines: StoredLine[], runId: string) {
  const own = lines.findIndex((line) => line.run === runId);
  let from = own < 0 ? lines.length : own;
  while (from > 0 && isPersonText(lines[from - 1] as StoredLine)) from--;
  return from;
}

/** The path of a work task's own transcript file. */
export const taskPath = (taskId: string) => `tasks/${taskId}.jsonl`;

// The file or files the window moves over: the person's day files, or one task's file.
export async function readTail(
  reader: TranscriptReader,
  personId: string,
  runId: string,
  taskId?: string,
) {
  const files = (await reader.list(personId))
    .filter(({ path, lineCount }) =>
      taskId ? path === taskPath(taskId) : dayFile.test(path) && lineCount > 0,
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  const newest = files.length - 1;
  if (newest < 0) return [];

  const read = async (file: number, from: number, to?: number): Promise<ViewLine[]> => {
    const path = (files[file] as { path: string }).path;
    const lines = await reader.read(personId, path, { from, ...(to && { to }) });
    return lines.map((line) => ({ ...line, path }));
  };
  // Up to `count` lines that come before line `seq` of `file`, reaching into earlier days.
  const before = async (file: number, seq: number, count: number): Promise<ViewLine[]> => {
    if (count <= 0 || file < 0) return [];
    const to = seq - 1;
    const from = Math.max(1, to - count + 1);
    const here = to >= 1 ? await read(file, from, to) : [];
    if (from > 1 || file === 0) return here;
    const earlier = await before(
      file - 1,
      (files[file - 1] as { lineCount: number }).lineCount + 1,
      count - here.length,
    );
    return [...earlier, ...here];
  };
  const firstOf = (lines: ViewLine[]) => files.findIndex(({ path }) => path === lines[0]?.path);

  const total = (files[newest] as { lineCount: number }).lineCount;
  const start = Math.max(1, Math.floor((total - minTail) / step) * step + 1);
  let lines = await read(newest, start);
  if (lines.length < minTail) {
    lines = [...(await before(newest, start, minTail - lines.length)), ...lines];
  }
  // The window must not begin inside the run in progress: reach back, a step at a time.
  while (protectedFrom(lines, runId) === 0) {
    const first = lines[0] as ViewLine;
    const earlier = await before(firstOf(lines), first.seq, step);
    if (earlier.length === 0) break;
    lines = [...earlier, ...lines];
  }
  return lines;
}
