import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {getRoadProfile} from '../src/building-profiles.js';
import {OPTO_ROAD_TRANSPORT_SITES,planOptoRoadTransport} from '../src/opto-road-transport.js';

const base=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),extension=JSON.parse(readFileSync(new URL('../public/data/opto-southeast.geojson',import.meta.url),'utf8'));
const before=JSON.stringify([base,extension]),source=mergeCampusExtension(base,extension),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal}),route=createCommuteRoute(source,{frame,geoToLocal});
const treeReservations=[...campus.landcoverPlan.trees,...campus.landcoverPlan.shrubs],options={model,route,frame,geoToLocal,treeReservations},plan=planOptoRoadTransport(options),world=createPlayerWorld(model);
const local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
const roads=model.roads.map(r=>{const g=r.feature.geometry;return{id:r.id,profile:getRoadProfile(r.feature),lines:(g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[]).map(line=>line.map(local))};});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);}
function roadDistance(p,road){return Math.min(...road.lines.flatMap(l=>l.slice(1).map((b,i)=>segmentDistance(p,l[i],b))));}
after(()=>{campus.dispose();model.dispose();});

test('six stable source-road pickups add three scooters, one roadster and two boards without a helicopter or source mutation',()=>{
 assert.deepEqual(plan.rejected,[]);assert.deepEqual(plan.counts,{scooter:3,roadster:1,hoverboard:2});assert.deepEqual(plan.items.map(p=>p.id),OPTO_ROAD_TRANSPORT_SITES.map(s=>s.id));assert.deepEqual(plan,planOptoRoadTransport(options));
 assert.equal(new Set(plan.items.map(p=>p.id)).size,6);assert.equal(JSON.stringify([base,extension]),before);
 for(const [i,p]of plan.items.entries()){assert.equal(p.sourceId,OPTO_ROAD_TRANSPORT_SITES[i].sourceId);assert.equal(p.placement,'光电楼沿路');assert.ok(p.z>250&&p.z<680);assert.ok(Math.abs(p.y-.14)<.001);for(const q of plan.items.slice(i+1))assert.ok(distance(p,q)>50,'spread along the connection, not a single parking cluster');}
});

test('parked footprints preserve every source carriageway and sidewalk, and remain close enough to see from their own road',()=>{
 for(const p of plan.items){
  const sourceRoad=roads.find(r=>r.id===p.sourceId);assert.ok(sourceRoad&&!sourceRoad.profile.bridge&&!sourceRoad.profile.tunnel);assert.ok(roadDistance(p,sourceRoad)<10);
  for(const road of roads)assert.ok(roadDistance(p,road)>=road.profile.width/2+p.clearanceRadius+.29,`${p.id} leaves ${road.id} clear`);
  for(const road of roads.filter(r=>r.profile.motor))assert.ok(roadDistance(p.boardingPose,road)>=road.profile.width/2+.38,`${p.id} boarding stays outside a motor lane`);
 }
});

test('vehicle and complete walking approach clear the actual rendered tree trunks, shrub patches and existing commute parking',()=>{
 for(const p of plan.items){
  for(const t of treeReservations){const radius=(t.height??0)>3?Math.max(.65,(t.radius??3.5)*.18):t.radius??.7;assert.ok(distance(p,t)>=p.clearanceRadius+radius+.25,`${p.id} vegetation envelope`);}
  for(const t of route.parkingPlaces)assert.ok(distance(p,t)>=p.clearanceRadius+1.4,`${p.id} existing parked scooter`);
  const length=distance(p.approachPose,p.boardingPose),steps=Math.ceil(length/.1);
  for(let i=0;i<=steps;i++){const t=i/Math.max(1,steps),q={x:p.approachPose.x+(p.boardingPose.x-p.approachPose.x)*t,z:p.approachPose.z+(p.boardingPose.z-p.approachPose.z)*t};for(const tree of treeReservations){const radius=(tree.height??0)>3?Math.max(.65,(tree.radius??3.5)*.18):tree.radius??.7;assert.ok(distance(q,tree)>=.38+radius+.25,'not separated from the road by plants');}}
 }
});

test('real full-campus movement walks from each road shoulder to pickup, mounts and dismounts without collision or a height jump',()=>{
 for(const p of plan.items){
  const motion=createPlayerMotion({route,world}),start=p.approachPose,target=p.boardingPose;
  assert.equal(motion.placeWalker(start).ok,true,`${p.id} road shoulder`);
  for(let step=0;step<600;step++){
   const dx=target.x-motion.state.x,dz=target.z-motion.state.z,d=Math.hypot(dx,dz);if(d<.045)break;
   motion.step(1/120,{moveX:dx/d*.3,moveZ:dz/d*.3});assert.equal(motion.state.blockedReason,'',`${p.id}: walk-in ${motion.state.blockedReason}`);assert.ok(Math.abs(motion.state.y-.14)<.05);
  }
  assert.ok(distance(motion.state,target)<.05,`${p.id} reaches pickup on foot`);assert.ok(distance(motion.state,p)<p.interactionRadius);
  assert.equal(motion.canPlaceMode(p,p.mode).ok,true);assert.equal(motion.placeMode(p,p.mode).ok,true);assert.equal(motion.state.mode,p.mode);assert.ok(Math.abs(motion.state.y-.14)<.05);
  assert.equal(motion.placeWalker(target).ok,true,`${p.id} can dismount next to the vehicle`);assert.ok(distance(motion.state,target)<.001);assert.equal(motion.state.mode,'walk');
 }
});

test('missing source roads and newly occupied verge areas omit only unsafe pickups, without teleporting them to unrelated roads',()=>{
 assert.deepEqual(planOptoRoadTransport().items,[]);
 const roadster=OPTO_ROAD_TRANSPORT_SITES.find(s=>s.mode==='roadster'),missing=planOptoRoadTransport({...options,model:{...model,roads:model.roads.filter(r=>r.id!==roadster.sourceId)}});
 assert.equal(missing.items.length,5);assert.ok(!missing.items.some(p=>p.id===roadster.id));assert.ok(missing.rejected.some(p=>p.id===roadster.id&&p.reason==='missing-or-nonground-source-road'));
 const occupied=planOptoRoadTransport({...options,treeReservations:[...treeReservations,{...OPTO_ROAD_TRANSPORT_SITES[0].target,radius:40,height:1}]});
 assert.ok(!occupied.items.some(p=>p.id===OPTO_ROAD_TRANSPORT_SITES[0].id));assert.equal(occupied.items.length,5);assert.ok(occupied.rejected.some(p=>p.id===OPTO_ROAD_TRANSPORT_SITES[0].id));
 const refused=planOptoRoadTransport({...options,groundAt:()=>({allowed:true,height:.14}),canPlaceMode:()=>({ok:false})});assert.equal(refused.items.length,0);assert.equal(refused.rejected.length,6);
});
