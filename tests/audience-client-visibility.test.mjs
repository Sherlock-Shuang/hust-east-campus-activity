import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudienceClient} from '../src/audience-client.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const identity={id:'viewer',nickname:'同学'};
class MemoryStorage{
  values=new Map();get length(){return this.values.size;}key(i){return [...this.values.keys()][i]??null;}
  getItem(key){return this.values.get(key)??null;}setItem(key,value){this.values.set(key,String(value));}removeItem(key){this.values.delete(key);}
}
function seed(storage,{id='one',sequence=1,type='opening',tabId='saved-tab'}={}){
  storage.setItem('campus-event-v1:'+id,JSON.stringify({audienceId:identity.id,event:{eventId:id,tabId,type,attemptId:'attempt'},sequence,queuedAt:100+sequence,status:'pending'}));
}
function fixture(t,{hidden=false,online=true,storage=new MemoryStorage(),locks,initial,events}={}){
  let now=0,id=0;const timers=new Map(),calls=[],identities=[],errors=[];
  class Surface extends EventTarget{
    listeners=new Map();addEventListener(type,fn){super.addEventListener(type,fn);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){super.removeEventListener(type,fn);this.listeners.get(type)?.delete(fn);}
    emit(type,extra={}){this.dispatchEvent(Object.assign(new Event(type),extra));}
    get count(){return [...this.listeners.values()].reduce((n,v)=>n+v.size,0);}
  }
  const document=new Surface(),window=new Surface(),navigator={onLine:online,...(locks?{locks}: {})};document.hidden=hidden;
  const client=createAudienceClient({documentImpl:document,windowImpl:window,navigatorImpl:navigator,storageImpl:storage,random:()=>.5,
    setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer:id=>timers.delete(id),
    onIdentity:value=>identities.push(value),onError:message=>errors.push(message),
    fetchImpl:(path,options)=>{
      const call={path,options,body:options.body?JSON.parse(options.body):undefined,at:now};calls.push(call);
      if(path==='/api/audience/me')return initial?initial(call):Promise.resolve(response({audience:identity,csrfToken:'token'}));
      if(path==='/api/audience/events')return events?events(call):Promise.resolve(response({duplicate:false}));
      if(path==='/api/audience/heartbeat')return Promise.resolve(response({audience:identity}));
      throw Error('Unexpected endpoint '+path);
    }});
  t.after(()=>client.dispose());
  async function advance(ms){const end=now+ms;for(;;){await settle();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;await settle();}
  const visibility=hidden=>{document.hidden=hidden;document.emit('visibilitychange');};
  const connectivity=online=>{navigator.onLine=online;window.emit(online?'online':'offline');};
  const byPath=path=>calls.filter(call=>call.path==='/api/audience/'+path);
  return {client,document,window,navigator,storage,timers,calls,identities,errors,advance,visibility,connectivity,byPath};
}

test('identity loading in an initially hidden page does not start recurring heartbeat or event retries',async t=>{
  const storage=new MemoryStorage();seed(storage);let resolveIdentity;
  const f=fixture(t,{hidden:true,storage,initial:()=>new Promise(resolve=>resolveIdentity=resolve)});
  assert.equal(f.calls.length,1);resolveIdentity(response({audience:identity,csrfToken:'token'}));await f.client.ready;await settle();
  assert.equal(f.byPath('heartbeat').length,0);assert.equal(f.byPath('events').length,0);assert.equal(f.timers.size,0);
  await f.advance(3600000);assert.equal(f.calls.length,1);
  f.visibility(false);await settle();assert.equal(f.byPath('heartbeat').length,1);assert.equal(f.byPath('events').length,1);assert.equal(f.timers.size,1);
});

test('hidden pages stop recurring requests and resume exactly one immediate heartbeat and one timer',async t=>{
  const f=fixture(t);await f.client.ready;await settle();assert.equal(f.byPath('heartbeat').length,1);assert.equal(f.timers.size,1);
  await f.advance(25000);assert.equal(f.byPath('heartbeat').length,2);f.visibility(true);assert.equal(f.timers.size,0);
  const before=f.calls.length;await f.advance(3600000);assert.equal(f.calls.length,before);
  f.visibility(false);for(let i=0;i<20;i++){f.document.emit('visibilitychange');f.window.emit('online');}await settle();
  assert.equal(f.byPath('heartbeat').length,3);assert.equal(f.timers.size,1);await f.advance(25000);assert.equal(f.byPath('heartbeat').length,4);
});

test('offline pauses heartbeat, and online waits until the page is actually visible',async t=>{
  const f=fixture(t);await f.client.ready;await settle();f.connectivity(false);assert.equal(f.timers.size,0);
  const before=f.calls.length;await f.advance(300000);assert.equal(f.calls.length,before);
  f.visibility(true);f.connectivity(true);await f.advance(300000);assert.equal(f.calls.length,before);
  f.visibility(false);await settle();assert.equal(f.byPath('heartbeat').length,2);assert.equal(f.timers.size,1);
});

test('BFCache pagehide suspends even without visibilitychange; pageshow restores one recurring loop',async t=>{
  const f=fixture(t);await f.client.ready;await settle();f.window.emit('pagehide',{persisted:true});assert.equal(f.timers.size,0);
  const before=f.calls.length;f.document.emit('visibilitychange');f.window.emit('online');await f.advance(300000);assert.equal(f.calls.length,before);
  f.window.emit('pageshow',{persisted:true});f.document.emit('visibilitychange');await settle();assert.equal(f.byPath('heartbeat').length,2);assert.equal(f.timers.size,1);
  f.client.dispose();assert.equal(f.document.count,0);assert.equal(f.window.count,0);assert.equal(f.timers.size,0);
  f.window.emit('pageshow',{persisted:true});await f.advance(300000);assert.equal(f.byPath('heartbeat').length,2);
});

test('rapid lifecycle transitions never duplicate future heartbeat timers',async t=>{
  const f=fixture(t);await f.client.ready;await settle();
  for(let i=0;i<10;i++){f.visibility(true);f.window.emit('pagehide',{persisted:true});f.visibility(false);f.window.emit('pageshow',{persisted:true});f.window.emit('online');}
  await settle();assert.equal(f.timers.size,1);const before=f.byPath('heartbeat').length;await f.advance(25000);assert.equal(f.byPath('heartbeat').length,before+1);
});

test('required opening and returned acknowledgements still deliver while hidden or in pagehide',async t=>{
  const f=fixture(t,{hidden:true});await f.client.ready;await settle();
  const opening=await f.client.event('opening',{attemptId:'one',workId:'tasay'},{required:true});assert.deepEqual(opening,{duplicate:false});
  f.window.emit('pagehide',{persisted:true});const returned=await f.client.event('returned',{attemptId:'one',workId:'tasay'},{required:true});assert.deepEqual(returned,{duplicate:false});
  assert.deepEqual(f.byPath('events').map(call=>call.body.type),['opening','returned']);assert.ok(f.byPath('events').every(call=>call.options.keepalive));assert.equal(f.byPath('heartbeat').length,0);assert.equal(f.timers.size,0);
});

test('failed hidden events remain durable and retry in original per-tab order only after becoming visible',async t=>{
  let failing=true;const f=fixture(t,{hidden:true,events:async()=>response(failing?{error:'temporarily offline'}:{duplicate:false},failing?503:200)});await f.client.ready;await settle();
  await assert.rejects(f.client.event('opening',{attemptId:'ordered'},{required:true}),/temporarily offline/);
  assert.equal(await f.client.event('returned',{attemptId:'ordered'}),null);
  assert.deepEqual(f.byPath('events').map(call=>call.body.type),['opening','opening'],'explicit return cannot overtake an unacknowledged opening');
  const before=f.calls.length;await f.advance(300000);assert.equal(f.calls.length,before);
  failing=false;f.visibility(false);await settle();assert.deepEqual(f.byPath('events').slice(-2).map(call=>call.body.type),['opening','returned']);
  const pending=[...f.storage.values.values()].map(JSON.parse).filter(entry=>entry.status==='pending');assert.equal(pending.length,0);
});

test('explicit flush delivers persisted events while hidden without starting recurring requests',async t=>{
  const storage=new MemoryStorage();seed(storage);const f=fixture(t,{hidden:true,storage});await f.client.ready;await settle();
  await f.client.flush();assert.equal(f.byPath('events').length,1);assert.equal(f.byPath('heartbeat').length,0);assert.equal(f.timers.size,0);
});

test('background queue stops between deliveries when the page hides during an in-flight acknowledgement',async t=>{
  const storage=new MemoryStorage();seed(storage,{id:'first',sequence:1});seed(storage,{id:'second',sequence:2,type:'returned'});let acknowledge;
  const f=fixture(t,{hidden:true,storage,events:call=>call.body.eventId==='first'?new Promise(resolve=>acknowledge=resolve):Promise.resolve(response({duplicate:false}))});
  await f.client.ready;await settle();f.visibility(false);await settle();assert.equal(f.byPath('events').length,1);
  f.visibility(true);acknowledge(response({duplicate:false}));await settle();assert.equal(f.byPath('events').length,1,'second queued delivery waits for foreground');assert.equal(f.timers.size,0);
  f.visibility(false);await settle();assert.deepEqual(f.byPath('events').map(call=>call.body.eventId),['first','second']);
});

test('an explicit hidden flush is not swallowed by a background drain waiting for another tab lock',async t=>{
  const waiting=[];const locks={request(name,operation){return new Promise((resolve,reject)=>waiting.push({name,async release(){try{resolve(await operation());}catch(error){reject(error);}}}));}};
  const storage=new MemoryStorage();seed(storage);const f=fixture(t,{hidden:true,storage,locks});await f.client.ready;await settle();f.visibility(false);await settle();assert.equal(waiting.length,1);
  f.visibility(true);const explicit=f.client.flush();await settle();
  for(let i=0;i<4&&waiting.length;i++){await waiting.shift().release();await settle();}
  await explicit;assert.equal(f.byPath('events').length,1,'explicit flush delivers after the cancelled background attempt releases its lock');assert.equal(f.timers.size,0);
});

test('disposing during identity lookup never starts heartbeat or invokes identity callbacks afterwards',async t=>{
  let resolveIdentity;const f=fixture(t,{initial:()=>new Promise(resolve=>resolveIdentity=resolve)});f.client.dispose();
  resolveIdentity(response({audience:identity,csrfToken:'token'}));await f.client.ready;await settle();assert.equal(f.identities.length,0);assert.equal(f.byPath('heartbeat').length,0);assert.equal(f.timers.size,0);assert.equal(f.document.count,0);assert.equal(f.window.count,0);
});

test('a background delivery that obtains the cross-tab lock after hiding does not send until foreground resumes',async t=>{
  const waiting=[];const locks={request(_name,operation){return new Promise((resolve,reject)=>waiting.push(async()=>{try{resolve(await operation());}catch(error){reject(error);}}));}};
  const storage=new MemoryStorage();seed(storage);const f=fixture(t,{hidden:true,storage,locks});await f.client.ready;await settle();
  f.visibility(false);await settle();assert.equal(waiting.length,1);f.visibility(true);await waiting.shift()();await settle();assert.equal(f.byPath('events').length,0);assert.equal(f.timers.size,0);
  f.visibility(false);await settle();assert.equal(waiting.length,1);await waiting.shift()();await settle();assert.equal(f.byPath('events').length,1);
});

test('a required opening already in flight retains its acknowledgement across pagehide',async t=>{
  let acknowledge;const f=fixture(t,{events:()=>new Promise(resolve=>acknowledge=resolve)});await f.client.ready;await settle();
  const required=f.client.event('opening',{attemptId:'pending-opening'},{required:true});await settle();f.window.emit('pagehide',{persisted:true});
  assert.equal(f.byPath('events').length,1);assert.equal(f.byPath('events')[0].options.signal.aborted,false);
  acknowledge(response({duplicate:false}));assert.deepEqual(await required,{duplicate:false});await settle();assert.equal(f.timers.size,0);
  assert.equal([...f.storage.values.values()].map(JSON.parse).some(entry=>entry.event.attemptId==='pending-opening'),false);
});
