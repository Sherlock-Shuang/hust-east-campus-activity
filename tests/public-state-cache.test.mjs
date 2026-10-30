import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicStateCache} from '../serverless/public-state-cache.mjs';

test('a burst of public state reads shares one in-flight request and a bounded TTL',async()=>{
  let now=0,reads=0,resolve;const cache=createPublicStateCache({now:()=>now,ttlMs:500});
  const load=()=>{reads++;return new Promise(done=>{resolve=done;});};
  const burst=Array.from({length:100},()=>cache.read(load));await Promise.resolve();assert.equal(reads,1);
  resolve({revision:0,payload:'zero'});const rows=await Promise.all(burst);assert.ok(rows.every(row=>row.revision===0));
  now=499;await cache.read(load);assert.equal(reads,1);
  now=500;const next=cache.read(load);await Promise.resolve();assert.equal(reads,2);
  resolve({revision:1,payload:'one'});assert.equal((await next).revision,1);
});

test('a late old select cannot overwrite a committed revision or return it to the waiting stream',async()=>{
  let resolve,now=0;const cache=createPublicStateCache({now:()=>now});
  const pending=cache.read(()=>new Promise(done=>{resolve=done;}));await Promise.resolve();
  cache.publish({revision:7,payload:'latest'});resolve({revision:6,payload:'old'});
  assert.equal((await pending).payload,'latest');
  cache.publish({revision:5,payload:'older'});
  assert.equal((await cache.read(()=>assert.fail('within TTL'))).revision,7);
  now=501;assert.equal((await cache.read(async()=>({revision:8,payload:'other-process'}))).revision,8);
});

test('failed public reads are not retained, database caches are independent and rows cannot be mutated',async()=>{
  const a=createPublicStateCache(),b=createPublicStateCache();let reads=0;
  await assert.rejects(a.read(async()=>{reads++;throw new Error('transient');}),/transient/);
  const row=await a.read(async()=>{reads++;return {revision:9,payload:'a'};});assert.equal(reads,2);
  assert.throws(()=>{row.revision=100;},TypeError);
  assert.equal((await b.read(async()=>({revision:0,payload:'b'}))).payload,'b');
  assert.equal((await a.read(()=>assert.fail())).payload,'a');
});
