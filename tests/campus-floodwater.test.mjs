import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {CAMPUS_FLOOD_WATER,CAMPUS_FLOOD_WAVES,createCampusFloodwater,sampleCampusFloodwater} from '../src/campus-floodwater.js';

const center=CAMPUS_FLOOD_WATER.x;

test('the north-moving curved front floods only ground that it has already crossed',()=>{
  const options={front:1000,elapsed:15};
  for(const z of[-3000,0,999,1000])assert.equal(sampleCampusFloodwater({x:center,y:1.8,z},options).wet,false);
  const rising=sampleCampusFloodwater({x:center,y:1.8,z:1225},options);
  assert.equal(rising.fill,.5);assert.ok(rising.waterY>3&&rising.waterY<4.2);assert.ok(rising.depth>0);
  const flooded=sampleCampusFloodwater({x:center,y:1.8,z:1450},options);
  assert.equal(flooded.fill,1);assert.ok(flooded.waterY>7&&flooded.waterY<9.3);
  const edgeX=center+CAMPUS_FLOOD_WATER.width/2;
  assert.equal(sampleCampusFloodwater({x:edgeX,z:1599},options).wet,false,'the bowed sides arrive later than the centre');
  assert.equal(sampleCampusFloodwater({x:edgeX,z:1825},options).fill,.5);
  assert.equal(sampleCampusFloodwater({x:edgeX+1,z:3000},options).wet,false,'water respects the mapped domain');
  assert.equal(sampleCampusFloodwater({x:center,z:-4001},{...options,front:-6000}).wet,false);
  assert.equal(sampleCampusFloodwater({x:center,z:6001},{...options,front:-6000}).wet,false);
});

test('water remains after the leading wave passes and keeps moving without a simulation replay',()=>{
  const position={x:center-430,y:1.8,z:-1100};
  const a=sampleCampusFloodwater(position,{front:-6000,elapsed:50}),b=sampleCampusFloodwater(position,{front:-6000,elapsed:51});
  assert.equal(a.fill,1);assert.equal(b.fill,1);assert.notEqual(a.waterY,b.waterY);
  const late=sampleCampusFloodwater(position,{front:-600000,elapsed:3600});
  assert.equal(late.fill,1);assert.ok(late.waterY>7&&late.waterY<9.3);
  assert.deepEqual(late,sampleCampusFloodwater(position,{front:-600000,elapsed:3600}));
  assert.deepEqual(sampleCampusFloodwater(position,{front:-6000,elapsed:50,reducedMotion:true}),
    sampleCampusFloodwater(position,{front:-6000,elapsed:5000,reducedMotion:true}),'reduced motion freezes the surface texture and waves');
});

test('CPU sampling and the generated vertex height field share the same world-space wave spectrum',()=>{
  const effect=createCampusFloodwater({THREE});
  try{
    effect.update({active:true,front:-6000,elapsed:31});
    const material=effect.group.children[0].material,source=material.vertexShader;
    assert.ok(source.includes('#include <logdepthbuf_vertex>'));
    assert.ok(material.fragmentShader.includes('#include <logdepthbuf_fragment>'));
    const expression=source.match(/fill\*uRipple\*\(([^;]+)\);/)[1];
    const shaderWave=new Function('p','uTime',`return ${expression.replaceAll('sin(','Math.sin(')};`);
    for(const elapsed of[31,72,3600])for(const position of[{x:1400,y:2,z:100},{x:-840,y:12,z:-2500},{x:3600,y:1,z:3000}]){
      effect.update({active:true,front:-6000,elapsed});
      const expected=CAMPUS_FLOOD_WATER.level+shaderWave({x:position.x,y:position.z},elapsed);
      assert.ok(Math.abs(effect.sampleAt(position).waterY-expected)<1e-10);
    }
    assert.equal(CAMPUS_FLOOD_WAVES.length,3);
  }finally{effect.dispose();}
});

test('hidden and paused water has bounded resources, resets cleanly, and owns its disposal',()=>{
  const effect=createCampusFloodwater({THREE}),scene=new THREE.Scene();scene.add(effect.group);
  assert.equal(effect.group.children.length,0);assert.equal(effect.update({active:false}),false);
  assert.equal(effect.sampleAt({x:center,y:1,z:1000}).wet,false);
  assert.equal(effect.update({active:true,elapsed:40,front:-4200}),true);
  const mesh=effect.group.children[0],geometry=mesh.geometry,material=mesh.material;
  assert.equal(effect.group.children.length,1);assert.ok(geometry.attributes.position.count<35000);
  assert.equal(material.side,THREE.DoubleSide);assert.equal(material.depthWrite,false);
  assert.equal(material.fog,false);assert.equal(mesh.castShadow,false);
  assert.equal(effect.group.position.x,center);
  const snapshot=effect.sampleAt({x:center,y:1,z:0});
  assert.equal(effect.update({active:true,elapsed:40,front:-4200}),false,'same server phase makes no animation change');
  assert.deepEqual(effect.sampleAt({x:center,y:1,z:0}),snapshot);
  assert.equal(effect.update({active:false}),true);assert.equal(effect.group.visible,false);
  assert.equal(effect.sampleAt({x:center,y:1,z:0}).wet,false);
  effect.update({active:true,elapsed:60,front:-8400});
  assert.equal(effect.group.children[0],mesh,'retrigger never allocates a second surface');
  let geometries=0,materials=0;geometry.addEventListener('dispose',()=>geometries++);material.addEventListener('dispose',()=>materials++);
  effect.dispose();effect.dispose();assert.equal(geometries,1);assert.equal(materials,1);assert.equal(scene.children.length,0);
  assert.equal(effect.update({active:true,elapsed:60,front:-8400}),false);assert.equal(effect.sampleAt({x:center,z:0}).wet,false);
});
