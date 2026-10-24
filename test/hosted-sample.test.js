// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSample } from '../lib/core/agent/runs/sample.js';
import { CodedError } from '../lib/core/contracts/codes.js';
import { toEngineMessages } from '../lib/engine-messages.js';

const personId = '00000000-0000-4000-8000-000000000001';
const input = {personId, runId: '00000000-0000-4000-8000-000000000002',
  round: 1, operationId: 'native:sample:0001', replyChannel: 'web'};
const request = {operationId: input.operationId, role: 'chat', system: 'Synthetic fixture',
  tools: [], history: [], engineHistory: [{role: 'user', content: 'Synthetic ask', timestamp: 1}]};
const answer = () => ({text: 'Synthetic answer', calls: [],
  messages: [{role: 'assistant', content: 'Synthetic answer'}], finishReason: 'stop',
  engine: {version: 1, message: {...toEngineMessages([{role: 'assistant', content: 'Synthetic answer'}])[0],
    timestamp: 1, providerState: {opaqueFixture: 'retain only inside sealed native receipt'}}}});
function setup(send = async () => ({status: 'settled', value: answer(), costMicros: 1, absorbedMicros: 0})) {
  const rows = [], requests = [], receipts = new Map();
  const deps = {
    receipt: async (person, operation, task) => {
      assert.equal(person, personId); assert.equal(task, undefined);
      const row = receipts.get(operation);
      if (!row) return undefined;
      return {answer: row, calls: []};
    },
    gateway: {call: async (person, body) => {
      assert.equal(person, personId); requests.push(body); return send();
    }},
    transcript: {
      list: async () => { throw new Error('Receipt lookup must not scan day files'); },
      read: async () => { throw new Error('Receipt lookup must use the host index'); },
      append: async (_person, _target, lines) => {
        for (const line of lines) {
          rows.push(line);
          if (line.kind === 'model') receipts.set(line.op.slice(0, -6), line.body);
        }
        return lines.map((line, i) => ({op: line.op, path: 'conversations/2026-10-24.jsonl',
          fileId: 'fixture', lineNo: i + 1, added: true}));
      },
    },
    tools: {readOnly: () => undefined}, blindKey: async () => new Uint8Array(32).fill(7),
  };
  return {sample: createSample(deps), rows, requests, receipts};
}

test('a native sample persists opaque engine state and its rollback projection before returning', async () => {
  const f = setup();
  const first = await f.sample(input, request);
  assert.equal(first.status, 'answered');
  assert.deepEqual(f.rows[0].body.engine, answer().engine);
  assert.deepEqual(f.rows[0].body.messages, answer().messages);
  for (let n = 0; n < 500; n++) f.rows.push({op: `later:${n}`, kind: 'note', body: {fact: 'synthetic'}});
  const replay = await f.sample(input, request);
  assert.equal(replay.status, 'answered');
  assert.deepEqual(replay.answer.engine, answer().engine);
  assert.equal(f.requests.length, 1, 'a lost ACK does not create another paid provider call');
});

test('sampling does not implement its own compaction or provider retry', async () => {
  const f = setup(async () => { throw new CodedError('context_overflow'); });
  await assert.rejects(f.sample(input, request), error => error.code === 'context_overflow');
  assert.equal(f.requests.length, 1);
  assert.equal(f.rows.length, 0);
  const settled = setup(async () => ({status: 'already_settled', costMicros: 1}));
  assert.deepEqual(await settled.sample(input, request), {status: 'lost'});
  assert.equal(settled.requests.length, 1);
});

test('an engine request cannot change the operation identity or cross the chat/work boundary', async () => {
  const f = setup();
  for (const body of [{...request, operationId: 'different'}, {...request, role: 'work'}])
    await assert.rejects(f.sample(input, body), error => error.code === 'invalid_input');
  assert.equal(f.requests.length, 0);
  assert.equal(f.rows.length, 0);
});
