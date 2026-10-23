// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// When a repeating job is next due. Repeats are kept in the person's own zone, so "9:00" stays
// 9:00 on the wall across DST; an interval counts real elapsed minutes. Pure.
import { localInstant, wallClock } from "./clock.ts";

export { localInstant } from "./clock.ts";

export type Recurrence =
  | { rule: "daily"; time: string }
  // Weekdays are 0 (Sunday) to 6.
  | { rule: "weekly"; time: string; weekdays: number[] }
  | { rule: "interval"; minutes: number };

const dayMs = 24 * 60 * 60 * 1000;
const everyDay = [0, 1, 2, 3, 4, 5, 6];

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + dayMs).toISOString().slice(0, 10);

/** The first occurrence strictly after `after`. */
export function nextOccurrence(recurrence: Recurrence, after: Date, timeZone: string): Date {
  if (recurrence.rule === "interval")
    return new Date(after.getTime() + recurrence.minutes * 60_000);
  const { time } = recurrence;
  const weekdays = recurrence.rule === "weekly" ? recurrence.weekdays : everyDay;
  // A day gives at most one occurrence, so an hour that repeats never doubles one. A week of days
  // is enough to find an allowed weekday; the day after that is a safe margin for the zone.
  let day = wallClock(after, timeZone).day;
  for (let tried = 0; tried < 9; tried++, day = nextDay(day)) {
    if (!weekdays.includes(weekdayOf(day))) continue;
    const occurrence = localInstant(day, time, timeZone);
    if (occurrence > after) return occurrence;
  }
  throw new RangeError("a repeat needs at least one weekday");
}

/**
 * The occurrence to wait for after `due` came due: the next one, or, when several were missed,
 * the first after `now`. One catch-up at most, never a burst.
 */
export function followingOccurrence(
  recurrence: Recurrence,
  due: Date,
  now: Date,
  timeZone: string,
): Date {
  const next = nextOccurrence(recurrence, due, timeZone);
  return next > now ? next : nextOccurrence(recurrence, now, timeZone);
}
