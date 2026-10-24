// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionProjection } from '../lib/core/agent/session.js';
import { createAssistantMessageEventStream } from '../lib/core/agent/provider.js';
import { createEmptyTransportUsage } from '../lib/core/upstream/openclaw/ai/src/transports/transport-stream-shared.js';
import { assertCalls } from '../lib/core/agent/limits.js';

const model = { id: 'fixture', name: 'fixture', provider: 'fixture', api: 'openai-completions',
  baseUrl: 'https://fixture.invalid/v1', input: ['text'], reasoning: false, maxTokens: 1024,
  contextWindow: 16000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const assistant = text => ({ role: 'assistant', content: [{ type: 'text', text }], timestamp: 1,
  api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', usage: createEmptyTransportUsage() });
const bytes = messages => Buffer.byteLength(JSON.stringify(messages));
function history() {
  return Array.from({ length: 12 }, (_, n) => [
    { role: 'user', content: `Historical task ${n}: ${'synthetic history '.repeat(30)}`, timestamp: n },
    assistant(`Historical result ${n}: ${'synthetic result '.repeat(30)}`),
  ]).flat();
}

test('upstream compaction bounds history, preserves the current ask and persists before reuse', async () => {
  const session = new SessionProjection(), messages = history();
  const current = { role: 'user', content: 'Resume only this current task.', timestamp: 50 };
  messages.push(current);
  let samples = 0, saved;
  const context = await session.context(messages, { limit: 12000, bytes, model, preserve: current,
    stream: (_model, context) => {
      samples++;
      assert(bytes(context) <= 12000);
      assert.equal(context.systemPrompt.includes('summar'), true);
      const message = assistant('Synthetic summary: prior tasks completed.');
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    },
    persist: entry => { saved = entry; return 'Sanitized durable summary.'; },
  });
  assert(samples > 0);
  assert.equal(saved.type, 'compaction');
  assert(bytes(context) <= 12000);
  assert(context.includes(current));
  assert(JSON.stringify(context).includes('Sanitized durable summary.'));
  assert(!JSON.stringify(context).includes('Synthetic summary:'));
});

test('a failed compaction write cannot replace the authoritative session projection', async () => {
  const session = new SessionProjection(), messages = history();
  const stream = () => {
    const s = createAssistantMessageEventStream();
    s.push({ type: 'done', reason: 'stop', message: assistant('A summary that failed to persist.') });
    return s;
  };
  await assert.rejects(session.context(messages, { limit: 12000, bytes, model, stream,
    persist: () => { throw new Error('synthetic persistence outage'); } }), /persistence outage/);
  const restored = await session.context(messages, { limit: 100000, bytes, model, stream,
    persist: () => { throw new Error('must not write'); } });
  assert.deepEqual(restored, messages);
});

test('provider pairing IDs are bounded and cannot introduce ambiguous extra separators', () => {
  const call = { id: 'call_synthetic|fc_synthetic', name: 'memory', input: {} };
  assert.doesNotThrow(() => assertCalls([call]));
  for (const id of ['one|two|three', 'x'.repeat(201), '../unsafe/id', '|missing'])
    assert.throws(() => assertCalls([{ ...call, id }]));
  assert.throws(() => assertCalls([call, call]));
});
