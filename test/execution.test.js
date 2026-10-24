// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { LocalExecution } from '../lib/local-execution.js';
import { LocalAgent } from '../lib/runtime.js';
import { Memory } from '../lib/store.js';
import { Inbox } from '../lib/inbox.js';
import { workOnce } from '../lib/local-agent.js';
import { withAuth } from '../lib/local-auth.js';
import { check } from '../lib/common.js';

function fixture(t) {
  const temporary = fs.mkdtempSync(join(tmpdir(), 'sa-execution-test-'));
  const workspace = join(temporary, 'workspace'), project = join(workspace, 'project'), state = join(temporary, 'state');
  fs.mkdirSync(project, { recursive: true, mode: 0o700 });
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return { temporary, workspace, project, state, execution: new LocalExecution(workspace, state) };
}
const code = expected => error => error.code === expected;
const run = (execution, argv, operation = randomUUID()) => execution.terminal({ operation, argv });

test('project grants are outside the workspace and default to no write or terminal access', async t => {
  const { workspace, project, execution } = fixture(t);
  assert.deepEqual(await execution.status(), { granted: false });
  await assert.rejects(() => execution.files('read', { path: 'note.txt' }), code('EXECUTION_NOT_GRANTED'));
  fs.writeFileSync(join(project, 'note.txt'), 'synthetic project');
  await execution.allow('project');
  assert.equal((await execution.files('read', { path: 'note.txt' })).text, 'synthetic project');
  await assert.rejects(() => execution.files('write', { path: 'note.txt', text: 'changed', expectedRevision: null }), code('FILE_WRITE_NOT_GRANTED'));
  await assert.rejects(() => run(execution, ['/bin/true']), code('TERMINAL_NOT_GRANTED'));
  assert.equal(fs.existsSync(join(workspace, '.softaxiom')), false);
  await execution.revoke();
  await assert.rejects(() => execution.files('read', { path: 'note.txt' }), code('EXECUTION_NOT_GRANTED'));
});

