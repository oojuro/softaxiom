// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import { CodedError } from "./codes.ts";

// The one timestamp form: ISO 8601 in UTC with milliseconds, like `2026-10-20T14:03:09.120Z`.
// It is fixed width, so equal instants are equal strings and string order is time order. The 10.1
// move drifted because Postgres text (`2026-10-20 14:03:09+00`) was compared with ISO text
// (zero-freeze design 3.4); normalizing once at every boundary removes that class of bug.
export const Instant = z.iso.datetime({ precision: 3 }).brand<"Instant">();
export type Instant = z.infer<typeof Instant>;

// Text must carry its zone: without one, `Date` silently reads it as the machine's local time.
const zonedText = z.iso.datetime({ offset: true });

/** Normalizes a timestamp where it enters our code: from the database, a provider or JSON. */
export function instant(value: Date | number | string): Instant {
  if (typeof value === "string" && !zonedText.safeParse(value).success) {
    throw new CodedError("invalid_input");
  }
  const time = new Date(value);
  // Out-of-range years print as `+275760-...`, which the schema rejects like any invalid date.
  const text = Number.isNaN(time.getTime()) ? "" : time.toISOString();
  const result = Instant.safeParse(text);
  if (!result.success) throw new CodedError("invalid_input");
  return result.data;
}
