import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {planWorldTransport} from '../src/world-transport.js';
import {createParkedContactShadows} from '../src/parked-contact-shadows.js';
const radii={spider:.7,roadster:2.6,hoverboard:1.7,helicopter:5};
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
function edgeDistance(p,a,b){const x=b.x-a.x,z=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.z-a.z)*z)/Math.max(1e-9,x*x+z*z)));return Math.hypot(p.x-a.x-t*x,p.z-a.z-t*z);}
function clear(p,polygon,radius){return !inside(p,polygon)&&polygon.every((a,i)=>edgeDistance(p,a,polygon[(i+1)%polygon.length])>=radius-1e-7);}

test('authored activity props leave all ground roads and building arrival spaces clear, with walkable approaches',()=>{
 const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),scene=new THREE.Scene(),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'}),model=createGeoScene(THREE,scene,source,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal}),route=createCommuteRoute(source,{frame,geoToLocal}),motion=createPlayerMotion({route,world:createPlayerWorld(model)});
 try{
  const plan=planWorldTransport({model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode}),roads=route.roadSurfaces.filter(s=>!s.bridge&&Math.abs((s.surfaceY??.14)-.14)<.5),entries=model.architectureInfrastructure.walkSurfaces.filter(s=>/entry|approach|stair|porch/i.test(`${s.kind||''} ${s.id||''}`));
  assert.deepEqual(plan.counts,{spider:10,roadster:3,hoverboard:5,helicopter:1,boat:2});assert.deepEqual(plan.rejected,[]);
  for(const item of plan.items.filter(i=>i.mode!=='boat')){
   for(const road of roads)assert.ok(clear(item,road.polygon,radii[item.mode]+.3),`${item.id} obstructs ${road.sourceId}`);
   for(const entry of entries)if(!entry.holes?.some(h=>inside(item,h)))assert.ok(clear(item,entry.polygon,radii[item.mode]+1.2),`${item.id} obstructs ${entry.id}`);
   if(item.mode==='helicopter')continue;
   const start=item.approachStart,end=item.approachPose;assert.ok(start&&end,item.id+' has a planned approach');assert.ok(Math.hypot(item.x-end.x,item.z-end.z)<item.interactionRadius);
   const steps=Math.max(1,Math.ceil(Math.hypot(start.x-end.x,start.z-end.z)/.2));
   for(let i=0;i<=steps;i++){const p={x:start.x+(end.x-start.x)*i/steps,z:start.z+(end.z-start.z)*i/steps,y:.14,yaw:item.yaw};assert.equal(motion.canPlaceMode(p,'walk').ok,true,item.id+' approach is walkable');}
  }
 }finally{campus.dispose();model.dispose();}
});

test('contact shadows share one bounded batch, do not upload idle matrices, and release each owned resource once',()=>{
 const suit={mode:'spider',x:2,y:.14,z:3,yaw:.3},car={mode:'roadster',x:8,y:.14,z:5,yaw:0},boat={mode:'boat',x:1,y:0,z:9,yaw:0},layer=createParkedContactShadows(THREE,[suit,car,boat]),mesh=layer.mesh;
 assert.equal(mesh.count,2);assert.equal(mesh.userData.maxInstances,2);assert.equal(mesh.material.map.image.width,64);
 const initial=mesh.instanceMatrix.version;layer.update(suit);layer.update(car);assert.equal(mesh.instanceMatrix.version,initial,'idle contact shadows do not re-upload');
 layer.update(suit,{visible:false});assert.equal(mesh.instanceMatrix.version,initial+1);const m=new THREE.Matrix4();mesh.getMatrixAt(0,m);assert.equal(m.elements[0],0);assert.equal(m.elements[10],0);
 layer.update(suit,{visible:false});assert.equal(mesh.instanceMatrix.version,initial+1);suit.x=20;layer.update(suit);mesh.getMatrixAt(0,m);assert.equal(m.elements[12],20);assert.ok(Math.abs(m.elements[13]-.149)<1e-6);
 const owned=[mesh,mesh.geometry,mesh.material,mesh.material.map],counts=owned.map(()=>0);owned.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));layer.dispose();layer.dispose();assert.deepEqual(counts,[1,1,1,1]);
});

test('storm board teardown is idempotent and late updates cannot recreate disposed graphics',async()=>{
 const {createCampusSurfboards}=await import('../src/campus-surfboards.js'),scene=new THREE.Scene(),water={active:true,elapsed:1,boardAt:()=>null},layer=createCampusSurfboards(THREE,scene,water),pose={x:0,y:.14,z:0,yaw:0,mode:'walk',speed:0};
 layer.update(pose);const owned=new Set();layer.root.traverse(o=>{if(o.geometry)owned.add(o.geometry);if(o.material)owned.add(o.material);if(o.isInstancedMesh)owned.add(o);});
 const disposed=new Map();for(const resource of owned)resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
 layer.dispose();layer.dispose();layer.update(pose);assert.equal(layer.root.visible,false);assert.equal(layer.root.children.length,0);assert.equal(scene.children.length,0);for(const resource of owned)assert.equal(disposed.get(resource),1);
 const idle=createCampusSurfboards(THREE,scene,{...water,active:false});idle.dispose();idle.update(pose);assert.equal(idle.root.children.length,0);
});
