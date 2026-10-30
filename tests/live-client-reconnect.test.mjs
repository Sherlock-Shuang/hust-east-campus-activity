import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../src/live-client.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({random=()=>.5,fetchImpl}={}){
  let now=0,id=0;const timers=new Map(),sources=[],requests=[],states=[],statuses=[];
  const document=new EventTarget(),window=new EventTarget();document.hidden=false;
  class Source extends EventTarget{
    constructor(){super();this.closed=0;sources.push(this);}
    close(){this.closed++;}
    emit(type,payload){this.dispatchEvent(Object.assign(new Event(type),{data:JSON.stringify(payload)}));}
  }
  const payload=(revision=1)=>({state:{revision},serverTime:1700000000000+now});
  const options={random,clock:()=>1700000000000+now,monotonic:()=>now,documentImpl:document,windowImpl:window,
    setTimer:(fn,delay)=>{const key=++id;timers.set(key,{fn,at:now+delay});return key;},clearTimer:key=>timers.delete(key),
    EventSourceImpl:Source,fetchImpl:async(url,opts)=>{requests.push({at:now,url,signal:opts.signal});return fetchImpl?fetchImpl(url,opts):{ok:true,json:async()=>payload()};},
    onState:state=>states.push(state.revision),onConnection:value=>statuses.push(value)};
  const client=createLiveClient(options);
  async function advance(ms){const end=now+ms;for(;;){await flush();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;await flush();}
  return {client,options,document,window,sources,requests,states,statuses,timers,payload,advance,now:()=>now};
}

test('opening and a quick foreground return do not repeat initial RTT/state queries',async()=>{
  const f=fixture();await flush();assert.equal(f.requests.length,1);assert.equal(f.sources.length,1);
  f.sources[0].emit('open');f.sources[0].emit('snapshot',f.payload());f.sources[0].emit('clock',{});
  f.document.dispatchEvent(new Event('visibilitychange'));await f.advance(1000);
  assert.equal(f.requests.length,1);assert.equal(f.client.connected,true);f.client.dispose();assert.equal(f.timers.size,0);
});

test('reconnect closes old source, backs off, resets on a valid snapshot and ignores late packets',async()=>{
  const f=fixture();await flush();const first=f.sources[0];first.emit('snapshot',f.payload());
  first.emit('error');assert.equal(first.closed,1);assert.equal(f.client.connected,false);
  first.emit('snapshot',f.payload(999));assert.equal(f.client.state.revision,1);
  await f.advance(749);assert.equal(f.sources.length,1);await f.advance(1);assert.equal(f.sources.length,2);
  f.sources[1].emit('error');await f.advance(1499);assert.equal(f.sources.length,2);await f.advance(1);assert.equal(f.sources.length,3);
  f.sources[2].emit('snapshot',f.payload(2));assert.equal(f.client.connected,true);f.sources[2].emit('error');
  await f.advance(750);assert.equal(f.sources.length,4);assert.equal(f.requests.length,1,'fresh SSE snapshots do not require a separate GET on every reconnect');
  f.client.dispose();await f.advance(60000);assert.equal(f.sources.length,4);assert.equal(f.timers.size,0);
});

test('repeated network failures have a bounded retry rate and dispose cancels scheduled work',async()=>{
  const f=fixture({fetchImpl:async()=>{throw new Error('offline');}});await flush();
  await f.advance(120000);
  assert.ok(f.requests.length>=6&&f.requests.length<=11,`unexpected retry count ${f.requests.length}`);
  assert.equal(f.sources.length,0);assert.equal(f.timers.size,1);
  const count=f.requests.length;f.client.dispose();await f.advance(120000);assert.equal(f.requests.length,count);assert.equal(f.timers.size,0);
});

test('offline suspends retries; online resumes even when the document is hidden',async()=>{
  const f=fixture();await flush();f.sources[0].emit('snapshot',f.payload());f.window.dispatchEvent(new Event('offline'));
  assert.equal(f.sources[0].closed,1);await f.advance(120000);assert.equal(f.sources.length,1);
  f.document.hidden=true;f.window.dispatchEvent(new Event('online'));await f.advance(750);assert.equal(f.sources.length,2);
  f.sources[1].emit('snapshot',f.payload(2));assert.equal(f.client.state.revision,2);f.client.dispose();
});

test('clock and visibility requests coalesce, preserve server time and cancel on disposal',async()=>{
  const f=fixture();await flush();f.sources[0].emit('snapshot',f.payload());await f.advance(65000);
  for(let i=0;i<20;i++){f.sources[0].emit('clock',{});f.document.dispatchEvent(new Event('visibilitychange'));}
  assert.equal(f.timers.size,1);assert.equal(f.requests.length,1);await f.advance(550);assert.equal(f.requests.length,2);
  assert.ok(Math.abs(f.client.now()-(1700000000000+f.now()))<1);
  await f.advance(65000);f.sources[0].emit('clock',{});f.client.dispose();await f.advance(2000);assert.equal(f.requests.length,2);assert.equal(f.timers.size,0);
});

test('200 readers spread reconnect and foreground calibrations rather than form a request burst',async()=>{
  const fixtures=Array.from({length:200},(_,i)=>fixture({random:()=>i/200}));await flush();
  for(const f of fixtures){f.sources[0].emit('snapshot',f.payload());f.sources[0].emit('error');}
  const reconnectTimes=fixtures.map(f=>[...f.timers.values()][0].at);
  assert.equal(new Set(reconnectTimes).size,200);assert.ok(Math.max(...reconnectTimes)-Math.min(...reconnectTimes)>490);
  for(const f of fixtures){await f.advance(15000);f.sources[1].emit('snapshot',f.payload());f.document.dispatchEvent(new Event('visibilitychange'));}
  const calibrationTimes=fixtures.map(f=>[...f.timers.values()][0].at-f.now());
  assert.equal(new Set(calibrationTimes).size,200);assert.ok(Math.max(...calibrationTimes)-Math.min(...calibrationTimes)>890);
  assert.equal(fixtures.reduce((n,f)=>n+f.requests.length,0),200);
  for(const f of fixtures)f.client.dispose();
});