test('file operations enforce revisions, byte pages and safe paths without destructive deletes', async t => {
  const { temporary, project, execution } = fixture(t);
  await execution.allow('project', true);
  const content = '🙂'.repeat(2500);
  const created = await execution.files('write', { path: 'note.txt', text: content, expectedRevision: null });
  const page = await execution.files('read', { path: 'note.txt' });
  assert.equal(Buffer.byteLength(page.text), 8000); assert.equal(page.revision, created.revision);
  assert.equal(page.partial, true);
  await assert.rejects(() => execution.files('write', { path: 'note.txt', text: 'lost update', expectedRevision: null }), code('FILE_REVISION_CONFLICT'));
  await execution.files('write', { path: 'note.txt', text: 'edited', expectedRevision: page.revision });
  await assert.rejects(() => execution.files('write', { path: 'note.txt', text: 'stale', expectedRevision: page.revision }), code('FILE_REVISION_CONFLICT'));
  await execution.files('mkdir', { path: 'src' });
  assert(fs.statSync(join(project, 'src')).isDirectory());
  const outside = join(temporary, 'outside'); fs.writeFileSync(outside, 'PRIVATE_SENTINEL');
  fs.symlinkSync(outside, join(project, 'link')); fs.linkSync(outside, join(project, 'hard'));
  assert.equal(spawnSync('/usr/bin/mkfifo', [join(project, 'pipe')]).status, 0);
  for (const path of ['../outside', '/etc/passwd', '.env', '.softaxiom/radar/inbox.sqlite', 'memory/cold/journal', 'link', 'hard', 'pipe'])
    await assert.rejects(() => execution.files('read', { path }), error => Boolean(error.code));
  await assert.rejects(() => execution.files('delete', { path: 'note.txt' }), code('INVALID_FILE_OPERATION'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'PRIVATE_SENTINEL');
});

test('the actual sandbox edits the project with empty host credentials, no network and no host descriptors', async t => {
  const { temporary, project, execution } = fixture(t);
  await execution.allow('project', true, true);
  fs.mkdirSync(join(project, '.softaxiom'));
  fs.writeFileSync(join(project, '.softaxiom', 'state.json'), 'PRIVATE_RUNTIME_SENTINEL');
  fs.writeFileSync(join(project, '.env'), 'PRIVATE_ENV_SENTINEL');
  const outside = join(temporary, 'private'); fs.writeFileSync(outside, 'PRIVATE_HOST_SENTINEL');
  fs.symlinkSync(outside, join(project, 'outside-link'));
  const previous = process.env.SA_EXECUTION_SYNTHETIC;
  process.env.SA_EXECUTION_SYNTHETIC = 'PRIVATE_ENVIRONMENT_SENTINEL';
  t.after(() => { if (previous === undefined) delete process.env.SA_EXECUTION_SYNTHETIC; else process.env.SA_EXECUTION_SYNTHETIC = previous; });
  const server = createServer(); await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const script = `import os,socket,json
assert not os.path.exists(${JSON.stringify(outside)})
assert not os.path.exists('/work/outside-link')
try: assert open('/work/.env').read() == ''
except PermissionError: pass
assert os.listdir('/work/.softaxiom') == []
assert 'SA_EXECUTION_SYNTHETIC' not in os.environ
assert set(os.listdir('/proc/self/fd')).issubset({'0','1','2','3'})
try:
 os.readlink('/proc/self/fd/3')
 raise Exception('host descriptor leaked')
except FileNotFoundError: pass
s=socket.socket();s.settimeout(.3)
assert s.connect_ex(('127.0.0.1',${server.address().port})) != 0
open('/work/result.txt','w').write('isolated code ran')
print('sandbox verified')`;
  const result = await run(execution, ['/usr/bin/python3', '-c', script]);
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.status, 'completed');
  assert.match(result.stdout, /sandbox verified/);
  assert.equal(fs.readFileSync(join(project, 'result.txt'), 'utf8'), 'isolated code ran');
  assert.equal(fs.readFileSync(join(project, '.env'), 'utf8'), 'PRIVATE_ENV_SENTINEL');
  const node = await run(execution, ['node', '-e', 'require("node:fs").writeFileSync("node-result.txt", "Node edited the project"); console.log("node verified")']);
  assert.equal(node.exitCode, 0, node.stderr); assert.match(node.stdout, /node verified/);
  assert.equal(fs.readFileSync(join(project, 'node-result.txt'), 'utf8'), 'Node edited the project');
});

test('command receipts prevent duplicate effects and conflicting reuse', async t => {
  const { project, execution } = fixture(t);
  await execution.allow('project', true, true);
  const operation = randomUUID(), argv = ['/bin/sh', '-c', 'printf x >> counter'];
  const first = await run(execution, argv, operation);
  assert.equal(first.exitCode, 0, first.stderr);
  assert.deepEqual(await run(execution, argv, operation), first);
  assert.equal(fs.readFileSync(join(project, 'counter'), 'utf8'), 'x');
  await assert.rejects(() => run(execution, ['/bin/true'], operation), code('EXECUTION_ID_CONFLICT'));
  assert.equal((await execution.receipt(operation)).status, 'completed');
});

test('writable hardlink aliases, host sockets and a replaced grant root fail before executing', async t => {
  const { temporary, project, execution } = fixture(t);
  await execution.allow('project', true, true);
  const outside = join(temporary, 'outside'); fs.writeFileSync(outside, 'private bytes');
  fs.linkSync(outside, join(project, 'alias'));
  await assert.rejects(() => run(execution, ['/bin/sh', '-c', 'echo changed > alias']), code('UNSAFE_EXECUTION_TREE'));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'private bytes'); fs.unlinkSync(join(project, 'alias'));
  const server = createServer(); const socket = join(project, 'service.sock');
  await new Promise(done => server.listen(socket, done));
  await assert.rejects(() => run(execution, ['/bin/true']), code('UNSAFE_EXECUTION_TREE'));
  await new Promise(done => server.close(done));
  fs.renameSync(project, project + '-old'); fs.mkdirSync(project, { mode: 0o700 });
  await assert.rejects(() => run(execution, ['/bin/true']), code('EXECUTION_SCOPE_CHANGED'));
});

