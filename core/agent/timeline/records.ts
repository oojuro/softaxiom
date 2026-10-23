// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Reads the timeline's files into claims. A file is the agent's own writing, so this keeps to the
// shape the timeline doc describes (agent-text/docs/timeline-files.md) and drops anything else;
// whether a claim is believed is load.ts's decision, not this one's.
import { localInstant } from "../../policy/clock.ts";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { Item, Source } from "./certainty.ts";
import { rules } from "./rules.ts";

export const timelineRoot = "memory/timeline";
export const eventsFolder = `${timelineRoot}/events/`;
export const nowNote = `${timelineRoot}/now.md`;
export const predictionsPath = (day: string) => `${timelineRoot}/predictions/${day}.md`;

/** An item as its file claims it: the source and confirmation are not yet checked. */
export type Claim = Omit<Item, "unverified"> & { evidence?: string | undefined };

const frontMatter = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const instant = z.iso.datetime({ offset: true }).transform((text) => new Date(text));

const shared = {
  place: z.string().optional(),
  // A record that names no source is a guess.
  source: z.enum(["told", "found", "guess", "device"]).default("guess"),
  as_of: instant,
  evidence: z.string().optional(),
  confirmed_at: instant.optional(),
  asked_at: instant.optional(),
};
const eventFields = z.looseObject({
  kind: z.literal("event"),
  title: z.string().min(1),
  date: day,
  start: clock,
  end: clock.optional(),
  ...shared,
});
const nowFields = z.looseObject({ kind: z.literal("now"), ...shared });
const planFields = z.looseObject({ as_of: instant.optional() });

const dayMs = 24 * 3_600_000;
const common = (fields: z.output<z.ZodObject<typeof shared>>) => ({
  source: fields.source as Source,
  asOf: fields.as_of,
  place: fields.place,
  evidence: fields.evidence,
  confirmedAt: fields.confirmed_at,
  askedAt: fields.asked_at,
});

function fieldsOf(text: string): { fields: unknown; body: string } | undefined {
  const match = frontMatter.exec(text);
  if (!match) return undefined;
  try {
    return { fields: parseYaml(match[1] ?? ""), body: text.slice(match[0].length) };
  } catch {
    return undefined;
  }
}

function eventOf(path: string, fields: unknown, timeZone: string): Claim[] {
  const parsed = eventFields.safeParse(fields);
  if (!parsed.success) return [];
  const { date, start, end, title } = parsed.data;
  const from = localInstant(date, start, timeZone);
  let until = end
    ? localInstant(date, end, timeZone)
    : new Date(from.getTime() + rules.eventMinutes * 60_000);
  if (until <= from) until = new Date(until.getTime() + dayMs);
  return [{ kind: "event", path, title, start: from, end: until, ...common(parsed.data) }];
}

function nowOf(path: string, fields: unknown): Claim[] {
  const parsed = nowFields.safeParse(fields);
  return parsed.success ? [{ kind: "now", path, title: "now", ...common(parsed.data) }] : [];
}

// A guess about a stretch of the day: `- 16:10-18:10 train home (guess: they said about 2 hours)`.
const planLine =
  /^\s*[-*]\s*([01]\d|2[0-3]):([0-5]\d)\s*[-–]\s*([01]\d|2[0-3]):([0-5]\d)\s+(\S.*)$/;

function guessesOf(path: string, fields: unknown, body: string, timeZone: string): Claim[] {
  const date = /predictions\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)?.[1];
  const parsed = planFields.safeParse(fields);
  if (!date || !parsed.success) return [];
  const asOf = parsed.data.as_of ?? localInstant(date, "00:00", timeZone);
  return body.split("\n").flatMap((line) => {
    const [, h1, m1, h2, m2, title] = planLine.exec(line) ?? [];
    if (!title) return [];
    const start = localInstant(date, `${h1}:${m1}`, timeZone);
    let end = localInstant(date, `${h2}:${m2}`, timeZone);
    if (end <= start) end = new Date(end.getTime() + dayMs);
    return [
      {
        kind: "guess" as const,
        path,
        title: title.trim(),
        start,
        end,
        source: "guess" as const,
        asOf,
      },
    ];
  });
}

/** The claims one file makes; nothing for a file that is not in the shape. */
export function claimsIn(path: string, text: string, timeZone: string): Claim[] {
  const read = fieldsOf(text);
  if (!read) return [];
  if (path === nowNote) return nowOf(path, read.fields);
  if (path.startsWith(eventsFolder)) return eventOf(path, read.fields, timeZone);
  return guessesOf(path, read.fields, read.body, timeZone);
}
