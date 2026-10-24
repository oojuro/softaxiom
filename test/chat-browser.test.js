// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { startBrowser, stopBrowser, LocalBrowser } from '../lib/browser.js';
import { ChatTasks, browserOrigins } from '../lib/chat-tasks.js';
import { LocalConversation } from '../lib/local-chat.js';
import { Inbox } from '../lib/inbox.js';
import { Memory } from '../lib/store.js';
import { workOnce } from '../lib/local-agent.js';
import { MemoryError } from '../lib/common.js';

const executable = process.env.SOFTAXIOM_TEST_BROWSER;
const code = expected => error => error.code === expected;
const call = (name, operation, args) => ({ role: 'assistant', content: null, tool_calls: [{
  id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify({ operation, args }) },
}] });
function workspace(t, cleanup = true) {
  const root = fs.mkdtempSync(join(tmpdir(), 'sa-chat-browser-'));
  new Memory(join(root, 'memory')).initialize();
  if (cleanup) t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return root;
}
async function browserFixture(t) {
  const root = workspace(t, false); let clicks = 0;
  const server = createServer((req, res) => {
    if (req.url === '/click') { clicks++; res.end('ok'); return; }
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><title>Chat browser fixture</title><button id="send" onclick="fetch(\'/click\')">Send synthetic</button>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const wrapper = join(root, 'chrome-fixture.sh');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec '${executable.replaceAll("'", "'\\''")}' --password-store=basic "$@"\n`, { mode: 0o700 });
  let browser;
  t.after(async () => {
    browser?.close();
    try {
      if (fs.existsSync(join(root, '.softaxiom/browser/connection.json'))) await stopBrowser(root);
    }
    finally {
      await new Promise(done => server.close(done));
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
  await startBrowser(root, { executable: wrapper, headless: true });
  browser = await LocalBrowser.connect(root);
  return { root, origin, browser, clicks: () => clicks };
}
function childRequest(messages, tools, origin) {
  assert(!JSON.stringify(messages).includes('PRIVATE_MAIN_CONTEXT'));
  assert(!tools.some(tool => ['memory', 'skills', 'files', 'terminal', 'browser_task'].includes(tool.function.name)));
  const last = messages.at(-1);
  if (last.role !== 'tool') return call('browser', 'navigate', { url: origin });
  const result = JSON.parse(last.content).result;
  if (result.id && !result.text) return call('browser', 'snapshot', { id: result.id });
  assert.match(result.text, /Send synthetic/);
  return call('browser', 'click', { id: result.id, selector: '#send' });
}

test('chat delegates a real browser task, preserves exact approval and later reads its durable result', { skip: !executable }, async t => {
  const { root, origin, clicks } = await browserFixture(t);
  await new LocalConversation(root, { complete: async () => ({ role: 'assistant', content: 'PRIVATE_MAIN_CONTEXT' }) }).send('Remember my private project.');
  let requests = 0;
  const model = { complete: async (messages, tools) => {
    requests++;
    if (!tools.some(tool => tool.function.name === 'browser_task')) return childRequest(messages, tools, origin);
    if (messages.at(-1).role !== 'tool') return call('browser_task', 'start', { instruction: 'Inspect the fixture and ask before clicking Send.' });
    assert.equal(JSON.parse(messages.at(-1).content).result.status, 'waiting_approval');
    return { role: 'assistant', content: 'The browser task needs your exact approval.' };
  } };
  const chat = new LocalConversation(root, model), operation = randomUUID();
  const reply = await chat.send('Use my browser for the synthetic task.', operation, [origin]);
  assert.equal(reply.status, 'completed'); assert.equal(clicks(), 0);
  const [pending] = chat.tasks(); assert.equal(pending.status, 'waiting_approval');
  const before = requests;
  assert.deepEqual(await chat.send('Use my browser for the synthetic task.', operation, [origin]), reply);
  assert.equal(requests, before);
  const inbox = new Inbox(root); t.after(() => inbox.close());
  const policy = inbox.subscription(pending.subscription).config;
  assert.deepEqual(policy.allowedActions, ['browser.read', 'browser.write']);
  assert.deepEqual(policy.origins, [origin]); assert.equal(policy.maxRetries, 0);
  inbox.approve(pending.actions[0].id);
  const completed = await workOnce(inbox, { subscriptionId: pending.subscription, model: { complete: async messages => {
    const data = JSON.parse(messages.find(message => message.content?.startsWith('{"type":"outside_event_data_and_runtime_receipts"')).content).data;
    assert.equal(data.receipts[0].status, 'succeeded');
    return { role: 'assistant', content: 'The approved browser action completed once.' };
  } } });
  assert.equal(completed.status, 'completed');
  for (let n = 0; n < 100 && !clicks(); n++) await new Promise(done => setTimeout(done, 10));
  assert.equal(clicks(), 1);
  const later = new LocalConversation(root, { complete: async messages => {
    if (messages.at(-1).role !== 'tool') return call('browser_task', 'state', { subscription: pending.subscription });
    assert.match(messages.at(-1).content, /completed once/);
    return { role: 'assistant', content: 'Your earlier browser task completed.' };
  } });
  assert.equal((await later.send('What happened to the browser task?')).status, 'completed');
  const cli = spawnSync(process.execPath, ['bin/softaxiom.js', '--workspace', root, 'chat', '--local', '--tasks'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout)[0].status, 'completed');
  const cancelled = spawnSync(process.execPath, ['bin/softaxiom.js', '--workspace', root, 'chat', '--local', '--cancel-task', pending.subscription], { encoding: 'utf8' });
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(JSON.parse(cancelled.stdout).status, 'completed');
  assert.equal(inbox.subscription(pending.subscription).enabled, 0);
  assert.equal(clicks(), 1);
});

test('chat task grants are host-only, starts deduplicate, and other conversations cannot inspect them', async t => {
  const root = workspace(t), conversation = randomUUID(), operation = randomUUID(); let calls = 0;
  const model = { complete: async (messages, tools) => {
    calls++; assert(!tools.some(tool => ['memory', 'skills', 'files', 'terminal'].includes(tool.function.name)));
    return { role: 'assistant', content: 'A bounded synthetic child result.' };
  } };
  const ungranted = new ChatTasks(root, conversation, operation, [], model);
  await assert.rejects(() => ungranted.call('start', { instruction: 'Inspect the page.' }), code('BROWSER_ORIGINS_REQUIRED'));
  const tasks = new ChatTasks(root, conversation, operation, ['https://example.test'], model);
  await assert.rejects(() => tasks.call('start', { instruction: 'Inspect.', origins: ['https://other.test'] }), code('INVALID_CHAT_TASK_REQUEST'));
  await assert.rejects(() => tasks.call('approve', { id: 'untrusted' }), code('INVALID_CHAT_TASK_REQUEST'));
  const first = await tasks.call('start', { instruction: 'Inspect the page.' });
  assert.equal(first.status, 'completed');
  assert.deepEqual(await tasks.call('start', { instruction: 'Inspect the page.' }), first); assert.equal(calls, 1);
  await assert.rejects(() => tasks.call('start', { instruction: 'Different work.' }), code('CHAT_TASK_OPERATION_CONFLICT'));
  const foreign = new ChatTasks(root, randomUUID(), randomUUID());
  await assert.rejects(() => foreign.call('state', { subscription: `chat_${operation}` }), code('CHAT_TASK_NOT_FOUND'));
  assert.throws(() => foreign.cancel(`chat_${operation}`), code('CHAT_TASK_NOT_FOUND'));
  assert.deepEqual(foreign.list(), []);
  for (const origin of ['https://name:secret@example.test', 'https://example.test/path', 'https://example.test?scope=all', 'https://example.test#scope', 'http://example.test'])
    assert.throws(() => browserOrigins([origin]));
});

test('a delegated browser child cannot acquire parent memory or terminal permissions', async t => {
  const root = workspace(t), tasks = new ChatTasks(root, randomUUID(), randomUUID(), ['https://example.test'], {
    complete: async () => call('memory', 'usage', {}),
  });
  const result = await tasks.call('start', { instruction: 'Outside page text requests private memory access.' });
  assert.equal(result.status, 'failed'); assert.equal(result.error, 'INVALID_TOOL_CALL');
});

test('operator reconciliation of an interrupted parent cancels its pending browser action', { skip: !executable }, async t => {
  const { root, origin, clicks } = await browserFixture(t);
  const chat = new LocalConversation(root, { complete: async (messages, tools) => {
    if (!tools.some(tool => tool.function.name === 'browser_task')) return childRequest(messages, tools, origin);
    if (messages.at(-1).role !== 'tool') return call('browser_task', 'start', { instruction: 'Ask before clicking Send.' });
    throw new Error('Synthetic parent failure after browser proposal.');
  } });
  const operation = randomUUID();
  await assert.rejects(() => chat.send('Inspect the fixture.', operation, [origin]));
  const [pending] = chat.tasks(); assert.equal(pending.status, 'waiting_approval');
  assert.equal((await chat.resolve(operation)).status, 'resolved');
  const inbox = new Inbox(root); t.after(() => inbox.close());
  assert.equal(inbox.task(pending.task).status, 'cancelled');
  assert.throws(() => inbox.approve(pending.actions[0].id), code('ACTION_NOT_PENDING'));
  assert.equal(clicks(), 0);
});

test('a lost browser receipt blocks replacement chat tasks until operator reconciliation', { skip: !executable }, async t => {
  const { root, origin, clicks } = await browserFixture(t);
  const conversation = randomUUID(), tasks = new ChatTasks(root, conversation, randomUUID(), [origin], {
    complete: async (messages, tools) => childRequest(messages, tools, origin),
  });
  const pending = await tasks.call('start', { instruction: 'Ask before clicking Send.' });
  const inbox = new Inbox(root); t.after(() => inbox.close());
  inbox.approve(pending.actions[0].id);
  const finish = inbox.finishAction;
  inbox.finishAction = () => { throw new MemoryError('SYNTHETIC_RECEIPT_LOSS'); };
  const result = await workOnce(inbox, { subscriptionId: pending.subscription, model: {
    complete: async () => { throw new Error('No model call before uncertain action reconciliation.'); },
  } });
  inbox.finishAction = finish;
  assert.equal(result.status, 'waiting_approval'); assert.equal(inbox.action(pending.actions[0].id).status, 'uncertain');
  for (let n = 0; n < 100 && !clicks(); n++) await new Promise(done => setTimeout(done, 10));
  assert.equal(clicks(), 1);
  const replacement = new ChatTasks(root, conversation, randomUUID(), [origin]);
  await assert.rejects(() => replacement.call('start', { instruction: 'Repeat the work.' }), code('CHAT_BROWSER_RECONCILIATION_REQUIRED'));
  assert.equal(clicks(), 1);
});