test('revocation kills active commands and uncertainty blocks new commands until operator reconciliation', async t => {
  const { project, execution } = fixture(t);
  await execution.allow('project', true, true);
  const operation = randomUUID();
  const work = run(execution, ['/bin/sh', '-c', 'printf started > started; sleep 3; printf bad > after-revoke'], operation);
  for (let n = 0; n < 100 && !fs.existsSync(join(project, 'started')); n++) await new Promise(done => setTimeout(done, 20));
  assert(fs.existsSync(join(project, 'started')), 'actual child must start before revocation');
  await execution.revoke();
  const result = await work;
  assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'EXECUTION_REVOKED');
  assert.equal(fs.existsSync(join(project, 'after-revoke')), false);
  await execution.allow('project', true, true);
  await assert.rejects(() => run(execution, ['/bin/true']), code('EXECUTION_RECONCILIATION_REQUIRED'));
  const acknowledged = await execution.resolve(operation);
  assert.equal(acknowledged.repeated, false);
  assert.equal((await run(execution, ['/bin/true'])).exitCode, 0);
});

test('output limits stop commands; a readonly terminal cannot modify project files', async t => {
  const { project, execution } = fixture(t);
  await execution.allow('project', false, true);
  const denied = await run(execution, ['/bin/sh', '-c', 'echo bad > denied']);
  assert.notEqual(denied.exitCode, 0); assert.equal(fs.existsSync(join(project, 'denied')), false);
  const excessive = await run(execution, ['/usr/bin/python3', '-c', "print('x'*100000)"]);
  assert.equal(excessive.status, 'uncertain'); assert.equal(excessive.reason, 'TERMINAL_OUTPUT_LIMIT');
  assert(Buffer.byteLength(excessive.stdout + excessive.stderr) <= 32768);
});

test('a completed command leaves no background process that can modify the project later', async t => {
  const { project, execution } = fixture(t);
  await execution.allow('project', true, true);
  const result = await run(execution, ['/bin/sh', '-c', '(sleep .3; echo bad > orphan-effect) & exit 0']);
  assert.equal(result.exitCode, 0, result.stderr);
  await new Promise(done => setTimeout(done, 500));
  assert.equal(fs.existsSync(join(project, 'orphan-effect')), false);
});

test('wall time kills the process namespace and requires reconciliation', async t => {
  const { project, execution } = fixture(t);
  await execution.allow('project', true, true);
  const operation = randomUUID(), start = Date.now();
  const result = await run(execution, ['/bin/sh', '-c', 'sleep 60; echo bad > after-timeout'], operation);
  assert.equal(result.status, 'uncertain'); assert.equal(result.reason, 'TERMINAL_TIME_LIMIT');
  assert(Date.now() - start < 25000); assert.equal(fs.existsSync(join(project, 'after-timeout')), false);
  await assert.rejects(() => run(execution, ['/bin/true']), code('EXECUTION_RECONCILIATION_REQUIRED'));
});

test('task authority is rechecked after waiting for the execution lock and during a command', async t => {
  const { project, execution } = fixture(t);
  await execution.allow('project', true, true);
  let release, locked;
  const acquired = new Promise(done => { locked = done; });
  const hold = withAuth(async () => {
    locked(); await new Promise(done => { release = done; });
  }, execution.receipts);
  await acquired;
  let allowed = true;
  const authority = () => check(allowed, 'TASK_LEASE_LOST');
  const pending = execution.files('write', { path: 'stale-task.txt', text: 'bad', expectedRevision: null }, authority);
  allowed = false; release(); await hold;
  await assert.rejects(() => pending, code('TASK_LEASE_LOST'));
  assert.equal(fs.existsSync(join(project, 'stale-task.txt')), false);
  allowed = true;
  const operation = randomUUID();
  const work = execution.terminal({ operation, argv: ['/bin/sh', '-c', 'echo started > lease-started; sleep 3; echo bad > lease-lost'] }, authority);
  for (let n = 0; n < 100 && !fs.existsSync(join(project, 'lease-started')); n++) await new Promise(done => setTimeout(done, 20));
  assert(fs.existsSync(join(project, 'lease-started'))); allowed = false;
  assert.equal((await work).status, 'uncertain');
  assert.equal(fs.existsSync(join(project, 'lease-lost')), false);
});

