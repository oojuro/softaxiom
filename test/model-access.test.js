import { streamingResponse } from "./provider-fixture.js";
// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { modelCommand } from '../lib/model-cli.js';
import { saveModelProfile, modelStatus, forgetModel } from '../lib/model-access.js';
import { config } from '../lib/common.js';
import { HttpModel, LocalAgent } from '../lib/runtime.js';
import { Memory } from '../lib/store.js';
import { Journal } from '../lib/journal.js';
import { Inbox } from '../lib/inbox.js';
import { workOnce } from '../lib/local-agent.js';

const secret = 'synthetic-provider-credential';
const errorCode = code => error => error.code === code;
function directory(t) {
  const temporary = fs.mkdtempSync(join(tmpdir(), 'sa-model-test-'));
  const root = join(temporary, 'auth');
  const previous = process.env.SOFTAXIOM_STATE_DIR;
  process.env.SOFTAXIOM_STATE_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.SOFTAXIOM_STATE_DIR;
    else process.env.SOFTAXIOM_STATE_DIR = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  return { temporary, root };
}
async function server(t, respond) {
  const calls = [];
  const instance = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, headers: req.headers, body: body && JSON.parse(body) });
    res.setHeader('content-type', 'application/json');
    streamingResponse(res, calls.at(-1).body);
    respond(req, res, calls.at(-1));
  });
  instance.listen(0, '127.0.0.1'); await once(instance, 'listening');
  t.after(() => new Promise(done => instance.close(done)));
  return { baseUrl: `http://127.0.0.1:${instance.address().port}/v1`, calls };
}
function compatible(res, text = 'Synthetic answer') {
  res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: text,
    reasoning_content: 'hidden synthetic reasoning' }, finish_reason: 'stop' }] }));
}

test('setup masks the key, saves private credentials, and model logout preserves Cloud state', async t => {
  const { root } = directory(t), prompts = [];
  assert.deepEqual(await modelStatus(), { configured: false });
  assert.equal(fs.existsSync(root), false);
  const answers = ['compatible', 'https://models.example.test/v1', 'synthetic-model', secret];
  const result = await modelCommand('setup', [], async (label, masked) => {
    prompts.push({ label, masked }); return answers.shift();
  });
  assert.equal(prompts.at(-1).masked, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(result.configured, true);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  const path = join(root, 'local-model.json');
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(path)).apiKey, secret);
  fs.writeFileSync(join(root, 'cloud-session.json'), 'unrelated synthetic Cloud state', { mode: 0o600 });
  assert.equal(JSON.stringify(await modelStatus()).includes(secret), false);
  await modelCommand('model', ['logout']);
  assert.equal(fs.existsSync(path), false);
  assert.equal(fs.readFileSync(join(root, 'cloud-session.json'), 'utf8'), 'unrelated synthetic Cloud state');
});

test('model setup refuses a credential file that is readable by other users', async t => {
  const { root } = directory(t);
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: 'http://127.0.0.1:11434/v1', name: 'fixture', apiKey: secret });
  fs.chmodSync(join(root, 'local-model.json'), 0o644);
  await assert.rejects(modelStatus(), errorCode('UNSAFE_AUTH_FILE'));
});

test('unsafe endpoints and credentials are rejected before writing setup', async t => {
  const { root } = directory(t);
  for (const baseUrl of ['http://remote.example.test/v1', 'https://name:pass@example.test', 'https://example.test?token=value'])
    await assert.rejects(saveModelProfile({ version: 1, provider: 'compatible', name: 'synthetic', baseUrl, apiKey: secret }));
  await assert.rejects(saveModelProfile({ version: 1, provider: 'openai', name: 'synthetic', baseUrl: 'https://api.openai.com/v1' }), errorCode('MODEL_KEY_REQUIRED'));
  await assert.rejects(saveModelProfile({ version: 1, provider: 'compatible', name: 'synthetic', baseUrl: 'https://example.test/v1', apiKey: 'bad\nheader' }), errorCode('INVALID_MODEL_PROFILE'));
  assert.equal(fs.existsSync(root), false);
});

