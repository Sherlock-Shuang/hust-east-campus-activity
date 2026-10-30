import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CAMPUS_TSUNAMI_PLACEMENT,createCampusTsunami,sampleCampusTsunami} from '../src/campus-tsunami.js';
import {reconcileC118Flood} from '../src/c118-flood-state.js';

const event={id:'shared-campus-and-c118',startAt:103000,pausedAt:null,pausedMs:0};

test('exterior approach uses the C118 server timeline and stops at the mapped campus edge',()=>{
  assert.equal(sampleCampusTsunami(null,100000),null);
  const countdown=sampleCampusTsunami(event,100000),arrival=sampleCampusTsunami(event,110000),storm=sampleCampusTsunami(event,130000);
  assert.equal(countdown.elapsed,-3);
  assert.equal(countdown.front,CAMPUS_TSUNAMI_PLACEMENT.farFront);
  assert.ok(countdown.front>arrival.front&&arrival.front>storm.front);
  assert.ok(countdown.height<arrival.height&&arrival.height<storm.height);
  assert.equal(storm.front,CAMPUS_TSUNAMI_PLACEMENT.nearFront);
  assert.ok(storm.front-storm.height*.24>882,'curl remains outside the southernmost building footprint');
  assert.equal(sampleCampusTsunami(event,300000).front,storm.front,'the storm persists without sweeping the world anchor through the campus');
  assert.equal(sampleCampusTsunami(event,300000).phase,'surging');
});

test('late joins, host pause and resume keep the exterior on the same authoritative phase',()=>{
  const paused=reconcileC118Flood({c118Flood:event},{c118Flood:event,paused:true},111000);
  assert.deepEqual(sampleCampusTsunami(paused,150000),sampleCampusTsunami(event,111000));
  const resumed=reconcileC118Flood({c118Flood:paused},{c118Flood:paused,paused:false},161000);
  assert.deepEqual(sampleCampusTsunami(resumed,166000),sampleCampusTsunami(event,116000));
  const scene=new THREE.Scene(),a=createCampusTsunami({THREE,scene}),b=createCampusTsunami({THREE,scene});
  try{
    a.update({event,now:103000});a.update({event:resumed,now:166000});
    b.update({event:resumed,now:166000});
    assert.deepEqual(a.sample,b.sample,'joining mid-event skips directly to the server phase');
    a.update({event:paused,now:200000,paused:true});
    const frozen=a.group.children[0].material.uniforms.uTime.value;
    assert.equal(a.update({event:paused,now:300000,paused:true}),false);
    assert.equal(a.group.children[0].material.uniforms.uTime.value,frozen);
  }finally{a.dispose();b.dispose();}
});

test('no event builds nothing; entering a portal suspends the wave and returning catches up',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene});
  try{
    assert.equal(effect.update({event:null,now:100000}),false);
    assert.equal(effect.group.children.length,0,'no initial geometry or shader allocation');
    effect.update({event,now:108000});
    const mesh=effect.group.children[0],time=mesh.material.uniforms.uTime.value;
    assert.equal(effect.update({event,now:109000,visible:false}),true);
    assert.equal(effect.active,false);
    assert.equal(effect.update({event,now:120000,visible:false}),false);
    assert.equal(mesh.material.uniforms.uTime.value,time,'an embedded report hall does not animate the hidden campus');
    effect.update({event,now:125000});assert.equal(effect.sample.elapsed,22);
    assert.equal(effect.update({event:null,now:126000}),true);
    assert.equal(effect.active,false);assert.equal(effect.sample,null);
    assert.equal(effect.update({event:null,now:127000}),false);
  }finally{effect.dispose();}
});

test('the huge wave stays world anchored, keeps a small draw budget and disposes owned resources',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene});
  effect.update({event,now:110000});
  const original=effect.group.position.clone();
  assert.equal(effect.group.children.length,3);
  assert.ok(effect.group.children.reduce((sum,item)=>sum+item.geometry.attributes.position.count,0)<10000);
  assert.ok(effect.group.children.every(item=>!item.material.fog&&!item.castShadow));
  const geometries=effect.group.children.map(item=>item.geometry),materials=effect.group.children.map(item=>item.material);
  let disposedGeometry=0,disposedMaterial=0;
  geometries.forEach(g=>g.addEventListener('dispose',()=>disposedGeometry++));materials.forEach(m=>m.addEventListener('dispose',()=>disposedMaterial++));
  effect.update({event,now:700000});assert.deepEqual(effect.group.position,original);
  effect.dispose();effect.dispose();
  assert.equal(disposedGeometry,3);assert.equal(disposedMaterial,3);assert.equal(scene.children.length,0);
});
