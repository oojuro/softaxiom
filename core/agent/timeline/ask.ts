// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// When the picture is unsure, the agent may ask the person one question. This decides whether it
// may and about what; how to ask well is the timeline skill's. The limits are invariants: at most
// a couple of unprompted questions a day, none in quiet hours, none about what was already asked,
// and only when something soon rides on the answer.

import { wallClock } from "../../policy/clock.ts";
import { inQuietHours, type QuietHours } from "../../policy/quiet.ts";
import { certaintyOf, contradicts, type Item } from "./certainty.ts";
import { rules } from "./rules.ts";

export interface Ask {
  item: Item;
  score: number;
  // The event whose leave time or wakes need the answer.
  dependent: Item;
}

const hour = 3_600_000;
// Asked after it was last changed: the same question again would be a repeat.
const asked = ({ askedAt, asOf }: Item) => askedAt !== undefined && askedAt >= asOf;

export function worthAsking(
  items: readonly Item[],
  now: Date,
  timeZone: string,
  quiet: QuietHours,
): Ask | undefined {
  if (inQuietHours(now, timeZone, quiet)) return undefined;
  const today = wallClock(now, timeZone).day;
  const askedToday = items.filter(
    ({ askedAt }) => askedAt && wallClock(askedAt, timeZone).day === today,
  );
  if (askedToday.length >= rules.askPerDay) return undefined;

  const soon = items
    .filter(
      ({ kind, start, end }) =>
        kind === "event" &&
        start &&
        end &&
        end > now &&
        start.getTime() - now.getTime() <= rules.askHorizonHours * hour,
    )
    .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  const asks = items.flatMap((item): Ask[] => {
    const dependent = item.kind === "now" ? soon[0] : soon.find(({ path }) => path === item.path);
    const score = certaintyOf(item, now, items);
    const repeat = asked(item) || items.some((other) => asked(other) && contradicts(item, other));
    return item.kind === "guess" || !dependent || score >= rules.askBelow || repeat
      ? []
      : [{ item, score, dependent }];
  });
  return asks.sort(
    (a, b) =>
      (a.dependent.start?.getTime() ?? 0) - (b.dependent.start?.getTime() ?? 0) ||
      a.score - b.score,
  )[0];
}
