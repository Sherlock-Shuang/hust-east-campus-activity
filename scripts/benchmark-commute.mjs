import {readFileSync,writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createCommuteRoute} from '../src/commute-route.js';
const {createCommuteSimulation}=await import(process.argv.includes('--baseline')?'../deployment/vercel-app/src/commute-simulation.js':'../src/commute-simulation.js');
const {createCommuteScene}=await import(process.argv.includes('--baseline')?'../deployment/vercel-app/src/commute-scene.js':'../src/commute-scene.js');
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
const fc=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const route=createCommuteRoute(fc,{frame,geoToLocal});
const sim=createCommuteSimulation(route,{seed:943108,startMinutes:478,density:1,scooterShare:.86,vehicleLanes:3,signals:true});
const scene=new THREE.Scene(),visual=createCommuteScene(THREE,scene,route,sim);
const camera=new THREE.PerspectiveCamera(58,16/9,.12,1600);
const p=sim.getPoseAt(route.length*.4,0);camera.position.set(p.x+7,p.y+3,p.z+8);camera.lookAt(p.x,p.y+1,p.z-8);camera.updateMatrixWorld();
let samples=[];for(let i=0;i<1200;i++){const start=performance.now();sim.step(1/60);samples.push(performance.now()-start);}const checksum=createHash('sha256').update(JSON.stringify(sim.state)).digest('hex');
const stats=values=>{values.sort((a,b)=>a-b);return{mean:values.reduce((a,b)=>a+b,0)/values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],maximum:values.at(-1)};};
const simulationMs=stats(samples);samples=[];
for(let i=0;i<120;i++){visual.update(camera);}for(let i=0;i<600;i++){const start=performance.now();visual.update(camera);samples.push(performance.now()-start);}
const staticViewMs=stats(samples);samples=[];
for(let i=0;i<600;i++){const a=sim.getPoseAt(route.length*.4+i*.025,0);camera.position.set(a.x+7,a.y+3,a.z+8);camera.lookAt(a.x,a.y+1,a.z-8);camera.updateMatrixWorld();const start=performance.now();visual.update(camera);samples.push(performance.now()-start);}
const movingViewMs=stats(samples);samples=[];
const attributeVersions=new WeakMap();let instanceUploadBytes=0;
for(let i=0;i<600;i++){sim.step(1/60);const start=performance.now();visual.update(camera);samples.push(performance.now()-start);
  visual.group.traverse(mesh=>{if(!mesh.isInstancedMesh)return;for(const attribute of[mesh.instanceMatrix,mesh.instanceColor]){if(!attribute)continue;const old=attributeVersions.get(attribute);if(old!==undefined&&old!==attribute.version)instanceUploadBytes+=(attribute.updateRanges.length?attribute.updateRanges.reduce((sum,range)=>sum+range.count,0):attribute.array.length)*attribute.array.BYTES_PER_ELEMENT;attributeVersions.set(attribute,attribute.version);}});
}
const liveTrafficViewMs=stats(samples);
const renderHash=createHash('sha256');visual.group.traverse(o=>{if(!o.isInstancedMesh)return;renderHash.update(o.name);renderHash.update(String(o.count));renderHash.update(Buffer.from(o.instanceMatrix.array.buffer,0,o.count*16*4));if(o.instanceColor)renderHash.update(Buffer.from(o.instanceColor.array.buffer,0,o.count*3*4));});
const result={renderChecksum:renderHash.digest('hex'),description:'Node CPU only; seeded real campus commute, 1200 simulation frames at 60Hz then 600 static, moving view and live traffic view updates; no GPU/renderer',node:process.version,agents:sim.agents.length,parking:visual.counts.parked,simulationMs,staticViewMs,movingViewMs,liveTrafficViewMs,scheduledInstanceUploadBytesPerVisualUpdate:instanceUploadBytes/599,simulationChecksum:checksum};
visual.dispose();const output=JSON.stringify(result,null,2);console.log(output);const path=process.argv[2];if(path)writeFileSync(path,output+'\n');
