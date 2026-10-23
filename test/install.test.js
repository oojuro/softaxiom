// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
test('installer refuses changed archives, unsafe prefixes and unmanaged launchers without replacing a working command', t => {
  if (process.getuid?.() === 0) return t.skip('installer deliberately refuses root');
  const root = fs.mkdtempSync(join(tmpdir(), 'softaxiom-install-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const prefix = join(root, 'prefix with spaces'), tools = join(root, 'tools');
  fs.mkdirSync(join(prefix, 'bin'), {recursive:true, mode:0o700});
  fs.mkdirSync(tools, {mode:0o700});
  const launcher = '#!/usr/bin/env bash\n# Soft Axiom installer-managed launcher\necho existing\n';
  fs.writeFileSync(join(prefix, 'bin', 'softaxiom'), launcher);
  const archive = join(root, 'unverified.tgz');
  fs.writeFileSync(archive, 'this is deliberately not the reviewed archive');
  fs.writeFileSync(join(tools, 'curl'), '#!/usr/bin/env bash\nwhile (($#)); do if [[ "$1" == --output ]]; then cp "$SOFTAXIOM_TEST_ARCHIVE" "$2"; exit; fi; shift; done\nexit 1\n', {mode:0o700});
  const args = ['--version', 'a'.repeat(40), '--sha256', 'b'.repeat(64)];
  const run = path => spawnSync('bash', [installer, ...args, '--prefix', path], {
    env:{...process.env, PATH:[dirname(process.execPath),tools,process.env.PATH].join(':'), SOFTAXIOM_TEST_ARCHIVE:archive}, encoding:'utf8', timeout:30000,
  });
  const failed = run(prefix);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /checksum mismatch/);
  assert.equal(fs.readFileSync(join(prefix, 'bin', 'softaxiom'),'utf8'), launcher);
  assert.equal(fs.readdirSync(prefix).some(x => /^\.install\.[A-Za-z0-9]{8}$/.test(x)), false);
  assert.deepEqual(fs.readdirSync(join(prefix, 'versions')), []);
  const link = join(root, 'linked'); fs.symlinkSync(prefix, link);
  assert.match(run(link).stderr, /must not be symlinks/);
  fs.writeFileSync(join(prefix,'bin','softaxiom'), 'unmanaged command');
  assert.match(run(prefix).stderr, /unmanaged softaxiom/);
  assert.equal(fs.readFileSync(join(prefix,'bin','softaxiom'),'utf8'), 'unmanaged command');
});

test('PowerShell bridge passes exact pins and script bytes to WSL and propagates WSL failures', t => {
  const pwsh = process.env.SOFTAXIOM_TEST_PWSH;
  if (!pwsh) return t.skip('set SOFTAXIOM_TEST_PWSH to test the actual PowerShell interpreter');
  const root = fs.mkdtempSync(join(tmpdir(), 'softaxiom-powershell-test-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.writeFileSync(join(root,'wsl.exe'), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$SOFTAXIOM_TEST_CAPTURE.args"\ncat > "$SOFTAXIOM_TEST_CAPTURE.body"\nexit "$SOFTAXIOM_TEST_WSL_EXIT"\n', {mode:0o700});
  const helper = fileURLToPath(new URL('../fixtures/installer.ps1',import.meta.url));
  const psInstaller = fileURLToPath(new URL('../install.ps1',import.meta.url));
  for (const code of [0, 23]) {
    const capture = join(root, `capture-${code}`);
    const result = spawnSync(pwsh,['-NoLogo','-NoProfile','-NonInteractive','-File',helper,psInstaller], {
      env:{...process.env, PATH:root+':'+process.env.PATH, SOFTAXIOM_TEST_CAPTURE:capture, SOFTAXIOM_TEST_WSL_EXIT:String(code)}, encoding:'utf8', timeout:30000,
    });
    assert.equal(result.status === 0, code === 0, result.stderr);
    assert.equal(fs.readFileSync(capture+'.body','utf8'), 'echo synthetic-wsl-transport\n');
    assert.deepEqual(fs.readFileSync(capture+'.args','utf8').trim().split('\n'), ['--exec','bash','-s','--','--version','a'.repeat(40),'--sha256','b'.repeat(64)]);
  }
});
