// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// How sure the agent is of each part of the person's day, computed from things the model cannot
// supply: where a record came from (already checked: see load.ts), how old it is, whether another
// record contradicts it, and whether the person said it again. Pure; the numbers are in rules.ts.
import { rules } from "./rules.ts";

export type Source = "told" | "found" | "guess" | "device";

export interface Item {
  // An event they have, the one note of where they are, or a guess about a stretch of the day.
  kind: "event" | "now" | "guess";
  path: string;
  title: string;
  place?: string | undefined;
  start?: Date | undefined;
  end?: Date | undefined;
  // The source that counts: a claim code could not check is already a guess here.
  source: Source;
  asOf: Date;
  confirmedAt?: Date | undefined;
  // When the agent last asked the person about it.
  askedAt?: Date | undefined;
  // What the record claimed to be, when it could not be shown.
  unverified?: Source | undefined;
}

type Span = [number, number];
const hour = 3_600_000;
const minute = 60_000;

function halfLifeHours({ source, kind }: Item) {
  if (source === "guess") return rules.halfLifeHours.guess;
  if (source === "device") return rules.halfLifeHours.device;
  return kind === "now" ? rules.halfLifeHours.now : rules.halfLifeHours.event;
}

// The part of the day a record speaks for. A note of where they are is a point in time: it clashes
// with an event that was on when it was written, not with one that began after.
function span(item: Item): Span | undefined {
  if (item.kind === "now") return [item.asOf.getTime(), item.asOf.getTime() + 1];
  return item.start && item.end ? [item.start.getTime(), item.end.getTime()] : undefined;
}

const placeOf = (item: Item) => item.place?.trim().toLowerCase() ?? "";

export function contradicts(a: Item, b: Item): boolean {
  const [one, two] = [placeOf(a), placeOf(b)];
  const [x, y] = [span(a), span(b)];
  if (a.path === b.path || !one || !two || one === two || !x || !y) return false;
  return x[0] < y[1] && y[0] < x[1];
}

/** 0 to 1: how sure we are of this record at `now`, given the records around it. */
export function certaintyOf(item: Item, now: Date, others: readonly Item[] = []): number {
  const confirmed = item.confirmedAt !== undefined;
  const base = Math.min(
    rules.ceiling,
    rules.base[item.source] + (confirmed ? rules.confirmationLift : 0),
  );
  const since = Math.max(item.asOf.getTime(), item.confirmedAt?.getTime() ?? 0);
  const age = Math.max(0, now.getTime() - since) / hour;
  const aged = base * 0.5 ** (age / halfLifeHours(item));
  const doubted = others.some((other) => contradicts(item, other));
  return Math.min(rules.ceiling, aged * (doubted ? rules.contradiction : 1));
}

export interface Window {
  from: Date;
  to: Date;
}

/**
 * How much of the rest of the waking day is known, weighted by how sure we are, and the stretches
 * that are not. A slot counts as the best score of any record that speaks for it.
 */
export function dayCoverage(items: readonly Item[], now: Date, window: Window) {
  const from = Math.max(window.from.getTime(), now.getTime());
  const to = window.to.getTime();
  if (from >= to) return { share: 1, gaps: [] as Window[] };
  const slot = rules.slotMinutes * minute;
  const scored = items.flatMap((item) => {
    const own: Span | undefined =
      item.kind === "now"
        ? [now.getTime(), now.getTime() + rules.nowReachMinutes * minute]
        : span(item);
    return own ? [{ own, score: certaintyOf(item, now, items) }] : [];
  });
  const slots = Math.ceil((to - from) / slot);
  const best = Array.from({ length: slots }, (_, index) => {
    const middle = from + index * slot + Math.min(slot, to - from - index * slot) / 2;
    return Math.max(
      0,
      ...scored.filter(({ own }) => own[0] <= middle && middle < own[1]).map(({ score }) => score),
    );
  });

  const gaps: Window[] = [];
  let open: number | undefined;
  const close = (end: number) => {
    if (open !== undefined && end - open >= rules.gapMinutes * minute) {
      gaps.push({ from: new Date(open), to: new Date(end) });
    }
    open = undefined;
  };
  best.forEach((score, index) => {
    if (score >= rules.gapBelow) close(from + index * slot);
    else open ??= from + index * slot;
  });
  close(to);
  return { share: best.reduce((sum, score) => sum + score, 0) / slots, gaps };
}
