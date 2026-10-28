import test from 'node:test';
import assert from 'node:assert/strict';
import {activityPortals} from '../src/activity-catalog.js';
import {isEventActive,validateLiveState,createDefaultLiveState} from '../src/live-state.js';
import {selectActivitiesNow,activitySelectionSignature} from '../src/activity-launch.js';
import {createAudienceRecord,applyAudienceEvent} from '../server/audience-store.mjs';

test('new activities have no beacons or admission until the host explicitly opens them',()=>{
  const portals=activityPortals();assert.equal(portals.length,3);
  assert.ok(portals.every(p=>p.enabled===false&&!isEventActive(p)));
  const record=createAudienceRecord({id:'viewer',identityHash:'a'.repeat(64),nickname:'观众'},100);
  const point=portals[0],event={eventId:'closed-visit',type:'visit',tabId:'tab',pointId:point.id,position:{x:point.x,y:0,z:point.z}};
  assert.throws(()=>applyAudienceEvent(record,event,{points:portals}),/未开放/);
  assert.deepEqual(record.visits,{});
});

test('host selection atomically enables only chosen activities, clears old schedules and preserves coordinates',()=>{
  const original=activityPortals().map(p=>({...p,startAt:9999999999999,endAt:99999999999999}));
  const opened=selectActivitiesNow(original,['point-library','point-tasay']);
  assert.deepEqual(opened.map(p=>isEventActive(p)),[true,false,true]);
  assert.deepEqual(opened.map(({id,x,z,url,radius})=>({id,x,z,url,radius})),original.map(({id,x,z,url,radius})=>({id,x,z,url,radius})));
  assert.ok(original.every(p=>p.enabled===false));
  assert.ok(selectActivitiesNow(opened,[]).every(p=>!isEventActive(p)));
  assert.throws(()=>selectActivitiesNow(original,['deleted']),/已被删除/);
  const state=validateLiveState({...createDefaultLiveState(),portals:opened});
  assert.equal(state.phase.id,'explore');assert.deepEqual(state.markers,[]);
});

test('host concurrency signature covers admission and location changes',()=>{
  const points=activityPortals(),baseline=activitySelectionSignature(points);
  for(const patch of [{enabled:true},{startAt:100},{x:999},{url:'/changed/'},{radius:20}]){
    assert.notEqual(activitySelectionSignature([{...points[0],...patch},...points.slice(1)]),baseline);
  }
});

test('closing blocks new visits and openings but preserves admitted experience and its eventual return',()=>{
  const points=selectActivitiesNow(activityPortals(),['point-library']),point=points[0];
  let record=createAudienceRecord({id:'viewer',identityHash:'b'.repeat(64),nickname:'观众'},100),n=0;
  const event=type=>({eventId:`event-${++n}`,type,tabId:'tab',pointId:point.id,attemptId:'attempt',position:{x:point.x,y:0,z:point.z}});
  for(const type of ['visit','opening'])record=applyAudienceEvent(record,event(type),{points}).record;
  const closed=selectActivitiesNow(points,[]);
  assert.throws(()=>applyAudienceEvent(record,event('visit'),{points:closed}),/未开放/);
  assert.throws(()=>applyAudienceEvent(record,{...event('opening'),attemptId:'second'},{points:closed}),/未开放/);
  record=applyAudienceEvent(record,event('opened'),{points:closed}).record;
  record=applyAudienceEvent(record,event('returned'),{points:closed}).record;
  assert.equal(record.attempts.attempt.status,'returned');
  assert.equal(Object.keys(record.visits).length,1);
});
