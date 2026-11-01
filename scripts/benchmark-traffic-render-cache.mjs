// CPU-only deterministic traffic update comparison. No WebGL context is used;
// buffer bytes below are queued update ranges, not measured GPU time or FPS.
// node scripts/benchmark-traffic-render-cache.mjs --baseline-ref 169d89c
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {createCommuteScene as optimized} from '../src/commute-scene.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const ref=process.argv[process.argv.indexOf('--baseline-ref')+1];
if(!process.argv.includes('--baseline-ref')||!ref)throw new Error('Pass --baseline-ref <commit> to compare with a known source revision.');
const baselinePath=fileURLToPath(new URL(`../src/.traffic-baseline-${process.pid}.mjs`,import.meta.url));
const layers=[];
try{
  writeFileSync(baselinePath,execFileSync('git',['show',`${ref}:src/commute-scene.js`],{cwd:root}));
  const {createCommuteScene:baseline}=await import(pathToFileURL(baselinePath));
  const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url)));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const route=createCommuteRoute(data,{frame,geoToLocal});
  const sim=createCommuteSimulation(route,{seed:943108,startMinutes:478,scooterShare:.86,vehicleLanes:3,signals:true});
  const before=baseline(THREE,new THREE.Scene(),route,sim),after=optimized(THREE,new THREE.Scene(),route,sim);layers.push(before,after);
  const meshes=layer=>layer.group.children.filter(m=>m.isInstancedMesh&&/scooter|pedestrian/.test(m.userData.component));
  const digest=layer=>{const hash=createHash('sha256');for(const mesh of meshes(layer)){hash.update(JSON.stringify([mesh.name,mesh.count,mesh.userData.agentIds]));for(const [buffer,n]of[[mesh.instanceMatrix,16],[mesh.instanceColor,3]])if(buffer&&mesh.count)hash.update(Buffer.from(buffer.array.buffer,buffer.array.byteOffset,mesh.count*n*4));}return hash.digest('hex');};
  const consume=layer=>{for(const mesh of meshes(layer)){mesh.instanceMatrix.clearUpdateRanges();mesh.instanceColor?.clearUpdateRanges();}};
  const camera=new THREE.PerspectiveCamera(58,16/9,.1,1600);
  let comparisons=0;
  // Exact final data, not just counts: changing views, detail bands, movement,
  // flood animation, active membership, and borrowed parking all participate.
  for(let i=0;i<48;i++){
    sim.step(1/20);const focus=sim.agents[i%sim.agents.length];
    camera.position.set(focus.x+Math.sin(i*.4)*18,focus.y+3+(i%6)*4,focus.z+20);camera.lookAt(focus.x,focus.y+1,focus.z);
    for(const layer of layers){layer.setDetailDistanceScale([.45,1,1.25][i%3]);layer.setFloodState(i>=24&&i<36?{id:'qa',elapsed:180+i*.05}:null);layer.update(camera);}
    assert.equal(digest(after),digest(before),`visible matrices/colours/IDs differ at view ${i}`);comparisons++;
    layers.forEach(consume);
  }
  for(const layer of layers){const item=layer.scooterTransport.items.find(e=>e.origin==='parking');assert.equal(layer.scooterTransport.take(item).ok,true);assert.equal(layer.scooterTransport.release(item,{x:item.x+1,y:item.y,z:item.z+2,yaw:.7}).ok,true);}
  assert.equal(digest(after),digest(before),'parking pickup/return differs');comparisons++;
  // Use no camera for the stress case so every authored traffic/parking actor
  // is selected, without changing the production density or LOD thresholds.
  // A fresh fixture clears the retained camera from the equivalence phase.
  layers.forEach(layer=>layer.dispose());layers.length=0;
  const sampleSim=createCommuteSimulation(route,{seed:943108,startMinutes:478,scooterShare:.86,vehicleLanes:3,signals:true});
  const pairs=[['before',baseline(THREE,new THREE.Scene(),route,sampleSim)],['after',optimized(THREE,new THREE.Scene(),route,sampleSim)]];layers.push(...pairs.map(p=>p[1]));
  const measurements={};
  const conditions={unchanged:()=>{},oneActor:step=>{sampleSim.agents[0].x+=.001;},allMoving:step=>{for(const actor of sampleSim.agents){actor.x+=.001;actor.progress+=.01;}}};
  for(const [condition,mutate]of Object.entries(conditions)){
    const timing={before:[],after:[]};
    for(let step=0;step<360;step++){
      mutate(step);
      // Alternate order to reduce systematic JIT/GC scheduling bias.
      for(const [name,layer]of step%2?[...pairs].reverse():pairs){
        const start=performance.now();layer.update();const elapsed=performance.now()-start;if(step>=60)timing[name].push(elapsed);consume(layer);
      }
    }
    measurements[condition]=Object.fromEntries(Object.entries(timing).map(([name,values])=>{values.sort((a,b)=>a-b);return[name,{meanMs:values.reduce((n,v)=>n+v,0)/values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)]}];}));
  }
  const writes={};
  for(const [name,layer]of pairs){
    let matrixWrites=0,colorWrites=0;
    for(const mesh of meshes(layer)){const matrix=mesh.setMatrixAt,color=mesh.setColorAt;mesh.setMatrixAt=function(...args){matrixWrites++;return matrix.apply(this,args);};mesh.setColorAt=function(...args){colorWrites++;return color.apply(this,args);};}
    consume(layer);sampleSim.agents[0].x+=.001;layer.update();
    let matrixBytes=0,colorBytes=0;for(const mesh of meshes(layer)){for(const r of mesh.instanceMatrix.updateRanges)matrixBytes+=r.count*4;for(const r of mesh.instanceColor?.updateRanges||[])colorBytes+=r.count*4;}
    writes[name]={matrixWrites,colorWrites,queuedMatrixBytes:matrixBytes,queuedColorBytes:colorBytes};
  }
  console.log(JSON.stringify({node:process.version,baselineRef:ref,scope:'CPU only, no GPU/FPS measurement; 60 warmups + 300 timed updates, alternating before/after',actors:sampleSim.agents.length,parked:layers[0].counts.parked,parts:meshes(layers[0]).length,exactViewComparisons:comparisons,measurements,oneActorChanged:writes},null,2));
}finally{
  layers.forEach(layer=>layer.dispose());try{unlinkSync(baselinePath);}catch{}
}
