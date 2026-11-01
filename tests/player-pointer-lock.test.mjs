import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlayerPointerLock} from '../src/player-pointer-lock.js';

class Clock {
  now=0;next=0;jobs=new Map();
  setTimeout(fn,delay){const id=++this.next;this.jobs.set(id,{at:this.now+delay,fn});return id;}
  clearTimeout(id){this.jobs.delete(id);}
  advance(ms){const end=this.now+ms;while(true){const next=[...this.jobs].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;this.now=next[1].at;this.jobs.delete(next[0]);next[1].fn();}this.now=end;}
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function fixture(t,{promise=false,prefix='',exitPrefix=prefix,propertyPrefix=prefix,eventPrefix=prefix,install=true,exitEvent=true,requestBehavior}={}){
  const document=new EventTarget(),window=new EventTarget(),canvas={},clock=new Clock(),events=[],errors=[],pending=[],observed=[],requests=[];
  const property=propertyPrefix?`${propertyPrefix}PointerLockElement`:'pointerLockElement';
  const requestName=prefix?`${prefix}RequestPointerLock`:'requestPointerLock';
  const exitName=exitPrefix?`${exitPrefix}ExitPointerLock`:'exitPointerLock';
  const changeEvent=`${eventPrefix}pointerlockchange`,errorEvent=`${eventPrefix}pointerlockerror`;
  document.defaultView=window;document.hidden=false;document[property]=null;let allowed=true,exits=0;
  const installAPI=()=>{
    canvas[requestName]=function(){assert.equal(this,canvas);const record={};requests.push(record);if(requestBehavior)return requestBehavior({document,canvas,record,changeEvent,errorEvent,property});if(promise)return new Promise((resolve,reject)=>Object.assign(record,{resolve,reject}));};
    document[exitName]=function(){assert.equal(this,document);exits++;document[property]=null;if(exitEvent)document.dispatchEvent(new Event(changeEvent));};
  };
  if(install)installAPI();
  const lock=createPlayerPointerLock({canvas,document,canLock:()=>allowed,onChange:value=>{events.push(value);observed.push({kind:'change',value,locked:lock.locked,pending:lock.pending});},onError:error=>errors.push(error),onPendingChange:value=>{pending.push(value);observed.push({kind:'pending',value,locked:lock.locked,pending:lock.pending});},requestTimeoutMs:100,timers:clock});
  t.after(()=>{lock.dispose();assert.equal(clock.jobs.size,0,'dispose clears every deadline');});
  return {lock,canvas,document,window,clock,events,errors,pending,observed,requests,installAPI,property,get exits(){return exits;},deny(){allowed=false;},
    grant({event=true}={}){document[property]=canvas;if(event)document.dispatchEvent(new Event(changeEvent));},
    error(reason){const event=new Event(errorEvent);if(reason)event.error=reason;document.dispatchEvent(event);},
    resolve(index=requests.length-1){requests[index].resolve?.();},reject(reason=new Error('blocked'),index=requests.length-1){requests[index].reject?.(reason);}};
}

test('event-only lock waits for the browser element and ignores duplicate requests',t=>{
  const f=fixture(t);f.lock.request();f.lock.request();assert.equal(f.requests.length,1);assert.equal(f.lock.pending,true);assert.equal(f.lock.locked,false);
  f.document.dispatchEvent(new Event('pointerlockchange'));assert.equal(f.lock.pending,true,'an unrelated change is not a grant');
  f.grant();assert.deepEqual(f.events,[true]);assert.equal(f.lock.pending,false);assert.deepEqual(f.pending,[true,false]);assert.equal(f.clock.jobs.size,0);
  f.grant();assert.deepEqual(f.events,[true],'duplicate aliases must not repeat confirmation');
  f.lock.release();assert.equal(f.lock.locked,false);assert.deepEqual(f.events,[true,false]);
});

test('a missing terminal event has a deadline and a later user action can retry',t=>{
  const f=fixture(t);f.lock.request();f.clock.advance(99);assert.equal(f.lock.pending,true);f.clock.advance(1);
  assert.equal(f.lock.pending,false);assert.equal(f.lock.locked,false);assert.equal(f.lock.error.name,'PointerLockTimeoutError');assert.equal(f.errors.length,1);
  f.clock.advance(1000);assert.equal(f.requests.length,1,'a deadline never requests permission automatically');
  f.lock.request();assert.equal(f.requests.length,2);assert.equal(f.lock.error,null);assert.equal(f.lock.pending,true);f.grant();assert.equal(f.lock.locked,true);
});

test('cancelling a silent request does not block a new user request indefinitely',t=>{
  const f=fixture(t);f.lock.toggle();f.lock.toggle();assert.equal(f.lock.pending,false);assert.equal(f.clock.jobs.size,0);
  f.lock.toggle();assert.equal(f.requests.length,2);assert.equal(f.lock.pending,true);f.grant();assert.equal(f.lock.locked,true);
});

test('Promise resolution without a change event confirms only the real locked element',async t=>{
  const f=fixture(t,{promise:true});f.lock.request();f.grant({event:false});f.resolve();await flush();
  assert.equal(f.lock.locked,true);assert.equal(f.lock.pending,false);assert.deepEqual(f.events,[true]);assert.equal(f.clock.jobs.size,0);
});

test('a fulfilled Promise without an owned element is never optimistic success',async t=>{
  const f=fixture(t,{promise:true});f.lock.request();f.resolve();await flush();
  assert.equal(f.lock.locked,false);assert.equal(f.lock.pending,true);assert.deepEqual(f.events,[]);
  f.clock.advance(100);assert.equal(f.lock.pending,false);assert.equal(f.lock.error.name,'PointerLockTimeoutError');
  f.lock.request();assert.equal(f.requests.length,2);f.grant();assert.equal(f.lock.locked,true);
});

test('the deadline checks real ownership when an event-only browser omits change',t=>{
  const f=fixture(t);f.lock.request();f.grant({event:false});f.clock.advance(100);
  assert.equal(f.lock.pending,false);assert.deepEqual(f.events,[true]);assert.equal(f.lock.error,null);
});

for(const promise of [false,true])test(`a late permission grant after timeout remains allowed (${promise?'Promise':'events'})`,async t=>{
  const f=fixture(t,{promise});f.lock.request();f.clock.advance(100);assert.equal(f.lock.pending,false);assert.equal(f.lock.error.name,'PointerLockTimeoutError');
  f.grant();f.resolve();await flush();assert.equal(f.lock.locked,true);assert.equal(f.exits,0);assert.equal(f.lock.error,null);assert.equal(f.events.at(-1),true);
});

for(const cancel of ['release','blur','hidden','dispose','inactive'])test(`a late grant after ${cancel} is released, including after timeout`,t=>{
  const f=fixture(t);f.lock.request();f.clock.advance(100);
  if(cancel==='release')f.lock.release();else if(cancel==='blur')f.window.dispatchEvent(new Event('blur'));else if(cancel==='hidden'){f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));}else if(cancel==='dispose')f.lock.dispose();else f.deny();
  const before={events:f.events.length,errors:f.errors.length,pending:f.pending.length};f.grant();
  assert.equal(f.lock.locked,false);assert.equal(f.exits,1);assert.ok(!f.events.includes(true));
  if(cancel==='dispose')assert.deepEqual({events:f.events.length,errors:f.errors.length,pending:f.pending.length},before,'disposed helpers never update their old UI');
});

