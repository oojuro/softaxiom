// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
export interface Sealed {
  v: 1;
  kv: number;
  fmt?: string;
  iv: string;
  tag: string;
  data: string;
}

// Where a sealed value belongs. Together with the person and the key version it is the AAD, so a
// ciphertext copied to another row, column, person or key version does not open.
export interface Binding {
  table: string;
  rowId: string;
  purpose: string;
}

const additionalData = (personId: string, { table, rowId, purpose }: Binding, keyVersion: number) =>
  Buffer.from(JSON.stringify(["sa", table, personId, rowId, purpose, keyVersion]));

// AES-256-GCM with a random 96-bit iv: with one key per person the collision risk stays far
// below any real volume.
export function sealWith(
  key: Uint8Array,
  keyVersion: number,
  personId: string,
  binding: Binding,
  plaintext: Uint8Array,
): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv).setAAD(
    additionalData(personId, binding, keyVersion),
  );
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    v: 1,
    kv: keyVersion,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

// The caller supplies the key that matches `sealed.kv`. Nothing about the failure says which part
// was wrong, and it never includes content.
export function openWith(
  key: Uint8Array,
  personId: string,
  binding: Binding,
  sealed: Sealed,
): Uint8Array {
  if (sealed.v !== 1) throw new Error("unsupported envelope version");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"))
      .setAAD(additionalData(personId, binding, sealed.kv))
      .setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]);
  } catch {
    throw new Error("sealed value did not open: wrong key, row, person or purpose, or changed");
  }
}
