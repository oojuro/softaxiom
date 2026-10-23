// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
// Takes stored secrets out of text on its way to the model, a log or a report. A page, a tool or
// an error may give a secret back in another form than it was typed, so every form a program
// commonly turns bytes into is matched, with whitespace and zero-width marks ignored so a secret
// split across lines or spaces is still found. Over-redacting is the safe mistake.

export const redactedMark = "[redacted]";

// Shorter than this a value cannot be told from ordinary text. The vault refuses to store one.
export const minimumSecretLength = 4;

// Dashes too: a seed or a code is shown in groups, whatever the separator.
const ignored = /[\s\-​-‍⁠﻿]/;
const stripIgnored = (text: string) => [...text].filter((char) => !ignored.test(char)).join("");

const hexBytes = (bytes: Buffer, prefix: string, joiner: string) =>
  [...bytes].map((byte) => prefix + byte.toString(16).padStart(2, "0")).join(joiner);

// The characters base64 gives for the secret wherever it sits in a longer payload: three
// alignments, keeping only the characters that do not depend on a neighbouring byte, plus the
// whole tail when the secret ends the payload.
function base64Forms(bytes: Buffer): string[] {
  return [0, 1, 2].flatMap((lead) => {
    const encoded = Buffer.concat([Buffer.alloc(lead), bytes]).toString("base64");
    const first = Math.ceil((lead * 8) / 6);
    const last = Math.floor(((lead + bytes.length) * 8) / 6);
    return [
      encoded.slice(first, last),
      encoded.slice(first),
      encoded.slice(first).replace(/=+$/, ""),
    ];
  });
}

const hexForms = (bytes: Buffer) =>
  [
    ["", ""],
    ["", ":"],
    ["", "-"],
    ["\\x", ""],
    ["%", ""],
    ["0x", ","],
  ].flatMap(([prefix = "", joiner = ""]) => {
    const lower = hexBytes(bytes, prefix, joiner);
    return [lower, lower.toUpperCase()];
  });

const lowerPercent = (text: string) =>
  text.replace(/%[0-9A-F]{2}/g, (found) => found.toLowerCase());

function textForms(secret: string): string[] {
  const percent = encodeURIComponent(secret);
  const json = JSON.stringify(secret).slice(1, -1);
  return [
    secret,
    percent,
    lowerPercent(percent),
    encodeURI(secret),
    percent.replaceAll("%20", "+"),
    json,
    json.replace(
      /[^\x20-\x7e]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ),
  ];
}

// A secret is text, or raw bytes (the key a seed spells): bytes have no text form worth matching.
function variantsOf(secret: string | Buffer): string[] {
  const bytes = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  const base64 = base64Forms(bytes);
  const derived = [
    ...base64,
    ...base64.map((form) => form.replaceAll("+", "-").replaceAll("/", "_")),
    ...base64.map((form) => encodeURIComponent(form)),
  ];
  const text = typeof secret === "string" ? textForms(secret) : [];
  const all = [...text, ...hexForms(bytes), ...derived];
  return all.map(stripIgnored).filter((form) => form.length >= minimumSecretLength);
}

// Where, in the original text, the characters of `flat` came from.
function flatten(text: string) {
  const origin: number[] = [];
  let flat = "";
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (ignored.test(char)) continue;
    flat += char;
    origin.push(index);
  }
  return { flat, origin };
}

type Span = [from: number, to: number];

function mergeSpans(spans: Span[]): Span[] {
  const merged: Span[] = [];
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

export function createSecretRedactor() {
  const variantsByKey = new Map<string, string[]>();
  let variants: string[] = [];
  const refresh = () => {
    variants = [...new Set([...variantsByKey.values()].flat())];
  };

  function redact(text: string): string {
    if (variants.length === 0) return text;
    const { flat, origin } = flatten(text);
    const spans: Span[] = [];
    for (const variant of variants) {
      for (let at = flat.indexOf(variant); at >= 0; at = flat.indexOf(variant, at + 1)) {
        spans.push([origin[at] as number, (origin[at + variant.length - 1] as number) + 1]);
      }
    }
    let output = "";
    let done = 0;
    for (const [from, to] of mergeSpans(spans)) {
      output += text.slice(done, from) + redactedMark;
      done = to;
    }
    return output + text.slice(done);
  }

  // The same walk for anything that can be turned into JSON: keys too, since a key can carry text.
  function redactValue<T>(value: T): T {
    if (typeof value === "string") return redact(value) as T;
    if (Array.isArray(value)) return value.map((item) => redactValue(item)) as T;
    if (value === null || typeof value !== "object") return value;
    const entries = Object.entries(value).map(([key, item]) => [redact(key), redactValue(item)]);
    return Object.fromEntries(entries) as T;
  }

  return {
    // The forms of one or more secrets per key; setting a key again replaces them.
    set(key: string, ...secrets: (string | Buffer)[]) {
      variantsByKey.set(key, secrets.flatMap(variantsOf));
      refresh();
    },
    remove(key: string) {
      variantsByKey.delete(key);
      refresh();
    },
    redact,
    redactValue,
    // Error text only: a cause or stack can quote what failed, so neither is kept.
    redactError: (error: unknown) => redact(error instanceof Error ? error.message : String(error)),
  };
}

export type SecretRedactor = ReturnType<typeof createSecretRedactor>;
