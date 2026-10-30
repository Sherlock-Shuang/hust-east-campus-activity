import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createDistanceLodSelection} from '../src/static-instance-lod.js';
import {createTreeLayer,createShrubLayer} from '../src/vegetation.js';

test('distance bands hold through threshold oscillation, jump across bands, and reset on quality change',()=>{
  const lod=createDistanceLodSelection(2,[100,280]);
  assert.equal(lod.levelAt(0,99**2),0);
  for(let n=0;n<30;n++)assert.equal(lod.levelAt(0,(n%2?101:99)**2),0);
  assert.equal(lod.levelAt(0,111**2),1);
  for(let n=0;n<30;n++)assert.equal(lod.levelAt(0,(n%2?101:99)**2),1);
  assert.equal(lod.levelAt(0,89**2),0);
  assert.equal(lod.levelAt(0,900**2),2,'fast flight jumps directly to horizon');
  assert.equal(lod.levelAt(0,20**2),0,'fast return immediately restores near geometry');
  lod.setScale(.5);assert.equal(lod.levelAt(0,60**2),1,'quality changes use their exact new thresholds');
  lod.reset();assert.equal(lod.levelAt(0,49**2),0);
});

test('tree layer draws exactly one crown per source tree without LOD chatter; export and budget changes are immediate',()=>{
  const layer=createTreeLayer(THREE,[{x:0,y:.1,z:0,height:12,radius:4,seed:.25,featureId:'tree/hysteresis'}]);
  const camera=new THREE.PerspectiveCamera(60,1,.1,5000),center=new THREE.Vector3(0,6.1,0);
  const counts=()=>{
    const sums={near:0,far:0,horizon:0};
    for(const m of layer.group.children){const part=m.userData.part;if(part==='leaves')sums.near+=m.count;else if(part==='leaves-distant')sums.far+=m.count;else if(part==='horizon-canopy')sums.horizon+=m.count;}
    assert.equal(sums.near+sums.far+sums.horizon,1,'never double draws or drops a tree between mesh bands');return sums;
  };
  const update=(distance,scale=1)=>{camera.position.set(0,6.1,distance);camera.lookAt(center);layer.update(camera,{detailDistanceScale:scale});return counts();};
  try{
    assert.equal(update(99).near,1);
    for(let n=0;n<20;n++)assert.equal(update(n%2?101:99).near,1);
    assert.equal(update(111).far,1);
    for(let n=0;n<20;n++)assert.equal(update(n%2?101:99).far,1);
    assert.equal(update(89).near,1);
    assert.equal(update(279).far,1);
    for(let n=0;n<20;n++)assert.equal(update(n%2?281:279).far,1);
    assert.equal(update(309).horizon,1);
    assert.equal(update(251).far,1);
    assert.equal(update(220,.5).horizon,1);
    assert.equal(update(220,1).far,1,'stationary camera honors changed quality budget');
    layer.update(null);assert.equal(counts().near,1,'export restores all near geometry');
    assert.equal(update(105).far,1,'export clears old transition history');
  }finally{layer.dispose();}
});

test('shrub near/far/cull bands retain one source and export ignores previous culling',()=>{
  const layer=createShrubLayer(THREE,[{x:0,y:.1,z:0,height:1,radius:1,seed:.2,featureId:'shrub/one'}]),camera=new THREE.PerspectiveCamera(60,1,.1,1000);
  const update=(z,scale=1)=>{camera.position.set(0,.6,z);camera.lookAt(0,.6,0);layer.update(camera,{detailDistanceScale:scale});return layer.group.children.map(m=>m.count);};
  try{
    assert.deepEqual(update(64),[1,0]);
    for(let n=0;n<20;n++)assert.deepEqual(update(n%2?66:64),[1,0]);
    assert.deepEqual(update(72),[0,1]);assert.deepEqual(update(58),[1,0]);
    assert.deepEqual(update(259),[0,1]);
    for(let n=0;n<20;n++)assert.deepEqual(update(n%2?261:259),[0,1]);
    assert.deepEqual(update(287),[0,0]);assert.deepEqual(update(233),[0,1]);
    assert.deepEqual(update(233,.5),[0,0]);
    layer.update(null);assert.deepEqual(layer.group.children.map(m=>m.count),[1,0]);
    assert.deepEqual(update(267,1),[0,0],'export resets visibility history to exact new budget');
  }finally{layer.dispose();}
});