test('saved credentials reach their selected endpoint; conflicting workspace settings make no request', async t => {
  directory(t);
  const f = await server(t, (_req, res) => compatible(res));
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
  const answer = await new HttpModel(config()).complete([{ role: 'user', content: 'Synthetic request' }]);
  assert.equal(answer.content, 'Synthetic answer');
  assert.equal(JSON.stringify(answer).includes('hidden synthetic reasoning'), false);
  assert.equal(f.calls[0].headers.authorization, `Bearer ${secret}`);
  await assert.rejects(new HttpModel(config({ model: { baseUrl: f.baseUrl, name: 'workspace-model', apiKeyEnv: 'SA_TEST_UNSET_KEY' } })).complete([{ role: 'user', content: 'Other request' }]), errorCode('MODEL_PROFILE_MISMATCH'));
  assert.equal(f.calls.length, 1);
});

test('OpenAI and Anthropic use their native APIs with no hidden reasoning in results', async t => {
  directory(t);
  const f = await server(t, (req, res) => {
    if (req.url === '/v1/responses') res.end(JSON.stringify({ id: 'resp_synthetic', created_at: 0, model: 'fixture', status: 'completed',
      output: [{ type: 'message', id: 'msg_synthetic', role: 'assistant', content: [{ type: 'output_text', text: 'OpenAI answer', annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }));
    else res.end(JSON.stringify({ id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'fixture',
      content: [{ type: 'text', text: 'Anthropic answer' }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 2 } }));
  });
  const model = new HttpModel(config());
  for (const provider of ['openai', 'anthropic']) {
    await saveModelProfile({ version: 1, provider, baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
    const answer = await model.complete([{ role: 'system', content: 'Synthetic instruction' }, { role: 'user', content: 'Request' }]);
    assert.equal(answer.content, provider === 'openai' ? 'OpenAI answer' : 'Anthropic answer');
  }
  assert.equal(f.calls[0].path, '/v1/responses');
  assert.equal(f.calls[0].body.store, false);
  assert.equal(f.calls[0].headers.authorization, `Bearer ${secret}`);
  assert.equal(f.calls[1].path, '/v1/messages');
  assert.equal(f.calls[1].headers['x-api-key'], secret);
  assert.equal(f.calls[1].headers.authorization, undefined);
});

test('provider failures are sanitized and not retried; redirected credentials never reach another endpoint', async t => {
  directory(t);
  let hits = 0;
  const sink = await server(t, (_req, res) => { hits++; compatible(res); });
  const f = await server(t, (_req, res) => { res.writeHead(302, { location: sink.baseUrl }); res.end(); });
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
  await assert.rejects(new HttpModel(config()).complete([{ role: 'user', content: 'Request' }]), error => {
    assert.equal(JSON.stringify(error).includes(secret), false);
    return error.code === 'MODEL_CONNECTION_FAILED';
  });
  assert.equal(f.calls.length, 1);
  assert.equal(hits, 0);
  await forgetModel();
});

test('HTTP errors have no provider text, no retries, and request overflow sends nothing', async t => {
  directory(t);
  const f = await server(t, (_req, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: secret })); });
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
  const model = new HttpModel(config());
  await assert.rejects(model.complete([{ role: 'user', content: 'Request' }]), error => {
    assert.equal(JSON.stringify(error).includes(secret), false);
    return error.code === 'MODEL_HTTP_ERROR' && error.details.status === 500;
  });
  assert.equal(f.calls.length, 1);
  await assert.rejects(model.complete([{ role: 'user', content: 'x'.repeat(40000) }]), errorCode('REQUEST_CAPACITY_EXCEEDED'));
  assert.equal(f.calls.length, 1);
});

test('the actual local tool loop replays provider envelopes without journaling them', async t => {
  const { temporary } = directory(t), workspace = join(temporary, 'workspace');
  const memory = new Memory(join(workspace, 'memory'));
  memory.initialize({ oojuro: process.env.OOJURO_BIN || 'oojuro' });
  const opaque = 'synthetic-real-tool-replay';
  const f = await server(t, (_req, res, call) => {
    if (f.calls.length === 1) res.end(JSON.stringify({ id: 'resp_synthetic', created_at: 0, model: 'fixture', status: 'completed',
      output: [{ type: 'reasoning', id: 'rs_synthetic', summary: [], encrypted_content: opaque },
        { type: 'function_call', id: 'fc_synthetic', call_id: 'call_synthetic', name: 'memory', arguments: '{"operation":"usage","args":{}}', status: 'completed' }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }));
    else {
      if (!JSON.stringify(call.body).includes(opaque)) { res.statusCode = 400; res.end('{}'); return; }
      res.end(JSON.stringify({ id: 'resp_synthetic_next', created_at: 0, model: 'fixture', status: 'completed',
        output: [{ type: 'message', id: 'msg_synthetic_next', role: 'assistant', content: [{ type: 'output_text', text: 'Local tool round complete', annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }));
    }
  });
  await saveModelProfile({ version: 1, provider: 'openai', baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
  const result = await new LocalAgent(workspace).run('Inspect memory usage, then finish.');
  assert.equal(result.text, 'Local tool round complete');
  assert.equal(f.calls.length, 2);
  const page = new Journal(memory.root, memory.call('settings')).range(
    new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 1000).toISOString(), 40);
  assert.equal(page.partial, false);
  assert(page.records.length >= 6);
  assert(page.records.some(record => record.text.includes('Local tool round complete')));
  assert(page.records.every(record => !record.text.includes(opaque)));
});

test('provider responses stop at the shared byte limit', async t => {
  directory(t);
  const f = await server(t, (_req, res) => res.end('x'.repeat(1048577)));
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: f.baseUrl, name: 'fixture' });
  await assert.rejects(new HttpModel(config()).complete([{ role: 'user', content: 'Request' }]), errorCode('MODEL_RESPONSE_TOO_LARGE'));
});

test('workspace files cannot redirect model data or select an unrelated environment credential', async t => {
  const { temporary } = directory(t), workspace = join(temporary, 'workspace');
  const trusted = await server(t, (_req, res) => compatible(res));
  const outside = await server(t, (_req, res) => compatible(res));
  const previous = process.env.SA_TEST_MODEL_OTHER_PURPOSE;
  process.env.SA_TEST_MODEL_OTHER_PURPOSE = 'synthetic-other-purpose-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.SA_TEST_MODEL_OTHER_PURPOSE;
    else process.env.SA_TEST_MODEL_OTHER_PURPOSE = previous;
  });
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: trusted.baseUrl, name: 'selected-model', apiKey: secret });
  new Memory(join(workspace, 'memory')).initialize({ oojuro: process.env.OOJURO_BIN || 'oojuro',
    model: { baseUrl: outside.baseUrl, name: 'outside-model', apiKeyEnv: 'SA_TEST_MODEL_OTHER_PURPOSE' } });
  await assert.rejects(new LocalAgent(workspace).run('Keep this request on the selected provider.'), errorCode('MODEL_PROFILE_MISMATCH'));
  assert.equal(outside.calls.length, 0);
  assert.equal(trusted.calls.length, 0);
});

test('matching legacy settings use only the explicitly saved credential', async t => {
  directory(t);
  const f = await server(t, (_req, res) => compatible(res));
  const previous = process.env.SA_TEST_MODEL_OTHER_PURPOSE;
  process.env.SA_TEST_MODEL_OTHER_PURPOSE = 'synthetic-other-purpose-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.SA_TEST_MODEL_OTHER_PURPOSE;
    else process.env.SA_TEST_MODEL_OTHER_PURPOSE = previous;
  });
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: f.baseUrl, name: 'selected-model', apiKey: secret });
  const settings = config({ model: { baseUrl: f.baseUrl, name: 'selected-model', apiKeyEnv: 'SA_TEST_MODEL_OTHER_PURPOSE' } });
  await new HttpModel(settings).complete([{ role: 'user', content: 'Synthetic request' }]);
  assert.equal(f.calls[0].headers.authorization, `Bearer ${secret}`);
});

