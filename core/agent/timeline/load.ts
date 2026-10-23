// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Reads the picture from memory and decides what each record is worth believing. A record's front
// matter is the agent's own claim, so it counts for what code can show: a told claim needs the
// person's own line with the quoted words; a found one needs the note it names to exist. A claim
// that cannot be shown is a guess, whatever it says. This is the only place a source is trusted.
import { localInstant, wallClock } from "../../policy/clock.ts";
import { codeOf, report } from "../../telemetry/report.ts";
import type { FileLister, FileReader, TranscriptReader } from "../context/ports.ts";
import type { Item } from "./certainty.ts";
import {
  type Claim,
  claimsIn,
  eventsFolder,
  nowNote,
  predictionsPath,
  timelineRoot,
} from "./records.ts";
import { rules } from "./rules.ts";

export interface TimelinePorts {
  files: FileReader & FileLister;
  transcript: TranscriptReader;
}

const minute = 60_000;
const slack = rules.slackMinutes * minute;
// `conversations/2026-10-21.jsonl:42 "the words they said"`; without the line number the newest
// lines of that day are searched, which is where a text they just sent is.
const toldEvidence = /^(conversations\/\d{4}-\d{2}-\d{2}\.jsonl)(?::(\d+))?\s+["“](.+?)["”]\s*$/;
const foundEvidence = /^([^\s"]+?)(?::\d+(?:-\d+)?)?$/;

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

// When the person said it, if a line is theirs and holds the quoted words.
export async function toldSource(
  personId: string,
  evidence: string | undefined,
  ports: TimelinePorts,
) {
  const match = toldEvidence.exec(evidence ?? "");
  if (!match) return undefined;
  const [, path = "", number, quote = ""] = match;
  const wanted = ` ${wordsOf(quote).join(" ")} `;
  if (wordsOf(quote).length < rules.quoteWords) return undefined;
  const range = number
    ? { from: Number(number), to: Number(number) }
    : { from: await tailFrom(personId, path, ports) };
  const lines = await ports.transcript.read(personId, path, range);
  const said = lines.filter((line) => {
    const text = (line.body as { text?: unknown } | undefined)?.text;
    return (
      line.kind === "message" &&
      line.provenance === "person" &&
      typeof text === "string" &&
      ` ${wordsOf(text).join(" ")} `.includes(wanted)
    );
  });
  const newest = said.at(-1);
  return newest;
}

async function tailFrom(personId: string, path: string, ports: TimelinePorts) {
  const file = (await ports.transcript.list(personId)).find((entry) => entry.path === path);
  return Math.max(1, (file?.lineCount ?? 0) - rules.recentLines);
}

async function noteExists(personId: string, claim: Claim, ports: TimelinePorts) {
  const path = foundEvidence.exec(claim.evidence ?? "")?.[1];
  if (!path || path.startsWith(`${timelineRoot}/`)) return false;
  return (await ports.files.read(personId, path)) !== undefined;
}

const plain = ({ evidence: _evidence, ...item }: Claim): Item => item;

/** The item a claim amounts to once its source has been checked. */
export async function ground(
  personId: string,
  claim: Claim,
  ports: TimelinePorts,
  now: Date,
): Promise<Item> {
  const asOf = new Date(Math.min(claim.asOf.getTime(), now.getTime()));
  const item = { ...plain(claim), asOf, confirmedAt: undefined };
  const guess = (): Item => ({
    ...item,
    source: "guess",
    ...(claim.source !== "guess" && { unverified: claim.source }),
  });
  if (claim.source === "found") return (await noteExists(personId, claim, ports)) ? item : guess();
  if (claim.source !== "told") return guess();
  const source = await toldSource(personId, claim.evidence, ports).catch(() => undefined);
  const said = source && new Date(source.at);
  if (!said || said.getTime() > now.getTime() + slack) return guess();
  // Saying it again confirms it only if they spoke after the record was made, and the record
  // does not claim a confirmation later than their last word.
  const confirmed =
    claim.confirmedAt !== undefined &&
    said.getTime() > claim.asOf.getTime() + slack &&
    claim.confirmedAt.getTime() <= said.getTime() + slack;
  return {
    ...item,
    asOf: said,
    confirmedAt: confirmed
      ? new Date(Math.min(claim.confirmedAt?.getTime() ?? 0, now.getTime()))
      : undefined,
  };
}

// The folder holds a file a day or more per event; only the days in view are opened.
function pathsInView(listed: string[], days: string[]) {
  return listed.filter((path) => {
    const name = path.slice(eventsFolder.length);
    return path.startsWith(eventsFolder) && days.some((day) => name.startsWith(`${day}-`));
  });
}

// Today and the days after it, as dates on the person's own calendar.
function daysInView(now: Date, timeZone: string) {
  const noon = localInstant(wallClock(now, timeZone).day, "12:00", timeZone).getTime();
  return Array.from(
    { length: rules.lookaheadDays },
    (_, index) => wallClock(new Date(noon + index * 24 * 3_600_000), timeZone).day,
  );
}

/** The records for today and the next days, each graded. A file that cannot be read is skipped. */
export async function loadTimeline(
  personId: string,
  ports: TimelinePorts,
  now: Date,
  timeZone: string,
): Promise<Item[]> {
  const days = daysInView(now, timeZone);
  const listed = await ports.files.list(personId, eventsFolder);
  const paths = [nowNote, predictionsPath(days[0] ?? ""), ...pathsInView(listed, days)];
  const graded = await Promise.all(
    paths.map(async (path) => {
      try {
        const text = await ports.files.read(personId, path);
        const claims = text === undefined ? [] : claimsIn(path, text, timeZone);
        return await Promise.all(claims.map((claim) => ground(personId, claim, ports, now)));
      } catch (error) {
        report("timeline", "read", "failed", codeOf(error));
        return [];
      }
    }),
  );
  return graded.flat();
}
