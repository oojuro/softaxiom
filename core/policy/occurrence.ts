// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// What becomes of one occurrence of a schedule that has come due. Pure: the store reads the row
// and the clock, this decides, and the store carries it out.
import { inQuietHours, type QuietHours } from "./quiet.ts";

/**
 * An occurrence this much later than it was due was lost to an outage, not to ordinary delay. A
 * deploy or a retry takes seconds; anything past this means the worker was not there.
 */
export const outageAfterMs = 15 * 60 * 1000;

export type Fate =
  // Do it: send the reminder or start the work.
  | "send"
  // After the schedule's end: close the schedule.
  | "expired"
  // Came due during an outage: a repeat moves on to the next future slot without running.
  | "missed"
  // The flag that guards the schedule is off (or killed): skipped and recorded, and the next
  // occurrence asks again, so turning the flag back on resumes it.
  | "gated"
  // Fell in the person's quiet hours and the schedule yields to them: skipped, and recorded.
  | "quiet";

export interface Occurrence {
  dueAt: Date;
  now: Date;
  expiresAt: Date | null;
  repeats: boolean;
  quietSkip: boolean;
  // The schedule names a flag and it is not on for this person.
  gated: boolean;
  quiet: QuietHours;
  timeZone: string;
}

export function fateOf(occurrence: Occurrence): Fate {
  const { dueAt, now, expiresAt, repeats, quietSkip, gated, quiet, timeZone } = occurrence;
  if (expiresAt && expiresAt <= dueAt) return "expired";
  // A one-time job has no next slot to move to, so late beats lost.
  if (repeats && now.getTime() - dueAt.getTime() > outageAfterMs) return "missed";
  if (gated) return "gated";
  if (quietSkip && inQuietHours(now, timeZone, quiet)) return "quiet";
  return "send";
}
