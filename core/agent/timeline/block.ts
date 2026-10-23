// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// The Timeline block of a chat round: the agent's picture of the person's time and place, with how
// sure it is of each part, and at most one thing worth asking. It is compact on purpose (the model
// reads it every round), and what came from outside text is marked as data, never as orders.

import { localInstant, wallClock } from "../../policy/clock.ts";
import { defaultQuietHours, type QuietHours } from "../../policy/quiet.ts";
import { outside } from "../context/outside.ts";
import { type Ask, worthAsking } from "./ask.ts";
import { certaintyOf, dayCoverage, type Item, type Window } from "./certainty.ts";
import { loadTimeline, type TimelinePorts } from "./load.ts";
import { rules } from "./rules.ts";

export interface TimelineDeps extends TimelinePorts {
  quietHours(personId: string): Promise<QuietHours>;
}

const minute = 60_000;
const percent = (score: number) => `${Math.round(score * 100)}%`;
const clip = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

function ago(from: Date, now: Date) {
  const minutes = Math.max(0, Math.floor((now.getTime() - from.getTime()) / minute));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return minutes < 48 * 60
    ? `${Math.floor(minutes / 60)} h ago`
    : `${Math.floor(minutes / 1440)} d ago`;
}

const span = (minutes: number) => {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
};

// Where a claim came from, and how old it is.
const origin = (item: Item, now: Date) => {
  if (item.source === "guess")
    return item.unverified ? `guess (${item.unverified} claim unproven)` : "guess";
  return `${item.source} ${ago(new Date(Math.max(item.asOf.getTime(), item.confirmedAt?.getTime() ?? 0)), now)}`;
};

// Words that may have come from a mail or a page are wrapped as data.
const fromOutside = ({ source, unverified }: Item) => source === "found" || unverified === "found";
const named = (item: Item) => {
  const place = item.place ? ` (${clip(item.place, rules.placeChars)})` : "";
  const text = `${clip(item.title, rules.titleChars)}${place}`;
  return fromOutside(item) ? outside("timeline", item.path, text) : text;
};

export function renderTimeline(
  items: readonly Item[],
  now: Date,
  timeZone: string,
  quiet: QuietHours,
): string {
  if (items.length === 0) return "";
  const here = wallClock(now, timeZone);
  const clock = (at: Date) => wallClock(at, timeZone).time;
  const weekday = (at: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  const score = (item: Item) => percent(certaintyOf(item, now, items));

  const where = items.find(({ kind }) => kind === "now");
  const nowLine = where
    ? `Now: ${clip(where.place ?? "somewhere", rules.placeChars)}, ${origin(where, now)}, ${score(where)}`
    : "Now: unknown";
  const next = items
    .filter(({ kind, start, end }) => kind !== "now" && start && end && end > now)
    .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0))
    .slice(0, rules.shownEvents)
    .map((item) => {
      const [start, end] = [item.start as Date, item.end as Date];
      const day = wallClock(start, timeZone).day === here.day ? "" : `${weekday(start)} `;
      return `${day}${clock(start)}-${clock(end)} ${named(item)}, ${origin(item, now)}, ${score(item)}`;
    });

  const window = wakingWindow(here.day, timeZone, quiet);
  const { share, gaps } = dayCoverage(items, now, window);
  const gapLine =
    gaps.length === 0
      ? []
      : [
          `Gaps: ${gaps
            .slice(0, 2)
            .map(
              ({ from, to }) =>
                `${clock(from)}-${clock(to)} (${span(Math.round((to.getTime() - from.getTime()) / minute))})`,
            )
            .join(", ")}`,
        ];
  const ask = worthAsking(items, now, timeZone, quiet);
  const lines = [
    "Timeline:",
    nowLine,
    ...next,
    ...(ask ? [askLine(ask, clock)] : []),
    ...gapLine,
    `Known: ${percent(share)} of the rest of today`,
  ];
  while (lines.join("\n").length > rules.blockChars && lines.length > 2) lines.pop();
  return lines.join("\n");
}

// Names what is unsure, how sure, and what waits on it. The agent stamps the record when it asks.
function askLine({ item, score, dependent }: Ask, clock: (at: Date) => string) {
  const event = `the ${clock(dependent.start as Date)} ${named(dependent)}`;
  const subject = item.kind === "now" ? `where they are, for ${event}` : event;
  return `Worth asking: ${subject} (${percent(score)} sure; leave time and wakes depend on it). After asking, set asked_at in ${item.path}.`;
}

// Their waking hours are the ones outside their quiet hours; a quiet window that does not wrap
// midnight is odd, and the default stands in.
function wakingWindow(day: string, timeZone: string, quiet: QuietHours): Window {
  const { start, end } = quiet.start > quiet.end ? quiet : defaultQuietHours;
  return { from: localInstant(day, end, timeZone), to: localInstant(day, start, timeZone) };
}

export async function timelineBlock(
  deps: TimelineDeps,
  personId: string,
  now: Date,
  timeZone: string,
): Promise<string> {
  const items = await loadTimeline(personId, deps, now, timeZone);
  if (items.length === 0) return "";
  // Without their quiet hours the agent assumes it may not ask.
  const quiet = await deps.quietHours(personId).catch(() => ({ start: "00:00", end: "23:59" }));
  return renderTimeline(items, now, timeZone, quiet);
}
