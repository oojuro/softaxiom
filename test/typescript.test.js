// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { supportsWal, assertWalRuntime } from '../lib/inbox.js';

test('runtime, CLI and build modules are authored in checked TypeScript without type escapes', () => {
  for (const folder of ['lib', 'bin', 'scripts']) {
    for (const file of readdirSync(new URL(`../${folder}/`, import.meta.url))) {
      if (!file.endsWith('.ts')) continue;
      const source = readFileSync(new URL(`../${folder}/${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /@ts-(?:ignore|nocheck)/);
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function visit(node) {
        assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, `${folder}/${file}: any disables the contract`);
        ts.forEachChild(node, visit);
      }
      visit(tree);
    }
  }
});

test('WAL runtime admission rejects affected SQLite versions and accepts the documented fixes', () => {
  for (const version of ['3.44.5','3.45.0','3.49.9','3.50.4','3.50.6','3.51.2','unknown','3.51.3-unverified'])
    assert.equal(supportsWal(version), false, version);
  for (const version of ['3.44.6','3.50.7','3.51.3','3.52.0','3.53.4','3.54.1'])
    assert.equal(supportsWal(version), true, version);
  assert.doesNotThrow(assertWalRuntime);
});
