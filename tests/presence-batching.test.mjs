import test from 'node:test';
import assert from 'node:assert/strict';
import {createAudienceStore} from '../server/audience-store.mjs';

test('presence batching keeps live state immediate, but exploration acknowledgements remain durable',async()=>{
  const writes=[];let time=100;
  const s=createAudienceStore({now:()=>time,idFactory:()=> 'viewer',presenceFlushMs:5000,persist:async data=>writes.push(structuredClone(data))});
  await s.join({identityHash:'a'.repeat(64),nickname:'验收',tabId:'tab'});
  for(let i=0;i<100;i++){time++;await s.heartbeat('viewer','tab');}
  assert.equal(s.get('viewer').lastSeenAt,200);assert.equal(writes.length,1);
  const point={id:'point',workId:'work',x:0,z:0,radius:10,enabled:true};
  await s.event('viewer',{type:'visit',eventId:'visit',tabId:'tab',pointId:'point',position:{x:0,y:0,z:0}},{points:[point]});
  assert.equal(writes.length,2);assert.equal(writes[1].audiences.viewer.lastSeenAt,200);
  assert.equal(writes[1].audiences.viewer.events.length,1);await s.flush();assert.equal(writes.length,2);
  time=300;await s.heartbeat('viewer','tab');await s.flush();assert.equal(writes.length,3);assert.equal(writes[2].audiences.viewer.lastSeenAt,300);
});
test('a failed presence save remains retryable and cannot discard durable exploration',async()=>{
  let fail=false;const s=createAudienceStore({idFactory:()=> 'viewer',presenceFlushMs:5000,persist:async()=>{if(fail)throw Error('disk');}});
  await s.join({identityHash:'a'.repeat(64),nickname:'验收',tabId:'tab'});await s.heartbeat('viewer','tab');fail=true;
  await assert.rejects(s.flush(),/disk/);assert.equal(s.get('viewer').nickname,'验收');fail=false;await s.flush();
});
