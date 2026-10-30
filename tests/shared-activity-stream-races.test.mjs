import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedActivityStream} from '../serverless/shared-activity-stream.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function timeline(){
  let now=1000,id=0;const jobs=new Map();
  return {now:()=>now,setTimeout(fn){jobs.set(++id,fn);return id;},clearTimeout(key){jobs.delete(key);},get pending(){return jobs.size;},
    fireAt(time){now=time;const [key,fn]=jobs.entries().next().value;jobs.delete(key);return fn();}};
}
function observer(id){const packets=[],errors=[];return {id,packets,errors,send:(name,payload)=>packets.push({name,payload}),error:(cause,phase)=>errors.push({cause,phase})};}
const names=client=>client.packets.map(packet=>packet.name);

test('a subscriber arriving during count aggregation gets an initial snapshot without waiting for another poll',async()=>{
  const clock=timeline(),countsGate=gate(),first=observer('first'),second=observer('second');let countCalls=0,idles=0;
  const scheduler=createSharedActivityStream({clock,readState:async()=>({revision:3,payload:'{"revision":3}'}),
    readCounts:async()=>{if(++countCalls===1)await countsGate.promise;return {onlineCount:2};},renewLeases:async()=>{},onIdle:()=>idles++});
  const removeFirst=scheduler.subscribe(first);await settle();assert.equal(countCalls,1);assert.deepEqual(first.packets,[]);
  const removeSecond=scheduler.subscribe(second);countsGate.resolve();await settle();await settle();
  assert.deepEqual(names(first),['snapshot','clock']);assert.deepEqual(names(second),['snapshot','clock']);
  assert.equal(second.packets[0].payload.state.revision,3);assert.equal(clock.pending,1);assert.deepEqual([...first.errors,...second.errors],[]);
  removeFirst();removeSecond();assert.equal(clock.pending,0);assert.equal(idles,1);
});

test('a subscriber arriving during bulk renewal gets a fresh snapshot and does not inherit the older lease timestamp',async()=>{
  const clock=timeline(),renewGate=gate(),renewStarted=gate(),first=observer('first'),second=observer('second'),renewals=[];let revision=4,idles=0;
  const scheduler=createSharedActivityStream({clock,readState:async()=>({revision,payload:JSON.stringify({revision})}),readCounts:async()=>({onlineCount:2}),
    renewLeases:async(ids,now)=>{renewals.push({ids,now});renewStarted.resolve();await renewGate.promise;},onIdle:()=>idles++});
  const removeFirst=scheduler.subscribe(first);await settle();assert.deepEqual(names(first),['snapshot','clock']);
  const pump=clock.fireAt(16000);await renewStarted.promise;revision=5;
  const removeSecond=scheduler.subscribe(second);assert.deepEqual(second.packets,[]);renewGate.resolve();await pump;await settle();
  assert.deepEqual(names(second),['snapshot','clock']);assert.equal(second.packets[0].payload.state.revision,5);
  assert.deepEqual(first.packets.filter(p=>p.name==='snapshot').map(p=>p.payload.state.revision),[4,5]);
  assert.deepEqual(renewals,[{ids:['first'],now:16000}],'newly inserted stream keeps its own initial lease');
  assert.deepEqual([...first.errors,...second.errors],[]);assert.equal(clock.pending,1);
  removeFirst();removeSecond();assert.equal(clock.pending,0);assert.equal(idles,1);
});
