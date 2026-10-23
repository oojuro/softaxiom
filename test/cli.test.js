// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Inbox } from '../lib/inbox.js';

const entry = fileURLToPath(new URL('../bin/softaxiom.js', import.meta.url));
function setup(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'sa-cli-test-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const workspace = join(root, 'workspace');
  const run = args => spawnSync(process.execPath, [entry, '--workspace', workspace, ...args], {
    encoding:'utf8', timeout:15000,
    env:{ ...process.env, SA_CLI_TEST_SECRET:'' },
  });
  return { workspace, run };
}

test('each product command explains its limits without initializing a workspace or requiring model access', t => {
  const { workspace, run } = setup(t);
  for (const family of ['radar','bridge','compass']) {
    for (const args of [[family], [family,'--help']]) {
      const result = run(args);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, new RegExp(`sa ${family}`));
      assert.equal(fs.existsSync(workspace), false);
    }
  }
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(fs.readFileSync(new URL('../npm-shrinkwrap.json', import.meta.url)));
  assert.deepEqual(pkg.bin, lock.packages[''].bin);
  for (const name of ['sa','softaxiom','sa-memory']) assert.equal(pkg.bin[name], 'bin/softaxiom.js');
});

test('Bridge exposes real adapter descriptors and refuses unconfigured credentials or malformed scope before networking', t => {
  const { workspace, run } = setup(t);
  for (const transport of ['api','mcp','browser']) {
    const result = run(['bridge','github','configure',transport]);
    assert.equal(result.status, 0, result.stderr);
    const descriptor = JSON.parse(result.stdout);
    assert.equal(descriptor.transport, transport);
    assert.equal(descriptor.readOnly, true);
  }
  for (const [args, code] of [
    [['github','check','api'], 'BRIDGE_TOKEN_ENV_REQUIRED'],
    [['github','check','mcp','--token-env','SA_CLI_TEST_SECRET'], 'ADAPTER_CREDENTIAL_MISSING'],
    [['github','check','api','--token-env','bad=name'], 'BRIDGE_TOKEN_ENV_REQUIRED'],
    [['github','check','browser','--token-env','SA_CLI_TEST_SECRET'], 'INVALID_BRIDGE_OPTION'],
    [['github','check','api','--account','a/b'], 'INVALID_BRIDGE_ACCOUNT'],
    [['github','check','api','--account','a','--account','b'], 'INVALID_BRIDGE_OPTION'],
    [['other','configure','api'], 'BRIDGE_ADAPTER_UNSUPPORTED'],
    [['github','configure','api','--allow-write'], 'UNEXPECTED_ARGUMENT'],
  ]) {
    const result = run(['bridge', ...args]);
    assert.equal(result.status, 1, result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {error:{code, details:{}}});
  }
  assert.equal(fs.existsSync(workspace), false);
});

test('Compass queues an actual scoped planning task and reports missing setup without claiming a plan or timer exists', t => {
  const { workspace, run } = setup(t);
  const result = run(['compass','plan','--origins','https://github.com','Plan time for my compiler work']);
  assert.equal(result.status, 0, result.stderr);
  const answer = JSON.parse(result.stdout);
  assert.equal(answer.status, 'configuration_required');
  assert.equal(answer.code, 'MEMORY_SETUP_REQUIRED');
  const inbox = new Inbox(workspace);
  try {
    const subscription = inbox.subscription(answer.subscription);
    assert.match(subscription.config.instruction, /Plan time for my compiler work/);
    assert.match(subscription.config.instruction, /No automatic morning\/evening schedule is created/);
    assert.deepEqual(subscription.config.origins, ['https://github.com']);
    assert.equal(subscription.config.allowedActions.includes('terminal'), false);
    assert.equal(inbox.events().length, 1);
    assert.equal(inbox.tasks().length, 0);
    const task = inbox.claimTask(answer.subscription);
    assert.equal(task.subscription_id, answer.subscription);
    assert.equal(task.events.length, 1);
  } finally { inbox.close(); }
});
