import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createResidentInstanceBatch} from '../src/resident-instance-batch.js';
import {createStaticFrustumIndex} from '../src/static-frustum-index.js';
import {createTreeLayer} from '../src/vegetation.js';

test('resident capacity follows active districts, shrinks after hysteresis, exports and restores exact source identities',()=>{
  let now=0,geometryDisposals=0,materialDisposals=0;
  const parent=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
  geometry.addEventListener('dispose',()=>geometryDisposals++);material.addEventListener('dispose',()=>materialDisposals++);
  const matrices=Array.from({length:1000},(_,i)=>new THREE.Matrix4().makeTranslation(i,1,-i)),colors=matrices.map((_,i)=>new THREE.Color(i%2?'red':'blue')),ids=matrices.map((_,i)=>`tree-${i}`);
  const batch=createResidentInstanceBatch(THREE,{parent,name:'test',geometry,material,matrices,colors,ids,now:()=>now});
  batch.update([777,999]);assert.equal(batch.stats.residentCapacity,16);assert.equal(parent.children.length,1);
  assert.equal(batch.mesh.instanceMatrix.array[12],777);assert.deepEqual(batch.mesh.userData.instanceFeatureIds,['tree-777','tree-999']);
  batch.update(Array.from({length:200},(_,i)=>i));assert.equal(batch.stats.residentCapacity,256);
  now=1;batch.update([15]);now=1500;batch.update([15]);assert.equal(batch.stats.residentCapacity,256);
  now=1502;batch.update([15]);assert.equal(batch.stats.residentCapacity,16,'small but nonempty district also shrinks');
  now=3003;batch.update([]);assert.equal(batch.stats.residentCapacity,0);assert.equal(parent.children.length,0);
  batch.update(matrices.map((_,i)=>i),{forceFull:true});assert.equal(batch.mesh.count,1000);assert.equal(batch.mesh.instanceMatrix.array[999*16+12],999);
  batch.release();assert.equal(batch.stats.residentBytes,0);batch.update([5]);assert.equal(batch.mesh.instanceMatrix.array[12],5);
  batch.dispose();batch.update([1]);assert.equal(parent.children.length,0);assert.equal(geometryDisposals,0);assert.equal(materialDisposals,0);geometry.dispose();material.dispose();
});

test('frustum clusters conservatively include boundary-crossing spheres and exact selection matches brute force',()=>{
  const items=Array.from({length:2000},(_,i)=>({x:(i%50)*20-500,z:Math.floor(i/50)*20-400,r:i%11===0?45:5}));
  const sphereAt=(p,s)=>{s.center.set(p.x,5,p.z);s.radius=p.r;};
  const index=createStaticFrustumIndex(THREE,items,sphereAt),sphere=new THREE.Sphere(),camera=new THREE.PerspectiveCamera(55,1.6,.1,700),frustum=new THREE.Frustum(),matrix=new THREE.Matrix4();
  for(let step=0;step<30;step++){
    camera.position.set(Math.sin(step)*600,15+step*4,Math.cos(step)*600);camera.lookAt(0,0,0);camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const exact=i=>{sphereAt(items[i],sphere);return frustum.intersectsSphere(sphere);};
    assert.deepEqual(index.query(frustum).filter(exact),items.map((_,i)=>i).filter(exact));
  }
  assert.equal(index.query(null).length,items.length);
});

test('resident forest preserves exact LOD transforms and picking IDs, releases and resumes, and full export ignores cache',()=>{
  const trees=Array.from({length:300},(_,i)=>({x:(i%20)*30,z:Math.floor(i/20)*30,height:9+(i%5),radius:4,featureId:`t${i}`,seed:(i*.618)%1}));
  const normal=createTreeLayer(THREE,trees,{detail:'forest'}),resident=createTreeLayer(THREE,trees,{detail:'forest',resident:true});
  const camera=new THREE.PerspectiveCamera(65,1.6,.1,1000);
  const snapshot=layer=>Object.fromEntries(layer.group.children.filter(m=>m.count).map(m=>[m.name,{ids:m.userData.instanceFeatureIds,matrices:Array.from(m.instanceMatrix.array.slice(0,m.count*16))}]));
  try{
    for(const scale of[1,.45,1.3])for(const x of[0,150,400]){camera.position.set(x,14,300);camera.lookAt(x,4,0);camera.updateMatrixWorld();normal.update(camera,{detailDistanceScale:scale});resident.update(camera,{detailDistanceScale:scale});assert.deepEqual(snapshot(resident),snapshot(normal));}
    resident.releaseDecorativeResources();assert.equal(resident.group.children.length,0);resident.update(camera);assert.equal(resident.group.children.length,0);
    resident.resumeDecorativeResources();resident.update(camera,{detailDistanceScale:1.3});assert.deepEqual(snapshot(resident),snapshot(normal));
    resident.update(null);normal.update(null);assert.deepEqual(snapshot(resident),snapshot(normal));
  }finally{normal.dispose();resident.dispose();}
});

test('cancelling a staged tree build disposes its partial owned resources and leaves borrowed materials intact',async()=>{
  const {buildTreeLayer}=await import('../src/vegetation.js');
  const created=[],disposed=new Set();
  class Material extends THREE.MeshStandardMaterial{constructor(...args){super(...args);created.push(this);this.addEventListener('dispose',()=>disposed.add(this));}}
  class Texture extends THREE.DataTexture{constructor(...args){super(...args);created.push(this);this.addEventListener('dispose',()=>disposed.add(this));}}
  const borrowed=new THREE.MeshStandardMaterial();let borrowedDisposals=0;borrowed.addEventListener('dispose',()=>borrowedDisposals++);
  const iterator=buildTreeLayer({...THREE,MeshStandardMaterial:Material,DataTexture:Texture},[{x:0,z:0}],{barkMaterial:borrowed,resident:true});
  iterator.next();iterator.next();assert.ok(created.length>=4);iterator.return();
  assert.equal(disposed.size,created.length);assert.equal(borrowedDisposals,0);assert.equal(iterator.next().done,true);borrowed.dispose();
});
