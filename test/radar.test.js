// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { Inbox } from '../lib/inbox.js';
import { pollSources, webhookServer } from '../lib/watchers.js';

const isCode = code => error => error.code === code;
const event = (id = 'one', extra = {}) => ({ id, kind: 'ci.failed', summary: 'Synthetic check failed', group: 'pull:1', ...extra });
function fixture(t, options = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'softaxiom-radar-test-'));
  const db = new Inbox(workspace, options);
  t.after(() => { db.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  db.putSource({ id: 'source', account: 'synthetic', kind: 'manual' });
  db.putSubscription({ id: 'subscription', sources: ['source'], instruction: 'Investigate failures. Ask before pushing.',
    allowedActions: ['memory', 'browser.read', 'browser.write'], origins: ['https://example.test'] });
  return { workspace, db };
}
async function server(t, callback) {
  const s = createServer(callback); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  t.after(() => new Promise(done => s.close(done)));
  return `http://127.0.0.1:${s.address().port}`;
}

test('durable deduplication, grouping, processed versus read, and fresh-process recovery', async t => {
  const { db, workspace } = fixture(t);
  assert.equal(db.ingest('source', [event(), event('two')]).inserted, 2);
  assert.equal(db.ingest('source', [event()]).duplicates, 1);
  const source = `import {Inbox} from ${JSON.stringify(new URL('../lib/inbox.js', import.meta.url).href)};
    const d=new Inbox(${JSON.stringify(workspace)});const t=d.claimTask();console.log(JSON.stringify({id:t.id,token:t.lease_token,events:t.events.length}));d.close();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  assert.equal((await once(child, 'exit'))[0], 0);
  const claimed = JSON.parse(output);
  assert.equal(claimed.events, 2); assert.equal(db.claimTask(), null);
  db.complete(claimed.id, claimed.token, { text: 'Failure investigated, no push made.' });
  assert.equal(db.events({ unread: true }).length, 2);
  assert.ok(db.events().every(e => e.processed === 1 && e.read_at === null));
  db.markRead(db.events()[0].id); assert.equal(db.events({ unread: true }).length, 1);
  assert.equal(db.ingest('source', [event()]).inserted, 0); assert.equal(db.claimTask(), null);
});

test('lease fencing, finite retries and subscription changes stop assigned and unassigned work', t => {
  let now = 1000;
  const { db } = fixture(t, { clock: () => now, leaseMs: 100 });
  db.ingest('source', [event()]); const first = db.claimTask();
  db.progress(first.id, first.lease_token, { note: 'Inspected CI; no effects yet' });
  now += 101; const resumed = db.claimTask();
  assert.equal(resumed.id, first.id); assert.notEqual(resumed.lease_token, first.lease_token);
  assert.equal(resumed.progress.note, 'Inspected CI; no effects yet');
  assert.throws(() => db.complete(first.id, first.lease_token, { text: 'stale' }), isCode('TASK_LEASE_LOST'));
  db.ingest('source', [event('later')]);
  db.putSubscription({ ...db.subscription('subscription').config, id: 'subscription', enabled: false });
  assert.throws(() => db.assertLease(resumed.id, resumed.lease_token), isCode('TASK_LEASE_LOST'));
  assert.equal(db.claimTask(), null);
  assert.ok(db.all('SELECT status FROM deliveries').every(d => d.status === 'cancelled'));
  db.putSubscription({ ...db.subscription('subscription').config, id: 'subscription', enabled: true, maxRetries: 1 });
  db.ingest('source', [event('fresh')]); const retry = db.claimTask();
  db.fail(retry.id, retry.lease_token, 'SYNTHETIC_FAILURE'); assert.equal(db.claimTask(), null);
  now += 3000; const retried = db.claimTask(); db.fail(retried.id, retried.lease_token, 'SYNTHETIC_FAILURE');
  assert.equal(db.task(retry.id).status, 'failed'); assert.equal(db.claimTask(), null);
});

test('approved effect intent survives interruption and cannot be replayed automatically', t => {
  let now = 1000;
  const { db } = fixture(t, { clock: () => now, leaseMs: 100 });
  db.ingest('source', [event()]); let task = db.claimTask();
  const operation = { operation: 'click', args: { id: 'tab', selector: '#submit' }, binding: 'synthetic-revision' };
  const action = db.propose(task.id, task.lease_token, operation);
  assert.throws(() => db.beginAction(action.id, task.lease_token), isCode('ACTION_NOT_APPROVED'));
  db.waitApproval(task.id, task.lease_token); db.approve(action.id); task = db.claimTask();
  db.beginAction(action.id, task.lease_token);
  now += 101;
  assert.equal(db.claimTask(), null);
  assert.equal(db.action(action.id).status, 'uncertain');
  assert.equal(db.task(task.id).status, 'waiting_approval');
  assert.throws(() => db.approve(action.id), isCode('ACTION_NOT_PENDING'));
  db.resolveAction(action.id, 'succeeded'); task = db.claimTask();
  assert.equal(db.propose(task.id, task.lease_token, operation).status, 'succeeded');
  db.complete(task.id, task.lease_token, { text: 'Operator reconciled the completed effect.' });
  db.ingest('source', [event('revoked')]); task = db.claimTask();
  const revoked = db.propose(task.id, task.lease_token, operation);
  db.waitApproval(task.id, task.lease_token); db.approve(revoked.id); task = db.claimTask();
  db.beginAction(revoked.id, task.lease_token);
  db.putSubscription({ ...db.subscription('subscription').config, id: 'subscription', enabled: false });
  for (const e of db.events()) db.markRead(e.id);
  db.prune(new Date(now + 1).toISOString());
  assert.equal(db.action(revoked.id).status, 'uncertain');
  assert.equal(db.task(task.id).events[0].summary, 'Synthetic check failed');
});

test('source cursor and event commit are atomic; stale pollers cannot advance freshness', t => {
  let now = 1000; const { db } = fixture(t, { clock: () => now, leaseMs: 100 });
  const poll = db.claimSource('source'); assert.equal(db.claimSource('source'), null);
  assert.throws(() => db.ingest('source', [event(), event('bad', { kind: 'not valid' })], { cursor: 'next', leaseToken: poll.lease_token }), isCode('INVALID_EVENT_KIND'));
  assert.equal(db.events().length, 0); assert.equal(db.source('source').cursor, null);
  now += 101; const newer = db.claimSource('source');
  assert.throws(() => db.ingest('source', [event()], { cursor: 'stale', leaseToken: poll.lease_token }), isCode('SOURCE_LEASE_LOST'));
  db.ingest('source', [event()], { cursor: 'next', leaseToken: newer.lease_token });
  assert.equal(db.source('source').cursor, 'next'); assert.equal(db.source('source').last_success, now);
});

test('consistent backup and retention preserve unread data and deduplication tombstones', async t => {
  const { db, workspace } = fixture(t);
  db.ingest('source', [event(), event('unread')]); const task = db.claimTask(); db.complete(task.id, task.lease_token, { text: 'Done' });
  const read = db.events().find(e => e.external_id === 'one'); db.markRead(read.id);
  db.prune('2100-01-01T00:00:00Z');
  assert.equal(db.events().find(e => e.id === read.id).summary, 'Content removed by owner');
  assert.equal(db.events({ unread: true })[0].summary, 'Synthetic check failed');
  assert.equal(db.ingest('source', [event()]).duplicates, 1); assert.equal(db.claimTask(), null);
  const backup = join(workspace, 'consistent.sqlite'); await db.backup(backup);
  assert.ok(fs.statSync(backup).size > 0);
  const restoredDir = join(workspace, 'restore/.softaxiom/radar'); fs.mkdirSync(restoredDir, { recursive: true });
  fs.copyFileSync(backup, join(restoredDir, 'inbox.sqlite')); const restored = new Inbox(join(workspace, 'restore'));
  assert.equal(restored.events().length, 2); restored.close();
  db.forgetSource('source'); assert.equal(db.events().length, 0); assert.equal(db.sources().length, 0);
});

test('HTTP incremental checks and failures expose truthful watcher freshness', async t => {
  let now = 1000, failed = false; const cursors = [];
  const endpoint = await server(t, (request, response) => {
    cursors.push(new URL(request.url, 'http://fixture').searchParams.get('cursor'));
    response.setHeader('Content-Type', 'application/json');
    response.end(failed ? 'not-json' : JSON.stringify({ events: [event()], cursor: 'revision-two' }));
  });
  const { db } = fixture(t, { clock: () => now });
  db.putSource({ id: 'http', kind: 'http', account: 'synthetic', config: { url: endpoint, intervalMs: 1000 } });
  assert.equal((await pollSources(db))[0].inserted, 1);
  now += 1001; failed = true; assert.equal((await pollSources(db))[0].error, 'SOURCE_INVALID_JSON');
  assert.equal(db.source('http').last_success, 1000); assert.equal(db.source('http').last_error, 'SOURCE_INVALID_JSON');
  assert.deepEqual(cursors, [null, 'revision-two']);
});

test('signed webhooks persist once and reject invalid signatures or browser-origin requests', async t => {
  const { db } = fixture(t);
  process.env.SOFTAXIOM_TEST_WEBHOOK_SECRET = 'synthetic-webhook-fixture-only';
  t.after(() => { delete process.env.SOFTAXIOM_TEST_WEBHOOK_SECRET; });
  db.putSource({ id: 'webhook', account: 'synthetic', kind: 'http', config: { url: 'https://example.test/events', hmacEnv: 'SOFTAXIOM_TEST_WEBHOOK_SECRET' } });
  const s = webhookServer(db); await once(s, 'listening'); t.after(() => new Promise(done => s.close(done)));
  const url = `http://127.0.0.1:${s.address().port}/events/webhook`, body = JSON.stringify({ events: [event()] });
  const signature = `sha256=${createHmac('sha256', process.env.SOFTAXIOM_TEST_WEBHOOK_SECRET).update(body).digest('hex')}`;
  const send = headers => fetch(url, { method: 'POST', headers, body });
  assert.equal((await send({ 'x-hub-signature-256': signature })).status, 202);
  assert.equal((await (await send({ 'x-hub-signature-256': signature })).json()).duplicates, 1);
  assert.equal((await send({ 'x-hub-signature-256': signature, Origin: 'https://hostile.test' })).status, 400);
  assert.equal((await send({ 'x-hub-signature-256': 'invalid' })).status, 400);
  assert.equal(db.events().length, 1);
});

test('MCP stdio checks perform initialization and preserve cursor through the real framing', async t => {
  const { db } = fixture(t);
  const script = new URL('../fixtures/mcp-source.js', import.meta.url);
  db.putSource({ id: 'mcp', account: 'synthetic', kind: 'mcp', config: { command: [process.execPath, script.pathname], tool: 'changes' } });
  const result = await pollSources(db);
  assert.equal(result[0].inserted, 1); assert.equal(db.source('mcp').cursor, 'mcp-next');
});

test('related events beyond one batch are assigned once, and competing processes get one lease', async t => {
  const { db, workspace } = fixture(t);
  db.ingest('source', Array.from({ length: 65 }, (_, i) => event(`batch-${i}`)));
  const script = `import {Inbox} from ${JSON.stringify(new URL('../lib/inbox.js', import.meta.url).href)};
    const d=new Inbox(${JSON.stringify(workspace)});const t=d.claimTask();console.log(JSON.stringify(t?{id:t.id,token:t.lease_token,count:t.events.length}:null));d.close();`;
  const claim = async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', c => { output += c; });
    assert.equal((await once(child, 'exit'))[0], 0); return JSON.parse(output);
  };
  const claims = await Promise.all([claim(), claim()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean); assert.equal(first.count, 30);
  db.complete(first.id, first.token, { text: 'First batch processed.' });
  const second = db.claimTask(); assert.equal(second.events.length, 30);
  db.complete(second.id, second.lease_token, { text: 'Second batch processed.' });
  const last = db.claimTask(); assert.equal(last.events.length, 5);
  db.complete(last.id, last.lease_token, { text: 'Final batch processed.' });
  assert.equal(db.claimTask(), null); assert.equal(db.get("SELECT count(*) n FROM deliveries WHERE status='processed'").n, 65);
});

test('GitHub polls current failures, latest review decisions and durable review cursors', async t => {
  const { db } = fixture(t); let now = Date.now(); db.clock = () => now;
  let reviews = [
    { id: 1, user: { login: 'synthetic' }, state: 'CHANGES_REQUESTED' },
    { id: 2, user: { login: 'synthetic' }, state: 'APPROVED' },
    { id: 3, user: { login: 'other' }, state: 'CHANGES_REQUESTED', html_url: 'https://example.test/pull/7#review-3' },
  ];
  const origin = await server(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const data = req.url.includes('/reviews') ? reviews : req.url.includes('/check-runs') ?
      { total_count: 1, check_runs: [{ id: 11, name: 'synthetic-ci', conclusion: 'failure' }] } : req.url.includes('/status') ?
        { total_count: 0, statuses: [] } : { state: 'open', head: { sha: 'synthetic-sha' }, html_url: 'https://example.test/pull/7' };
    res.end(JSON.stringify(data));
  });
  db.putSource({ id: 'github', account: 'synthetic', kind: 'github', config: { repository: 'example/project', pulls: [7], api: `${origin}/api/v3`, intervalMs: 1000 } });
  assert.equal((await pollSources(db)).find(r => r.source === 'github').inserted, 2);
  assert.equal(db.events().filter(e => e.kind === 'github.changes_requested').length, 1);
  assert.match(db.events().find(e => e.kind === 'github.changes_requested').url, /#review-3/);
  now += 1001; assert.equal((await pollSources(db)).find(r => r.source === 'github').inserted, 0);
  reviews = [...reviews, { id: 4, user: { login: 'synthetic' }, state: 'CHANGES_REQUESTED' }];
  now += 1001; assert.equal((await pollSources(db)).find(r => r.source === 'github').inserted, 1);
  assert.equal(db.source('github').cursor.reviews[7], 4);
});
