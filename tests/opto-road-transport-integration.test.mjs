import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {createCommuteScene} from '../src/commute-scene.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createPlayerModels} from '../src/player-models.js';
import {createTransportInteraction} from '../src/transport-interaction.js';
import {createWorldTransport,planWorldTransport} from '../src/world-transport.js';
import {planOptoRoadTransport} from '../src/opto-road-transport.js';
const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name,import.meta.url),'utf8'));
const source=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(t){
 const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal}),route=createCommuteRoute(source,{frame,geoToLocal});
 const plan=planOptoRoadTransport({model,route,frame,geoToLocal,treeReservations:[...campus.landcoverPlan.trees,...campus.landcoverPlan.shrubs]});
 const parking=plan.items.filter(i=>i.mode==='scooter').map((i,index)=>({...i,id:-200001-index,activityId:i.id,contactMode:'independent',y:i.y+.021,colorIndex:index+3}));
 const sim=createCommuteSimulation(route,{peakAgents:0,flowScale:0,maxAgents:0}),visual=createCommuteScene(THREE,scene,route,sim,{model,activityParking:parking}),models=createPlayerModels(THREE);
 const motion=createPlayerMotion({route,world:createPlayerWorld(model,{movableParking:true}),traffic:()=>visual.scooterTransport.parkedAgents,getPoseAt:sim.getPoseAt});
 const baselineMotion=createPlayerMotion({route,world:createPlayerWorld(model,{movableParking:true}),traffic:()=>visual.scooterTransport.parkedAgents.filter(i=>!i.activityId),getPoseAt:sim.getPoseAt});
 const original=planWorldTransport({model,route,groundAt:baselineMotion.groundAt,canPlaceMode:baselineMotion.canPlaceMode}),options={model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode},world=createWorldTransport({...options,THREE,scene,playerModels:models,additionalItems:plan.items.filter(i=>i.mode!=='scooter')});
 t.after(()=>{world.dispose();models.dispose();visual.dispose();campus.dispose();model.dispose();});return{scene,model,campus,route,plan,visual,motion,original,world};
}

test('opto roadside inventory appends three usable vehicles and three scooters without changing original props',t=>{
 const f=fixture(t);assert.equal(f.plan.items.length,6);assert.deepEqual(f.plan.rejected,[]);assert.deepEqual(f.world.plan.rejected,[]);
 assert.equal(f.world.items.length,24);assert.equal(f.visual.scooterTransport.items.filter(i=>i.record.activityId).length,3);
 for(let i=0;i<f.original.items.length;i++){const old=f.original.items[i],next=f.world.items[i];for(const key of ['id','mode','x','y','z','yaw'])assert.equal(next[key],old[key],'original '+old.id+' '+key);}
 assert.equal(f.world.items.filter(i=>i.mode==='helicopter').length,1,'only one original helicopter');
 for(const item of f.plan.items){
  const actual=item.mode==='scooter'?f.visual.scooterTransport.items.find(i=>i.record.activityId===item.id):f.world.items.find(i=>i.id===item.id);
  assert.ok(actual,item.id+' is actually integrated');assert.ok(Math.abs(actual.y-item.y)<.000001,'same ground level');
  assert.ok(f.motion.groundAt(actual.x,actual.z,0,actual.y).allowed,item.id+' is on reachable ground');
  if(item.mode!=='scooter')assert.equal(f.motion.canPlaceMode(actual,actual.mode).ok,true,item.id+' is mountable');
 }
});

test('each additional transport can mount and dismount through the real adapter without duplicate parked copies',t=>{
 const f=fixture(t),interaction=createTransportInteraction({motion:f.motion,sources:[f.world,f.visual.scooterTransport]});
 for(const item of f.plan.items){
  const target=item.mode==='scooter'?f.visual.scooterTransport.items.find(i=>i.record.activityId===item.id):f.world.items.find(i=>i.id===item.id);
  const offsets=[1,-1],candidates=item.boardingPose?[item.boardingPose]:[];
  for(const side of offsets)for(const r of [1.4,2,2.6,3.1])candidates.push({x:item.x+Math.cos(item.yaw)*r*side,y:item.y,z:item.z-Math.sin(item.yaw)*r*side,yaw:item.yaw});
  let selected=false;
  for(const p of candidates){if(!f.motion.placeWalker(p).ok)continue;if(interaction.nearest()?.item===target){selected=true;break;}}
  assert.ok(selected,'reachable interaction point for '+item.id);
  assert.ok(interaction.mount().ok,'mount '+item.id);assert.equal(f.motion.state.mode,item.mode);
  if(item.mode==='hoverboard'){
   const ground=f.motion.state.y;for(let i=0;i<360;i++)f.motion.step(1/120,{vertical:1});
   assert.ok(f.motion.state.y>ground+2,'board has actual takeoff clearance at '+item.id);
   for(let i=0;i<1200&&!f.motion.state.grounded;i++)f.motion.step(1/120,{vertical:-1});
   assert.equal(f.motion.state.grounded,true,'board lands at '+item.id);
  }
  assert.ok(interaction.dismount().ok,'dismount '+item.id);assert.equal(f.motion.state.mode,'walk');
  if(item.mode==='scooter'){assert.equal(f.visual.scooterTransport.items.filter(i=>i.record.activityId===item.id).length,1);assert.equal(target.mounted,false);}
  else{assert.equal(f.world.items.filter(i=>i.id===item.id).length,1);assert.equal(target.taken,false);}
 }
});

test('new scooters use existing batches and new cars/boards share static geometry, with distant props hidden',t=>{
 const f=fixture(t),added=f.world.items.filter(i=>i.activityRegion==='opto-road'),boards=f.world.items.filter(i=>i.mode==='hoverboard');
 assert.equal(added.length,3);for(const item of added){assert.ok(item.visual.children.length<40);assert.equal(item.visual.children[0].geometry,boards.includes(item)?boards[0].visual.children[0].geometry:f.world.items.find(i=>i.mode===item.mode).visual.children[0].geometry);}
 f.world.update(0,{x:9999,y:.14,z:9999,mode:'walk'});assert.ok(added.every(i=>!i.visual.visible));
 for(const item of added){f.world.update(0,{...item,mode:'walk'});assert.equal(item.visual.visible,true);}
 const camera=new THREE.PerspectiveCamera(70,16/9,.1,20000);camera.position.set(9000,100,9000);camera.lookAt(9001,100,9000);f.visual.update(camera);
 const ids=new Set(f.visual.scooterTransport.items.filter(i=>i.record.activityId).map(i=>i.record.id));
 f.visual.group.traverse(o=>{if(o.isInstancedMesh)assert.ok((o.userData.agentIds||[]).every(id=>!ids.has(id)));});
});
