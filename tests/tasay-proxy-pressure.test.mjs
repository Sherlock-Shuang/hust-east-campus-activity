import test from 'node:test';
import assert from 'node:assert/strict';
import {createTasayProxy} from '../integration/tasay/proxy.mjs';

const origin='https://campus.test',env={TASAY_LLM_API_KEY:'private-test-key',TASAY_LLM_BASE_URL:'https://model.test/v1',TASAY_LLM_MODEL:'server-model'};
const request=(body={messages:[{role:'user',content:'hello'}]},signal)=>new Request(origin+'/api/works/tasay/default/chat/completions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body),signal});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<500;i++){if(predicate())return;await tick();}assert.fail('condition not reached');}
const complete=async response=>({status:response.status,body:await response.text(),retry:response.headers.get('retry-after')});

test('200 simultaneous requests cannot pass async admission: 8 execute, 16 wait, rest get bounded retry',async t=>{
  let active=0,peak=0,calls=0,quotas=0;const gate=deferred();
  const proxy=createTasayProxy({env,rateLimit:async()=>{quotas++;await tick();return true;},fetchImpl:async()=>{calls++;active++;peak=Math.max(active,peak);await gate.promise;active--;return Response.json({ok:true});}});t.after(()=>proxy.dispose());
  const all=Array.from({length:200},(_,i)=>proxy(request(),{audienceId:`viewer-${i}`}).then(complete));
  await until(()=>calls===8);await tick();assert.equal(quotas,8,'waiting requests do not consume the shared daily budget');
  gate.resolve();const responses=await Promise.all(all);assert.equal(peak,8);assert.equal(calls,24);assert.equal(quotas,24);
  assert.equal(responses.filter(r=>r.status===200).length,24);assert.equal(responses.filter(r=>r.status===429&&r.retry==='10').length,176);
});

test('invalid and oversized messages do not occupy admission or charge quota',async t=>{
  let quotas=0,calls=0;const proxy=createTasayProxy({env,rateLimit:async()=>{quotas++;return true;},fetchImpl:async()=>{calls++;return Response.json({ok:true});}});t.after(()=>proxy.dispose());
  for(const [body,status] of [['{',400],['null',400],[{},400],[{messages:[{role:'tool',content:'x'}]},400],[{messages:[{role:'user',content:'x'.repeat(60001)}]},413]])assert.equal((await proxy(request(body),{audienceId:'viewer'})).status,status);
  assert.equal(quotas,0);assert.equal(calls,0);assert.equal((await complete(await proxy(request(),{audienceId:'viewer'}))).status,200);
});

test('cancelled and expired queue entries are not sent or charged, and FIFO continues',async t=>{
  const gate=deferred();let calls=0,quotas=0;
  const proxy=createTasayProxy({env,maxConcurrent:1,maxQueued:3,queueTimeoutMs:40,rateLimit:async()=>{quotas++;return true;},fetchImpl:async()=>{calls++;await gate.promise;return Response.json({ok:true});}});t.after(()=>proxy.dispose());
  const first=proxy(request(),{audienceId:'first'}).then(complete);await until(()=>calls===1);
  const abort=new AbortController(),cancelled=proxy(request(undefined,abort.signal),{audienceId:'cancelled'});await tick();abort.abort();assert.equal((await cancelled).status,499);
  const timed=await proxy(request(),{audienceId:'timed'});assert.equal(timed.status,429);assert.equal(timed.headers.get('retry-after'),'10');
  assert.equal(quotas,1);assert.equal(calls,1);gate.resolve();assert.equal((await first).status,200);
  assert.equal((await complete(await proxy(request(),{audienceId:'next'}))).status,200);assert.equal(quotas,2);
});

test('per-viewer local quota reservations stay atomic across delayed shared quota checks',async t=>{
  const gate=deferred();let quotaCalls=0,calls=0;
  const proxy=createTasayProxy({env,maxConcurrent:8,maxPerMinute:2,rateLimit:async()=>{quotaCalls++;await gate.promise;return true;},fetchImpl:async()=>{calls++;return Response.json({ok:true});}});t.after(()=>proxy.dispose());
  const attempts=Array.from({length:6},()=>proxy(request(),{audienceId:'same'}).then(complete));await until(()=>quotaCalls===2);gate.resolve();const responses=await Promise.all(attempts);
  assert.equal(responses.filter(r=>r.status===200).length,2);assert.equal(responses.filter(r=>r.status===429).length,4);assert.equal(calls,2);assert.equal(quotaCalls,2);
});

test('shared quota rejection releases capacity and does not poison the local audience budget',async t=>{
  let allowed=false,calls=0;const proxy=createTasayProxy({env,maxConcurrent:1,maxPerMinute:1,rateLimit:async()=>allowed,fetchImpl:async()=>{calls++;return Response.json({ok:true});}});t.after(()=>proxy.dispose());
  assert.equal((await proxy(request(),{audienceId:'same'})).status,429);assert.equal(calls,0);allowed=true;
  assert.equal((await complete(await proxy(request(),{audienceId:'same'}))).status,200);assert.equal(calls,1);
  assert.equal((await proxy(request(),{audienceId:'same'})).status,429);
});

test('request abort after response headers cancels a stalled body without another client read',async t=>{
  let calls=0,cancels=0;const controller=new AbortController();
  const proxy=createTasayProxy({env,maxConcurrent:1,fetchImpl:async()=>{calls++;return calls===1?new Response(new ReadableStream({cancel(){cancels++;}})):Response.json({ok:true});}});t.after(()=>proxy.dispose());
  const first=await proxy(request(undefined,controller.signal),{audienceId:'first'});assert.equal(first.status,200);
  const second=proxy(request(),{audienceId:'second'}).then(complete);await tick();assert.equal(calls,1);controller.abort();
  assert.equal((await second).status,200);assert.equal(cancels,1);await assert.rejects(first.text());
});

test('downstream stream cancellation frees admission for the next viewer',async t=>{
  let calls=0,cancels=0;const proxy=createTasayProxy({env,maxConcurrent:1,fetchImpl:async()=>{calls++;return calls===1?new Response(new ReadableStream({cancel(){cancels++;}})):Response.json({ok:true});}});t.after(()=>proxy.dispose());
  const first=await proxy(request(),{audienceId:'first'}),second=proxy(request(),{audienceId:'second'}).then(complete);await tick();
  await first.body.cancel();assert.equal((await second).status,200);assert.equal(cancels,1);
});

test('overall timeout cancels upstream and frees slot even when fetch ignores abort',async t=>{
  let calls=0,cancelledLate=0;const gate=deferred();
  const proxy=createTasayProxy({env,maxConcurrent:1,timeoutMs:35,fetchImpl:async()=>++calls===1?gate.promise:Response.json({ok:true})});t.after(()=>proxy.dispose());
  assert.equal((await proxy(request(),{audienceId:'first'})).status,504);
  assert.equal((await complete(await proxy(request(),{audienceId:'next'}))).status,200);
  gate.resolve(new Response(new ReadableStream({cancel(){cancelledLate++;}})));await until(()=>cancelledLate===1);
});

test('dispose aborts active and pending work; quota wait cancellation never starts upstream',async()=>{
  const gate=deferred();let quotas=0,calls=0;
  const proxy=createTasayProxy({env,maxConcurrent:1,rateLimit:async()=>{quotas++;return gate.promise;},fetchImpl:async()=>{calls++;return Response.json({ok:true});}});
  const first=proxy(request(),{audienceId:'first'}),second=proxy(request(),{audienceId:'second'});await until(()=>quotas===1);proxy.dispose();proxy.dispose();
  assert.equal((await first).status,503);assert.equal((await second).status,503);assert.equal((await proxy(request(),{audienceId:'third'})).status,503);
  gate.resolve(true);await tick();assert.equal(calls,0);assert.equal(quotas,1);
});

test('upstream rate limits preserve only bounded Retry-After, never credentials or diagnostics',async t=>{
  const proxy=createTasayProxy({env,fetchImpl:async()=>new Response('secret-model-diagnostics',{status:429,headers:{'Retry-After':'999'}})});t.after(()=>proxy.dispose());
  const result=await complete(await proxy(request(),{audienceId:'viewer'}));assert.equal(result.status,429);assert.equal(result.retry,'120');assert.ok(!result.body.includes('secret'));
});

test('slow body timeout releases its reader without blocking a validated audience request',async t=>{
  let cancelledBody=0,quotas=0,calls=0;
  const proxy=createTasayProxy({env,maxConcurrent:1,timeoutMs:40,rateLimit:async()=>{quotas++;return true;},fetchImpl:async()=>{calls++;return Response.json({ok:true});}});t.after(()=>proxy.dispose());
  const body=new ReadableStream({cancel(){cancelledBody++;}}),slow=new Request(origin+'/api/works/tasay/default/chat/completions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body,duplex:'half'});
  const waiting=proxy(slow,{audienceId:'slow'});assert.equal((await complete(await proxy(request(),{audienceId:'valid'}))).status,200);
  assert.equal((await waiting).status,504);assert.equal(cancelledBody,1);assert.equal(quotas,1);assert.equal(calls,1);
});

test('an upstream streaming failure frees capacity and exposes no upstream diagnostic',async t=>{
  let calls=0,source;
  const proxy=createTasayProxy({env,maxConcurrent:1,fetchImpl:async()=>++calls===1?new Response(new ReadableStream({start(c){source=c;}})):Response.json({ok:true})});t.after(()=>proxy.dispose());
  const first=await proxy(request(),{audienceId:'first'}),second=proxy(request(),{audienceId:'second'}).then(complete);
  const rejected=assert.rejects(first.text(),e=>!e.message.includes('private')&&/中断/.test(e.message));source.error(new Error('private upstream diagnostic'));await rejected;
  assert.equal((await second).status,200);assert.equal(calls,2);
});