test('disposal during a request guards the late grant without UI callbacks',t=>{
  const f=fixture(t);f.lock.request();f.lock.dispose();f.clock.advance(1000);f.grant();
  assert.equal(f.lock.locked,false);assert.deepEqual(f.events,[]);assert.deepEqual(f.errors,[]);assert.deepEqual(f.pending,[true]);
});

test('pending feedback reads the actual unlocked state when a grant is no longer allowed',t=>{
  const f=fixture(t);f.lock.request();f.deny();f.grant();
  assert.equal(f.lock.pending,false);assert.equal(f.lock.locked,false);
  assert.ok(f.observed.every(snapshot=>!snapshot.locked),'a rejected synchronous grant never publishes a locked UI snapshot');
  assert.equal(f.observed.findLast(snapshot=>snapshot.kind==='pending').locked,false);
});

test('an asynchronous rejected grant publishes false after the browser finishes exiting',t=>{
  const f=fixture(t);f.document.exitPointerLock=()=>{};f.lock.request();f.deny();f.grant();
  assert.equal(f.lock.locked,true,'ownership remains real until the browser finishes exit');
  f.document[f.property]=null;f.document.dispatchEvent(new Event('pointerlockchange'));
  assert.equal(f.observed.at(-1).locked,false);assert.equal(f.observed.at(-1).kind,'change');assert.ok(!f.events.includes(true));
});

for(const promise of [false,true])for(const cancel of ['timeout','release'])test(`overlapping ${promise?'Promise':'event'} requests preserve both late-grant guards after ${cancel}`,async t=>{
  const f=fixture(t,{promise});f.lock.request();
  if(cancel==='timeout')f.clock.advance(100);else f.lock.release();
  f.lock.request();assert.equal(f.requests.length,2);f.grant();f.resolve(0);await flush();
  f.lock.release();f.lock.dispose();const before={events:f.events.length,errors:f.errors.length,pending:f.pending.length};
  f.grant();f.resolve(1);await flush();
  assert.equal(f.lock.locked,false,'disposing after the first grant still releases the second request’s later grant');assert.equal(f.exits,2);
  assert.deepEqual({events:f.events.length,errors:f.errors.length,pending:f.pending.length},before);
});

test('an old event-only failure does not cancel a replacement request',t=>{
  const f=fixture(t);f.lock.request();f.lock.release();f.lock.request();f.error();
  assert.equal(f.lock.pending,true);assert.equal(f.errors.length,0);f.grant();assert.equal(f.lock.locked,true);
});

