// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CloudClient, cloudOrigin } from '../lib/cloud-client.js';
import { withAuth } from '../lib/local-auth.js';

const destination = {email:'synthetic@example.test'};
const errorCode = expected => error => error.code === expected;
async function fixture(t) {
  const temporary = fs.mkdtempSync(join(tmpdir(),'sa-cloud-client-'));
  const root = join(temporary,'auth');
  let generation = 0, received = [], redirectCount = 0, mode = 'normal', verification;
  const sink = createServer((_req,res) => { redirectCount++; res.end('{}'); });
  sink.listen(0,'127.0.0.1'); await once(sink,'listening');
  const server = createServer(async (req,res) => {
    let body=''; for await (const data of req) body+=data;
    received.push({path:req.url,body:body?JSON.parse(body):undefined,cookie:req.headers.cookie});
    res.setHeader('content-type','application/json');
    if (req.url === '/api/cli') {
      res.statusCode=mode==='old'?404:200; res.end(JSON.stringify({version:1})); return;
    }
    if (req.url === '/api/auth/code') { res.end('{"sent":true}'); return; }
    if (req.url === '/api/auth/verify') {
      if (JSON.parse(body).code !== '123456') { res.statusCode=401; res.end('{}'); return; }
      if (verification) { verification.entered(); await verification.wait; verification=undefined; }
      res.setHeader('set-cookie',[`sa_access=synthetic_access_${generation}; HttpOnly; SameSite=Lax`, `sa_refresh=synthetic_refresh_${generation}; HttpOnly; SameSite=Lax`]);
      res.end('{"ok":true}'); return;
    }
    if (req.url === '/api/redirect') {
      res.writeHead(302,{location:`http://127.0.0.1:${sink.address().port}/stolen`}); res.end(); return;
    }
    if (req.url === '/api/auth/signout') {
      res.statusCode=mode==='unavailable'?503:200;
      res.end(JSON.stringify({ok:true,revoked:mode==='normal'})); return;
    }
    if (mode === 'unavailable') { res.statusCode=503; res.end('{"private":"never repeat provider content"}'); return; }
    if (mode === 'revoked' || req.headers.cookie !== `sa_access=synthetic_access_${generation}; sa_refresh=synthetic_refresh_${generation}`) {
      res.statusCode=401; res.end('{}'); return;
    }
    if (req.url === '/api/conversation') { res.end(JSON.stringify({ingressId:JSON.parse(body).operationId})); return; }
    if (req.url.startsWith('/api/conversation/turns/')) {
      res.end(JSON.stringify({ingressId:req.url.split('/').at(-1).split('?')[0],status:'finished',runId:'00000000-0000-4000-8000-000000000001',outcome:'done',
        messages:[{op:'synthetic_reply',at:'2026-10-23T00:00:00Z',text:'Same existing agent.'}],next:null}));return;
    }
    generation++;
    res.setHeader('set-cookie',mode==='partial' ? [`sa_access=synthetic_access_${generation}`] :
      [`sa_access=synthetic_access_${generation}; HttpOnly`, `sa_refresh=synthetic_refresh_${generation}; HttpOnly`]);
    res.end(JSON.stringify({owned:true,generation}));
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await Promise.all([new Promise(done=>server.close(done)),new Promise(done=>sink.close(done))]);
    fs.rmSync(temporary,{recursive:true,force:true});
  });
  return {root,origin,client:new CloudClient(root),setMode:value=>{mode=value;},received,redirects:()=>redirectCount,
    holdVerification:()=>{
      let release, entered;
      const wait=new Promise(done=>{release=done;});
      const started=new Promise(done=>{entered=done;});
      verification={wait,entered};
      return {started,release};
    }};
}

test('logout racing an in-flight login cannot leave a newly resurrected session', async t => {
  const f=await fixture(t), gate=f.holdVerification();
  const loggingIn=f.client.verify(destination,'123456',f.origin);
  await gate.started;
  const loggingOut=new CloudClient(f.root).logout();
  const early=await Promise.race([
    loggingOut.then(()=>true),
    new Promise(done=>setTimeout(()=>done(false),100)),
  ]);
  gate.release();
  await loggingIn; await loggingOut;
  assert.equal(early,false);
  assert.equal((await f.client.status()).connected,false);
});

test('the actual CLI defaults to cloud after login, honors --local, and resumes without a second submission', async t => {
  const f=await fixture(t); await f.client.verify(destination,'123456',f.origin);
  const workspace=join(f.root,'no-local-workspace');
  async function cli(args) {
    const child=spawn(process.execPath,[new URL('../bin/softaxiom.js',import.meta.url).pathname,'--workspace',workspace,...args],{
      env:{PATH:process.env.PATH,SOFTAXIOM_STATE_DIR:f.root},stdio:['ignore','pipe','pipe']});
    let out='',error='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>error+=d);
    const [status]=await once(child,'close'); return {status,result:JSON.parse(out),error};
  }
  const operationId=randomUUID();
  const answered=await cli(['chat','--operation',operationId,'Hello from CLI']);
  assert.equal(answered.status,0,answered.error);
  assert.equal(answered.result.messages[0].text,'Same existing agent.');
  assert.equal(fs.existsSync(workspace),false);
  assert.equal(f.received.filter(r=>r.path==='/api/conversation').length,1);
  assert.equal((await cli(['chat','--resume',operationId])).status,0);
  assert.equal(f.received.filter(r=>r.path==='/api/conversation').length,1);
  assert.equal((await cli(['chat','Explain','--verbose'])).status,0);
  assert.equal(f.received.filter(r=>r.path==='/api/conversation').at(-1).body.text,'Explain --verbose');
  assert.equal((await cli(['chat','--','--verbose'])).status,0);
  assert.equal(f.received.filter(r=>r.path==='/api/conversation').at(-1).body.text,'--verbose');
  const local=await cli(['chat','--local','Independent local work']);
  assert.equal(local.result.error.code,'NOT_INITIALIZED');
  assert.equal(f.received.filter(r=>r.path==='/api/conversation').length,3);
  assert.equal((await cli(['logout'])).result.revocation,'confirmed');
  assert.equal((await cli(['status'])).result.connected,false);
});

