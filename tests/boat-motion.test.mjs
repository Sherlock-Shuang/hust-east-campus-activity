import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPlayerMotion} from '../src/player-motion.js';
import {createBoatModel} from '../src/boat-model.js';
import {createPlayerModels} from '../src/player-models.js';
import {createVehicleCameraRig} from '../src/player-camera.js';
const rect=(x1,z1,x2,z2)=>[{x:x1,z:z1},{x:x2,z:z1},{x:x2,z:z2},{x:x1,z:z2}];
const route={length:100,points:[{x:0,z:0,y:.16,progress:0},{x:0,z:-100,y:.16,progress:100}],segments:[{startProgress:0,endProgress:100,width:6}]};
const lake={id:'test-lake',surfaceY:-1.5,rings:[rect(10,-80,60,10),rect(28,-35,36,-25)]};
const make=(extra={})=>createPlayerMotion({route,world:{water:[lake],...extra}});
const tick=(m,s,input,dt=1/60)=>{for(let t=0;t<s-1e-8;t+=dt)m.step(Math.min(dt,s-t),input);};
test('explicit mount validates hull water/land footprint and preserves state on failure',()=>{
 const m=make();const before={...m.state};assert.equal(m.setMode('boat').ok,false);assert.deepEqual({...m.state,blockedReason:before.blockedReason},before);
 assert.equal(m.placeMode({x:0,z:0,yaw:0},'boat').ok,false);assert.equal(m.state.mode,'walk');
 assert.equal(m.placeMode({x:10.4,z:0,yaw:0},'boat').ok,false,'hull cannot hang across shore');
 assert.equal(m.placeMode({x:20,z:0,yaw:0},'boat').ok,true);assert.equal(m.state.mode,'boat');assert.equal(m.state.y,-1.5);assert.equal(m.state.grounded,true);
 assert.equal(m.placeWalker({x:20,z:0,yaw:0}).ok,false,'cannot dismount on water');assert.equal(m.state.mode,'boat');
 assert.equal(m.placeWalker({x:5,z:0,yaw:0}).ok,true);assert.equal(m.state.y,.14);
});
test('yacht propels and turns smoothly with frame independent water-level contact',()=>{
 const a=make(),b=make();for(const m of[a,b])m.placeMode({x:20,z:0,yaw:0},'boat');
 tick(a,4,{forward:1,turn:-.2},1/60);tick(b,4,{forward:1,turn:-.2},1/24);
 for(const k of['x','y','z','speed','yaw','distance'])assert.ok(Math.abs(a.state[k]-b.state[k])<1e-8,k);
 assert.equal(a.state.speed,6);assert.equal(a.state.y,-1.5);assert.ok(a.state.distance>12);assert.ok(a.state.x>20);
 tick(a,2,{brake:true});assert.equal(a.state.speed,0);assert.equal(a.state.y,-1.5);
});
test('entire hull stays inside coast and outside island holes during approach',()=>{
 const coast=make();coast.placeMode({x:20,z:-65,yaw:0},'boat');tick(coast,10,{forward:1,fast:true});assert.ok(coast.state.z>-76.81);assert.equal(coast.state.speed,0);assert.match(coast.state.blockedReason,/水域/);
 const island=make();island.placeMode({x:32,z:-12,yaw:0},'boat');tick(island,10,{forward:1});assert.ok(island.state.z>-21.81);assert.match(island.state.blockedReason,/水域/);
 assert.equal(island.waterAt(32,-30),null);assert.equal(island.waterAt(20,-30).id,'test-lake');
});
test('low bridge and building footprints block boats',()=>{
 const bridgeRoute={...route,roadSurfaces:[{bridge:true,surfaceY:.14,polygon:rect(10,-30,60,-25)}]};
 const bridge=createPlayerMotion({route:bridgeRoute,world:{water:[lake]}});bridge.placeMode({x:20,z:-10,yaw:0},'boat');tick(bridge,10,{forward:1});assert.equal(bridge.state.blockedReason,'桥下净空不足');assert.ok(bridge.state.z>-22);
 const building=make({buildings:[{height:12,minHeight:0,rings:[rect(15,-30,25,-25)]}]});building.placeMode({x:20,z:-10,yaw:0},'boat');tick(building,10,{forward:1});assert.equal(building.state.blockedReason,'建筑边界');
});
test('mounting any transport checks destination clearance and only ignores the selected traffic actor',()=>{
 const actors=[{id:7,type:'scooter',active:true,x:4,y:.14,z:-2,yaw:0}];const m=createPlayerMotion({route,world:{buildings:[{height:8,rings:[rect(7,-5,10,5)]}]},traffic:()=>actors});
 assert.equal(m.placeMode({x:4,z:-2,yaw:0},'scooter').ok,false);
 assert.equal(m.placeMode({x:4,z:-2,yaw:0},'scooter',{ignoreTrafficId:7}).ok,true);
 actors.push({id:8,type:'walk',active:true,x:4.1,y:.14,z:-2,yaw:0});assert.equal(m.canPlaceMode({x:4,z:-2,yaw:0},'scooter',{ignoreTrafficId:7}).ok,false);
 assert.equal(m.canPlaceMode({x:5,z:0,yaw:0},'helicopter').ok,false);
 const previous={...m.state};assert.equal(m.placeMode({x:8,z:0,yaw:0},'roadster').ok,false);assert.deepEqual(m.state,previous);
});
test('walk is faster but still ramps and stops under control',()=>{
 const m=createPlayerMotion({route});m.step(1/120,{forward:1});assert.ok(m.state.speed<.01);tick(m,1,{forward:1});assert.equal(m.state.speed,3.2);tick(m,1,{forward:1,fast:true});assert.equal(m.state.speed,5.2);
 const d=m.state.distance;tick(m,.8,{});assert.equal(m.state.speed,0);assert.ok(m.state.distance-d<1.8,'5.2 m/s running releases within two short strides');
});
test('boat model has real waterline draft, separate driver and finite released resources',()=>{
 const model=createBoatModel(THREE),bounds=new THREE.Box3().setFromObject(model.group);assert.ok(bounds.min.y<-.3&&bounds.min.y>-.5);assert.ok(bounds.max.z-bounds.min.z>6.5);assert.equal(model.group.getObjectByName('yacht-driver').visible,false);
 const resources=new Set();model.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});let n=0;resources.forEach(r=>r.addEventListener('dispose',()=>n++));model.dispose();model.dispose();assert.equal(n,resources.size);
 const rig=createPlayerModels(THREE);rig.update({mode:'boat',x:20,y:-1.5,z:-20,yaw:.3,speed:2},1/60);assert.equal(rig.group.children.filter(c=>c.visible).length,1);assert.equal(rig.group.getObjectByName('yacht-driver').visible,true);rig.dispose();
});
test('boat first and third person cameras remain above the river surface and clear of dry bank height',()=>{
 const m=make();m.placeMode({x:20,z:-10,yaw:0},'boat');const camera=createVehicleCameraRig();for(const view of['third','first']){const p=camera.update(m.state,1/60,{view,groundAt:m.groundAt,world:{}});assert.ok(p.position.y>.14);assert.ok(Number.isFinite(p.target.z));}
});
test('borrowed scooter retains shell family and paint without recoloring the player',()=>{
 const rig=createPlayerModels(THREE);const walker=rig.group.getObjectByName('player-walk');const colors=walker.children.map(m=>m.material.color.getHex());
 for(const id of[1,2,0,2]){rig.setScooterAppearance({id,colorIndex:3});rig.update({mode:'scooter',grounded:true},0);const scooter=rig.group.getObjectByName('player-scooter');assert.equal(scooter.userData.appearance.family,id%3);const paint=scooter.children.filter(m=>m.name.startsWith('player-paint-'));assert.ok(paint.length);assert.equal(paint[0].material.color.getHexString(),'d3c3a4');}
 assert.deepEqual(walker.children.map(m=>m.material.color.getHex()),colors);rig.dispose();
});
