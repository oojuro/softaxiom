// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Specialists} from '../lib/specialists.js';
import {Memory} from '../lib/store.js';
import {Inbox} from '../lib/inbox.js';
function fixture(t) {
 const root=fs.mkdtempSync(join(tmpdir(),'sa-specialist-')),workspace=join(root,'workspace'),state=join(root,'state');
 fs.mkdirSync(workspace,{mode:0o700});const previous=process.env.SOFTAXIOM_STATE_DIR;
 process.env.SOFTAXIOM_STATE_DIR=state;t.after(()=>{if(previous===undefined)delete process.env.SOFTAXIOM_STATE_DIR;else process.env.SOFTAXIOM_STATE_DIR=previous;fs.rmSync(root,{recursive:true,force:true});});
 const memory=new Memory(join(workspace,'memory'));memory.initialize();
 const specialists=new Specialists(workspace);return {workspace,specialists,memory};
}
const request=(agent='internal-auditor')=>({version:1,operationId:randomUUID(),agent,input:'The release is ready. Check the evidence.',limits:{milliseconds:20000,steps:1,concurrency:1,retries:0,maxMicros:agent==='external-jsonl'?0:340480}});
test('internal specialist has no tools, parent memory/history or recursive authority; result and identity survive restart',async t=>{
 const f=fixture(t);f.memory.call('writeDiary',{day:'2026-10-23',text:'# 2026-10-23\n\nPRIVATE_DIARY_SENTINEL',expectedRevision:null});
 let calls=0;const model={complete:async(messages,tools)=>{calls++;assert.deepEqual(tools,[]);assert(!JSON.stringify(messages).includes('PRIVATE_DIARY_SENTINEL'));return {role:'assistant',content:'Evidence is missing; this claim is unverified.'};}};
 const task=request(), {subscription}=f.specialists.start(task);
 assert.throws(()=>f.specialists.start({...task,input:'Changed input'}),e=>e.code==='DELEGATION_ID_CONFLICT');
 const result=await f.specialists.work(subscription,model);assert.equal(result.status,'completed');
 assert.match(new Specialists(f.workspace).state(subscription).result.text,/unverified/);
 assert.equal(f.specialists.start(task).repeated,true);await f.specialists.work(subscription,model);assert.equal(calls,1);
});
test('independent Python specialist runs offline without credentials, full workspace or engine dependency',async t=>{
 const f=fixture(t),folder=join(f.workspace,'specialist-code');fs.mkdirSync(folder,{mode:0o700});
 fs.copyFileSync(new URL('../examples/specialists/evidence-audit.py',import.meta.url),join(folder,'specialist.py'));
 await f.specialists.execution.allow(folder,false,true);
 const {subscription}=f.specialists.start(request('external-jsonl'));
 const result=await f.specialists.work(subscription);assert.equal(result.status,'completed',result.error);
 assert.match(result.result.text,/unverified/);
 const second=new Specialists(f.workspace);assert.equal((await second.work(subscription)).status,'completed');
 await second.execution.revoke();
 const next=second.start(request('external-jsonl'));assert.equal((await second.work(next.subscription)).error,'EXECUTION_NOT_GRANTED');
});
test('cancellation before dispatch and lost specialist receipt never redispatch model work',async t=>{
 const f=fixture(t);let calls=0;const model={complete:async()=>{calls++;return {role:'assistant',content:'Result'};}};
 const a=f.specialists.start(request());f.specialists.cancel(a.subscription);
 assert.equal((await f.specialists.work(a.subscription,model)).status,'cancelled');assert.equal(calls,0);
 const b=f.specialists.start(request()), inbox=new Inbox(f.workspace,{leaseMs:60000});
 const claimed=inbox.claimTask(b.subscription);inbox.progress(claimed.id,claimed.lease_token,{started:true});inbox.run('UPDATE tasks SET lease_until=0 WHERE id=?',claimed.id);inbox.close();
 const result=await f.specialists.work(b.subscription,model);assert.equal(result.status,'failed');assert.equal(result.error,'SPECIALIST_RECONCILIATION_REQUIRED');assert.equal(calls,0);
});
test('external proposals cannot broaden permissions, budgets, transport, retries or access scopes',t=>{
 const f=fixture(t), original=request('external-jsonl');
 for(const change of [{permissions:{memory:['*']}},{agent:'remote-agent'},{limits:{...original.limits,retries:1}},{limits:{...original.limits,maxMicros:1}},{limits:{...original.limits,concurrency:2}}])
  assert.throws(()=>f.specialists.start({...original,...change}),e=>e.code==='INVALID_DELEGATION');
});

