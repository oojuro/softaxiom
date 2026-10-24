// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
export function verifyUpstream(root: string) {
  const manifest = JSON.parse(readFileSync(resolve(root, "docs/OPENCLAW_PROVENANCE.json"), "utf8")) as {
    revision: string; files: { path: string; sha256: string; source: string; upstreamSha256: string }[];
  };
  assert.equal(manifest.revision, "15ae101a0d854480cfb500a5e241055450da39da", "Upstream revision requires review");
  assert.equal(manifest.files.length, 229, "Upstream import closure requires review");
  assert.equal(new Set(manifest.files.map(file => file.path)).size, 229, "Duplicate inherited source");
  for (const file of manifest.files) {
    assert.match(file.path, /^core\/upstream\/openclaw\/[a-z0-9./-]+\.ts$/);
    assert.match(file.source, /^packages\/[a-z0-9./-]+\.ts$/);
    assert.match(file.upstreamSha256, /^[a-f0-9]{64}$/);
    const text = readFileSync(resolve(root, file.path));
    assert.equal(createHash("sha256").update(text).digest("hex"), file.sha256,
      "Changed inherited source requires provenance review");
    assert.ok(text.toString().slice(0,500).includes("SPDX-License-Identifier: MIT"), "Preserve inherited MIT attribution");
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifyUpstream(fileURLToPath(new URL("../", import.meta.url)));
