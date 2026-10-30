import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../src/live-client.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const BASE=1700000000000;
function fixture({deviceOffset=0}={}){
  let mono=0,wallExtra=deviceOffset,id=0;const timers=new Map(),requests=[],sources=[],states=[];
  const document=new EventTarget();document.hidden=false;
  class Source extends EventTarget{constructor(){super();sources.push(this);}close(){}emit(type,payload={}){this.dispatchEvent(Object.assign(new Event(type),{data:JSON.stringify(payload)}));}}
  const client=createLiveClient({documentImpl:document,windowImpl:new EventTarget(),clock:()=>BASE+mono+wallExtra,monotonic:()=>mono,random:()=>0,
    setTimer:(fn,delay)=>{const key=++id;timers.set(key,{at:mono+delay,fn});return key;},clearTimer:key=>timers.delete(key),EventSourceImpl:Source,
    fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>{requests.push({resolve,reject,signal,at:mono});signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});}),
    onState:state=>states.push(state.revision)});
  async function advance(ms){const end=mono+ms;for(;;){await flush();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;mono=next[1].at;timers.delete(next[0]);next[1].fn();}mono=end;await flush();}
  async function respond(index,serverTime,revision=1){requests[index].resolve({ok:true,json:async()=>({state:{revision},serverTime})});await flush();}
  const visibility=hidden=>{document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));};
  return {client,timers,requests,sources,states,advance,respond,visibility,mono:()=>mono,wallJump:ms=>{wallExtra+=ms;}};
}

test('a high RTT followed by a low RTT cannot rewind or freeze an established server clock',async()=>{
  const f=fixture();await f.advance(200);await f.respond(0,BASE+150);assert.equal(f.client.now(),BASE+250,'first asymmetric RTT estimates 50ms ahead');
  await f.advance(60000);f.sources[0].emit('clock');await f.advance(100);assert.equal(f.requests.length,2);
  await f.advance(20);const before=f.client.now();await f.respond(1,BASE+f.mono()-10);assert.equal(f.client.now(),before,'calibration must not jump backwards');
  let previous=before;for(let i=0;i<5;i++){await f.advance(100);const current=f.client.now();assert.equal(current-previous,90,'clock keeps moving at 0.9x during a negative correction');previous=current;}
  assert.equal(f.client.now(),BASE+f.mono());await f.advance(100);assert.equal(f.client.now()-previous,100,'normal rate resumes after convergence');f.client.dispose();
});

test('ordinary positive corrections slew rather than abruptly accelerating scheduled effects',async()=>{
  const f=fixture();await f.advance(200);await f.respond(0,BASE+50);assert.equal(f.client.now(),BASE+150);
  await f.advance(60000);f.sources[0].emit('clock');await f.advance(100);await f.advance(20);
  const before=f.client.now();await f.respond(1,BASE+f.mono()-10);assert.equal(f.client.now(),before);
  let previous=before;for(let i=0;i<5;i++){await f.advance(100);const current=f.client.now();assert.equal(current-previous,110);previous=current;}
  assert.equal(f.client.now(),BASE+f.mono());f.client.dispose();
});

test('only the first calibration may correct an inaccurate device clock backwards',async()=>{
  const f=fixture({deviceOffset:86400000});const uncalibrated=f.client.now();await f.advance(10);await f.respond(0,BASE+5);
  assert.equal(f.client.now(),BASE+10);assert.ok(f.client.now()<uncalibrated);f.client.dispose();
});

test('resume detects an OS sleep even when monotonic time did not advance and catches up from the server',async()=>{
  const f=fixture();await f.respond(0,BASE);f.visibility(true);f.wallJump(600000);f.visibility(false);
  assert.equal(f.requests.length,1,'wake calibration is jittered, not an immediate burst');await f.advance(100);assert.equal(f.requests.length,2);
  const before=f.client.now();await f.respond(1,BASE+600000+f.mono());assert.equal(f.client.now(),BASE+600000+f.mono());
  assert.equal(f.client.now()-before,600000,'trusted forward sleep correction is immediate, not a long 1.1x catch-up');f.client.dispose();
});

test('a device wall-clock jump is only a resync hint and cannot move the activity timeline',async()=>{
  const f=fixture();await f.respond(0,BASE);f.wallJump(600000);f.visibility(false);await f.advance(100);
  const before=f.client.now();await f.respond(1,BASE+f.mono());assert.equal(f.client.now(),before);f.client.dispose();
});

test('a pre-sleep in-flight reply cannot erase a wake resync; a fresh calibration is coalesced',async()=>{
  const f=fixture();await f.respond(0,BASE);await f.advance(60000);f.sources[0].emit('clock');await f.advance(100);assert.equal(f.requests.length,2);
  f.visibility(true);f.wallJump(600000);f.visibility(false);f.visibility(false);
  await f.respond(1,BASE+f.mono(),2);assert.equal(f.client.state.revision,1,'discard response whose request crossed a clock discontinuity');
  await f.advance(100);assert.equal(f.requests.length,3);await f.respond(2,BASE+600000+f.mono(),3);
  assert.equal(f.client.state.revision,3);assert.equal(f.client.now(),BASE+600000+f.mono());f.client.dispose();assert.equal(f.timers.size,0);
});
