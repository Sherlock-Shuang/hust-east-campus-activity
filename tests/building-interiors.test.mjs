import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyInterior} from '../src/building-interiors.js';
import {campusLandmarkArrival} from '../src/campus-landmark-arrival.js';
import {indoorMovement,createC118Navigation,crossedC118Door} from '../src/c118-navigation.js';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
const entries=[{id:'opto-c118',x:4,z:5,y:.14,radius:8}];
test('interior entry requires on-foot proximity at the actual ground elevation',()=>{
  const state={x:5,z:6,y:.14,mode:'walk'};
  assert.equal(nearbyInterior(entries,state).kind,'building-interior');
  for(const change of [{x:40},{y:10},{mode:'roadster'},{mode:'scooter'},{mode:'hoverboard'}])assert.equal(nearbyInterior(entries,{...state,...change}),null);
  assert.equal(nearbyInterior(entries,{...state,mode:'spider'}).workId,'opto-c118');
});
test('standard campus URL does not change spawn, explicit landmarks are named and bounded',()=>{
  assert.equal(campusLandmarkArrival({},'unknown'),null);
  assert.equal(campusLandmarkArrival({},null),null);
  assert.equal(campusLandmarkArrival({optoEntry:entries[0]},'opto').x,4);
});
test('C118 movement uses camera heading and original fixed step collision solver',()=>{
  assert.deepEqual(indoorMovement(0,1,0),{moveX:0,moveZ:-1});
  assert.ok(indoorMovement(-Math.PI/2,1,0).moveX>.99);
  const plan=planOptoC118Interior(),nav=createC118Navigation({plan,spawn:plan.spawn,colliders:plan.colliders,walkSurfaces:plan.walkSurfaces});
  const x=nav.state.x;
  for(let i=0;i<120;i++)nav.step(1/60,indoorMovement(-Math.PI/2,1,0));
  assert.ok(nav.state.x>x+4);assert.ok(Math.abs(nav.state.y-.14)<.01);
  nav.suspend();assert.equal(nav.state.speed,0);assert.equal(nav.state.vx,0);
});
test('walking through either side door returns instead of entering the unmodelled exterior void',()=>{
  const plan=planOptoC118Interior();assert.equal(crossedC118Door(plan,plan.spawn),false);
  for(const sign of [-1,1])assert.equal(crossedC118Door(plan,{x:sign*11.5,z:plan.doors[0].z}),true);
  assert.equal(crossedC118Door(plan,{x:11.5,z:0}),false);
});
