// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestFrame } from '../lib/core/agent/context/frame.js';

function setup() {
  const reads = [], recalled = [], summaries = [];
  const frame = createRequestFrame({
    prompt: () => 'Synthetic product prompt.\nPerson: synthetic',
    profile: {get: async person => { reads.push(person); return {name: 'Synthetic', timeZone: 'UTC'}; }},
    transcript: {list: async () => { throw new Error('Frame must not choose a transcript window'); },
      read: async () => { throw new Error('Frame must not read conversation content'); }},
    retrieval: {retrieve: async (person, query) => { recalled.push({person, ...query}); return {
      matches: [{reference: 'memory/warm/example.md:1-1', kind: 'memory', excerpt: 'Outside memory fixture'}],
      skills: [{folder: 'research', similarity: 1}], mode: 'keyword'}; }},
    summaries: {latest: async (person, count) => { summaries.push({person, count});
      return [{path: 'memory/summaries/example.md', text: 'Outside summary fixture'}]; }},
    tools: {definitions: role => [{name: role, description: 'Synthetic role', inputSchema: {type: 'object'}}]},
    skills: {root: 'agent-text/skills', index: '- research: discover sources'},
    connectedRoutes: {index: async () => []}, now: () => new Date('2026-10-24T12:00:00Z'),
  });
  return {frame, reads, recalled, summaries};
}
const history = [{role: 'user', content: 'Current engine-owned request', timestamp: 1}];
const input = {personId: 'person-fixture', runId: 'run-fixture', operationId: 'sample-fixture',
  role: 'chat', replyChannel: 'web', history, ask: 'Trusted ingress question'};

test('product framing preserves the exact engine-selected history without another context algorithm', async () => {
  const f = setup(), framed = await f.frame(input);
  assert.equal(framed.engineHistory, history);
  assert.deepEqual(framed.history, []);
  assert.deepEqual(f.recalled, [{person: input.personId, text: input.ask, operation: input.operationId}]);
  assert.equal(framed.context.includes('Reply on: web'), true);
  assert.equal(framed.context.includes('Outside memory fixture'), true);
  assert.equal(framed.context.includes('Outside summary fixture'), true);
  assert.equal(framed.system.includes('research: discover sources'), true);
});

test('work framing excludes main-conversation summaries and bounds recall to skills', async () => {
  const f = setup(), framed = await f.frame({...input, role: 'work', taskId: 'task-fixture'});
  assert.deepEqual(f.summaries, []);
  assert.equal(f.recalled[0].skillsOnly, true);
  assert.equal(framed.context.includes('Reply on:'), false);
  assert.equal(framed.context.includes('Outside summary fixture'), false);
  assert.equal(framed.engineHistory, history);
});

test('the platform-funded lost-answer attempt cannot create another customer recall operation', async () => {
  const f = setup();
  await f.frame({...input, platformFunded: true});
  assert.deepEqual(f.recalled, []);
});
