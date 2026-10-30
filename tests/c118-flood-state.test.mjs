import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeC118Flood,reconcileC118Flood,getC118FloodElapsed} from '../src/c118-flood-state.js';
import {createDefaultLiveState,validateLiveState} from '../src/live-state.js';

const event={id:'test-flood',startAt:103000,pausedAt:null,pausedMs:0};
test('legacy states normalize dry, while flood state rejects invalid ids and time values',()=>{
  const legacy=createDefaultLiveState();delete legacy.c118Flood;
  assert.equal(validateLiveState(legacy).c118Flood,null);
  assert.equal(normalizeC118Flood(null),null);assert.equal(normalizeC118Flood(undefined),null);
  assert.deepEqual(normalizeC118Flood({...event,extra:'ignored'}),event);
  for(const invalid of [false,1,'event',[],{}, {...event,id:'../bad'}, {...event,id:'x'.repeat(65)},
    {...event,startAt:Infinity},{...event,startAt:-1},{...event,startAt:1.5},
    {...event,pausedAt:'103001'},{...event,pausedMs:NaN},{...event,pausedMs:-1}]){
    assert.throws(()=>normalizeC118Flood(invalid),/C118海啸/);
  }
});

test('new events get one server-scheduled countdown and copied client time cannot change it',()=>{
  const dry=createDefaultLiveState(),requested={...dry,c118Flood:{...event,startAt:1,pausedMs:999,pausedAt:2}};
  const started=reconcileC118Flood(dry,requested,100000);assert.deepEqual(started,event);
  assert.equal(getC118FloodElapsed(started,100000),-3);assert.equal(getC118FloodElapsed(started,103000),0);
  const running={...dry,c118Flood:started};
  assert.deepEqual(reconcileC118Flood(running,requested,110000),started);
  const restart=reconcileC118Flood(running,{...requested,c118Flood:{...event,id:'next'}},110000);
  assert.deepEqual(restart,{...event,id:'next',startAt:113000});
  assert.equal(getC118FloodElapsed(null,200000),null);
});

test('global pause freezes both countdown and flood progression across repeated saves',()=>{
  const dry=createDefaultLiveState();
  let state={...dry,paused:true,c118Flood:reconcileC118Flood(dry,{...dry,paused:true,c118Flood:event},100000)};
  assert.equal(getC118FloodElapsed(state.c118Flood,200000),-3);
  const resumed=reconcileC118Flood(state,{...state,paused:false},200000);
  assert.equal(resumed.pausedMs,100000);assert.equal(resumed.pausedAt,null);
  assert.equal(getC118FloodElapsed(resumed,200000),-3);assert.equal(getC118FloodElapsed(resumed,208000),5);
  state={...dry,c118Flood:resumed};
  const paused=reconcileC118Flood(state,{...state,paused:true},208000);
  assert.equal(getC118FloodElapsed(paused,210000),5);
  const twice=reconcileC118Flood({...state,paused:true,c118Flood:paused},{...state,paused:true},211000);
  assert.deepEqual(twice,paused,'unrelated saves do not move the pause instant');
  const continued=reconcileC118Flood({...state,paused:true,c118Flood:paused},state,218000);
  assert.equal(continued.pausedMs,110000);assert.equal(getC118FloodElapsed(continued,219000),6);
});

test('legacy missing field preserves the current event, explicit null restores dry state',()=>{
  const running={...createDefaultLiveState(),c118Flood:event};
  const {c118Flood,...legacy}=running;
  assert.deepEqual(reconcileC118Flood(running,legacy,110000),event);
  assert.equal(reconcileC118Flood(running,{...running,c118Flood:null},110000),null);
  assert.equal(running.c118Flood,event,'input state is never mutated');
});
