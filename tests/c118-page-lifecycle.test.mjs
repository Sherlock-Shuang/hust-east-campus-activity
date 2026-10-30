import test from 'node:test';
import assert from 'node:assert/strict';
import {createC118PageLifecycle} from '../src/c118-page-lifecycle.js';

function fixture(){
  const window=new EventTarget(),calls=[];
  const lifecycle=createC118PageLifecycle({window,onSuspend:()=>calls.push('suspend'),onResume:()=>calls.push('resume'),onDispose:()=>{calls.push('dispose');lifecycle.dispose();}});
  const emit=(type,persisted)=>{const event=new Event(type);event.persisted=persisted;window.dispatchEvent(event);};
  return {lifecycle,calls,emit};
}

test('BFCache pauses and restores the existing room without disposing its resources',()=>{
  const f=fixture();f.emit('pageshow',false);assert.deepEqual(f.calls,[]);
  f.emit('pagehide',true);f.emit('pagehide',true);assert.equal(f.lifecycle.suspended,true);assert.deepEqual(f.calls,['suspend']);
  f.emit('pageshow',false);assert.equal(f.lifecycle.suspended,true);
  f.emit('pageshow',true);f.emit('pageshow',true);assert.equal(f.lifecycle.suspended,false);assert.deepEqual(f.calls,['suspend','resume']);
  f.emit('pagehide',true);f.emit('pageshow',true);assert.deepEqual(f.calls,['suspend','resume','suspend','resume']);f.lifecycle.dispose();
});

test('real unload releases the room once and late pageshow cannot revive it',()=>{
  const f=fixture();f.emit('pagehide',false);f.emit('pagehide',false);f.emit('pageshow',true);assert.deepEqual(f.calls,['dispose']);
  f.lifecycle.dispose();f.lifecycle.dispose();assert.deepEqual(f.calls,['dispose']);
});

test('closing a cached embedded room removes resume callbacks',()=>{
  const f=fixture();f.emit('pagehide',true);f.lifecycle.dispose();f.emit('pageshow',true);f.emit('pagehide',false);
  assert.deepEqual(f.calls,['suspend']);
});
