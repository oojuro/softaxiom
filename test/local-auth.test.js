// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { withAuth } from '../lib/local-auth.js';

function fixture(t) {
  const temporary = fs.mkdtempSync(join(tmpdir(), 'sa-auth-test-'));
  t.after(() => fs.rmSync(temporary, {recursive:true, force:true}));
  return { temporary, root:join(temporary,'auth') };
}
const Record = z.object({token:z.string()}).strict();
const code = expected => error => error.code === expected;

test('local account records are private, atomically replaced and separated by purpose', async t => {
  const { root } = fixture(t);
  await withAuth(records => {
    records.write('model-openai', {token:'synthetic model credential'});
    records.write('cloud-session', {token:'synthetic cloud credential'});
    assert.deepEqual(records.read('cloud-session', Record), {token:'synthetic cloud credential'});
    records.write('cloud-session', {token:'synthetic rotated credential'});
    records.remove('cloud-session');
    assert.equal(records.read('cloud-session', Record), undefined);
    assert.deepEqual(records.read('model-openai', Record), {token:'synthetic model credential'});
    assert.throws(() => records.read('../outside', Record), code('INVALID_AUTH_NAME'));
  }, root);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(join(root,'model-openai.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(root).sort(), ['auth.lock','model-openai.json']);
});

test('unsafe credential paths and malformed records never expose stored values', async t => {
  const { temporary, root } = fixture(t);
  const outside = join(temporary,'outside');
  fs.mkdirSync(outside, {mode:0o700});
  const linked = join(temporary,'linked'); fs.symlinkSync(outside, linked);
  await assert.rejects(() => withAuth(() => {}, join(linked,'auth')), code('UNSAFE_AUTH_DIRECTORY'));
  await withAuth(records => {
    const file = join(root,'cloud-session.json');
    fs.writeFileSync(file, 'synthetic private malformed value', {mode:0o600});
    assert.throws(() => records.read('cloud-session', Record), error =>
      error.code === 'INVALID_AUTH_RECORD' && !error.message.includes('synthetic'));
    fs.chmodSync(file,0o644);
    assert.throws(() => records.read('cloud-session', Record), code('UNSAFE_AUTH_FILE'));
    fs.unlinkSync(file);
    const other = join(outside,'record'); fs.writeFileSync(other,'private outside bytes',{mode:0o600});
    fs.symlinkSync(other,file);
    assert.throws(() => records.write('cloud-session',{token:'new'}),code('UNSAFE_AUTH_FILE'));
    assert.equal(fs.readFileSync(other,'utf8'),'private outside bytes');
    fs.unlinkSync(file); fs.linkSync(other,file);
    assert.throws(() => records.read('cloud-session',Record),code('UNSAFE_AUTH_FILE'));
  },root);
});

test('the OS lock serializes concurrent refresh/save work and is released after failure', async t => {
  const { root } = fixture(t);
  const Counter = z.object({value:z.number()});
  let escaped;
  await assert.rejects(() => withAuth(records => {
    escaped = records;
    throw new Error('synthetic callback failure');
  },root), /synthetic callback failure/);
  assert.throws(() => escaped.read('counter', Counter), code('AUTH_LOCK_RELEASED'));
  await Promise.all(Array.from({length:4}, () => withAuth(async records => {
    const previous = records.read('counter',Counter)?.value ?? 0;
    await new Promise(done => setTimeout(done,10));
    records.write('counter',{value:previous+1});
  },root)));
  await withAuth(records => assert.equal(records.read('counter',Counter).value,4),root);
});

test('a named pipe is refused without waiting for a writer', async t => {
  const { root } = fixture(t);
  fs.mkdirSync(root,{mode:0o700});
  assert.equal(spawnSync('mkfifo',[join(root,'cloud-session.json')]).status,0);
  const module = new URL('../lib/local-auth.js',import.meta.url).href;
  const child = spawnSync(process.execPath,['--input-type=module','-e',
    `import {withAuth} from ${JSON.stringify(module)}; import {z} from 'zod';
     withAuth(r=>r.read('cloud-session',z.unknown()),process.argv[1]).catch(e=>{process.stdout.write(e.code);process.exitCode=1});`,root],
    {cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:3000});
  assert.equal(child.status,1,child.stderr);
  assert.equal(child.stdout,'UNSAFE_AUTH_FILE');
});

test('a writable ancestor cannot replace the private credential directory', async t => {
  const { temporary } = fixture(t);
  const writable = join(temporary,'untrusted-parent');
  fs.mkdirSync(writable); fs.chmodSync(writable,0o777);
  await assert.rejects(()=>withAuth(()=>{},join(writable,'auth')),code('UNSAFE_AUTH_DIRECTORY'));
});
