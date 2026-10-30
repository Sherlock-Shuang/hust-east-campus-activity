import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createStaticInstanceSelection,createStaticXZIndex} from '../src/static-instance-lod.js';

function fixture(){
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1000);
  mesh.setColorAt(0,new THREE.Color('white'));
  const matrices=Array.from({length:1000},(_,i)=>new THREE.Matrix4().makeTranslation(i*2,i%7,-i)),colors=matrices.map((_,i)=>new THREE.Color().setHSL(i/1000,.6,.5)),ids=matrices.map((_,i)=>`source/${i}`);
  return {mesh,matrices,colors,ids,selection:createStaticInstanceSelection(mesh,{matrices,colors,ids})};
}
test('static selection uploads only visible transforms and preserves source picking correspondence',()=>{
  const {mesh,matrices,colors,selection}=fixture();
  assert.equal(selection.update([3,421,27]),true);
  assert.equal(mesh.count,3);assert.equal(mesh.visible,true);
  assert.deepEqual(mesh.userData.instanceFeatureIds,['source/3','source/421','source/27']);
  assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:0,count:48}]);
  assert.deepEqual(mesh.instanceColor.updateRanges,[{start:0,count:9}]);
  for(const [slot,id]of [3,421,27].entries()){const matrix=new THREE.Matrix4(),color=new THREE.Color();mesh.getMatrixAt(slot,matrix);mesh.getColorAt(slot,color);assert.deepEqual(matrix.elements,matrices[id].elements);assert.ok(color.distanceTo?color.distanceTo(colors[id])<1e-6:Math.abs(color.r-colors[id].r)<1e-6);}
});
test('unchanged visibility, shrink and re-expansion do not rewrite static GPU buffers',()=>{
  const {mesh,selection}=fixture();selection.update([3,421,27]);
  const version=mesh.instanceMatrix.version;mesh.instanceMatrix.clearUpdateRanges();mesh.instanceColor.clearUpdateRanges();
  assert.equal(selection.update([3,421,27]),false);assert.equal(mesh.instanceMatrix.version,version);
  assert.equal(selection.update([3]),true);assert.equal(mesh.count,1);assert.equal(mesh.instanceMatrix.version,version);
  selection.update([]);assert.equal(mesh.visible,false);assert.equal(mesh.count,0);
  selection.update([3,421,27]);assert.equal(mesh.visible,true);assert.equal(mesh.instanceMatrix.version,version);
  assert.deepEqual(mesh.userData.instanceFeatureIds,['source/3','source/421','source/27']);
  selection.update([27,3]);assert.equal(mesh.count,2);assert.equal(mesh.instanceMatrix.version,version+1);assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:0,count:32}]);
});
test('changed spans exclude unchanged prefixes and retain writes until render, even after shrink and re-entry',()=>{
  const {mesh,matrices,colors,selection}=fixture();
  const flush=attribute=>{for(const range of attribute.updateRanges)gpu.get(attribute).set(attribute.array.subarray(range.start,range.start+range.count),range.start);attribute.clearUpdateRanges();};
  const gpu=new Map([mesh.instanceMatrix,mesh.instanceColor].map(attribute=>[attribute,new Float32Array(attribute.array.length)]));
  selection.update([1,2,3,4]);[...gpu.keys()].forEach(flush);
  const ids=mesh.userData.instanceFeatureIds;
  selection.update([1,2,3,8]);
  assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:48,count:16}]);
  assert.deepEqual(mesh.instanceColor.updateRanges,[{start:9,count:3}]);
  // No render between these updates: slot 3 still needs its earlier write.
  selection.update([1,9]);
  assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:16,count:48}]);
  assert.deepEqual(mesh.instanceColor.updateRanges,[{start:3,count:9}]);
  [...gpu.keys()].forEach(flush);
  selection.update([1,9,3,8]);
  assert.equal(mesh.userData.instanceFeatureIds,ids,'selection IDs reuse their own mapping array');
  assert.deepEqual(ids,['source/1','source/9','source/3','source/8']);
  assert.equal(mesh.instanceMatrix.updateRanges.length,0,'re-entry can use the already uploaded hidden slots');
  for(const [slot,index]of[1,9,3,8].entries()){
    assert.deepEqual(Array.from(gpu.get(mesh.instanceMatrix).subarray(slot*16,slot*16+16)),Array.from(new Float32Array(matrices[index].elements)));
    assert.deepEqual(Array.from(gpu.get(mesh.instanceColor).subarray(slot*3,slot*3+3)),Array.from(new Float32Array(colors[index].toArray())));
  }
});

