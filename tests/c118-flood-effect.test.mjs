import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118FloodEffect,sampleC118Flood} from '../src/c118-flood-effect.js';

const plan=planOptoC118Interior();
test('flood effect follows real doors and covers the current raised rear seating without reaching the ceiling',()=>{
  const effect=createC118FloodEffect(THREE,{plan});
  const visibleDoors=effect.group.userData.doors.filter(d=>d.delay<100);
  assert.equal(visibleDoors.length,plan.doors.length);
  for(let i=0;i<visibleDoors.length;i++)assert.equal(visibleDoors[i].x,plan.doors[i].x);
  assert.ok(effect.group.userData.peakWaterLevel>plan.seatRows.at(-1).y+1.65);
  assert.ok(effect.group.userData.peakWaterLevel<plan.config.floorY+plan.config.height-1);
  assert.equal(effect.group.visible,false);
  effect.dispose();
});

test('arrival is a travelling impact from the door, while negative time is dry and the high water persists',()=>{
  const door=plan.doors.find(d=>d.tier==='front');
  const p={x:door.x-door.side*4.5,z:door.z,y:door.y+1.65};
  assert.equal(sampleC118Flood(plan,p,-3).impact,0);
  assert.equal(sampleC118Flood(plan,p,-3).submerged,false);
  assert.ok(sampleC118Flood(plan,p,2.5).impact>.9);
  assert.ok(sampleC118Flood(plan,p,4).impact<.1);
  const rear={x:0,z:plan.seatRows.at(-1).z,y:plan.seatRows.at(-1).y+1.65};
  assert.equal(sampleC118Flood(plan,rear,30).submerged,true);
  assert.equal(sampleC118Flood(plan,rear,300).submerged,true);
});

test('time jumps and rewind reproduce the same water state without per-frame accumulation',()=>{
  const effect=createC118FloodEffect(THREE,{plan}),p={x:3,z:2,y:2};
  effect.update({elapsed:6,active:true});const early=effect.sampleAt(p);
  effect.update({elapsed:90,active:true});effect.update({elapsed:6,active:true});
  assert.deepEqual(effect.sampleAt(p),early);
  effect.update({elapsed:6,active:false});assert.equal(effect.group.visible,false);
  effect.update({elapsed:6,active:true});assert.equal(effect.group.visible,true);
  assert.deepEqual(effect.sampleAt(p),early);
  effect.update({elapsed:6,active:true,reducedMotion:true});
  assert.equal(effect.group.getObjectByName('c118-door-spray').visible,false);
  effect.dispose();
});

test('all samples stay finite across the room, effect has bounded GPU resources and idempotent disposal',()=>{
  const effect=createC118FloodEffect(THREE,{plan});
  for(const t of [-3,0,1.5,2.5,6,10,18,40,1000])for(const x of [-10,0,10])for(const z of [-15,0,15]){
    const s=effect.sampleAt({x,y:3,z},t);
    assert.ok(Number.isFinite(s.waterY)&&Number.isFinite(s.impact)&&Number.isFinite(s.depth));
  }
  const geometries=new Set(),materials=new Set();let calls=0;
  effect.group.traverse(o=>{if(o.geometry){geometries.add(o.geometry);materials.add(o.material);calls++;}});
  assert.equal(calls,6);assert.equal(geometries.size,3);
  let gd=0,md=0;geometries.forEach(g=>g.addEventListener('dispose',()=>gd++));materials.forEach(m=>m.addEventListener('dispose',()=>md++));
  effect.dispose();effect.dispose();assert.equal(gd,geometries.size);assert.equal(md,materials.size);assert.equal(effect.group.children.length,0);
});
