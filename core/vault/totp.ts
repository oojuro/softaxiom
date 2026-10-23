// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createHmac } from "node:crypto";

// Time-based one-time codes (RFC 6238 over RFC 4226), computed in code at the moment a page asks
// for one. The seed is as sensitive as a password: it is opened for one computation and dropped.
export const algorithms = ["SHA1", "SHA256", "SHA512"] as const;
export type Algorithm = (typeof algorithms)[number];

export interface Authenticator {
  // Base32, upper case, without spaces, dashes or padding.
  secret: string;
  algorithm: Algorithm;
  digits: number;
  period: number;
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const periodRange = { min: 10, max: 300 };

const normalized = (text: string) => text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");

/** The key bytes of a base32 seed; undefined when the text is not base32. */
export function seedBytes(secret: string): Buffer | undefined {
  const clean = normalized(secret);
  if (clean === "" || /[^A-Z2-7]/.test(clean)) return undefined;
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    buffer = ((buffer << 5) | alphabet.indexOf(char)) & 0xfffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

const isAlgorithm = (name: string): name is Algorithm => algorithms.includes(name as Algorithm);

/**
 * What a person pastes from a site's authenticator setup: the base32 key, or the `otpauth://totp`
 * link its QR code holds. Anything else, or settings outside the usual ones, is refused.
 */
export function parseAuthenticator(input: string): Authenticator | undefined {
  const text = input.trim();
  if (!/^otpauth:/i.test(text)) {
    return seedBytes(text)
      ? { secret: normalized(text), algorithm: "SHA1", digits: 6, period: 30 }
      : undefined;
  }
  try {
    const link = new URL(text);
    const { searchParams: query } = link;
    const secret = query.get("secret") ?? "";
    const algorithm = (query.get("algorithm") ?? "SHA1").toUpperCase();
    const digits = Number(query.get("digits") ?? 6);
    const period = Number(query.get("period") ?? 30);
    const valid =
      link.host.toLowerCase() === "totp" &&
      seedBytes(secret) &&
      isAlgorithm(algorithm) &&
      [6, 7, 8].includes(digits) &&
      Number.isInteger(period) &&
      period >= periodRange.min &&
      period <= periodRange.max;
    return valid ? { secret: normalized(secret), algorithm, digits, period } : undefined;
  } catch {
    return undefined;
  }
}

/** The code for a moment. Throws if the seed is not base32, which `parseAuthenticator` rules out. */
export function authenticatorCode(authenticator: Authenticator, at: Date): string {
  const { secret, algorithm, digits, period } = authenticator;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / period)));
  const key = seedBytes(secret);
  if (!key) throw new Error("authenticator: seed is not base32");
  const mac = createHmac(algorithm.toLowerCase(), key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}
