import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../src/live-client.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const BASE=1700000000000;
function fixture(t,{hidden=false}={}){
  let now=0,id=0;const timers=new Map(),requests=[],sources=[],states=[],connections=[];
  class Surface extends EventTarget{
    listeners=new Map();
    addEventListener(type,fn){super.addEventListener(type,fn);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){super.removeEventListener(type,fn);this.listeners.get(type)?.delete(fn);}
    emit(type,extra={}){this.dispatchEvent(Object.assign(new Event(type),extra));}
    get count(){return [...this.listeners.values()].reduce((n,v)=>n+v.size,0);}
  }
  const document=new Surface(),window=new Surface();document.hidden=hidden;
  class Source extends Surface{constructor(){super();this.closed=0;sources.push(this);}close(){this.closed++;}snapshot(revision,patch={}){this.emit('snapshot',{data:JSON.stringify({state:{revision,...patch},serverTime:BASE+now})});}}
  const client=createLiveClient({documentImpl:document,windowImpl:window,clock:()=>BASE+now,monotonic:()=>now,random:()=>.5,EventSourceImpl:Source,
    setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id),
    // Deliberately ignore abort. A browser/proxy may already have buffered JSON
    // when visibility changes; old completion must never own the new lifecycle.
    fetchImpl:(url,{signal})=>new Promise((resolve,reject)=>requests.push({url,signal,resolve,reject})),
    onState:state=>states.push(state),onConnection:state=>connections.push(state)});
  t.after(()=>client.dispose());
  async function advance(ms){const end=now+ms;for(;;){await settle();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;await settle();}
  async function respond(index,revision,patch={},serverTime=BASE+now){requests[index].resolve({ok:true,json:async()=>({state:{revision,...patch},serverTime})});await settle();}
  function visibility(hidden){document.hidden=hidden;document.emit('visibilitychange');}
  return {client,document,window,timers,requests,sources,states,connections,advance,respond,visibility,now:()=>now};
}

test('a page created hidden performs no network work until it becomes visible',async t=>{
  const f=fixture(t,{hidden:true});await f.advance(600000);assert.equal(f.requests.length,0);assert.equal(f.sources.length,0);assert.equal(f.timers.size,0);
  f.window.emit('online');await f.advance(60000);assert.equal(f.requests.length,0);
  f.visibility(false);await f.advance(549);assert.equal(f.requests.length,0);await f.advance(1);assert.equal(f.requests.length,1);
  await f.respond(0,4,{paused:true});assert.equal(f.sources.length,1);assert.equal(f.client.state.paused,true);assert.equal(f.client.connected,false);
  f.sources[0].snapshot(4,{paused:true});assert.equal(f.client.connected,true);
});

test('hidden established pages release SSE and cancel pending calibration, then synchronize missed host changes before reconnecting',async t=>{
  const f=fixture(t);await f.respond(0,1);const old=f.sources[0];old.snapshot(1);await f.advance(65000);old.emit('clock');assert.equal(f.timers.size,1);
  f.visibility(true);assert.equal(old.closed,1);assert.equal(f.timers.size,0);assert.equal(f.client.connected,false);
  old.snapshot(99,{paused:true});old.emit('error');old.emit('clock');await f.advance(600000);
  assert.equal(f.requests.length,1);assert.equal(f.sources.length,1);assert.equal(f.client.state.revision,1);
  const time=f.client.now();f.visibility(false);await f.advance(550);assert.equal(f.requests.length,2);assert.equal(f.sources.length,1,'no SSE before fresh authoritative state');
  const announcement={id:'missed',title:'活动已暂停'};await f.respond(1,7,{paused:true,announcement});
  assert.equal(f.client.state.revision,7);assert.equal(f.client.state.paused,true);assert.deepEqual(f.client.state.announcement,announcement);assert.equal(f.sources.length,2);assert.ok(f.client.now()>=time);
  assert.deepEqual(f.connections,[true,false]);f.sources[1].snapshot(7,{paused:true,announcement});assert.equal(f.client.connected,true);
});

