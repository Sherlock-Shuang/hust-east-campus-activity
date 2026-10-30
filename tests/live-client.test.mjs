import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveClient} from '../src/live-client.js';
import {createDefaultLiveState,validateLiveState,isEventActive} from '../src/live-state.js';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=(revision,patch={},serverTime=100000)=>({state:{...createDefaultLiveState(),revision,...patch},serverTime,onlineCount:2});
function fixture(t){
  let mono=500,wall=7000000,timerId=0;const calls=[],changes=[],connections=[],sources=[],timers=new Map();
  const document=new EventTarget();document.hidden=false;
  const moveTo=time=>{wall+=time-mono;mono=time;};
  async function advance(ms){
    const end=mono+ms;
    for(;;){await settle();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;moveTo(next[1].at);timers.delete(next[0]);next[1].fn();}
    moveTo(end);await settle();
  }
  class FakeSource {
    constructor(url){this.url=url;this.handlers=new Map();this.closeCount=0;sources.push(this);}
    addEventListener(type,fn){const handlers=this.handlers.get(type)||[];handlers.push(fn);this.handlers.set(type,handlers);}
    emit(type,payload){for(const handler of this.handlers.get(type)||[])handler({data:typeof payload==='string'?payload:JSON.stringify(payload)});}
    close(){this.closeCount++;}
  }
  const client=createLiveClient({
    onState:(state,info)=>changes.push({state:structuredClone(state),info}),onConnection:connected=>connections.push(connected),
    EventSourceImpl:FakeSource,clock:()=>wall,monotonic:()=>mono,random:()=>.5,documentImpl:document,windowImpl:new EventTarget(),
    setTimer:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:mono+delay});return id;},clearTimer:id=>timers.delete(id),
    fetchImpl:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})),
  });
  t.after(()=>client.dispose());
  return {client,calls,changes,connections,sources,timers,advance,jumpWall:ms=>wall+=ms,
    async refresh(){await advance(15001);document.dispatchEvent(new Event('visibilitychange'));await advance(550);},
    async respond(payload,ms=20,index=calls.length-1){await advance(ms);calls[index].resolve({ok:true,json:async()=>payload});await settle();},
    async fail(index=calls.length-1){calls[index].reject(new Error('network unavailable'));await settle();},
  };
}

test('initial HTTP snapshot anchors server time and first SSE snapshot establishes the live connection',async t=>{
  const f=fixture(t);assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/live/state');assert.equal(f.calls[0].options.cache,'no-store');
  assert.equal(f.client.connected,false);await f.respond(snapshot(4,{paused:true}),40);
  assert.equal(f.client.state.paused,true);assert.equal(f.changes.length,1);assert.equal(f.client.now(),100020);
  assert.equal(f.sources.length,1);assert.equal(f.sources[0].url,'/api/live/events');
  f.sources[0].emit('snapshot',snapshot(4,{paused:true}));
  assert.equal(f.client.connected,true);assert.deepEqual(f.connections,[true]);assert.equal(f.changes.at(-1).info.onlineCount,2);
});

test('older revisions cannot roll back a pause or announcement; newer revisions update immediately',async t=>{
  const f=fixture(t);await f.respond(snapshot(7,{paused:true}));const source=f.sources[0];
  const before=f.changes.length;source.emit('snapshot',snapshot(6,{paused:false}));
  assert.equal(f.client.state.revision,7);assert.equal(f.client.state.paused,true);assert.equal(f.changes.length,before);
  const announcement={id:'event',title:'开始集合',body:'东九门前',tone:'info',startAt:null,endAt:null};
  source.emit('snapshot',snapshot(8,{paused:false,announcement}));
  assert.equal(f.client.state.revision,8);assert.equal(f.client.state.paused,false);assert.deepEqual(f.client.state.announcement,announcement);
});

test('a replacement EventSource receives a complete current snapshot, including events missed while offline',async t=>{
  const f=fixture(t);await f.respond(snapshot(1));const source=f.sources[0];source.emit('snapshot',snapshot(1));
  source.emit('error');assert.equal(f.client.connected,false);assert.equal(f.client.state.revision,1);
  assert.equal(source.closeCount,1);source.emit('open');assert.equal(f.calls.length,1,'closed source cannot trigger a duplicate refresh');
  await f.advance(749);assert.equal(f.sources.length,1);await f.advance(1);assert.equal(f.sources.length,2);
  const replacement=f.sources[1];replacement.emit('open');assert.equal(f.calls.length,1,'replacement uses its complete SSE snapshot');
  const portal={id:'experience',label:'体验入口',description:'',x:0,z:0,url:'/experiences/demo.html',radius:10,enabled:true,startAt:null,endAt:null};
  replacement.emit('snapshot',snapshot(5,{paused:true,portals:[portal]}));
  assert.equal(f.client.state.revision,5);assert.equal(f.client.state.paused,true);assert.equal(f.client.state.portals[0].enabled,true);
  source.emit('snapshot',snapshot(99,{paused:false}));assert.equal(f.client.state.revision,5,'old source packets are ignored');
  assert.equal(f.client.connected,true);assert.deepEqual(f.connections,[true,false,true]);
});

test('a delayed refresh response cannot overwrite a newer SSE state or rewind the displayed clock',async t=>{
  const f=fixture(t);await f.respond(snapshot(2));const source=f.sources[0];await f.refresh();assert.equal(f.calls.length,2);
  source.emit('snapshot',snapshot(6,{paused:true},101000));const count=f.changes.length;
  const before=f.client.now();
  await f.respond(snapshot(3,{paused:false},90000),80);
  assert.equal(f.client.state.revision,6);assert.equal(f.client.state.paused,true);assert.equal(f.changes.length,count);assert.equal(f.client.now(),before+80);
  await f.advance(100);assert.equal(f.client.now(),before+170,'negative clock correction keeps advancing at 0.9x');
});

