// Deterministic CPU/upload A/B only. Browser GPU presentation/FPS is measured separately.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import * as currentVegetation from '../src/vegetation.js';
import * as currentSelection from '../src/static-instance-lod.js';

const root=new URL('../',import.meta.url),revision=process.env.PERF_BASELINE||'7c503d1';
const baselineRevision=execFileSync('git',['rev-parse',revision],{cwd:root,encoding:'utf8'}).trim();
const output=new URL('artifacts/performance-movement-2026-10-31/',root),baselineRoot=new URL(`instance-baseline-${baselineRevision.slice(0,7)}/`,output);
mkdirSync(baselineRoot,{recursive:true});
execFileSync('tar',['-x','-C',fileURLToPath(baselineRoot)],{input:execFileSync('git',['archive',baselineRevision,'src'],{cwd:root,maxBuffer:32*1024*1024})});
const baselineVegetation=await import(new URL('src/vegetation.js',baselineRoot));
const baselineSelection=await import(new URL('src/static-instance-lod.js',baselineRoot));
const trees=Array.from({length:7800},(_,i)=>({x:(i%100)*17-850,z:Math.floor(i/100)*17-650,height:8+i%10,radius:3.5+(i%4)*.45,seed:(i*.618)%1,featureId:`fixture-${i}`}));
const shrubs=Array.from({length:1200},(_,i)=>({x:(i%50)*19-475,z:Math.floor(i/50)*21-252,height:.5+(i%5)*.15,radius:.7+(i%4)*.2,seed:(i*.618)%1,featureId:`shrub-${i}`}));
const layers={baseline:baselineVegetation.createTreeLayer(THREE,trees,{detail:'forest',resident:true}),current:currentVegetation.createTreeLayer(THREE,trees,{detail:'forest',resident:true})};
const shrubLayers={baseline:baselineVegetation.createShrubLayer(THREE,shrubs),current:currentVegetation.createShrubLayer(THREE,shrubs)};
const camera=new THREE.PerspectiveCamera(58,16/9,.1,1800);
const flight=Array.from({length:96},(_,i)=>{const angle=i/96*Math.PI*2;return{x:Math.sin(angle)*480,y:4+(i%8)*26,z:Math.cos(angle)*420,angle};});
const walking=Array.from({length:360},(_,i)=>({x:-120+i*.08,y:3.7+Math.sin(i*.04)*.01,z:330-i*.035,angle:.6+i*.00012}));
function move(p){camera.position.set(p.x,p.y,p.z);camera.lookAt(p.x+Math.cos(p.angle+.4)*350,9,p.z-Math.sin(p.angle+.4)*350);camera.updateMatrixWorld();}

const verifiedGeometries=new Set();let checkedViews=0,checkedInstanceSlots=0;
function assertLayerEqual(before,after){
  const visible=layer=>new Map(layer.group.children.filter(mesh=>mesh.visible&&mesh.count).map(mesh=>[mesh.name,mesh]));
  const a=visible(before),b=visible(after);assert.deepEqual([...b.keys()].sort(),[...a.keys()].sort());
  for(const [name,left]of a){
    const right=b.get(name);assert.equal(right.count,left.count);checkedInstanceSlots+=left.count;
    assert.deepEqual(right.userData.instanceFeatureIds,left.userData.instanceFeatureIds);
    assert.deepEqual(right.instanceMatrix.array.subarray(0,right.count*16),left.instanceMatrix.array.subarray(0,left.count*16));
    assert.deepEqual(right.instanceColor?.array.subarray(0,right.count*3),left.instanceColor?.array.subarray(0,left.count*3));
    if(!verifiedGeometries.has(name)){
      verifiedGeometries.add(name);assert.deepEqual(right.geometry.index?.array,left.geometry.index?.array);
      assert.deepEqual(Object.keys(right.geometry.attributes),Object.keys(left.geometry.attributes));
      for(const key of Object.keys(left.geometry.attributes)){assert.equal(right.geometry.attributes[key].itemSize,left.geometry.attributes[key].itemSize);assert.deepEqual(right.geometry.attributes[key].array,left.geometry.attributes[key].array);}
      for(const key of ['type','roughness','metalness','alphaTest','alphaToCoverage','side','vertexColors'])assert.deepEqual(right.material[key],left.material[key]);
      assert.deepEqual(right.material.color,left.material.color);assert.deepEqual(right.material.map?.image.data,left.material.map?.image.data);
    }
  }
}
function verify(camera,scale){for(const family of[layers,shrubLayers]){family.baseline.update(camera,{detailDistanceScale:scale});family.current.update(camera,{detailDistanceScale:scale});assertLayerEqual(family.baseline,family.current);}checkedViews++;}
verify(null,1);
for(const scale of[1,.45,1.3])for(const p of flight){move(p);verify(camera,scale);camera.position.x+=.08;verify(camera,scale);}
for(const family of[layers]){family.baseline.releaseDecorativeResources();family.current.releaseDecorativeResources();assert.equal(family.current.group.children.length,0);family.baseline.resumeDecorativeResources();family.current.resumeDecorativeResources();}
verify(camera,1);verify(null,1);