test('suspended late initial requests cannot block or overwrite a new resume request',async t=>{
  const f=fixture(t);assert.equal(f.requests.length,1);f.visibility(true);assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.timers.size,0);
  f.visibility(false);await f.advance(550);assert.equal(f.requests.length,2,'aborted promise need not settle before foreground resumes');
  await f.respond(0,100,{paused:false});assert.equal(f.states.length,0);assert.equal(f.sources.length,0);assert.equal(f.timers.size,1,'late request cannot clear current request timeout');
  await f.respond(1,5,{paused:true});assert.equal(f.client.state.revision,5);assert.equal(f.client.state.paused,true);assert.equal(f.sources.length,1);
});

test('rapid hide/show cycles reject stale generations without opening duplicate streams',async t=>{
  const f=fixture(t);await f.respond(0,1);f.sources[0].snapshot(1);
  f.visibility(true);f.visibility(false);await f.advance(550);f.visibility(true);assert.equal(f.requests[1].signal.aborted,true);
  f.visibility(false);await f.advance(550);assert.equal(f.requests.length,3);await f.respond(2,8,{paused:true});
  const source=f.sources[1];source.snapshot(8,{paused:true});await f.respond(1,99,{paused:false});
  assert.equal(f.client.state.revision,8);assert.equal(f.client.state.paused,true);assert.equal(f.sources.length,2);assert.equal(f.client.connected,true);assert.equal(f.timers.size,0);
});

test('hidden pages cancel retry backoff and resume failures retain bounded exponential retries',async t=>{
  const f=fixture(t);await f.respond(0,1);f.sources[0].emit('error');assert.equal(f.timers.size,1);
  f.visibility(true);await f.advance(120000);assert.equal(f.sources.length,1);assert.equal(f.requests.length,1);assert.equal(f.timers.size,0);
  f.visibility(false);await f.advance(550);f.requests[1].reject(Error('unavailable'));await settle();assert.equal(f.sources.length,1);assert.equal(f.timers.size,1);
  await f.advance(1499);assert.equal(f.requests.length,2);await f.advance(1);assert.equal(f.requests.length,3);
  f.visibility(true);assert.equal(f.requests[2].signal.aborted,true);await f.advance(120000);assert.equal(f.requests.length,3);assert.equal(f.timers.size,0);
});

test('BFCache pagehide releases work, pageshow revalidates once, and disposal removes lifecycle hooks',async t=>{
  const f=fixture(t);await f.respond(0,1);f.sources[0].snapshot(1);
  f.window.emit('pagehide',{persisted:true});assert.equal(f.sources[0].closed,1);assert.equal(f.timers.size,0);
  f.document.emit('visibilitychange');f.window.emit('online');await f.advance(120000);assert.equal(f.requests.length,1,'pagehide remains suspended even if document.hidden is not updated');
  f.window.emit('pageshow',{persisted:true});f.document.emit('visibilitychange');await f.advance(550);assert.equal(f.requests.length,2);
  f.client.dispose();assert.equal(f.requests[1].signal.aborted,true);assert.equal(f.timers.size,0);assert.equal(f.document.count,0);assert.equal(f.window.count,0);
  await f.respond(1,20);f.window.emit('pageshow',{persisted:true});await f.advance(60000);assert.equal(f.sources.length,1);assert.equal(f.requests.length,2);assert.equal(f.client.state.revision,1);
});

test('foreground revalidation preserves an established monotonic clock when the new server sample is behind',async t=>{
  const f=fixture(t);await f.respond(0,1);f.sources[0].snapshot(1);await f.advance(10000);f.visibility(true);await f.advance(10000);f.visibility(false);await f.advance(550);
  const before=f.client.now();await f.respond(1,2,{},before-5000);assert.equal(f.client.now(),before,'resume does not treat the clock as first-ever calibration');
  await f.advance(100);assert.equal(f.client.now(),before+90);
});
