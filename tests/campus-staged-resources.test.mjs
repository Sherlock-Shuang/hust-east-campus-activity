import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildSurfaceMaterials,createSurfaceMaterials} from '../src/surface-materials.js';
import {buildEastNineGround} from '../src/east-nine-ground.js';
import {buildCampusLawnLandmarks} from '../src/campus-lawn-landmarks.js';
import {buildEastNinePlanting} from '../src/east-nine-planting.js';

function trackedThree(){const resources=[],disposed=new Set();
  class Material extends THREE.MeshStandardMaterial{constructor(...args){super(...args);resources.push(this);this.addEventListener('dispose',()=>disposed.add(this));}}
  class Texture extends THREE.DataTexture{constructor(...args){super(...args);resources.push(this);this.addEventListener('dispose',()=>disposed.add(this));}}
  return{THREE:{...THREE,MeshStandardMaterial:Material,DataTexture:Texture},resources,disposed};
}
function cancelAt(iterator,predicate){for(let n=0;n<5000;n++){const step=iterator.next();assert.equal(step.done,false,'must encounter a cancellable stage');if(predicate(step.value)){iterator.return();return;}}assert.fail('stage not reached');}

test('staged public materials preserve exact pixels, independent ownership and bounded pixel rows',()=>{
  const iterator=buildSurfaceMaterials(THREE),stages=[];let step;while(!(step=iterator.next()).done)stages.push(step.value);
  const staged=step.value,normal=createSurfaceMaterials(THREE);
  try{assert.equal(stages.length,9*8);for(const key of Object.keys(normal).filter(k=>k!=='dispose'))for(const map of['map','bumpMap','roughnessMap']){assert.deepEqual(staged[key][map].image.data,normal[key][map].image.data);assert.notEqual(staged[key][map].image.data,normal[key][map].image.data);}}
  finally{staged.dispose();normal.dispose();}
});

test('partial public material generation releases only its completed textures/materials on cancellation',()=>{
  const tracked=trackedThree();cancelAt(buildSurfaceMaterials(tracked.THREE),p=>p.material==='草地与细碎落叶'&&p.row===64);
  assert.ok(tracked.resources.length>8);assert.equal(tracked.resources.length,tracked.disposed.size);
});

test('partial East Nine paving cleans the first material while the second is still being generated',()=>{
  const tracked=trackedThree();cancelAt(buildEastNineGround(tracked.THREE,{records:[],roads:[]}),p=>p.stage==='东九柱廊铺装材质'&&p.row===64);
  assert.equal(tracked.resources.length,3);assert.equal(tracked.resources.length,tracked.disposed.size);
});

test('partial lawn and hedge builds clean textures and materials before installing visible geometry',()=>{
  const lawn=trackedThree(),preparedPlan={lawns:[],canopies:[],stones:[{id:'stone',x:0,y:0,z:0,yaw:0}],tufts:[],inscription:{carvedColumns:[]}};
  cancelAt(buildCampusLawnLandmarks(lawn.THREE,{}, {preparedPlan}),p=>p.stage==='题字景石');assert.ok(lawn.resources.length>=6);assert.equal(lawn.resources.length,lawn.disposed.size);
  const hedge=trackedThree();cancelAt(buildEastNinePlanting(hedge.THREE,{records:[],roads:[]},{plan:{patches:[],plants:[]}}),p=>p.stage==='东九绿篱几何');assert.equal(hedge.resources.length,4);assert.equal(hedge.resources.length,hedge.disposed.size);
});
