import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleFloodActorPose} from '../src/campus-flood-actors.js';
import {sampleActorPose} from '../src/commute-actors.js';
const flood={id:'wave',elapsed:100};
test('people and vehicles rise, drift and tilt using the shared flood surface without changing their dry pose',()=>{
 for(const kind of ['walk','scooter','roadster','hoverboard','boat','helicopter']){
  const a={id:12,kind,x:1400,y:.14,z:0,yaw:.2},copy={...a},p=sampleFloodActorPose(a,flood);
  assert.ok(p.y>6,kind);assert.ok(p.z<a.z,kind);assert.ok(p.flooded);assert.deepEqual(a,copy);
  assert.notDeepEqual(sampleFloodActorPose(a,{...flood,elapsed:101}),p);
  assert.equal(sampleFloodActorPose(a,null),a);
  assert.deepEqual(sampleFloodActorPose(a,{...flood,paused:true}),p,'fixed event time freezes buoyancy');
 }
});
test('dry streets, high aircraft and roofs do not float, and reduced motion keeps water support',()=>{
 const a={id:12,kind:'walk',x:1400,y:.14,z:0};
 assert.equal(sampleFloodActorPose(a,{...flood,elapsed:0}),a);
 const high={...a,y:45,kind:'helicopter'};assert.equal(sampleFloodActorPose(high,flood),high);
 const reduced=sampleFloodActorPose(a,{...flood,reducedMotion:true});assert.ok(reduced.y>7);assert.equal(reduced.z,a.z);
});
test('floating pedestrians use alternating swimming strokes instead of their dry standing rig',()=>{
 const a={id:12,kind:'walk',x:1400,y:.14,z:0,speed:0};
 const dry=sampleActorPose(a,'walk'),wet=sampleActorPose(sampleFloodActorPose(a,flood),'walk');
 assert.notDeepEqual(wet.points.handL,dry.points.handL);assert.notDeepEqual(wet.points.handL,wet.points.handR);
});
