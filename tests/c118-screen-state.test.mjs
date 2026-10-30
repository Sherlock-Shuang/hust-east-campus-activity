import test from 'node:test';
import assert from 'node:assert/strict';
import {createDefaultLiveState,validateLiveState} from '../src/live-state.js';
import {createDefaultC118Screen,normalizeC118Screen,reconcileC118Screen} from '../src/c118-screen-state.js';

test('old persisted snapshots receive the default programme and only fixed media IDs are accepted',()=>{
  const initial=createDefaultLiveState();assert.deepEqual(initial.c118Screen,{mediaId:'vibe-coding',revision:0});
  const {c118Screen,...legacy}=initial;assert.deepEqual(validateLiveState(legacy).c118Screen,c118Screen);
  assert.deepEqual(normalizeC118Screen(undefined),createDefaultC118Screen());
  for(const value of [{mediaId:'https://bad.example/private.mp4',revision:0},{mediaId:'club-promo',revision:-1},{mediaId:'club-promo',revision:.1},{mediaId:'club-promo',revision:Infinity},[]])assert.throws(()=>normalizeC118Screen(value));
  assert.deepEqual(normalizeC118Screen({mediaId:'club-promo',revision:3,url:'ignored'}),{mediaId:'club-promo',revision:3});
});

test('ordinary edits preserve playback while each explicit switch or repeat gets exactly one new revision',()=>{
  const initial={c118Screen:createDefaultC118Screen()};
  const selected=reconcileC118Screen(initial,{c118Screen:{mediaId:'club-promo',revision:1}});
  assert.deepEqual(selected,{mediaId:'club-promo',revision:1});
  assert.deepEqual(reconcileC118Screen({c118Screen:selected},{}),selected);
  assert.deepEqual(reconcileC118Screen({c118Screen:selected},{c118Screen:selected,paused:true}),selected);
  const repeated=reconcileC118Screen({c118Screen:selected},{c118Screen:{mediaId:'club-promo',revision:2}});
  assert.deepEqual(repeated,{mediaId:'club-promo',revision:2});
  assert.deepEqual(reconcileC118Screen({c118Screen:repeated},{c118Screen:{mediaId:'vibe-coding',revision:3}}),{mediaId:'vibe-coding',revision:3});
  for(const requested of [{mediaId:'vibe-coding',revision:1},{mediaId:'club-promo',revision:0},{mediaId:'club-promo',revision:9},null])assert.throws(()=>reconcileC118Screen({c118Screen:selected},{c118Screen:requested}));
  assert.throws(()=>reconcileC118Screen({c118Screen:{mediaId:'vibe-coding',revision:Number.MAX_SAFE_INTEGER}},{c118Screen:{mediaId:'club-promo',revision:Number.MAX_SAFE_INTEGER}}));
  assert.deepEqual(initial.c118Screen,{mediaId:'vibe-coding',revision:0});
});
