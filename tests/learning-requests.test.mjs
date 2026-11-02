import test from 'node:test';
import assert from 'node:assert/strict';
import {LEARNING_BOARD} from '../src/activity-catalog.js';
import {createAudienceRecord,createAudienceStore,applyAudienceEvent,normalizeLearningRequest,audienceLearningRequests,aggregateLearningRequests,validateAudienceData} from '../server/audience-store.mjs';

const record=()=>createAudienceRecord({id:'visitor-one',identityHash:'a'.repeat(64),nickname:'小华'},1000);
const event=(extra={})=>({eventId:'wish-one',tabId:'tab-one',type:'learning_request',text:'我想学 AI 视频剪辑',position:{x:LEARNING_BOARD.x,y:LEARNING_BOARD.y,z:LEARNING_BOARD.z},...extra});

test('learning request validation accepts normal multiline Unicode text and rejects empty, oversized or control text',()=>{
  assert.equal(normalizeLearningRequest('  我想学 AI\r\n文件整理  '),'我想学 AI\n文件整理');
  assert.equal([...normalizeLearningRequest('😀'.repeat(300))].length,300);
  for(const value of ['', ' \n ', '学'.repeat(301), '😀'.repeat(301), '剪辑\u0000视频', {}, null])assert.throws(()=>normalizeLearningRequest(value));
  // The API keeps content as text; its consumers must use textContent, not HTML.
  assert.equal(normalizeLearningRequest('<script>plain text</script>'),'<script>plain text</script>');
});

test('only visitors beside the board may submit; pause, spam and per-person limits preserve state and retries stay idempotent',()=>{
  const initial=record();
  for(const position of [null,{...event().position,x:LEARNING_BOARD.x+LEARNING_BOARD.radius+1},{...event().position,y:LEARNING_BOARD.maxPlayerY+1},{...event().position,y:LEARNING_BOARD.y-2},{...event().position,x:NaN}])assert.throws(()=>applyAudienceEvent(initial,event({position}),{now:2000}));
  assert.throws(()=>applyAudienceEvent(initial,event(),{paused:true,now:2000}),error=>error.status===409);
  const first=applyAudienceEvent(initial,event(),{now:2000});
  assert.equal(initial.learningRequests.length,0);assert.equal(first.record.learningRequests.length,1);
  assert.deepEqual(audienceLearningRequests(first.record),[{id:'wish-one',text:'我想学 AI 视频剪辑',createdAt:2000}]);
  assert.equal(first.record.events[0].pointId,LEARNING_BOARD.id);
  assert.throws(()=>applyAudienceEvent(first.record,event({eventId:'spam'}),{now:2001}),error=>error.status===429);
  assert.equal(applyAudienceEvent(first.record,event({position:null}),{paused:true,now:2001}).duplicate,true);
  let current=first.record;
  for(let i=1;i<20;i++)current=applyAudienceEvent(current,event({eventId:`wish-${i+1}`}),{now:2000+i*5000}).record;
  assert.throws(()=>applyAudienceEvent(current,event({eventId:'overflow'}),{now:200000}),error=>error.status===409);
  assert.equal(current.learningRequests.length,20);
  assert.equal(applyAudienceEvent(current,event(),{paused:true,now:200001}).duplicate,true);
});

test('legacy audience records gain an empty collection; private learning lists and global search cannot leak credentials',()=>{
  const legacy=record();delete legacy.learningRequests;
  const restored=validateAudienceData({schemaVersion:1,audiences:{[legacy.id]:legacy}});
  assert.deepEqual(restored.audiences[legacy.id].learningRequests,[]);assert.equal(legacy.learningRequests,undefined);
  const first=applyAudienceEvent(legacy,event(),{now:2000}).record;
  const second=applyAudienceEvent({...record(),id:'visitor-two',nickname:'小明'},event({text:'环境配置',eventId:'wish-two'}),{now:3000}).record;
  const matched=aggregateLearningRequests([first,second],{query:'AI'});
  assert.equal(matched.total,2);assert.equal(matched.participants,2);assert.equal(matched.messages.length,1);assert.equal(matched.messages[0].audienceId,first.id);
  assert.equal(aggregateLearningRequests([first,second],{query:'小明'}).messages[0].text,'环境配置');
  assert.equal(aggregateLearningRequests([first,second]).messages[0].id,'wish-two');
  assert.ok(!JSON.stringify(matched).includes('identityHash'));
  const own=audienceLearningRequests(first);own[0].text='changed';assert.equal(first.learningRequests[0].text,'我想学 AI 视频剪辑');
});

test('learning requests become visible only after persistence and survive a store restart',async()=>{
  let time=1000,shouldFail=false,durable;
  const store=createAudienceStore({idFactory:()=> 'visitor-one',now:()=>time,persist:async value=>{if(shouldFail)throw Error('disk full');durable=structuredClone(value);}});
  await store.join({identityHash:'a'.repeat(64),nickname:'小华',tabId:'tab-one'});
  shouldFail=true;await assert.rejects(store.event('visitor-one',event()),/disk full/);assert.equal(store.learningRequests().total,0);
  shouldFail=false;time=2000;await store.event('visitor-one',event());
  const restarted=createAudienceStore({initial:durable,now:()=>3000});
  assert.equal(restarted.learningRequests().messages[0].text,'我想学 AI 视频剪辑');
  assert.equal((await restarted.event('visitor-one',event())).duplicate,true);
  assert.equal(restarted.learningRequests().total,1);
});
