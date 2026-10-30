import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as THREE from 'three';
import {openActivityLibraryDoor,openActivityLibraryDocument,ACTIVITY_DOOR_HINT} from './activity-door.mjs';
import {blocked,movePlayer,setExitLocked,createMotion,OBSTACLES} from '../../work-assets/library/hub/physics.mjs';
import {routeToWorld,outsideExitDoor} from '../../work-assets/library/hub/route-config.mjs';
import {normalizeJourney,exitUnlocked,journeyText,completeGame} from '../../work-assets/library/hub/journey.mjs';
import {StoryClock} from '../../work-assets/library/hub/story-flow.mjs';

const main=await readFile(new URL('../../work-assets/library/hub/main.mjs',import.meta.url),'utf8');
const match=pattern=>{const result=main.match(pattern);assert(result,`Missing production code: ${pattern}`);return result[0];};
const constant=match(/^const ACTIVITY_GATE_ANGLE=.*;$/m);
const initialCollision=match(/^setExitLocked\(false\);$/m);
const gateCreation=match(/^const gateLeaf=.*;$/m);
function gateFixture(){
  const nodes=new Map(),resetDialog={returnValue:'reset'};
  const noop=()=>{};
  const context=vm.createContext({THREE,Math,exitDoor:new THREE.Group(),journey:normalizeJourney(null),setExitLocked,exitUnlocked,journeyText,normalizeJourney,createMotion,player:createMotion(),dt:.05,
    document:{documentElement:{dataset:{}}},$:selector=>{if(selector==='#reset-dialog')return resetDialog;if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);},
    updateJourneyStart:noop,controlBoundary:noop,cancelOpening:noop,phone:{reset:noop},storyClock:new StoryClock(),fireworks:{reset:noop},updateNight:noop,stop:noop,updateCamera:noop,save:noop,notice:noop,performance:{now:()=>100},historyContext:'',yaw:0,pitch:0,started:false,paused:true,lastPause:0});
  vm.runInContext([constant,initialCollision,gateCreation,'globalThis.leaf=gateLeaf;'].join('\n'),context);
  vm.runInContext(match(/function updateJourney\(\)\{[\s\S]*?\n\}/),context);
  return context;
}

test('actual activity door opens its 3D leaf and collision before either game is completed',()=>{
  setExitLocked(true);
  const context=gateFixture();
  assert.equal(context.leaf.rotation.y,Math.PI/2);
  assert.equal(OBSTACLES.some(obstacle=>obstacle.id==='journey-exit-door'),false);
  vm.runInContext('updateJourney()',context);
  assert.equal(context.document.documentElement.dataset.exitUnlocked,'true');
  assert.equal(context.document.documentElement.dataset.storyExitUnlocked,'false');
  assert.deepEqual(context.journey.completed,{isaac:false,wanyan:false});
});

test('production reset and frame updates keep the physical gate open without granting victories',()=>{
  const context=gateFixture();
  context.journey=completeGame(completeGame(context.journey,'isaac'),'wanyan');
  setExitLocked(true);context.leaf.rotation.y=0;
  const reset=match(/\$\('#reset-dialog'\)\.addEventListener\('close',\(\)=>\{[\s\S]*?\n\}\);/);
  vm.runInContext(reset.replace(/^.*?=>\{/,'(()=>{').replace(/\}\);$/,'})();'),context);
  assert.equal(context.leaf.rotation.y,Math.PI/2);
  assert.equal(OBSTACLES.some(obstacle=>obstacle.id==='journey-exit-door'),false);
  assert.deepEqual(context.journey.completed,{isaac:false,wanyan:false});
  vm.runInContext(match(/const target=.*?;gateAngle=.*?;gateLeaf\.rotation\.y=gateAngle;/),context);
  assert.equal(context.leaf.rotation.y,Math.PI/2);
});

test('the real movement solver crosses the doorway both ways with a fresh journey',()=>{
  const inside=routeToWorld(0,-1),outside=routeToWorld(0,1.5);
  setExitLocked(true);
  const stopped=movePlayer(inside,outside.x-inside.x,outside.z-inside.z);
  assert.equal(outsideExitDoor(stopped.x,stopped.z),false,'baseline locked collider must obstruct the doorway');
  gateFixture();
  assert.equal(blocked(inside.x,inside.z),false);
  const crossed=movePlayer(inside,outside.x-inside.x,outside.z-inside.z);
  assert(Math.hypot(crossed.x-outside.x,crossed.z-outside.z)<1e-8,'open doorway must permit the full outward movement');
  const returned=movePlayer(crossed,inside.x-crossed.x,inside.z-crossed.z);
  assert(Math.hypot(returned.x-inside.x,returned.z-inside.z)<1e-8,'open doorway must permit returning indoors');
});

test('a saved outdoor pose restores without changing story completion',()=>{
  gateFixture();
  const pose={...routeToWorld(0,2),yaw:.4,pitch:-.1};
  assert.equal(blocked(pose.x,pose.z),false);
  const journey=normalizeJourney(null),player=createMotion();
  const context=vm.createContext({stored:{pose},player,journey,blocked,exitUnlocked,THREE,Number,yaw:0,pitch:0,sessionStorage:{getItem:()=>null}});
  vm.runInContext(match(/^try\{const s=stored\.pose.*catch\{\}$/m),context);
  assert.equal(player.x,pose.x);assert.equal(player.z,pose.z);
  assert.equal(context.yaw,pose.yaw);assert.equal(context.pitch,pose.pitch);
  assert.equal(exitUnlocked(journey),false);assert.equal(journey.exited,false);
});

test('free outdoor access does not skip the games, final conversation or fireworks conditions',()=>{
  const journey=normalizeJourney({version:2,story:{intro:{status:'done'}}}),clock=new StoryClock();
  for(let index=0;index<200;index++)assert.equal(clock.tick(journey,{dt:.1,active:true,started:true,outside:true}),null);
  assert.deepEqual(journey.completed,{isaac:false,wanyan:false});
  assert.equal(journey.exited,false);assert.equal(journey.story.celebrated,false);assert.equal(journey.story.outsideSeconds,0);
  let completed=completeGame(completeGame(journey,'isaac'),'wanyan');
  completed.story.birthday.status='done';completed=normalizeJourney(completed);
  let event;for(let index=0;index<70;index++)event=clock.tick(completed,{dt:.1,active:true,started:true,outside:true});
  assert.equal(event,'celebrate','the earned ending must still work');
});

test('activity conversion is repeatable and the entry document invalidates the old door script',async()=>{
  assert.equal(openActivityLibraryDoor(main),main);
  assert.throws(()=>openActivityLibraryDoor('unrecognized source'),/Library door source changed/);
  const html=await readFile(new URL('../../work-assets/library/index.html',import.meta.url),'utf8');
  assert.equal(openActivityLibraryDocument(html),html);
  assert.match(html,/main\.mjs\?v=(?:open-door|assets-v2)-20261030/);
  const legacy='<small>唯一的密钥是一个日期</small><script src="/works/library/hub/main.mjs?v=legacy"></script>';
  assert.match(openActivityLibraryDocument(legacy),/main\.mjs\?v=open-door-20261030/);
  const future=html.replace(/main\.mjs\?v=[^"\s]+/, 'main.mjs?v=reviewed-future-generation');
  assert.equal(openActivityLibraryDocument(future),future, 'door pass must preserve newer runtime cache identifiers');
  assert(main.includes(ACTIVITY_DOOR_HINT));assert(html.includes(ACTIVITY_DOOR_HINT));
  assert(!main.includes('出口尚未打开'));
});
