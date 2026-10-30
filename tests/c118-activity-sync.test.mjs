import test from 'node:test';
import assert from 'node:assert/strict';
import {createC118ActivitySync} from '../src/c118-activity-sync.js';

const flood={id:'shared-flood',startAt:103000,pausedAt:null,pausedMs:0};

test('embedded C118 subscribes to the campus bridge and never opens a second live connection',()=>{
  let receive,subscriptions=0,unsubscriptions=0,mono=500;
  const seen=[],bridge={subscribe(fn){subscriptions++;receive=fn;fn({paused:false,c118Flood:null,serverTime:100000});return()=>unsubscriptions++;}};
  const sync=createC118ActivitySync({embedded:true,bridge,onState:state=>seen.push(state),monotonic:()=>mono,
    liveClientFactory(){assert.fail('an embedded room must share the parent connection');}});
  assert.equal(subscriptions,1);assert.equal(seen.length,1);assert.equal(sync.now(),100000);
  mono+=750;assert.equal(sync.now(),100750);
  receive({paused:false,c118Flood:flood,serverTime:101000});
  assert.equal(seen.at(-1).c118Flood,flood);assert.equal(sync.now(),101000);
  mono+=2500;assert.equal(sync.now(),103500,'time advances from the latest server anchor');
  receive({paused:false,c118Flood:flood,serverTime:NaN});
  mono+=100;assert.equal(sync.now(),103600,'a missing clock value cannot poison the last anchor');
  const count=seen.length;sync.dispose();sync.dispose();assert.equal(unsubscriptions,1);
  receive({paused:true,c118Flood:null,serverTime:999999});mono+=400;
  assert.equal(seen.length,count,'late bridge delivery cannot update a disposed room');
  assert.equal(sync.now(),104000,'late bridge delivery cannot reset its clock');
});

test('embedded rooms without a bridge stay isolated instead of opening a standalone live connection',()=>{
  let connections=0;const seen=[];
  const sync=createC118ActivitySync({embedded:true,onState:state=>seen.push(state),monotonic:()=>10,
    liveClientFactory(){connections++;}});
  assert.equal(connections,0);assert.deepEqual(seen,[]);sync.dispose();sync.dispose();
});

test('standalone C118 opens one client, uses its adjusted server clock, and disposes once',()=>{
  let receive,connections=0,closed=0,serverNow=100025;
  const seen=[],state={revision:1,paused:false,c118Flood:flood};
  const sync=createC118ActivitySync({embedded:false,onState:value=>seen.push(value),monotonic:()=>500,
    bridge:{subscribe(){assert.fail('a standalone room must not subscribe to a parent bridge');}},
    liveClientFactory(options){connections++;receive=options.onState;return{now:()=>serverNow,dispose(){closed++;}};}});
  assert.equal(connections,1);assert.equal(sync.now(),100025);
  receive(state,{serverTime:100000});
  assert.deepEqual(seen.at(-1),{...state,disposed:false,serverTime:100025});
  assert.equal(state.serverTime,undefined,'forwarding must not mutate the shared client state');
  serverNow+=3500;assert.equal(sync.now(),103525);
  receive({...state,revision:2,paused:true},{serverTime:103500});
  assert.equal(seen.at(-1).serverTime,103525,'use the client clock including its latency adjustment');
  const count=seen.length;sync.dispose();sync.dispose();assert.equal(closed,1);
  receive({...state,revision:3,c118Flood:null},{serverTime:200000});assert.equal(seen.length,count);
});

test('a standalone client can deliver an initial snapshot synchronously before its handle is returned',()=>{
  const seen=[];
  const sync=createC118ActivitySync({embedded:false,onState:state=>seen.push(state),monotonic:()=>0,
    liveClientFactory({onState}){onState({paused:false,c118Flood:flood},{serverTime:100000});return{now:()=>100020,dispose(){}};}});
  assert.equal(seen[0].serverTime,100000);assert.equal(sync.now(),100020);sync.dispose();
});
