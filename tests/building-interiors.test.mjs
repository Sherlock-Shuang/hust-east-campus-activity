import test from 'node:test';
import assert from 'node:assert/strict';
import {nearbyInterior,crossedInteriorDoor,interiorReturnSnapshot} from '../src/building-interiors.js';
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
const door={id:'opto-c118-main',x:0,z:-.65,y:2.82,radius:2,doorGate:{center:{x:0,z:0},normal:{x:0,z:1},halfWidth:2.4,frontDepth:1.8,backDepth:2.2},returnPose:{x:0,z:1.5,y:2.82}};
const walker=(x,z,changes={})=>({x,z,y:2.82,mode:'walk',grounded:true,...changes});
test('door admission uses the actual raised doorway, not a circle through walls or underneath its floor',()=>{
  assert.equal(nearbyInterior([door],walker(0,1)).id,door.id);
  for(const state of [walker(3,0),walker(0,3),walker(0,0,{y:.14}),walker(0,0,{grounded:false}),walker(0,0,{mode:'scooter'}),walker(0,-3)])assert.equal(nearbyInterior([door],state),null);
  assert.equal(nearbyInterior([{...door,doorGate:{}}],walker(0,0)),null);
});
test('only an outside-to-inside walk through the clear doorway auto-enters the hall',()=>{
  const before=walker(.2,.8),inside=walker(.2,-.2);
  assert.equal(crossedInteriorDoor([door],before,inside).workId,'opto-c118');
  assert.equal(crossedInteriorDoor([door],walker(0,.1,{mode:'spider'}),walker(0,-2.8,{mode:'spider'})).id,door.id,'fast grounded crossing is detected by its plane intersection, not the final trigger radius');
  for(const [a,b] of [[null,inside],[inside,inside],[inside,before],[walker(3,.8),walker(3,-.2)],[before,{...inside,y:5}],[before,{...inside,grounded:false}],[before,{...inside,mode:'spider'}],[walker(0,30),inside]])assert.equal(crossedInteriorDoor([door],a,b),null);
  const rotated={...door,doorGate:{...door.doorGate,normal:{x:1,z:0}},x:-.65,z:0};
  assert.equal(crossedInteriorDoor([rotated],walker(.8,.2),walker(-.2,.2)).id,door.id);
});
test('return preserves character and camera while clearing momentum and placing the walker outside the same door',()=>{
  const saved={mode:'spider',view:'third',pitch:.2,lookHeading:1.2,state:{...walker(0,-.2),yaw:1,vx:3,vz:2,verticalSpeed:4,speed:5}},snapshot=JSON.stringify(saved);
  const returned=interiorReturnSnapshot(saved,door);
  assert.equal(returned.mode,saved.mode);assert.equal(returned.view,'third');assert.equal(returned.lookHeading,1.2);
  assert.equal(returned.state.z,1.5);assert.equal(returned.state.y,2.82);assert.equal(returned.state.speed,0);
  assert.equal(crossedInteriorDoor([door],null,returned.state),null);
  assert.equal(JSON.stringify(saved),snapshot,'saved pose is not mutated');
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
  assert.ok(nav.state.x>x+4);assert.ok(Math.abs(nav.state.y-plan.spawn.y)<.01);
  nav.suspend();assert.equal(nav.state.speed,0);assert.equal(nav.state.vx,0);
});
test('walking through either side door returns instead of entering the unmodelled exterior void',()=>{
  const plan=planOptoC118Interior();assert.equal(crossedC118Door(plan,plan.spawn),false);
  for(const door of plan.doors){
    const side=door.side??Math.sign(door.x),state={x:side*(plan.config.width/2+.4),z:door.z,y:door.y};
    assert.equal(crossedC118Door(plan,state),true,door.id);
    assert.equal(crossedC118Door(plan,{...state,y:door.y+1}),false,'flying above a doorway is not an exit');
  }
  assert.equal(crossedC118Door(plan,{x:11.5,z:0}),false);
});

test('local door viewpoints are preserved, arbitrary interior URLs are not accepted',()=>{
  for(const view of ['westEntry','eastEntry','rearEntry'])assert.equal(nearbyInterior([{...door,url:`./c118.html?view=${view}`}],walker(0,1)).url,`./c118.html?view=${view}`);
  assert.equal(nearbyInterior([{...door,url:'https://example.com/'}],walker(0,1)).url,'./c118.html');
});