test('scheduled event time advances monotonically despite wall-clock jumps and refreshes periodically',async t=>{
  const f=fixture(t);await f.respond(snapshot(1),20);const initial=f.client.now();
  f.jumpWall(864000000);await f.advance(2500);assert.equal(f.client.now(),initial+2500);
  f.jumpWall(-1728000000);await f.advance(1500);assert.equal(f.client.now(),initial+4000);
  const event={enabled:true,startAt:initial+3000,endAt:initial+5000};assert.equal(isEventActive(event,f.client.now()),true);
  await f.advance(1000);assert.equal(isEventActive(event,f.client.now()),false);
  f.sources[0].emit('clock',{});assert.equal(f.calls.length,1,'wall discontinuity schedules calibration instead of a synchronous burst');
  await f.advance(550);assert.equal(f.calls.length,2);let before=f.client.now();await f.respond(snapshot(1,{},before+5),10);assert.equal(f.client.now(),before+10);
  f.sources[0].emit('clock',{});await f.advance(550);assert.equal(f.calls.length,2,'recent calibration does not repeatedly query');
  await f.advance(60001);f.sources[0].emit('clock',{});assert.equal(f.calls.length,2);await f.advance(549);assert.equal(f.calls.length,2);
  await f.advance(1);assert.equal(f.calls.length,3);before=f.client.now();await f.respond(snapshot(1,{},before+5),10);assert.equal(f.client.now(),before+10);
});

test('network and malformed JSON errors preserve the last received activity state',async t=>{
  const f=fixture(t);await f.respond(snapshot(3,{paused:true}));const original=f.sources[0];original.emit('snapshot',snapshot(3,{paused:true}));
  original.emit('error');await f.advance(750);const source=f.sources[1];await f.refresh();assert.equal(f.calls.length,2);await f.fail();
  assert.equal(f.client.state.revision,3);assert.equal(f.client.state.paused,true);assert.equal(f.client.connected,false);
  const count=f.changes.length;source.emit('snapshot','not json');assert.equal(f.changes.length,count);assert.equal(f.client.state.paused,true);
  source.emit('snapshot',snapshot(4,{paused:false}));assert.equal(f.client.connected,true);assert.equal(f.client.state.paused,false);
});

test('dispose closes the stream and ignores both late stream events and in-flight refresh completion',async t=>{
  const f=fixture(t);await f.respond(snapshot(2));const source=f.sources[0];source.emit('snapshot',snapshot(2));await f.refresh();assert.equal(f.calls.length,2);
  const changes=f.changes.length,connections=f.connections.length;f.client.dispose();assert.equal(source.closeCount,1);
  source.emit('snapshot',snapshot(99,{paused:true}));source.emit('error');await f.respond(snapshot(100,{paused:true}));
  assert.equal(f.client.state.revision,2);assert.equal(f.changes.length,changes);assert.equal(f.connections.length,connections);assert.equal(f.timers.size,0);
});

test('dispose before the first fetch completes never creates a stream or invokes callbacks',async t=>{
  const f=fixture(t);f.client.dispose();await f.respond(snapshot(5));
  assert.equal(f.sources.length,0);assert.equal(f.changes.length,0);assert.equal(f.connections.length,0);assert.equal(f.client.state.revision,0);
});

test('scheduled marker and portal boundaries are start-inclusive, end-exclusive and never override disabled state',()=>{
  const s=createDefaultLiveState();s.markers=[{id:'light',label:'光柱',x:0,z:0,color:'#12AABB',enabled:true,startAt:1000,endAt:2000}];
  s.portals=[{id:'portal',label:'入口',description:'',url:'/experiences/demo.html',x:0,z:0,enabled:false,startAt:1000,endAt:2000}];
  const valid=validateLiveState(s);assert.equal(isEventActive(valid.markers[0],999),false);assert.equal(isEventActive(valid.markers[0],1000),true);assert.equal(isEventActive(valid.markers[0],1999),true);assert.equal(isEventActive(valid.markers[0],2000),false);
  assert.equal(isEventActive(valid.portals[0],1500),false);assert.equal(isEventActive(null,1500),false);
  assert.equal(isEventActive({enabled:true,startAt:null,endAt:null},0),true);
  for(const endAt of [1000,999])assert.throws(()=>validateLiveState({...s,markers:[{...s.markers[0],endAt}]}),/结束时间/);
  for(const startAt of [-1,NaN,Infinity,'2026-10-27'])assert.throws(()=>validateLiveState({...s,markers:[{...s.markers[0],startAt}]}),/活动时间/);
});

test('missing state and invalid SSE revisions cannot claim a live connection or replace the last state',async t=>{
  const f=fixture(t);await f.respond(snapshot(2,{paused:true}));const source=f.sources[0],before=f.changes.length;
  for(const payload of [
    {serverTime:100000},
    {state:null,serverTime:100000},
    {state:{revision:'3'},serverTime:100000},
    {state:{revision:3.5},serverTime:100000},
    {state:{revision:-1},serverTime:100000},
    {state:{revision:Number.MAX_SAFE_INTEGER+1},serverTime:100000},
  ]){
    source.emit('snapshot',payload);
    assert.equal(f.client.connected,false,`invalid revision ${String(payload.state?.revision)} must stay disconnected`);
    assert.equal(f.client.state.revision,2);assert.equal(f.client.state.paused,true);assert.equal(f.changes.length,before);
  }
  source.emit('snapshot',snapshot(3,{paused:false}));assert.equal(f.client.connected,true);assert.equal(f.client.state.revision,3);
});