function consume(layer,state){
  let bytes=0;
  for(const mesh of layer.group.children)if(mesh.visible&&mesh.count)for(const attribute of[mesh.instanceMatrix,mesh.instanceColor])if(attribute){
    const previous=state.get(attribute);
    if(previous===undefined)bytes+=attribute.array.byteLength;
    else if(previous!==attribute.version){bytes+=attribute.updateRanges.length?attribute.updateRanges.reduce((sum,range)=>sum+range.count*attribute.array.BYTES_PER_ELEMENT,0):attribute.array.byteLength;attribute.clearUpdateRanges();}
    // Three r180 creates a full GPU buffer without consuming updateRanges;
    // only its later version-changing bufferSubData path clears those ranges.
    state.set(attribute,attribute.version);
  }
  return bytes;
}
function runLayer(layer,positions){
  const state=new Map();let cpuMs=0,uploadBytes=0;
  for(const p of positions){move(p);const start=performance.now();layer.update(camera);cpuMs+=performance.now()-start;uploadBytes+=consume(layer,state);}
  return{cpuMs,uploadBytes};
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const vegetation={};
for(const [route,positions]of Object.entries({walking,flight})){
  for(let warm=0;warm<2;warm++)for(const layer of Object.values(layers))runLayer(layer,positions);
  const trials={baseline:[],current:[]};
  for(let trial=0;trial<7;trial++)for(const key of trial%2?['current','baseline']:['baseline','current'])trials[key].push(runLayer(layers[key],positions));
  vegetation[route]={frames:positions.length,trials,median:Object.fromEntries(Object.entries(trials).map(([key,runs])=>[key,{cpuMs:median(runs.map(run=>run.cpuMs)),uploadBytes:median(runs.map(run=>run.uploadBytes))}]))};
}

const points=Array.from({length:20000},(_,i)=>({x:Math.sin(i*1.31)*1700,z:Math.cos(i*.37)*1600}));
const indices={baseline:baselineSelection.createStaticXZIndex(points),current:currentSelection.createStaticXZIndex(points)},out={baseline:[],current:[]};
const queryRoutes={walking:Array.from({length:600},(_,i)=>({x:-250+i*.08,z:120-i*.04})),flight:Array.from({length:120},(_,i)=>({x:-700+i*13,z:400-i*7}))};
const spatial={};
for(const [route,positions]of Object.entries(queryRoutes)){
  for(const p of positions)for(const radius of[60,120,450,1500])assert.deepEqual(indices.current.query(p,radius,out.current),indices.baseline.query(p,radius,out.baseline));
  function run(index,scratch){let count=0;const start=performance.now();for(const radius of[60,120,450,1500])for(const p of positions)count+=index.query(p,radius,scratch).length;return{cpuMs:performance.now()-start,candidates:count};}
  for(let warm=0;warm<2;warm++)for(const key of['baseline','current'])run(indices[key],out[key]);
  const trials={baseline:[],current:[]};
  for(let trial=0;trial<7;trial++)for(const key of trial%2?['current','baseline']:['baseline','current'])trials[key].push(run(indices[key],out[key]));
  spatial[route]={queries:positions.length*4,trials,medianMs:Object.fromEntries(Object.entries(trials).map(([key,runs])=>[key,median(runs.map(run=>run.cpuMs))]))};
}
for(const layer of[...Object.values(layers),...Object.values(shrubLayers)])layer.dispose();
const report={baselineRevision,generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,conditions:'Same-process alternating A/B after warmup. Deterministic 7,800-tree and 1,200-shrub fixtures; 20,000-point spatial fixture. Same geometry, source IDs, LOD budgets and camera trajectories. CPU update timings exclude emulated upload consumption; byte counts model visible instance attribute submissions, including first-use capacity. Does not measure GPU time or FPS.',equivalence:{checkedViews,checkedInstanceSlots,checkedGeometryBatches:verifiedGeometries.size,allInstanceMatricesColorsIdsGeometryAndMaterialsEqual:true},vegetation,spatial};
writeFileSync(new URL('instance-cpu-upload-ab.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
