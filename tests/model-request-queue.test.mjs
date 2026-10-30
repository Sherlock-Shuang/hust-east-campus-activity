import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelRequestQueue} from '../integration/model-request-queue.mjs';

test('FIFO admission stays bounded and a repeated release cannot steal another slot',async()=>{
  const queue=createModelRequestQueue({maxConcurrent:2,maxQueued:2}),first=await queue.acquire({key:'a'}),second=await queue.acquire({key:'b'}),order=[];
  const third=queue.acquire({key:'c'}).then(release=>{order.push('c');return release;}),fourth=queue.acquire({key:'d'}).then(release=>{order.push('d');return release;});
  await assert.rejects(queue.acquire({key:'e'}),{code:'QUEUE_FULL'});
  assert.deepEqual(queue.stats,{active:2,waiting:2,waitingKeys:2,closed:false});
  first();first();const releaseThird=await third;assert.deepEqual(order,['c']);assert.equal(queue.stats.active,2);
  second();const releaseFourth=await fourth;assert.deepEqual(order,['c','d']);releaseThird();releaseFourth();
  assert.deepEqual(queue.stats,{active:0,waiting:0,waitingKeys:0,closed:false});queue.dispose();
});

test('per-viewer wait cap, abort and expiry remove listeners and pending timers',async()=>{
  const timers=new Map();let id=0;
  const queue=createModelRequestQueue({maxConcurrent:1,maxQueued:4,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:key=>timers.delete(key)}),release=await queue.acquire();
  const controller=new AbortController(),waiting=queue.acquire({key:'same',signal:controller.signal});
  await assert.rejects(queue.acquire({key:'same'}),{code:'QUEUE_FULL'});assert.equal(timers.size,1);
  const rejected=assert.rejects(waiting,{code:'REQUEST_CANCELLED'});controller.abort();await rejected;assert.equal(timers.size,0);assert.equal(queue.stats.waitingKeys,0);
  const expired=queue.acquire({key:'new'}),expiry=assert.rejects(expired,{code:'QUEUE_TIMEOUT'});[...timers.values()][0]();await expiry;
  assert.equal(timers.size,0);release();assert.equal(queue.stats.active,0);
});

test('dispose rejects pending and future requests while existing release remains idempotent',async()=>{
  const queue=createModelRequestQueue({maxConcurrent:1}),release=await queue.acquire();
  const waiting=assert.rejects(queue.acquire({key:'pending'}),{code:'QUEUE_CLOSED'});queue.dispose();queue.dispose();await waiting;
  await assert.rejects(queue.acquire(),{code:'QUEUE_CLOSED'});release();release();assert.deepEqual(queue.stats,{active:0,waiting:0,waitingKeys:0,closed:true});
});

test('already aborted requests never acquire; invalid capacity is rejected',async()=>{
  const queue=createModelRequestQueue(),controller=new AbortController();controller.abort();
  await assert.rejects(queue.acquire({signal:controller.signal}),{code:'REQUEST_CANCELLED'});assert.equal(queue.stats.active,0);
  for(const options of [{maxConcurrent:0},{maxQueued:-1},{waitMs:NaN},{maxQueuedPerKey:0}])assert.throws(()=>createModelRequestQueue(options),RangeError);
});
