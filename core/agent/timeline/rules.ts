// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Every number the timeline's score and questions are made of, in one place. They are judgement
// calls, not facts: a change is a change to how sure the agent sounds, so each has a reason here
// and the tests pin their order and shape, not their digits.
export const rules = {
  // How sure we are of a record the moment it is written, by where it came from. What the person
  // said is almost certain (people misspeak and plans move), a device reading is nearly as good,
  // what the agent found in their accounts is somebody else's word, and a guess is a coin flip.
  base: { told: 0.95, device: 0.9, found: 0.7, guess: 0.4 },

  // Hours for the score to halve. Where they are changes within hours; a class on the calendar
  // holds for about a week; a routine the agent only inferred is stale by tonight; a position fix
  // is stale within the hour.
  halfLifeHours: { now: 2, event: 168, guess: 6, device: 0.5 },

  // Two records that cannot both be true (the same time, different places) each keep this share.
  contradiction: 0.6,
  // Their word, said again, lifts a record this far (never past the ceiling) and restarts its age.
  confirmationLift: 0.2,
  // Nothing is certain: the agent is never told it is more than this sure.
  ceiling: 0.99,

  // Below this the agent may ask, once, if something soon depends on the answer.
  askBelow: 0.6,
  // Something "depends" on a record when an event it touches starts within this many hours.
  askHorizonHours: 6,
  // Unprompted questions a day; a conversation the person started is not limited by it.
  askPerDay: 2,

  // A stretch of the day counts as unknown below this, and is worth naming from this length on.
  gapBelow: 0.35,
  gapMinutes: 60,
  slotMinutes: 15,
  // A note of where they are speaks for the next hour; after that it is only history.
  nowReachMinutes: 60,

  // A person's line and a record's `confirmed_at` may differ by this much (clocks, typing).
  slackMinutes: 5,
  // A quote that proves a told claim has at least this many words, so "class" proves nothing.
  quoteWords: 2,
  // A quote with no line number is looked for in this many of the day's newest lines.
  recentLines: 400,
  // An event with no end is taken to last this long.
  eventMinutes: 60,

  // Days of events the picture looks at: today and the two after.
  lookaheadDays: 3,

  // The block in the model's context, and how much of it an item may take.
  blockChars: 700,
  shownEvents: 3,
  titleChars: 40,
  placeChars: 24,
} as const;
