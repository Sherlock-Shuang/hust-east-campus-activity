import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CAMPUS_TSUNAMI_PLACEMENT,createCampusTsunami,sampleCampusTsunami} from '../src/campus-tsunami.js';
import {reconcileC118Flood} from '../src/c118-flood-state.js';

const event={id:'shared-campus-and-c118',startAt:103000,pausedAt:null,pausedMs:0};

test('the first wave crosses the whole playable campus instead of stopping outside it',()=>{
  assert.equal(sampleCampusTsunami(null,100000),null);
  const countdown=sampleCampusTsunami(event,100000),arrival=sampleCampusTsunami(event,103000),storm=sampleCampusTsunami(event,130000);
  assert.equal(countdown.elapsed,-3);
  assert.equal(countdown.front,CAMPUS_TSUNAMI_PLACEMENT.farFront);
  assert.ok(countdown.firstFront>arrival.firstFront&&arrival.firstFront>storm.firstFront);
  assert.ok(countdown.height<arrival.height);
  assert.equal(arrival.firstFront,CAMPUS_TSUNAMI_PLACEMENT.shoreFront);
  assert.ok(storm.firstFront+CAMPUS_TSUNAMI_PLACEMENT.arcDepth<-3942,'even the curved wings have passed the northernmost playable boundary');
  for(const [seconds,z] of [[2,755],[5,0],[12,-1801],[24,-3942]]){
    const sample=sampleCampusTsunami(event,event.startAt+seconds*1000);
    assert.ok(sample.firstFront<z,`wave sweeps past ${z} at ${seconds}s`);
  }
  assert.equal(sampleCampusTsunami(event,300000).phase,'surging');
});

test('successive crests keep crossing after the first impact, while flooded ground stays wet',()=>{
  const effect=createCampusTsunami({THREE,scene:new THREE.Scene()});
  try{
    for(const cycle of[0,1,20,100]){
      const a=sampleCampusTsunami(event,event.startAt+(cycle*40+5)*1000),b=sampleCampusTsunami(event,event.startAt+(cycle*40+8)*1000);
      assert.ok(a.waves[0].front>b.waves[0].front,'later crest advances north');
      effect.update({event,now:event.startAt+(cycle*40+38)*1000});
      assert.ok(effect.sampleAt({x:0,y:1.8,z:0}).depth>5,'recycling crests cannot uncover the flooded campus');
    }
  }finally{effect.dispose();}
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
    const frozen=a.group.getObjectByName('campus-tsunami-wall').material.uniforms.uTime.value;
    assert.equal(a.update({event:paused,now:300000,paused:true}),false);
    assert.equal(a.group.getObjectByName('campus-tsunami-wall').material.uniforms.uTime.value,frozen);
  }finally{a.dispose();b.dispose();}
});

test('no event builds nothing; entering a portal suspends the wave and returning catches up',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene});
  try{
    assert.equal(effect.update({event:null,now:100000}),false);
    assert.equal(effect.group.children.length,0,'no initial geometry or shader allocation');
    effect.update({event,now:108000});
    const mesh=effect.group.getObjectByName('campus-tsunami-wall'),time=mesh.material.uniforms.uTime.value;
    assert.equal(effect.update({event,now:109000,visible:false}),true);
    assert.equal(effect.active,false);
    assert.equal(effect.sampleAt({x:0,y:1.8,z:0}).wet,false,'portal interiors clear the exterior underwater state');
    assert.equal(effect.update({event,now:120000,visible:false}),false);
    assert.equal(mesh.material.uniforms.uTime.value,time,'an embedded report hall does not animate the hidden campus');
    effect.update({event,now:125000});assert.equal(effect.sample.elapsed,22);
    assert.equal(effect.update({event:null,now:126000}),true);
    assert.equal(effect.active,false);assert.equal(effect.sample,null);
    assert.equal(effect.update({event:null,now:127000}),false);
  }finally{effect.dispose();}
});

test('waves and water keep a fixed world frame, bounded draw budget and dispose shared resources once',()=>{
  const scene=new THREE.Scene(),effect=createCampusTsunami({THREE,scene});
  effect.update({event,now:110000});
  const original=effect.group.position.clone();
  const meshes=[];effect.group.traverse(item=>{if(item.isMesh||item.isPoints)meshes.push(item);});
  assert.equal(meshes.length,7);
  assert.ok(meshes.reduce((sum,item)=>sum+item.geometry.attributes.position.count,0)<50000);
  assert.ok(meshes.every(item=>!item.material.fog&&!item.castShadow));
  effect.group.updateMatrixWorld();
  assert.equal(effect.group.getObjectByName('campus-floodwater').getWorldPosition(new THREE.Vector3()).x,1400,'water is not translated twice');
  const geometries=[...new Set(meshes.map(item=>item.geometry))],materials=[...new Set(meshes.map(item=>item.material))];
  let disposedGeometry=0,disposedMaterial=0;
  geometries.forEach(g=>g.addEventListener('dispose',()=>disposedGeometry++));materials.forEach(m=>m.addEventListener('dispose',()=>disposedMaterial++));
  effect.update({event,now:700000});assert.deepEqual(effect.group.position,original);
  effect.dispose();effect.dispose();
  assert.equal(disposedGeometry,4);assert.equal(disposedMaterial,7);assert.equal(scene.children.length,0);
});