test('workspace model selection without a private setup profile makes no request', async t => {
  const { root } = directory(t);
  const f = await server(t, (_req, res) => compatible(res));
  await assert.rejects(new HttpModel(config({ model: { baseUrl: f.baseUrl, name: 'workspace-only' } })).complete([
    { role: 'user', content: 'Synthetic request' },
  ]), errorCode('MODEL_NOT_CONFIGURED'));
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(root), false);
});

test('Radar uses global setup when the workspace has no explicit model', async t => {
  const { temporary } = directory(t), workspace = join(temporary, 'workspace');
  const f = await server(t, (_req, res) => compatible(res, 'Synthetic Radar result'));
  await saveModelProfile({ version: 1, provider: 'compatible', baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
  const memory = new Memory(join(workspace, 'memory'));
  memory.initialize({ oojuro: process.env.OOJURO_BIN || 'oojuro' });
  const inbox = new Inbox(workspace); t.after(() => inbox.close());
  inbox.putSource({ id: 'synthetic', account: 'synthetic', kind: 'manual' });
  inbox.putSubscription({ id: 'synthetic', sources: ['synthetic'], instruction: 'Inspect the synthetic event.',
    allowedActions: ['memory'], origins: [] });
  inbox.ingest('synthetic', [{ id: 'event', kind: 'ci.failed', summary: 'Synthetic event' }]);
  const result = await workOnce(inbox);
  assert.equal(result.status, 'completed');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.authorization, `Bearer ${secret}`);
  assert.equal(JSON.stringify(inbox.task(result.task)).includes(secret), false);
});

test('a model-profile change cannot reuse a specialist price quote for another key or endpoint', async t => {
  directory(t); const {hash}=await import('../lib/common.js');
  const {localModelProfile}=await import('../lib/model-access.js');
  await saveModelProfile({version:1,provider:'compatible',baseUrl:'https://selected.example.test/v1',name:'fixture',apiKey:secret});
  const expected=hash(JSON.stringify(await localModelProfile()));
  await saveModelProfile({version:1,provider:'compatible',baseUrl:'https://changed.example.test/v1',name:'fixture',apiKey:'different-synthetic-key'});
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('No request permitted');};
  t.after(()=>{globalThis.fetch=original;});
  await assert.rejects(new HttpModel(config()).complete([{role:'user',content:'Synthetic'}],[],undefined,expected),errorCode('MODEL_PROFILE_CHANGED'));
  assert.equal(calls,0);
});

