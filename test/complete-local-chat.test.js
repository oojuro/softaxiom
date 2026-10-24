// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Memory } from '../lib/store.js';
import { LocalConversation } from '../lib/local-chat.js';
import { LocalExecution } from '../lib/local-execution.js';

test('persistent chat discovers a skill, edits a granted project, and keeps revocation across turns', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'sa-combined-chat-'));
  const workspace = join(root, 'workspace'), project = join(workspace, 'project');
  const previous = process.env.SOFTAXIOM_STATE_DIR;
  process.env.SOFTAXIOM_STATE_DIR = join(root, 'state');
  t.after(() => {
    if (previous === undefined) delete process.env.SOFTAXIOM_STATE_DIR;
    else process.env.SOFTAXIOM_STATE_DIR = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(project, { recursive: true, mode: 0o700 });
  fs.mkdirSync(join(workspace, 'skills/edit'), { recursive: true });
  fs.writeFileSync(join(workspace, 'skills/edit/SKILL.md'),
    '---\nname: edit\ndescription: Inspect this project before editing.\n---\nINTEGRATED_SKILL_BODY');
  fs.writeFileSync(join(project, 'note.txt'), 'INTEGRATED_PROJECT');
  new Memory(join(workspace, 'memory')).initialize();
  const execution = new LocalExecution(workspace);
  await execution.allow('project', true, true);
  const call = (name, operation, args) => ({ role: 'assistant', content: null, tool_calls: [{
    id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify({ operation, args }) },
  }] });
  let calls = 0;
  const chat = new LocalConversation(workspace, { complete: async (messages, tools) => {
    const names = tools.map(tool => tool.function.name);
    assert(names.includes('skills') && names.includes('files') && names.includes('terminal'));
    calls++;
    if (calls === 1) {
      assert(!JSON.stringify(messages).includes('INTEGRATED_SKILL_BODY'));
      return call('skills', 'read', { path: 'edit/SKILL.md' });
    }
    if (calls === 2) {
      assert.match(messages.at(-1).content, /INTEGRATED_SKILL_BODY/);
      return call('files', 'read', { path: 'note.txt' });
    }
    if (calls === 3) {
      assert.match(messages.at(-1).content, /INTEGRATED_PROJECT/);
      return call('terminal', 'run', { operation: randomUUID(),
        argv: ['/bin/sh', '-c', 'printf x >> counter'] });
    }
    assert.match(messages.at(-1).content, /completed/);
    return { role: 'assistant', content: 'INTEGRATED_REPLY: one project edit completed.' };
  } });
  const operation = randomUUID(), request = 'Use the edit skill to inspect and update my project.';
  const first = await chat.send(request, operation);
  assert.equal(calls, 4);
  assert.equal(fs.readFileSync(join(project, 'counter'), 'utf8'), 'x');
  assert.deepEqual(await chat.send(request, operation), first);
  assert.equal(calls, 4);
  assert.equal(fs.readFileSync(join(project, 'counter'), 'utf8'), 'x');
  await execution.revoke();
  const later = new LocalConversation(workspace, { complete: async (messages, tools) => {
    assert(JSON.stringify(messages).includes('INTEGRATED_REPLY'));
    assert(JSON.stringify(messages).includes(request));
    assert(!messages.some(message => message.role === 'tool' || message.tool_calls));
    assert(!tools.some(tool => ['files', 'terminal'].includes(tool.function.name)));
    assert(tools.some(tool => tool.function.name === 'skills'));
    return { role: 'assistant', content: 'I remember the completed edit; project access is revoked.' };
  } });
  assert.equal((await later.send('Continue after revoking project access.')).status, 'completed');
  assert.equal(later.history().turns.length, 2);
  assert.equal(fs.readFileSync(join(project, 'counter'), 'utf8'), 'x');
});
