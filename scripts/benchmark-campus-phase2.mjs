import * as THREE from 'three';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createTreeLayer} from '../src/vegetation.js';
import {createCampus3D,createCampus3DProgressive} from '../src/campus-3d.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {getCampusPlayerSpawn} from '../src/player-experience.js';
const root=new URL('../',import.meta.url),output=new URL('artifacts/performance-phase2-2026-10-30/',root);
const baselineRoot=new URL('baseline-a432493/',output);mkdirSync(baselineRoot,{recursive:true});
execFileSync('tar',['-x','-C',fileURLToPath(baselineRoot)],{input:execFileSync('git',['archive','a432493','src'],{cwd:root,maxBuffer:32*1024*1024})});
const baseline=await import(new URL('src/vegetation.js',baselineRoot));
const baselineCampus=await import(new URL('src/campus-3d.js',baselineRoot));
const trees=Array.from({length:7800},(_,i)=>({x:(i%100)*17-850,z:Math.floor(i/100)*17-650,height:8+i%10,radius:3.5+(i%4)*.45,seed:(i*.618)%1,featureId:`fixture-${i}`}));
const normal=baseline.createTreeLayer(THREE,trees,{detail:'forest'}),indexed=createTreeLayer(THREE,trees,{detail:'forest'}),resident=createTreeLayer(THREE,trees,{detail:'forest',resident:true});
const camera=new THREE.PerspectiveCamera(58,16/9,.1,1800);
const positions=Array.from({length:96},(_,i)=>{const angle=i/96*Math.PI*2;return{x:Math.sin(angle)*480,z:Math.cos(angle)*420,y:4+(i%8)*2,angle};});
const move=p=>{camera.position.set(p.x,p.y,p.z);camera.lookAt(p.x+Math.cos(p.angle+.4)*350,9,p.z-Math.sin(p.angle+.4)*350);camera.updateMatrixWorld();};
function run(layer){const start=performance.now();for(const p of positions){move(p);layer.update(camera,{detailDistanceScale:.85});}return performance.now()-start;}
const trials={baseline:[],indexed:[],resident:[]};
for(let i=0;i<2;i++){run(normal);run(indexed);run(resident);}
for(let i=0;i<8;i++){for(const key of(i%2?['resident','indexed','baseline']:['baseline','indexed','resident']))trials[key].push(run({baseline:normal,indexed,resident}[key]));}
const median=list=>[...list].sort((a,b)=>a-b)[Math.floor(list.length/2)];
const allocated=layer=>layer.group.children.reduce((n,m)=>n+(m.instanceMatrix?.array.byteLength||0)+(m.instanceColor?.array.byteLength||0),0);
const vegetation={fixtureTrees:trees.length,camerasPerTrial:positions.length,trialsMs:trials,medianMs:Object.fromEntries(Object.entries(trials).map(([k,v])=>[k,median(v)])),lastViewCandidateCount:indexed.group.userData.visibilityStats.candidates,baselineBytes:allocated(normal),residentBytes:allocated(resident),residentCapacity:resident.residency.reduce((n,b)=>n+b.residentCapacity,0)};
resident.releaseDecorativeResources();vegetation.suspendedBytes=allocated(resident);resident.resumeDecorativeResources();move(positions.at(-1));resident.update(camera,{detailDistanceScale:.85});vegetation.resumedBytes=allocated(resident);
normal.dispose();indexed.dispose();resident.dispose();
const read=name=>JSON.parse(readFileSync(new URL(`public/data/${name}`,root)));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson')),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),model=()=>createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const startup=[];
for(let i=0;i<3;i++){
  const a=model();let start=performance.now();const full=baselineCampus.createCampus3D(THREE,a,{frame,geoToLocal});const fullMs=performance.now()-start;full.dispose();a.dispose();
  const b=model();start=performance.now();let chunks=[],chunkStart=start;
  const campus=await createCampus3DProgressive(THREE,b,{frame,geoToLocal},{initialPosition:getCampusPlayerSpawn(b),budgetMs:6,yieldTask:async()=>{chunks.push(performance.now()-chunkStart);await new Promise(resolve=>setImmediate(resolve));chunkStart=performance.now();}});const readyMs=performance.now()-start,pending=campus.group.userData.progressive.pendingFacades;
  const complete=await campus.whenDetailedReady;if(complete.error)throw complete.error;
  const detailedMs=performance.now()-start;
  const spawn=getCampusPlayerSpawn(b);camera.position.set(spawn.x,3.5,spawn.z+8);camera.lookAt(spawn.x,2,spawn.z-70);camera.updateMatrixWorld();campus.update(camera,{detailDistanceScale:.85});
  const decoration=campus.decorationStats,all=[...decoration.batches,...decoration.trees];
  const residency={fullCapacityBytes:all.reduce((n,b)=>n+b.fullCapacityBytes,0),residentBytes:all.reduce((n,b)=>n+b.residentBytes,0),batches:all.length};
  campus.releaseDecorativeResources();residency.suspendedBytes=[...campus.decorationStats.batches,...campus.decorationStats.trees].reduce((n,b)=>n+b.residentBytes,0);
  startup.push({trial:i,fullSynchronousMs:fullMs,readyMs,detailedMs,pendingFacadesAtHandoff:pending,maxTaskMs:Math.max(...chunks),residency});campus.dispose();b.dispose();
}
const report={baselineRevision:'a432493',generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,conditions:'Same Node process, deterministic synthetic 7800-tree grid, fixed camera sequence, alternating A/B order after warmup. Startup CPU tasks yield with setImmediate: no download/render/present/network or actual FPS inference. Baseline full src extracted read-only from a432493; both builds use identical current public source map. New and baseline photograph building modules therefore share source revision.',vegetation,startup};
mkdirSync(output,{recursive:true});writeFileSync(new URL('campus-cpu-residency.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