test('Promise rejection preserves browser details and permits a user retry',async t=>{
  const f=fixture(t,{promise:true}),reason=Object.assign(new Error('User activation is required.'),{name:'NotAllowedError'});
  f.lock.request();f.reject(reason);await flush();f.error();assert.equal(f.errors.length,1);assert.equal(f.lock.error,reason);assert.equal(f.lock.pending,false);
  f.lock.request();assert.equal(f.requests.length,2);assert.equal(f.lock.error,null);f.grant();assert.equal(f.lock.locked,true);
});

test('the previous rejection companion error cannot cancel the next Promise request',async t=>{
  const f=fixture(t,{promise:true});f.lock.request();f.reject();await flush();f.lock.request();f.error();
  assert.equal(f.lock.pending,true);assert.equal(f.errors.length,1);f.grant();f.resolve();await flush();assert.equal(f.lock.locked,true);assert.equal(f.exits,0);
});

test('an old cancelled Promise rejection cannot cancel or report on a new request',async t=>{
  const f=fixture(t,{promise:true});f.lock.request();f.lock.release();f.lock.request();f.reject(new Error('old cancellation'),0);await flush();f.error();
  assert.equal(f.lock.pending,true);assert.deepEqual(f.errors,[]);f.grant();assert.equal(f.lock.locked,true);
});

test('a permission rejection after the UI deadline reports the eventual browser reason',async t=>{
  const f=fixture(t,{promise:true});f.lock.request();f.clock.advance(100);f.reject({name:'SecurityError',message:'Blocked by the embedding document.'});await flush();
  assert.equal(f.lock.pending,false);assert.equal(f.lock.error.name,'SecurityError');assert.equal(f.lock.error.message,'Blocked by the embedding document.');assert.equal(f.errors.length,2);
});

test('event-only failures and synchronous throws carry useful errors and can retry',t=>{
  const f=fixture(t);f.lock.request();f.error();assert.equal(f.lock.error.name,'PointerLockError');assert.equal(f.lock.pending,false);
  f.canvas.requestPointerLock=()=>{throw Object.assign(new Error('Sandbox disallows pointer lock.'),{name:'SecurityError'});};
  f.lock.request();assert.equal(f.lock.error.name,'SecurityError');assert.equal(f.lock.pending,false);assert.equal(f.clock.jobs.size,0);
  f.installAPI();f.lock.request();f.grant();assert.equal(f.lock.locked,true);
});

test('synchronous event-only errors are handled after the return type is known',t=>{
  const f=fixture(t,{requestBehavior:({document,errorEvent})=>document.dispatchEvent(new Event(errorEvent))});
  f.lock.request();assert.equal(f.lock.pending,false);assert.equal(f.lock.error.name,'PointerLockError');assert.equal(f.clock.jobs.size,0);
});

test('unsupported detection is dynamic when the host installs methods after creation',t=>{
  const f=fixture(t,{install:false});assert.equal(f.lock.supported,false);f.lock.request();assert.equal(f.lock.error.name,'NotSupportedError');assert.equal(f.lock.pending,false);
  f.installAPI();assert.equal(f.lock.supported,true);f.lock.request();f.grant();assert.equal(f.lock.locked,true);
});

for(const options of [
  {prefix:'moz'}, {prefix:'webkit'},
  {prefix:'moz',exitPrefix:'',propertyPrefix:'',eventPrefix:''},
  {prefix:'',exitPrefix:'webkit',propertyPrefix:'webkit',eventPrefix:'webkit'},
])test(`prefixed API combinations are bound and confirmed dynamically ${JSON.stringify(options)}`,t=>{
  const f=fixture(t,{...options,install:false});assert.equal(f.lock.supported,false);f.installAPI();assert.equal(f.lock.supported,true);
  f.lock.request();assert.equal(f.requests.length,1);f.grant();assert.equal(f.lock.locked,true);assert.deepEqual(f.events,[true]);
  f.lock.release();assert.equal(f.lock.locked,false);assert.equal(f.exits,1);assert.deepEqual(f.events,[true,false]);
  f.lock.request();f.error();assert.equal(f.lock.error.name,'PointerLockError');
});

test('standard methods take precedence and are detected when added later',t=>{
  const f=fixture(t,{prefix:'webkit'});let standard=0;
  f.canvas.requestPointerLock=function(){assert.equal(this,f.canvas);standard++;};
  f.lock.request();assert.equal(standard,1);assert.equal(f.requests.length,0);f.grant();assert.equal(f.lock.locked,true);
});

test('release reflects an actual browser unlock even when its change event is omitted',t=>{
  const f=fixture(t,{exitEvent:false});f.lock.request();f.grant();f.lock.release();
  assert.equal(f.lock.locked,false);assert.deepEqual(f.events,[true,false]);
});