test('cloud login uses the existing-account flow, keeps tokens private and serializes rotating cookies', async t => {
  const f=await fixture(t);
  await f.client.requestCode(destination,f.origin);
  assert.deepEqual(f.received.find(r=>r.path==='/api/auth/code').body,{mode:'signin',to:destination});
  assert.deepEqual(await f.client.verify(destination,'123456',f.origin),{connected:true,origin:f.origin});
  assert.deepEqual(await f.client.status(),{connected:true,origin:f.origin});
  const other=new CloudClient(f.root);
  const answers=await Promise.all([f.client.call('/api/settings'),other.call('/api/settings')]);
  assert.deepEqual(answers.map(a=>a.generation),[1,2]);
  const record=JSON.parse(fs.readFileSync(join(f.root,'cloud-session.json'),'utf8'));
  assert.equal(record.access,'synthetic_access_2'); assert.equal(record.refresh,'synthetic_refresh_2');
  assert.equal(fs.statSync(join(f.root,'cloud-session.json')).mode&0o777,0o600);
});

test('old deployments are refused before sending a code and failed login preserves an existing account', async t => {
  const f=await fixture(t);
  f.setMode('old');
  await assert.rejects(()=>f.client.requestCode(destination,f.origin),errorCode('CLOUD_UPDATE_REQUIRED'));
  assert.equal(f.received.some(r=>r.path==='/api/auth/code'),false);
  f.setMode('normal'); await f.client.verify(destination,'123456',f.origin);
  const previous=fs.readFileSync(join(f.root,'cloud-session.json'),'utf8');
  await assert.rejects(()=>f.client.verify(destination,'000000',f.origin),errorCode('CLOUD_UNAUTHORIZED'));
  assert.equal(fs.readFileSync(join(f.root,'cloud-session.json'),'utf8'),previous);
});

test('cloud requests never follow redirects with credentials, accept remote plain HTTP or save a torn token pair', async t => {
  const f=await fixture(t); await f.client.verify(destination,'123456',f.origin);
  for (const origin of ['http://example.test','https://user:secret@example.test','https://example.test/path','https://example.test?token=x'])
    assert.throws(()=>cloudOrigin(origin),errorCode('INVALID_CLOUD_ORIGIN'));
  await assert.rejects(()=>f.client.call('/api/redirect'),errorCode('CLOUD_UNAVAILABLE'));
  assert.equal(f.redirects(),0);
  const previous=fs.readFileSync(join(f.root,'cloud-session.json'),'utf8');
  f.setMode('partial');
  await assert.rejects(()=>f.client.call('/api/settings'),errorCode('CLOUD_SESSION_INCOMPLETE'));
  assert.equal(fs.readFileSync(join(f.root,'cloud-session.json'),'utf8'),previous);
});

test('transient refusals preserve the session; revocation clears it and logout leaves model credentials intact', async t => {
  const f=await fixture(t); await f.client.verify(destination,'123456',f.origin);
  await withAuth(r=>r.write('model-openai',{key:'synthetic model secret'}),f.root);
  f.setMode('unavailable');
  await assert.rejects(()=>f.client.call('/api/settings'),error=>
    error.code==='CLOUD_REQUEST_REFUSED' && !JSON.stringify(error).includes('never repeat'));
  assert.equal((await f.client.status()).connected,true);
  assert.deepEqual(await f.client.logout(),{connected:false,revocation:'unknown'});
  assert.equal((await f.client.status()).connected,false);
  await withAuth(r=>assert.equal(r.read('model-openai',z.object({key:z.string()})).key,'synthetic model secret'),f.root);
  f.setMode('normal'); await f.client.verify(destination,'123456',f.origin);
  assert.deepEqual(await f.client.logout(),{connected:false,revocation:'confirmed'});
  await f.client.verify(destination,'123456',f.origin);
  f.setMode('revoked');
  await assert.rejects(()=>f.client.call('/api/settings'),errorCode('CLOUD_UNAUTHORIZED'));
  assert.equal((await f.client.status()).connected,false);
});

test('checking an absent Cloud session neither creates state nor requires a writable home', async t => {
  const root=fs.mkdtempSync(join(tmpdir(),'sa-no-cloud-state-'));
  t.after(()=>{fs.chmodSync(root,0o700);fs.rmSync(root,{recursive:true,force:true});});
  const state=join(root,'missing','cloud');
  fs.chmodSync(root,0o500);
  assert.deepEqual(await new CloudClient(state).status(),{connected:false});
  assert.deepEqual(fs.readdirSync(root),[]);
});
