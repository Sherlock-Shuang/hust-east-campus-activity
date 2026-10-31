import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {planResidentialTrafficRoute,sampleResidentialTrafficPath,RESIDENTIAL_TRAFFIC_SOURCES} from '../src/residential-traffic-route.js';

const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(){const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),route=createCommuteRoute(source,{frame,geoToLocal});return{scene,model,route};}
const plan=f=>planResidentialTrafficRoute({...f,frame,geoToLocal});
function inside(ring,x,z){let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)result=!result;}return result;}
const samples=(path,step=.25)=>Array.from({length:Math.ceil(path.length/step)+1},(_,i)=>sampleResidentialTrafficPath(path,i*path.length/Math.ceil(path.length/step)));

test('gate approach adds only six riders and six pedestrians on three stable source-backed paths',()=>{
 const f=fixture(),before=JSON.stringify(source),routeBefore=JSON.stringify(f.route.points);
 try{const a=plan(f),b=plan(f);assert.equal(a.accepted,true);assert.deepEqual(a,b);assert.deepEqual(a.rejected,[]);
  assert.equal(a.gate.id,RESIDENTIAL_TRAFFIC_SOURCES.gate);assert.ok(Math.hypot(a.gate.x-529.60877,a.gate.z+79.80529)<.001);
  assert.deepEqual(a.paths.map(p=>[p.kind,p.count]),[['scooter',6],['walk',3],['walk',3]]);
  assert.equal(new Set(a.paths.map(p=>p.id)).size,3);for(const p of a.paths){assert.ok(Object.isFrozen(p));assert.ok(p.length>190&&p.length<210);assert.equal(p.points.length+1,p.distances.length);}
  assert.equal(JSON.stringify(source),before);assert.equal(JSON.stringify(f.route.points),routeBefore);
 }finally{f.model.dispose();}
});

test('paths stay outside the existing gate junction and use distinct mapped sidewalks',()=>{
 const f=fixture();try{const p=plan(f);assert.deepEqual(p.paths.map(p=>p.sourceId),[RESIDENTIAL_TRAFFIC_SOURCES.road,RESIDENTIAL_TRAFFIC_SOURCES.eastWalk,RESIDENTIAL_TRAFFIC_SOURCES.westWalk]);
  for(const path of p.paths)for(const pose of samples(path)){
   assert.ok(pose.z>-36&&pose.z<67,'loops stop before junction and south crossing');
   assert.ok(Math.hypot(pose.x-539.630231,pose.z+62.478178)>25,'do not cross red/green junction');
   for(let i=0;i<16;i++){const angle=i*Math.PI/8,x=pose.x+Math.cos(angle)*path.bodyRadius,z=pose.z+Math.sin(angle)*path.bodyRadius;assert.ok(path.corridors.some(c=>inside(c,x,z)),`${path.id} full body on own pavement`);}
  }
 }finally{f.model.dispose();}
});

test('riders keep the outer right half of both directions and slow smoothly for continuous turnarounds',()=>{
 const f=fixture();try{const path=plan(f).paths.find(p=>p.kind==='scooter');let forward=0,backward=0,minSpeed=Infinity,maxSpeed=0;
  for(const pose of samples(path,.1)){
   minSpeed=Math.min(minSpeed,pose.speed);maxSpeed=Math.max(maxSpeed,pose.speed);
   if(pose.z<-24||pose.z>55)continue;
   let near=null;for(let i=1;i<path.centerline.length;i++){const a=path.centerline[i-1],b=path.centerline[i],dx=b.x-a.x,dz=b.z-a.z,d2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((pose.x-a.x)*dx+(pose.z-a.z)*dz)/d2)),x=a.x+dx*t,z=a.z+dz*t,d=Math.hypot(pose.x-x,pose.z-z);if(!near||d<near.d)near={d,side:((pose.x-x)*-dz+(pose.z-z)*dx)/Math.sqrt(d2)};}
   assert.ok(near.side*pose.direction>1.5,'right edge rather than car centre');if(pose.direction===1)forward++;else backward++;
  }assert.ok(forward>100&&backward>100);assert.equal(minSpeed,1.25);assert.equal(maxSpeed,3.7);
 }finally{f.model.dispose();}
});

test('arc-length sampling is continuous across loop wrap, finite and reuses its output object',()=>{
 const f=fixture();try{for(const path of plan(f).paths){const out={},zero=sampleResidentialTrafficPath(path,0),end=sampleResidentialTrafficPath(path,path.length);
  assert.ok(Math.hypot(zero.x-end.x,zero.z-end.z)<1e-8);assert.ok(Math.abs(Math.sin(zero.yaw-end.yaw))<1e-8);
  assert.equal(sampleResidentialTrafficPath(path,10,out),out);for(const n of Object.values(out))assert.ok(Number.isFinite(n));
  const poses=samples(path,.05);for(let i=1;i<poses.length;i++){const a=poses[i-1],b=poses[i];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.051);assert.ok(Math.abs(Math.atan2(Math.sin(a.yaw-b.yaw),Math.cos(a.yaw-b.yaw)))<.4,'no abrupt heading jump');}
  const a=sampleResidentialTrafficPath(path,-.01),b=sampleResidentialTrafficPath(path,.01);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.021);
 }}finally{f.model.dispose();}
});

test('missing source data or new blocking structures omit only unsafe paths',()=>{
 assert.deepEqual(planResidentialTrafficRoute().paths,[]);const f=fixture();try{
  const absent={...f.model,records:f.model.records.filter(r=>r.id!==RESIDENTIAL_TRAFFIC_SOURCES.gate)};assert.equal(plan({...f,model:absent}).accepted,false);
  const withoutEast={...f.model,records:f.model.records.filter(r=>r.id!==RESIDENTIAL_TRAFFIC_SOURCES.eastWalk)};assert.equal(plan({...f,model:withoutEast}).paths.length,2);
  const p=plan(f).paths[0],mid=sampleResidentialTrafficPath(p,p.length*.25);
  f.model.architectureInfrastructure={buildings:[{height:5,polygon:[{x:mid.x-3,z:mid.z-3},{x:mid.x+3,z:mid.z-3},{x:mid.x+3,z:mid.z+3},{x:mid.x-3,z:mid.z+3}]}]};
  const blocked=plan(f);assert.ok(!blocked.paths.some(p=>p.kind==='scooter'));assert.ok(blocked.rejected.some(r=>r.id==='residential-road'&&r.reason==='source-pavement-or-static-obstacle'));
 }finally{f.model.dispose();}
});

test('complete reconstructed campus preserves all twelve actors and physically clear ground poses',()=>{
 const f=fixture(),campus=createCampus3D(THREE,f.model,{frame,geoToLocal});
 try{const p=plan(f);assert.deepEqual(p.rejected,[]);assert.equal(p.paths.length,3);const motion=createPlayerMotion({route:f.route,world:createPlayerWorld(f.model)});
  for(const path of p.paths)for(const pose of samples(path,2)){const ground=motion.groundAt(pose.x,pose.z,path.bodyRadius,pose.y);assert.ok(ground.allowed,`${path.id}: ${ground.reason}`);assert.ok(Math.abs(ground.height-pose.y)<.05,`${path.id} ground height`);}
 }finally{campus.dispose();f.model.dispose();}
});
