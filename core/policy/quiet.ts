// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Quiet hours: when Soft Axiom does not start contact on its own. The person's own window lives
// in their preferences; until they set one this is the window. It ends at 06:00 so the Compass
// morning plan, which is due then by default, is not inside it (the end is exclusive).
import { wallClock } from "./clock.ts";

export interface QuietHours {
  /** `HH:MM` on the person's wall clock. */
  start: string;
  end: string;
}

export const defaultQuietHours: QuietHours = { start: "22:00", end: "06:00" };

/** True when the wall clock reads inside the window: start inclusive, end exclusive. */
export function inQuietHours(at: Date, timeZone: string, { start, end }: QuietHours): boolean {
  if (start === end) return false;
  const { time } = wallClock(at, timeZone);
  return start < end ? time >= start && time < end : time >= start || time < end;
}

/** The first real minute outside quiet hours, including skipped and repeated wall times. */
export function nextOutsideQuiet(at: Date, timeZone: string, quiet: QuietHours): Date {
  if (!inQuietHours(at, timeZone, quiet)) return at;
  // Walk actual minutes through the shared wall clock. A local end time can occur twice or
  // not at all, and a backwards transition can leave the window before its nominal end.
  let candidate = new Date(Math.floor(at.getTime() / 60_000) * 60_000 + 60_000);
  while (inQuietHours(candidate, timeZone, quiet))
    candidate = new Date(candidate.getTime() + 60_000);
  return candidate;
}
