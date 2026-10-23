// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { CodedError } from "../../contracts/codes.ts";
import type { ContextCompactor, Summary } from "./ports.ts";
import { minTail } from "./tail.ts";
import { noteBody, type ViewLine } from "./view.ts";

// One overflow pass is bounded, shares upkeep's wallet limits, and never drops an uncovered line.
export async function compactTail(
  compactor: ContextCompactor | undefined,
  personId: string,
  lines: ViewLine[],
  taskId?: string,
  platformFunded = false,
) {
  if (!compactor) throw new CodedError("context_overflow");
  let cut = Math.max(0, lines.length - minTail);
  // An assistant model message and all following tool results remain together in the tail.
  const boundary = lines
    .slice(0, cut + 1)
    .findLastIndex(
      (line) =>
        line.kind === "model" ||
        (line.kind === "note" && noteBody.safeParse(line.body).success) ||
        (line.kind === "message" && !(line.role === "assistant" && line.run)),
    );
  if (lines[boundary]?.kind === "model") cut = boundary;
  if (cut === 0) throw new CodedError("context_overflow");
  const job = taskId && lines[0]?.seq === 1 ? lines[0] : undefined;
  const older = lines.slice(job ? 1 : 0, cut);
  const ranges: { path: string; from: number; to: number }[] = [];
  for (const line of older) {
    const range = ranges.at(-1);
    if (
      range &&
      range.path === line.path &&
      range.to + 1 === line.seq &&
      line.seq - range.from < 200
    ) {
      range.to = line.seq;
    } else ranges.push({ path: line.path, from: line.seq, to: line.seq });
  }
  if (ranges.length === 0 || ranges.length > 8) throw new CodedError("context_overflow");
  const summaries: Summary[] = [];
  for (const range of ranges) {
    const summary = await compactor.compact(personId, {
      ...range,
      ...(platformFunded && { funding: "platform" as const }),
    });
    if (!summary) throw new CodedError("context_overflow");
    summaries.push(summary);
  }
  return { summaries, lines: [...(job ? [job] : []), ...lines.slice(cut)] };
}
