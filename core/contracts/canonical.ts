// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// A JSON fingerprint must not depend on how a caller ordered an object's keys.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, field]) => field !== undefined);
    const body = entries
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, field]) => {
        return `${JSON.stringify(key)}:${canonical(field)}`;
      });
    return `{${body.join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
