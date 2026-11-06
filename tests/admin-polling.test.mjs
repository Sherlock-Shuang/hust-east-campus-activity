import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdminPolling} from '../src/admin-polling.js';

const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function fixture(t,{signedIn=true,defer=false}={}){
  let now=0,id=0,polls=0,renders=0;const timers=new Map(),pending=[];
  const document=Object.assign(new EventTarget(),{hidden:false}),window=new EventTarget();
  const polling=createAdminPolling({documentImpl:document,windowImpl:window,canPoll:()=>signedIn,
    refresh:()=>{polls++;if(defer)return new Promise(resolve=>pending.push(resolve));},render:()=>renders++,
    setTimer:(fn,delay)=>{const key=++id;timers.set(key,{fn,at:now+delay});return key;},clearTimer:key=>timers.delete(key)});
  t.after(()=>polling.dispose());
  async function advance(ms){const end=now+ms;for(;;){await settle();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;await settle();}
  return {polling,document,window,timers,pending,advance,get polls(){return polls;},get renders(){return renders;},
    visibility(hidden){document.hidden=hidden;document.dispatchEvent(new Event('visibilitychange'));},
    signedIn(value){signedIn=value;polling.sync();}};
}

test('visible admin polls once per interval and renders only while visible',async t=>{
  const f=fixture(t);await f.advance(4999);assert.equal(f.polls,0);assert.equal(f.renders,5);
  await f.advance(1);assert.equal(f.polls,1);await f.advance(5000);assert.equal(f.polls,2);
  f.visibility(true);const renders=f.renders;assert.equal(f.timers.size,0);
  await f.advance(3600000);assert.equal(f.polls,2);assert.equal(f.renders,renders);
  f.visibility(false);await settle();assert.equal(f.polls,3,'return refreshes once, without replaying every missed interval');
  await f.advance(4999);assert.equal(f.polls,3);await f.advance(1);assert.equal(f.polls,4);
});

test('hide during a request cannot re-arm timers; foreground catch-up waits for the pending request',async t=>{
  const f=fixture(t,{defer:true});await f.advance(5000);assert.equal(f.polls,1);
  f.visibility(true);await f.advance(300000);assert.equal(f.polls,1);assert.equal(f.timers.size,0);
  f.visibility(false);f.visibility(false);assert.equal(f.polls,1,'visibility events never overlap an in-flight request');
  f.pending.shift()();await settle();assert.equal(f.polls,2,'one current snapshot is requested after the old request settles');
  f.pending.shift()();await settle();await f.advance(5000);assert.equal(f.polls,3);
  f.visibility(true);f.pending.shift()();await settle();assert.equal(f.timers.size,0,'late completion while hidden stays idle');
});

test('signed-out pages and BFCache entries remain idle and wake once after return',async t=>{
  const f=fixture(t,{signedIn:false});await f.advance(60000);assert.equal(f.polls,0);assert.equal(f.renders,0);assert.equal(f.timers.size,0);
  f.signedIn(true);await f.advance(5000);assert.equal(f.polls,1);
  f.window.dispatchEvent(new Event('pagehide'));await f.advance(60000);assert.equal(f.polls,1);assert.equal(f.timers.size,0);
  f.window.dispatchEvent(new Event('pageshow'));await settle();assert.equal(f.polls,2);
  f.signedIn(false);await f.advance(60000);assert.equal(f.polls,2);assert.equal(f.timers.size,0);
});

test('dispose during a refresh prevents late scheduling and removes page event reactions',async t=>{
  const f=fixture(t,{defer:true});await f.advance(5000);f.polling.dispose();f.pending.shift()();await settle();
  f.visibility(false);f.window.dispatchEvent(new Event('pageshow'));await f.advance(60000);
  assert.equal(f.polls,1);assert.equal(f.timers.size,0);
});
