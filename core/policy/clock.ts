// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// A person's clock: what the wall says in their zone. The one place the system turns an instant
// into local time and back, so DST is handled once. Pure; `Intl` is the only source of zone rules.
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsOf(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  const part = Object.fromEntries(
    formatter.formatToParts(at).map(({ type, value }) => [type, value]),
  );
  return part as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** The wall clock in `timeZone` at that instant, as `YYYY-MM-DD` and `HH:MM`. */
export function wallClock(at: Date, timeZone: string) {
  const part = partsOf(at.getTime(), timeZone);
  return { day: `${part.year}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}` };
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
function offsetAt(at: number, timeZone: string) {
  const part = partsOf(at, timeZone);
  const wall = Date.UTC(
    Number(part.year),
    Number(part.month) - 1,
    Number(part.day),
    Number(part.hour),
    Number(part.minute),
    Number(part.second),
  );
  return wall - Math.floor(at / 1000) * 1000;
}

const dayMs = 24 * 60 * 60 * 1000;

/**
 * The instant a wall-clock time falls on. A time that happens twice (clocks going back) is the
 * first of them; a time that does not exist (clocks going forward) moves ahead by the gap.
 */
export function localInstant(day: string, time: string, timeZone: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  // The offsets in force a day either side bracket any change that could touch this wall time.
  const before = offsetAt(wall - dayMs, timeZone);
  const after = offsetAt(wall + dayMs, timeZone);
  const holds = [before, after]
    .map((offset) => ({ offset, instant: wall - offset }))
    .filter(({ offset, instant }) => offsetAt(instant, timeZone) === offset)
    .map(({ instant }) => instant);
  return new Date(holds.length > 0 ? Math.min(...holds) : wall - before);
}
