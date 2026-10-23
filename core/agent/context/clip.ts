// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
/** How many characters of one result the model is shown; the rest is read with `activity_result`. */
export const viewChars = 12_000;

/** A page for `activity_result`: small enough that the page and its marker fit in one view. */
export const pageChars = viewChars - 500;

const endsInHalfOfPair = (text: string, end: number) => {
  const unit = text.charCodeAt(end - 1);
  return unit >= 0xd800 && unit <= 0xdbff;
};

/**
 * Cuts `text` to a page of at most `limit` characters from `from`, and when more follows says how
 * much was shown and how to read the rest. The model always sees that something was cut off and
 * where the remainder is (`ref` is the transcript line that holds the whole result).
 */
/** The first `limit` characters, never ending in half of a character. */
export function prefix(text: string, limit: number) {
  return text.slice(0, text.length > limit && endsInHalfOfPair(text, limit) ? limit - 1 : limit);
}

export function clip(text: string, ref: string, limit = viewChars, from = 0) {
  let end = Math.min(text.length, from + limit);
  if (end < text.length && endsInHalfOfPair(text, end)) end--;
  const shown = text.slice(from, end);
  if (end >= text.length) return { text: shown, clipped: false };
  const note = `[clipped: showing ${shown.length} of ${text.length} characters; the rest: activity_result ref="${ref}" offset=${end}]`;
  return { text: `${shown}\n${note}`, clipped: true };
}
