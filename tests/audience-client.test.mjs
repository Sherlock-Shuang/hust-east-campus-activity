import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../src/audience-client.js',import.meta.url),'utf8').replace('export function createAudienceClient','function createAudienceClient');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const response=data=>({ok:true,json:async()=>data});
function fixture(t,fetchImpl,{pendingEvent=false}={}){
  const document=Object.assign(new EventTarget(),{hidden:false}),window=new EventTarget();
  const intervals=[],identities=[],errors=[],calls=[],storage=new Map();
  if(pendingEvent)storage.set('campus-event-v1:queued',JSON.stringify({audienceId:'existing',event:{eventId:'queued',tabId:'old-tab',type:'visit',pointId:'library'},sequence:1,queuedAt:1,status:'pending'}));
  const context={document,window,navigator:{},crypto:webcrypto,AbortController,setTimeout,clearTimeout,
    setInterval:callback=>(intervals.push(callback),intervals.length),clearInterval(){},
    localStorage:{get length(){return storage.size;},key:index=>[...storage.keys()][index],getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    onIdentity:person=>identities.push(person),onError:message=>errors.push(message),
    fetchImpl:async(path,options)=>{calls.push({path,options});return fetchImpl(path,options);}};
  vm.createContext(context);vm.runInContext(source+'\nglobalThis.client=createAudienceClient({fetchImpl,onIdentity,onError});',context);
  t.after(()=>context.client.dispose());
  return {...context,intervals,identities,errors,calls,storage};
}
for(const trigger of ['online','visibilitychange','timer'])test(`failed initial identity lookup recovers on ${trigger} and replays queued records`,async t=>{
  let online=false;
  const f=fixture(t,async path=>{
    if(!online)throw new Error('offline');
    return response(path==='/api/audience/me'?{audience:{id:'existing',nickname:'原昵称'},csrfToken:'restored-token'}:{});
  },{pendingEvent:true});
  await f.client.ready;assert.equal(f.client.identity,null);online=true;
  if(trigger==='timer')f.intervals[0]();
  else (trigger==='online'?f.window:f.document).dispatchEvent(new Event(trigger));
  await settle();
  assert.equal(f.client.identity.id,'existing');
  assert.equal(f.calls.filter(c=>c.path==='/api/audience/me').length,2);
  const delivered=f.calls.find(c=>c.path==='/api/audience/events');assert.ok(delivered);
  assert.equal(delivered.options.headers['X-CSRF-Token'],'restored-token');
  assert.equal(JSON.parse(delivered.options.body).eventId,'queued');
  assert.equal(f.calls.some(c=>c.path==='/api/audience/join'),false);
});
test('recovery and a manual join share a pending lookup without overwriting the joined identity',async t=>{
  let requests=0,finishLookup;
  const f=fixture(t,async path=>{
    if(path==='/api/audience/me'){
      if(++requests===1)throw new Error('offline');
      return new Promise(resolve=>{finishLookup=resolve;});
    }
    return response(path==='/api/audience/join'?{audience:{id:'joined'},csrfToken:'joined-token'}:{});
  });
  await f.client.ready;
  f.window.dispatchEvent(new Event('online'));f.document.dispatchEvent(new Event('visibilitychange'));f.intervals[0]();
  const joining=f.client.join('新昵称');await settle();assert.equal(requests,2);
  finishLookup(response({audience:null}));await joining;await settle();
  assert.equal(f.client.identity.id,'joined');
  assert.equal(f.calls.filter(c=>c.path==='/api/audience/join').length,1);
});
test('a successful anonymous lookup stays anonymous without repeated identity requests',async t=>{
  const f=fixture(t,async()=>response({audience:null}));await f.client.ready;
  f.intervals[0]();f.window.dispatchEvent(new Event('online'));await settle();
  assert.equal(f.calls.length,1);assert.equal(f.client.identity,null);
});
test('a lookup completing after disposal cannot change identity or notify the UI',async t=>{
  let finish;
  const f=fixture(t,()=>new Promise(resolve=>{finish=resolve;}));f.client.dispose();
  finish(response({audience:{id:'late'},csrfToken:'late-token'}));await f.client.ready;await settle();
  assert.equal(f.client.identity,null);assert.equal(f.identities.length,0);assert.equal(f.calls.length,1);
});