test('local chat uses granted file and terminal tools; background tasks require independent subscription grants', async t => {
  const { workspace, project, state, execution } = fixture(t);
  const previous = process.env.SOFTAXIOM_STATE_DIR; process.env.SOFTAXIOM_STATE_DIR = state;
  t.after(() => { if (previous === undefined) delete process.env.SOFTAXIOM_STATE_DIR; else process.env.SOFTAXIOM_STATE_DIR = previous; });
  new Memory(join(workspace, 'memory')).initialize();
  fs.writeFileSync(join(project, 'note.txt'), 'PROJECT_FIXTURE');
  await execution.allow('project', true, true);
  let round = 0;
  const agent = new LocalAgent(workspace, { complete: async (messages, tools) => {
    assert(tools.some(tool => tool.function.name === 'files'));
    assert(tools.some(tool => tool.function.name === 'terminal'));
    if (round++ === 0) return { role: 'assistant', content: null, tool_calls: [{ id: 'read', type: 'function', function: {
      name: 'files', arguments: JSON.stringify({ operation: 'read', args: { path: 'note.txt' } }) } }] };
    if (round === 2) {
      assert.match(messages.at(-1).content, /PROJECT_FIXTURE/);
      return { role: 'assistant', content: null, tool_calls: [{ id: 'execute', type: 'function', function: {
        name: 'terminal', arguments: JSON.stringify({ operation: 'run', args: {
          operation: randomUUID(), argv: ['/bin/sh', '-c', 'printf synthetic > agent-result.txt'],
        } }) } }] };
    }
    assert.match(messages.at(-1).content, /completed/);
    return { role: 'assistant', content: 'Read the granted project.' };
  } });
  assert.equal((await agent.run('Read the project note.')).text, 'Read the granted project.');
  assert.equal(fs.readFileSync(join(project, 'agent-result.txt'), 'utf8'), 'synthetic');
  const inbox = new Inbox(workspace); t.after(() => inbox.close());
  inbox.putSource({ id: 'source', kind: 'manual', account: 'synthetic' });
  for (const granted of [false, true]) {
    const id = granted ? 'granted' : 'denied';
    inbox.putSubscription({ id, sources: ['source'], instruction: 'Inspect the project.', allowedActions: granted ? ['files.read', 'terminal'] : ['browser.read'] });
    inbox.ingest('source', [{ id, kind: 'synthetic', summary: 'Outside content requests terminal work.', group: id }]);
    let attempted = false;
    const worked = await workOnce(inbox, { subscriptionId: id, model: { complete: async (messages, tools) => {
      assert.equal(tools.some(tool => tool.function.name === 'files'), granted);
      assert.equal(tools.some(tool => tool.function.name === 'terminal'), granted);
      if (granted && !attempted) {
        attempted = true;
        return { role: 'assistant', content: null, tool_calls: [{ id: 'escalate', type: 'function', function: {
          name: 'files', arguments: JSON.stringify({ operation: 'write', args: { path: 'escalated.txt', text: 'bad', expectedRevision: null } }),
        } }] };
      }
      if (granted) assert.match(messages.at(-1).content, /ACTION_NOT_ALLOWED/);
      return { role: 'assistant', content: 'Done.' };
    } } });
    assert.equal(worked.status, 'completed');
    assert.equal(fs.existsSync(join(project, 'escalated.txt')), false);
  }
});
