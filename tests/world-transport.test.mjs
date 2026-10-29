import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {waterFootprint} from '../src/water-details.js';
import {createWorldTransport,planWorldTransport} from '../src/world-transport.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createCommuteScene} from '../src/commute-scene.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {createPlayerModels} from '../src/player-models.js';
const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(){const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),route=createCommuteRoute(source,{frame,geoToLocal}),motion=createPlayerMotion({route,world:createPlayerWorld(model)});return{scene,model,route,motion};}
function mockModels(){const group=new THREE.Group(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();for(const mode of['roadster','hoverboard','helicopter','boat']){const g=new THREE.Group();g.name=`player-${mode}`;g.add(new THREE.Mesh(geometry,material));group.add(g);}return{group,geometry,material};}

test('game placements contain exact requested counts, stable ids and no source mutation',()=>{
 const {model,route,motion}=fixture(),before=JSON.stringify(source);try{const options={model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode},a=planWorldTransport(options),b=planWorldTransport(options);assert.deepEqual(a.counts,{spider:10,roadster:3,hoverboard:5,helicopter:1,boat:2});assert.deepEqual(a,b);assert.equal(new Set(a.items.map(i=>i.id)).size,21);assert.equal(JSON.stringify(source),before);assert.equal(a.rejected.length,0);}finally{model.dispose();}
});
test('single helicopter clears lawn boundary and ground pickups never occupy buildings or water',()=>{
 const {model,route,motion}=fixture();try{const plan=planWorldTransport({model,route,groundAt:motion.groundAt}),lawn=waterFootprint(model.records.find(r=>r.id==='way/98867860')),blocks=[...model.buildings,...model.water].map(waterFootprint).filter(Boolean);for(const item of plan.items.filter(i=>i.mode!=='boat')){assert.ok(motion.groundAt(item.x,item.z).allowed,item.id);assert.ok(blocks.every(b=>!b.contains(item.x,item.z)),item.id);assert.equal(item.y,motion.groundAt(item.x,item.z).height);}const helicopter=plan.items.find(i=>i.mode==='helicopter');assert.ok(lawn.contains(helicopter.x,helicopter.z));assert.ok(lawn.distance(helicopter.x,helicopter.z)>6);}finally{model.dispose();}
});
test('yachts float inside source lake and board from nearby solid land without island shortcut',()=>{
 const {model,route,motion}=fixture();try{const plan=planWorldTransport({model,route,groundAt:motion.groundAt}),lake=model.water.find(r=>r.id==='relation/13705236'),water=waterFootprint(lake);for(const boat of plan.items.filter(i=>i.mode==='boat')){assert.ok(water.contains(boat.x,boat.z));assert.equal(boat.y,lake.mesh.position.y);assert.ok(motion.groundAt(boat.boardingPose.x,boat.boardingPose.z).allowed);assert.ok(Math.hypot(boat.x-boat.boardingPose.x,boat.z-boat.boardingPose.z)<5);assert.ok(!water.contains(boat.boardingPose.x,boat.boardingPose.z));}}finally{model.dispose();}
});
test('take/release transfers one prop, refuses duplicates and keeps its new parked position',()=>{
 const {scene,model,route,motion}=fixture(),playerModels=mockModels();const layer=createWorldTransport({THREE,scene,model,route,groundAt:motion.groundAt,playerModels});try{const item=layer.items.find(i=>i.mode==='roadster');assert.equal(layer.nearest({...item,mode:'walk'}),item);assert.equal(layer.take(item).ok,true);assert.equal(item.visual.visible,false);assert.equal(layer.take(item).ok,false);assert.notEqual(layer.nearest(item),item);const pose={x:item.x+8,y:item.y,z:item.z+3,yaw:.4};assert.equal(layer.release(item,pose).ok,true);assert.equal(item.visual.visible,true);assert.equal(item.x,pose.x);assert.equal(layer.release(item,pose).ok,false);assert.equal(layer.items.filter(i=>i.id===item.id).length,1);assert.equal(layer.nearest({...pose,mode:'walk'}),item);assert.equal(layer.nearest({...pose,y:30,mode:'walk'}),null);}finally{layer.dispose();model.dispose();playerModels.geometry.dispose();playerModels.material.dispose();}
});
test('dock boarding is reachable from land, dismount cannot teleport to a distant old dock and shared rig resources survive disposal',()=>{
 const {scene,model,route,motion}=fixture(),playerModels=mockModels();let geometryDisposals=0,materialDisposals=0;playerModels.geometry.addEventListener('dispose',()=>geometryDisposals++);playerModels.material.addEventListener('dispose',()=>materialDisposals++);const layer=createWorldTransport({THREE,scene,model,route,groundAt:motion.groundAt,playerModels});const boat=layer.items.find(i=>i.mode==='boat'),dock={...boat.boardingPose};try{assert.equal(layer.nearest({...dock,mode:'walk'}),boat);assert.ok(layer.getDismountCandidates(boat,boat).some(p=>Math.hypot(p.x-dock.x,p.z-dock.z)<.01));const far={x:boat.x+80,y:boat.y,z:boat.z+80,yaw:boat.yaw};assert.ok(layer.getDismountCandidates(boat,far).every(p=>Math.hypot(p.x-dock.x,p.z-dock.z)>10));layer.take(boat);layer.release(boat,far);assert.equal(boat.boardingPose,null);}finally{layer.dispose();layer.dispose();assert.equal(geometryDisposals,0);assert.equal(materialDisposals,0);model.dispose();playerModels.geometry.dispose();playerModels.material.dispose();}
});

test('full live campus keeps exact counts clear of parked scooters and batches rider-free static geometry',()=>{
 const {scene,model,route}=fixture(),campus=createCampus3D(THREE,model,{frame,geoToLocal});
 const simulation=createCommuteSimulation(route,{seed:943108,startMinutes:478,density:1,scooterShare:.86,vehicleLanes:3,signals:true});
 const commute=createCommuteScene(THREE,scene,route,simulation,{model}),playerModels=createPlayerModels(THREE);
 const motion=createPlayerMotion({route,world:createPlayerWorld(model,{movableParking:true}),traffic:()=>[...simulation.agents,...commute.scooterTransport.parkedAgents],getPoseAt:simulation.getPoseAt});
 const layer=createWorldTransport({THREE,scene,model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode,playerModels});
 try{
  assert.ok(simulation.agents.length>=300);assert.ok(commute.scooterTransport.parkedAgents.length>=200);
  assert.deepEqual(layer.plan.counts,{spider:10,roadster:3,hoverboard:5,helicopter:1,boat:2});assert.deepEqual(layer.plan.rejected,[]);
  for(const item of layer.items){assert.equal(motion.canPlaceMode(item,item.mode).ok,true,item.id);assert.ok(item.visual.children.length<40,`${item.id} static draw calls`);
   const names=item.visual.children.flatMap(m=>m.userData.sourceParts||[]);assert.ok(names.every(name=>!/yacht-driver|hoverboard-rider|roadster-driver-|roadster-upper-arm-|roadster-forearm-/.test(name)),`${item.id} has no rider`);
  }
  const boards=layer.items.filter(i=>i.mode==='hoverboard');assert.equal(boards[0].visual.children[0].geometry,boards[1].visual.children[0].geometry,'static copies share baked geometry');
 }finally{layer.dispose();playerModels.dispose();commute.dispose();campus.dispose();model.dispose();}
});

test('activity props use the reachable ground level rather than an overhead bridge top',()=>{
 const {model,route,motion}=fixture();try{
  const original=planWorldTransport({model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode}),at=original.items.find(i=>i.id==='world-roadster-1');
  const deck={sourceId:'test/overhead-deck',bridge:true,surfaceY:11.14,polygon:[{x:at.x-12,z:at.z-12},{x:at.x+12,z:at.z-12},{x:at.x+12,z:at.z+12},{x:at.x-12,z:at.z+12}]};
  const layered=createPlayerMotion({route:{...route,roadSurfaces:[...route.roadSurfaces,deck]},world:createPlayerWorld(model)});
  const plan=planWorldTransport({model,route,groundAt:layered.groundAt,canPlaceMode:layered.canPlaceMode}),car=plan.items.find(i=>i.id==='world-roadster-1');
  assert.equal(car.x,at.x);assert.equal(car.z,at.z);assert.equal(car.y,.14,'an overhead road must not lift a roadside game prop onto its deck');
  assert.deepEqual(plan.counts,original.counts);
 }finally{model.dispose();}
});

test('world prop selection does not offer an item on a separate raised level',()=>{
 const {scene,model,route,motion}=fixture(),playerModels=mockModels(),layer=createWorldTransport({THREE,scene,model,route,groundAt:motion.groundAt,playerModels});
 try{const item=layer.items.find(i=>i.mode==='spider'),ground=item.y;layer.take(item);layer.release(item,{...item,y:ground+1.12});assert.notEqual(layer.nearest({...item,y:ground}),item);assert.equal(layer.nearest(item),item);}finally{layer.dispose();model.dispose();playerModels.geometry.dispose();playerModels.material.dispose();}
});

test('both real lake docks remain usable for normal boarding and local disembarking',async()=>{
 const {createTransportInteraction}=await import('../src/transport-interaction.js');
 const {scene,model,route,motion}=fixture(),playerModels=mockModels(),layer=createWorldTransport({THREE,scene,model,route,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode,playerModels});
 try{for(const boat of layer.items.filter(i=>i.mode==='boat')){assert.equal(motion.placeWalker(boat.boardingPose).ok,true);const transport=createTransportInteraction({motion,sources:[layer]});assert.equal(transport.mount().ok,true,boat.id+' real shoreline should board');assert.equal(motion.state.mode,'boat');assert.equal(transport.dismount().ok,true,boat.id+' real shoreline should exit');assert.equal(motion.state.mode,'walk');assert.equal(boat.taken,false);}}finally{layer.dispose();model.dispose();playerModels.geometry.dispose();playerModels.material.dispose();}
});