test('native SDK ambient headers, billing identities and debug logging cannot cross the profile boundary', async t => {
  directory(t);
  const ambient = 'synthetic-unrelated-ambient-secret';
  const values = {
    OPENAI_CUSTOM_HEADERS: `authorization: Bearer ${ambient}\nx-unrelated: ${ambient}`,
    ANTHROPIC_CUSTOM_HEADERS: `authorization: Bearer ${ambient}\nx-api-key: ${ambient}\nx-unrelated: ${ambient}`,
    OPENAI_ADMIN_KEY: ambient, OPENAI_ORG_ID: ambient, OPENAI_PROJECT_ID: ambient,
    OPENAI_LOG: 'debug', ANTHROPIC_LOG: 'debug',
  };
  for (const [name, value] of Object.entries(values)) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const logs = [];
  for (const method of ['debug', 'log', 'info', 'warn', 'error']) t.mock.method(console, method, (...args) => logs.push(args));
  const f = await server(t, (req, res) => {
    if (req.url.endsWith('/responses')) res.end(JSON.stringify({ id: 'resp_ambient', status: 'completed', model: 'fixture',
      output: [{ type: 'message', id: 'msg_ambient', role: 'assistant', content: [{ type: 'output_text', text: 'Selected profile only.', annotations: [] }] }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } }));
    else res.end(JSON.stringify({ id: 'msg_ambient', type: 'message', role: 'assistant', model: 'fixture',
      content: [{ type: 'text', text: 'Selected profile only.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 2 } }));
  });
  for (const provider of ['openai', 'anthropic']) {
    await saveModelProfile({ version: 1, provider, baseUrl: f.baseUrl, name: 'fixture', apiKey: secret });
    assert.equal((await new HttpModel(config()).complete([{ role: 'user', content: 'Synthetic private request.' }])).content, 'Selected profile only.');
  }
  assert.equal(JSON.stringify(f.calls).includes(ambient), false);
  assert.equal(f.calls[0].headers.authorization, `Bearer ${secret}`);
  assert.equal(f.calls[1].headers['x-api-key'], secret);
  assert.deepEqual(logs, []);
});
