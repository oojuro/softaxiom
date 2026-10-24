// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { fireworksModels } from '../lib/core/agent/gateway/providers.js';
import { generate } from '../lib/core/agent/gateway/generate.js';
import { shapePrompt } from '../lib/core/agent/gateway/prompt.js';
import { fireworksFetch, FIREWORKS_BASE_URL, FIREWORKS_MODEL } from '../lib/core/agent/gateway/fireworks.js';
const route = { provider: 'fireworks', model: FIREWORKS_MODEL, maxInputTokens: 32000, maxOutputTokens: 2048 };
const request = role => ({ operationId: 'synthetic-model-operation', role, system: 'Synthetic instructions', tools: [], history: [{ role: 'user', content: 'Synthetic task' }] });
const body = usage => ({ choices: [{ index: 0, message: { role: 'assistant', content: 'fixture' }, finish_reason: 'stop' }], usage });

test('all hosted roles use upstream Fireworks transports with no provider fallback', async () => {
  const calls = [];
  const models = fireworksModels({ keys: { fireworks: 'synthetic' }, fetch: async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(body({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
  } });
  for (const role of ['chat', 'work', 'authority', 'upkeep']) {
    const response = await generate(models(route), route, shapePrompt(route, request(role), 'sa-synthetic'));
    assert.equal(response.value.text, 'fixture');
    assert.equal(response.value.engine.version, 1);
  }
  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.equal(call.url, FIREWORKS_BASE_URL + '/chat/completions');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.headers.get('authorization'), 'Bearer synthetic');
    assert.equal(call.init.headers.get('x-session-affinity'), 'sa-synthetic');
    assert.equal(typeof call.init.body, 'string');
    const payload = JSON.parse(call.init.body);
    assert.equal(payload.model, FIREWORKS_MODEL);
    assert.equal(payload.max_completion_tokens, route.maxOutputTokens);
    assert.equal(payload.max_tokens, undefined);
  }
  for (const provider of ['openai', 'anthropic', 'google', 'compatible']) assert.throws(() => models({ ...route, provider }));
  assert.throws(() => models({ ...route, model: 'unreviewed' }));
});

test('the actual native wire body is bounded before transport dispatch', async () => {
  let calls = 0;
  const endpoint = fireworksModels({ keys: { fireworks: 'synthetic' }, fetch: async () => {
    calls++;
    return Response.json(body({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }));
  } })({ ...route, maxInputTokens: 4_000_000 });
  await assert.rejects(endpoint.complete({ systemPrompt: 'Synthetic bounds',
    messages: [{ role: 'user', content: 'x'.repeat(1_048_577), timestamp: 0 }],
  }), error => error.code === 'invalid_input');
  assert.equal(calls, 0);
});

test('native usage is authoritative only when complete and coherent; missing or invalid counts remain unknown', async () => {
  const valid = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110,
    prompt_tokens_details: { cached_tokens: 30, cache_write_tokens: 20 } };
  const endpoint = usage => fireworksModels({ keys: { fireworks: 'synthetic' }, fetch: async () => Response.json(body(usage)) })(route);
  const prompt = shapePrompt(route, request('chat'), 'sa-usage');
  assert.deepEqual((await generate(endpoint(valid), route, prompt)).usage,
    { inputTokens: 50, outputTokens: 10, cacheReadTokens: 30, cacheWriteTokens: 20 });
  for (const usage of [undefined, {}, { ...valid, completion_tokens: -1 }, { ...valid, prompt_tokens: 1.5 },
    { ...valid, total_tokens: 109 }, { ...valid, total_tokens: 111 },
    { ...valid, prompt_tokens_details: { cached_tokens: 101 } }])
    await assert.rejects(generate(endpoint(usage), route, prompt), error => error.code === 'outcome_unknown');
});

test('provider context refusal stays a definite refusal and never sends a hidden retry', async () => {
  let calls = 0;
  const models = fireworksModels({ keys: { fireworks: 'synthetic' }, fetch: async () => {
    calls++;
    return Response.json({ error: { code: 'context_length_exceeded', message: 'Synthetic private provider detail' } }, { status: 400 });
  } });
  await assert.rejects(generate(models(route), route, shapePrompt(route, request('chat'), 'sa-error')), error => {
    assert.equal(error.status, 400);
    assert.equal(JSON.stringify(error).includes('Synthetic private provider detail'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('hosted final transport rejects embeddings, alternate hosts and redirects before dispatch', async () => {
  let calls = 0;
  const send = fireworksFetch(async (_input, init) => { calls++; assert.equal(init.redirect, 'error'); return Response.json({}); });
  for (const url of [FIREWORKS_BASE_URL + '/embeddings', 'https://api.openai.com/v1/chat/completions', FIREWORKS_BASE_URL + '/chat/completions?x=1'])
    assert.throws(() => send(url, { method: 'POST' }));
  assert.equal(calls, 0);
  await send(FIREWORKS_BASE_URL + '/chat/completions', { method: 'POST', redirect: 'follow' });
  assert.equal(calls, 1);
});
