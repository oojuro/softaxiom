// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readCloudTurn } from '../lib/chat-cli.js';
import { CloudMessage, CloudTurn } from '../lib/core/contracts/cloud.js';

const operationId = randomUUID(), runId = randomUUID();
const turn = (overrides = {}) => ({ingressId:operationId,status:'running',runId,outcome:null,messages:[],next:null,...overrides});
const reply = text => ({op:randomUUID(),at:'2026-10-23T00:00:00Z',text});

test('cloud chat waits for terminal run status and drains all reply pages, including late bubbles', async () => {
  const cursor={day:'2026-10-23',line:10};
  const responses=[turn(),turn(),turn({status:'finished',outcome:'done',messages:[reply('First')],next:cursor}),
    turn({status:'finished',outcome:'done',messages:[reply('Second')]})];
  const calls=[];
  const result=await readCloudTurn({turn:async(id,after)=>{calls.push([id,after]);return responses.shift();}},operationId,async()=>{});
  assert.deepEqual(result.messages.map(m=>m.text),['First','Second']);
  assert.equal(result.status,'finished'); assert.equal(result.operationId,operationId);
  assert.deepEqual(calls[3],[operationId,cursor]);
});

test('a pending cloud turn returns its durable ID without reporting completion or resending', async () => {
  let time=0,calls=0;
  const result=await readCloudTurn({turn:async()=>{calls++;return turn({status:'accepted',runId:null});}},operationId,
    async()=>{time+=30000;},()=>time);
  assert.equal(calls,3); assert.equal(result.status,'accepted'); assert.equal(result.operationId,operationId);
  assert.deepEqual(result.messages,[]);
});

test('cloud chat rejects incomplete results and looping reply cursors', async () => {
  const cursor={day:'2026-10-23',line:10};
  await assert.rejects(()=>readCloudTurn({turn:async()=>turn({messages:[reply('Premature')]})},operationId),{code:'CLOUD_INVALID_RESPONSE'});
  await assert.rejects(()=>readCloudTurn({turn:async()=>turn({status:'finished',messages:[reply('Repeat')],next:cursor})},operationId),{code:'CLOUD_INVALID_CURSOR'});
  assert.equal(CloudMessage.safeParse({operationId,text:'hello',personId:randomUUID()}).success,false);
  assert.equal(CloudTurn.safeParse(turn({messages:[{...reply('Hello'),reasoning:'private'}]})).success,false);
});
