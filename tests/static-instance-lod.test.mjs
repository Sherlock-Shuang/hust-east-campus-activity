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
