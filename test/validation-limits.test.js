// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { CloudTurn } from '../lib/core/contracts/cloud.js';

test('bounded collections reject oversize before visiting elements', () => {
  for (const bound of ['max', 'length']) {
    let visited = 0;
    const element = z.preprocess(value => { visited++; return value; }, z.string());
    const result = z.array(element)[bound](2).safeParse(Array(1000).fill(null));
    assert.equal(result.success, false);
    assert.equal(visited, 0);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, 'too_big');
  }
});

test('oversized Cloud reply collections produce one size refusal rather than per-item issues', () => {
  const result = CloudTurn.safeParse({
    ingressId: '00000000-0000-4000-8000-000000000001', status: 'finished', runId: null,
    outcome: 'done', messages: Array(1000).fill(null), next: null,
  });
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
  assert.deepEqual(result.error.issues[0].path, ['messages']);
});
