// SPDX-FileCopyrightText: 2026 OpenClaw Foundation; 2026 Soft Axiom contributors
// SPDX-License-Identifier: MIT
/** Truncates to a nonnegative code-point budget; grapheme clusters may be split. */
export function truncateCodePoints(text: string, maxCodePoints: number): string {
    const limit = Math.max(0, Math.trunc(maxCodePoints) || 0);
    if (text.length <= limit) {
        return text;
    }
    const prefix: string[] = [];
    // Join only the bounded prefix; a substring can retain the entire oversized input.
    for (const codePoint of text) {
        if (prefix.length >= limit) {
            break;
        }
        prefix.push(codePoint);
    }
    return prefix.join("");
}
