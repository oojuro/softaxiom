// SPDX-FileCopyrightText: 2026 Soft Axiom contributors
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateText} from 'ai';
import {fireworksModels,providerModel} from '../lib/core/agent/gateway/providers.js';
import {fireworksFetch,FIREWORKS_BASE_URL,FIREWORKS_MODEL} from '../lib/core/agent/gateway/fireworks.js';
test('hosted policy is Fireworks-only for all roles while generic local adapters remain available',async()=>{
 const calls=[];const models=fireworksModels({keys:{fireworks:'synthetic'},fetch:async(input,init)=>{
  calls.push({url:String(input),init});return Response.json({choices:[{index:0,message:{role:'assistant',content:'fixture'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
 }});
 for(const role of ['chat','work','authority','upkeep'])await generateText({model:models({provider:'fireworks',model:FIREWORKS_MODEL,maxInputTokens:32000,maxOutputTokens:2048}),prompt:role,maxRetries:0});
 assert.equal(calls.length,4);for(const c of calls){assert.equal(c.url,FIREWORKS_BASE_URL+'/chat/completions');assert.equal(c.init.redirect,'error');}
 for(const provider of ['openai','anthropic','google','compatible'])assert.throws(()=>models({provider,model:FIREWORKS_MODEL}));
 assert.throws(()=>models({provider:'fireworks',model:'unreviewed'}));
 for(const provider of ['openai','anthropic'])assert.doesNotThrow(()=>providerModel({provider,model:'operator-choice',apiKey:'synthetic'}));
 assert.doesNotThrow(()=>providerModel({provider:'compatible',model:'operator-choice',baseURL:'http://127.0.0.1:11434/v1'}));
});
test('hosted final transport rejects embeddings, alternate hosts and redirects before dispatch',async()=>{
 let calls=0;const send=fireworksFetch(async(_input,init)=>{calls++;assert.equal(init.redirect,'error');return Response.json({});});
 for(const url of [FIREWORKS_BASE_URL+'/embeddings','https://api.openai.com/v1/chat/completions',FIREWORKS_BASE_URL+'/chat/completions?x=1'])assert.throws(()=>send(url,{method:'POST'}));
 assert.equal(calls,0);await send(FIREWORKS_BASE_URL+'/chat/completions',{method:'POST',redirect:'follow'});assert.equal(calls,1);
});