test('incremental selection remains byte-exact across sparse changes and multiple updates per render',()=>{
  const {mesh,matrices,colors,selection}=fixture();
  const gpu=new Map([mesh.instanceMatrix,mesh.instanceColor].map(attribute=>[attribute,new Float32Array(attribute.array.length)]));
  let indices=[];
  for(let step=0;step<160;step++){
    const count=(step*29)%80;indices=Array.from({length:count},(_,slot)=>(slot*7+Math.floor(step/4)*13)%1000);
    selection.update(indices);
    if(step%3!==0&&step!==159)continue;
    for(const [attribute,buffer]of gpu){for(const range of attribute.updateRanges)buffer.set(attribute.array.subarray(range.start,range.start+range.count),range.start);attribute.clearUpdateRanges();}
    assert.deepEqual(mesh.userData.instanceFeatureIds,indices.map(index=>`source/${index}`));
    for(const [slot,index]of indices.entries()){
      assert.deepEqual(Array.from(gpu.get(mesh.instanceMatrix).subarray(slot*16,slot*16+16)),Array.from(new Float32Array(matrices[index].elements)));
      assert.deepEqual(Array.from(gpu.get(mesh.instanceColor).subarray(slot*3,slot*3+3)),Array.from(new Float32Array(colors[index].toArray())));
    }
  }
});
test('static spatial broad phase includes every in-radius point at negative and cell boundaries',()=>{
  const points=Array.from({length:3000},(_,i)=>({x:Math.sin(i*1.31)*1700,z:Math.cos(i*.37)*1600}));
  points.push({x:-64,z:64},{x:0,z:0},{x:64,z:-64});
  const index=createStaticXZIndex(points),reused=[];
  for(const center of [{x:0,z:0},{x:-64,z:64},{x:900,z:-850}])for(const radius of [0,1,63,64,120,180,1500,5000]){
    const candidates=index.query(center,radius,reused),set=new Set(candidates);
    assert.equal(candidates,reused);assert.equal(set.size,candidates.length);
    for(let i=0;i<points.length;i++)if(Math.hypot(points[i].x-center.x,points[i].z-center.z)<=radius)assert.ok(set.has(i),`missing ${i} within ${radius}`);
  }
  assert.ok(index.query({x:0,z:0},120).length<points.length*.05,'nearby details never scan the complete map');
});

test('cached spatial rectangles match the exact source-order reference across boundaries, scale changes and caller edits',()=>{
  const points=Array.from({length:5000},(_,i)=>({x:Math.sin(i*1.31)*1700,z:Math.cos(i*.37)*1600}));
  points.push({x:-64,z:64},{x:0,z:0},{x:64,z:-64},{x:128,z:0});
  const index=createStaticXZIndex(points),out=[];
  const reference=(position,radius)=>points.flatMap((p,i)=>Math.floor(p.x/64)>=Math.floor((position.x-radius)/64)&&Math.floor(p.x/64)<=Math.floor((position.x+radius)/64)&&Math.floor(p.z/64)>=Math.floor((position.z-radius)/64)&&Math.floor(p.z/64)<=Math.floor((position.z+radius)/64)?[i]:[]);
  for(const radius of[0,1,63,64,65,120,180,1500,5000])for(const x of[-128.00001,-128,-127.99999,-64,-.00001,0,.00001,63.99999,64,64.00001,128]){
    const position={x,z:-x};
    assert.deepEqual(index.query(position,radius,out),reference(position,radius));
    out.splice(0,out.length,999999);
    assert.deepEqual(index.query(position,radius,out),reference(position,radius),'cached results ignore caller mutations');
    assert.deepEqual(index.query(position,radius),out,'independent outputs receive the same sorted source indices');
  }
});
