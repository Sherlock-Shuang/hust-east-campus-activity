import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createDynamicInstanceSelection} from '../src/dynamic-instance-selection.js';

function fixture(t){
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),8);
  t.after(()=>{mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();});
  const palette=[new THREE.Color('red'),new THREE.Color('blue')];
  const records=Array.from({length:6},(_,id)=>({agent:{id},version:1,matrix:new THREE.Matrix4().makeTranslation(id,0,0),color:palette[id%2],visible:true}));
  let writes=0;
  const selection=createDynamicInstanceSelection(mesh,{applies:r=>r.visible,matrixFor:r=>{writes++;return r.matrix;},colorFor:r=>r.color});
  const consume=()=>{mesh.instanceMatrix.clearUpdateRanges();mesh.instanceColor?.clearUpdateRanges();};
  return{mesh,records,palette,selection,consume,writes:()=>writes};
}

test('one actor moving updates one transform slot without resending unchanged paint/skin',t=>{
  const f=fixture(t);f.selection.update(f.records);f.consume();const colorsVersion=f.mesh.instanceColor.version;
  const ids=f.mesh.userData.agentIds,writes=f.writes();
  f.records[3].matrix.makeTranslation(3,5,0);f.records[3].version++;f.selection.update(f.records);
  assert.equal(f.writes()-writes,1);assert.deepEqual(f.mesh.instanceMatrix.updateRanges,[{start:48,count:16}]);
  assert.equal(f.mesh.instanceColor.version,colorsVersion);assert.equal(f.mesh.userData.agentIds,ids);
  assert.equal(f.mesh.instanceMatrix.array[3*16+13],5);
  f.consume();f.selection.update(f.records);assert.deepEqual(f.mesh.instanceMatrix.updateRanges,[]);
  f.records[3].color=f.palette[0];f.records[3].version++;f.selection.update(f.records);
  assert.deepEqual(f.mesh.instanceColor.updateRanges,[{start:9,count:3}]);
});

test('pending writes survive another update, including temporarily hidden tail slots',t=>{
  const f=fixture(t);f.selection.update(f.records);f.consume();
  f.records[5].matrix.makeTranslation(5,4,0);f.records[5].version++;f.selection.update(f.records);
  f.records[0].matrix.makeTranslation(0,3,0);f.records[0].version++;f.selection.update(f.records.slice(0,3));
  assert.equal(f.mesh.count,3);assert.deepEqual(f.mesh.instanceMatrix.updateRanges,[{start:0,count:96}]);
  f.selection.update(f.records);assert.equal(f.mesh.count,6);
  assert.deepEqual(f.mesh.instanceMatrix.updateRanges,[{start:0,count:96}]);
  assert.equal(f.mesh.instanceMatrix.array[5*16+13],4);assert.deepEqual(f.mesh.userData.agentIds,[0,1,2,3,4,5]);
});

test('appearance/brake membership, actor replacement and reordered selections retain exact IDs, colours and poses',t=>{
  const f=fixture(t);f.selection.update(f.records);f.consume();
  f.records[1].visible=false;f.selection.update(f.records);
  assert.deepEqual(f.mesh.userData.agentIds,[0,2,3,4,5]);assert.equal(f.mesh.count,5);
  const replacement={agent:{id:300},version:1,matrix:new THREE.Matrix4().makeTranslation(90,0,0),color:f.palette[0],visible:true};
  const records=[replacement,f.records[0],f.records[3]];f.selection.update(records);
  assert.deepEqual(f.mesh.userData.agentIds,[300,0,3]);assert.equal(f.mesh.instanceMatrix.array[12],90);
  assert.deepEqual(Array.from(f.mesh.instanceColor.array.slice(0,3)),f.palette[0].toArray());
  f.selection.update([]);assert.equal(f.mesh.count,0);assert.deepEqual(f.mesh.userData.agentIds,[]);
  f.selection.update(records);assert.deepEqual(f.mesh.userData.agentIds,[300,0,3]);assert.equal(f.mesh.instanceMatrix.array[12],90);
});
