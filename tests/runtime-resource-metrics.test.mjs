import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {estimateGeometryAllocation} from '../src/runtime-diagnostics.js';
import {createGpuFrameTimer} from '../src/gpu-frame-timer.js';

test('export allocation estimate deduplicates shared geometry and counts actual instance capacity',()=>{
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
  const one=new THREE.Mesh(geometry,material),two=new THREE.InstancedMesh(geometry,material,20);
  two.count=2;scene.add(one,two);const single=estimateGeometryAllocation(one),both=estimateGeometryAllocation(scene);
  assert.equal(both.uniqueGeometries,1);assert.equal(both.bytes-single.bytes,20*16*4);
  geometry.dispose();material.dispose();two.dispose();
});
test('GPU timers never read results before availability, bound pending work, and discard disjoint values',()=>{
  let available=false,disjoint=false,id=0,reads=0,deleted=0;
  const ext={TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2},gl={QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,
    getExtension:()=>ext,isContextLost:()=>false,getParameter:()=>disjoint,
    createQuery:()=>++id,beginQuery(){},endQuery(){},deleteQuery(){deleted++;},
    getQueryParameter(_q,p){if(p===3)return available;reads++;assert.ok(available);return 5000000;},
  };
  const timer=createGpuFrameTimer({getContext:()=>gl},{enabled:true});
  for(let i=0;i<20;i++){timer.begin();timer.end();}assert.equal(id,4);assert.equal(reads,0);
  available=true;timer.begin();timer.end();assert.equal(reads,4);assert.equal(timer.snapshot().p95Ms,5);
  disjoint=true;timer.begin();assert.equal(timer.snapshot().sampleCount,0);assert.equal(timer.snapshot().disjointResets,1);assert.ok(deleted>=5);
  timer.dispose();
});
