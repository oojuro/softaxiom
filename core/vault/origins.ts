// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { VaultError } from "./errors.ts";

// The only kind of origin a login is saved for: `https`, the default port, no login in the
// address. Everything else (`http`, another port, `user@host` tricks, a bare name) is not an
// origin a password may be typed on. URL parsing turns look-alike letters into punycode, so one
// that is not the saved name never compares equal.
export function httpsOrigin(address: string): string | undefined {
  try {
    const url = new URL(address);
    const plain = url.protocol === "https:" && !url.port && !url.username && !url.password;
    return plain ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

// Each origin in canonical form, once. Nothing is guessed from a bad one: it is refused.
export function checkedOrigins(origins: readonly string[]): string[] {
  if (origins.length === 0) throw new VaultError("no_origin");
  const canonical = origins.map((origin) => {
    const found = httpsOrigin(origin);
    if (!found) throw new VaultError("invalid_origin");
    return found;
  });
  return [...new Set(canonical)];
}

// Whether a page, by its address, is on one of the origins a login was saved for.
export function onSavedOrigin(origins: readonly string[], address: string): boolean {
  const origin = httpsOrigin(address);
  return origin !== undefined && origins.includes(origin);
}
