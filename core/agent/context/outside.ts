// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";

/**
 * Wraps text that did not come from the person (a page, an email, a tool's output, a note
 * recalled from memory) so the model can tell where it starts and ends. The tag carries an id that
 * is a hash of where the text sits in the transcript: it is the same every round, so the cache
 * prefix stays put, and the text cannot close the tag because it cannot know the id.
 */
export function outside(source: string, where: string, text: string): string {
  const id = createHash("sha256").update(`sa-outside:${where}`).digest("hex").slice(0, 10);
  const from = /^[a-z0-9_.:-]{1,40}$/.test(source) ? source : "unknown";
  return `<outside id="${id}" from="${from}">\n${text}\n</outside id="${id}">`;
}