test('main chat delegates only the current request, keeps the independent result and cannot add history scopes',async t=>{
 const f=fixture(t),folder=join(f.workspace,'specialist-code');fs.mkdirSync(folder,{mode:0o700});
 fs.copyFileSync(new URL('../examples/specialists/evidence-audit.py',import.meta.url),join(folder,'specialist.py'));
 await f.specialists.execution.allow(folder,false,true);
 const {LocalConversation}=await import('../lib/local-chat.js');
 await new LocalConversation(f.workspace,{complete:async()=>({role:'assistant',content:'PRIVATE_PARENT_HISTORY'})}).send('An earlier unrelated private message.');
 let calls=0;
 const model={complete:async(messages,tools)=>{
  assert(tools.some(tool=>tool.function.name==='specialist_task'));
  if(++calls===1)return {role:'assistant',content:null,tool_calls:[{id:'delegate1',type:'function',function:{name:'specialist_task',arguments:JSON.stringify({operation:'start',args:{agent:'external-jsonl'}})}}]};
  const result=JSON.parse(messages.at(-1).content).result;
  assert.equal(result.status,'completed');assert.match(result.result.text,/unverified/);
  return {role:'assistant',content:'The specialist found missing acceptance evidence.'};
 }};
 const operation=randomUUID();const chat=new LocalConversation(f.workspace,model);
 assert.match((await chat.send('This change is ready.',operation,[],['external-jsonl'])).text,/missing acceptance/);
 const inbox=new Inbox(f.workspace);const request=inbox.source('specialist_'+operation).config.specialist;
 assert.equal(request.input,'This change is ready.');assert(!JSON.stringify(request).includes('PRIVATE_PARENT_HISTORY'));
 inbox.close();assert.equal(calls,2);
 const hostile=new LocalConversation(f.workspace,{complete:async()=>({role:'assistant',content:null,tool_calls:[{id:'bad',type:'function',function:{name:'specialist_task',arguments:JSON.stringify({operation:'start',args:{agent:'external-jsonl',history:'PRIVATE_PARENT_HISTORY'}})}}]})});
 // Denied extra context produces a tool error; the host never creates a child with that scope.
 const badOperation=randomUUID();await assert.rejects(hostile.send('Other request.',badOperation,[],['external-jsonl']));
 assert.equal(f.specialists.list((chat.history()).conversation).some(task=>task.subscription_id==='specialist_'+badOperation),false);
});

test('revocation aborts an active internal request and does not retry it',async t=>{
 const f=fixture(t),task=f.specialists.start(request());let entered,calls=0;
 const ready=new Promise(done=>{entered=done;});
 const model={complete:async(_messages,_tools,signal)=>{calls++;entered();return new Promise((_done,fail)=>signal.addEventListener('abort',()=>fail(new Error('synthetic aborted')),{once:true}));}};
 const running=f.specialists.work(task.subscription,model);await ready;
 f.specialists.cancel(task.subscription);assert.equal((await running).status,'cancelled');
 assert.equal((await f.specialists.work(task.subscription,model)).status,'cancelled');assert.equal(calls,1);
});

test('an external specialist cannot dispatch after its task deadline while waiting for execution',async t=>{
 const f=fixture(t), task=f.specialists.start(request('external-jsonl'));
 let dispatched=false;const now=Date.now;
 f.specialists.execution.terminal=async(_args,authority)=>{
  try {Date.now=()=>now()+20001;authority();dispatched=true;}
  finally {Date.now=now;}
  throw new Error('dispatch must be refused');
 };
 const result=await f.specialists.work(task.subscription);
 assert.equal(dispatched,false);assert.equal(result.error,'SPECIALIST_TIME_LIMIT');
});
