// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Credential shapes that must never sit in a skill: a skill is read into model context and copied
// into the cloud computer. These are formats of keys, not a list of services we special-case.
const secretShapes = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bsk-[\w-]{24,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
  /\bxox[abprs]-[\w-]{10,}/,
  /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/,
];

/** Line numbers (1-based) that look like they hold a credential. */
export function secretLines(text: string): number[] {
  return text
    .split("\n")
    .flatMap((line, index) => (secretShapes.some((shape) => shape.test(line)) ? [index + 1] : []));
}
