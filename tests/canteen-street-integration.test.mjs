import test,{after} from 'node:test';
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
import {createResidentialTraffic,combineTrafficSources} from '../src/residential-traffic.js';
import {sampleResidentialTrafficPath} from '../src/residential-traffic-route.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createTransportInteraction} from '../src/transport-interaction.js';
import {planOptoRoadTransport,OPTO_ROAD_TRANSPORT_SITES} from '../src/opto-road-transport.js';
import {streetFootprint,polygonsOverlap} from '../src/street-clearance.js';

const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name,import.meta.url),'utf8'));
const base=read('east-campus.geojson'),extension=read('opto-southeast.geojson'),originalSource=JSON.stringify([base,extension]);
const source=mergeCampusExtension(base,extension),frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const scene=new THREE.Scene(),model=createGeoScene(THREE,scene,source,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal});
const route=createCommuteRoute(source,{frame,geoToLocal}),street=campus.canteenStreetLife;
const trees=[...campus.landcoverPlan.trees,...campus.landcoverPlan.shrubs,...street.plan.trees];
const opto=planOptoRoadTransport({model,route,frame,geoToLocal,treeReservations:trees});
// Same activity ID domains supplied by createCommuteExperience. Exercise the
// real commute scene and F adapter, rather than a second mock inventory.
const parking=[
  ...opto.items.filter(p=>p.mode==='scooter').map((p,i)=>({...p,id:-200001-i,activityId:p.id,activityRegion:'opto-road',contactMode:'independent',y:p.y+.021})),
  ...street.plan.parking.map((p,i)=>({...p,id:-300001-i,activityId:p.id,activityRegion:'canteen-street',kind:'scooter',type:'scooter',phase:'parked',active:true,contactMode:'independent'})),
];
const primary=createCommuteSimulation(route,{peakAgents:0,maxAgents:0,flowScale:0}),residential=createResidentialTraffic({model,route,frame,geoToLocal}),traffic=combineTrafficSources(primary,residential);
const visual=createCommuteScene(THREE,scene,route,traffic,{model,activityParking:parking}),world=createPlayerWorld(model,{movableParking:true});
const motion=createPlayerMotion({route,world,traffic:()=>[...traffic.agents,...visual.scooterTransport.parkedAgents],getPoseAt:primary.getPoseAt});
const staticMotion=createPlayerMotion({route,world}),distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const treeRadius=t=>(t.height??0)>3?Math.max(.65,(t.radius??3.5)*.18):t.radius??.7;
after(()=>{visual.dispose();residential.dispose();campus.dispose();model.dispose();});

test('the full merged campus exposes rendered street life and effective ground-level trunk barriers without source edits',()=>{
  assert.ok(street.plan.accepted);assert.ok(street.plan.trees.length>=15);assert.ok(street.plan.parking.length>=12);
  assert.equal(campus.layers.get('environment').children.includes(street.group),true);
  for(const barrier of street.infrastructure.barriers){
    assert.ok(model.architectureInfrastructure.barriers.includes(barrier),barrier.id+' is in actual movement infrastructure');
    assert.ok(world.barriers.some(b=>b.id===barrier.id),barrier.id+' is in the player world');
    const center=barrier.polygon.reduce((p,q)=>({x:p.x+q.x/barrier.polygon.length,z:p.z+q.z/barrier.polygon.length}),{x:0,z:0});
    assert.equal(staticMotion.canPlaceMode({...center,y:.14,yaw:0},'walk').ok,false,barrier.id+' cannot be walked through');
  }
  assert.equal(JSON.stringify([base,extension]),originalSource);
});

test('all twenty residential actors and both southern canteen paths survive the actual new barriers and parking',()=>{
  assert.deepEqual(residential.plan.rejected,[]);assert.equal(residential.agents.length,20);
  assert.deepEqual(residential.getDiagnostics().counts,{walk:14,scooter:6});
  assert.equal(residential.plan.paths.filter(p=>p.region==='south-canteen').reduce((n,p)=>n+p.count,0),8);
  for(const path of residential.plan.paths){
    const steps=Math.ceil(path.length/.4);
    for(let i=0;i<=steps;i++){
      const pose=sampleResidentialTrafficPath(path,path.length*i/steps),g=staticMotion.groundAt(pose.x,pose.z,path.bodyRadius,pose.y);
      assert.ok(g.allowed,`${path.id} remains unobstructed at ${i}: ${g.reason}`);assert.ok(Math.abs(g.height-pose.y)<.05);
      const placement=staticMotion.canPlaceMode(pose,path.kind);assert.ok(placement.ok,`${path.id} full movement body clears new barriers: ${placement.reason}`);
      for(const p of street.plan.parking)assert.ok(distance(pose,p)>path.bodyRadius+.6,`${path.id} is not filled by new scooters`);
    }
  }
});

test('all six opto pickups retain their IDs and full walk-in clearance against old and newly planted trees',()=>{
  assert.deepEqual(opto.rejected,[]);assert.deepEqual(opto.items.map(p=>p.id),OPTO_ROAD_TRANSPORT_SITES.map(s=>s.id));
  for(const p of opto.items){
    assert.equal(staticMotion.canPlaceMode(p,p.mode).ok,true,p.id+' vehicle footprint');
    for(const tree of trees)assert.ok(distance(p,tree)>=p.clearanceRadius+treeRadius(tree)+.25,p.id+' tree clearance');
    const steps=Math.max(1,Math.ceil(distance(p.approachPose,p.boardingPose)/.15));
    for(let i=0;i<=steps;i++){
      const t=i/steps,q={x:p.approachPose.x+(p.boardingPose.x-p.approachPose.x)*t,z:p.approachPose.z+(p.boardingPose.z-p.approachPose.z)*t,y:.14,yaw:p.yaw};
      assert.equal(staticMotion.canPlaceMode(q,'walk').ok,true,p.id+' continuous walking access');
      for(const tree of trees)assert.ok(distance(q,tree)>=.38+treeRadius(tree)+.25,p.id+' approach vegetation clearance');
    }
  }
});

test('new trunk and scooter footprints leave both mapped and photo-inferred existing parking intact',()=>{
  const oldParking=[...route.parkingPlaces,...route.photoInferredParking];
  assert.ok(route.parkingPlaces.length>0);assert.ok(route.photoInferredParking.length>0);
  for(const [index,p]of oldParking.entries()){
    const footprint=streetFootprint(p.x,p.z,p.footprintWidth??1.05,p.footprintLength??2.24,p.yaw??0);
    for(const barrier of street.infrastructure.barriers)assert.equal(polygonsOverlap(footprint,barrier.polygon),false,`old parking ${index} intersects ${barrier.id}`);
    for(const q of street.plan.parking){
      const other=streetFootprint(q.x,q.z,q.footprintWidth??1.05,q.footprintLength??2.24,q.yaw??0);
      assert.equal(polygonsOverlap(footprint,other),false,`old parking ${index} intersects new scooter ${q.id}`);
    }
  }
});

test('every street scooter has a unique live adapter identity, a clear vehicle footprint and a usable same-side walking approach',()=>{
  const items=visual.scooterTransport.items.filter(i=>i.record.activityRegion==='canteen-street');
  assert.equal(items.length,street.plan.parking.length);
  assert.equal(new Set(visual.scooterTransport.items.map(i=>i.id)).size,visual.scooterTransport.items.length);
  assert.equal(new Set(parking.map(p=>p.id)).size,parking.length);
  const interaction=createTransportInteraction({motion,sources:[visual.scooterTransport]});
  for(const [index,p]of street.plan.parking.entries()){
    const target=items.find(i=>i.record.activityId===p.id);assert.ok(target,'actual rendered scooter '+p.id);
    assert.equal(target.record.id,-300001-index);assert.equal(target.record.contactMode,'independent');
    assert.ok(Math.abs(target.y-.14)<.001);assert.equal(motion.canPlaceMode(target,'scooter',{ignoreTrafficId:target.record.id}).ok,true,p.id+' mount footprint');
    // Try authored side first, then normal shoulder offsets. This also catches
    // densely parked vehicles that are visible but impossible to borrow.
    const candidates=[p.boardingPose];
    for(const r of[1.35,1.7,2.1,2.5])for(const angle of[0,Math.PI,Math.PI/2,-Math.PI/2])candidates.push({x:p.x+Math.cos(p.yaw+angle)*r,z:p.z-Math.sin(p.yaw+angle)*r,y:.14,yaw:p.yaw});
    let mounted=false;
    for(const q of candidates){
      if(!motion.placeWalker(q).ok||interaction.nearest()?.item!==target)continue;
      if(interaction.mount().ok){mounted=true;break;}
    }
    assert.ok(mounted,p.id+' can be approached and borrowed with the real F adapter');
    assert.equal(motion.state.mode,'scooter');assert.equal(target.record.active,false);
    assert.equal(visual.scooterTransport.parkedAgents.filter(a=>a.activityId===p.id).length,0);
    assert.equal(interaction.dismount().ok,true,p.id+' has a clear place to get off');assert.equal(motion.state.mode,'walk');
    assert.equal(visual.scooterTransport.items.filter(i=>i.record.activityId===p.id).length,1);
    assert.equal(visual.scooterTransport.parkedAgents.filter(a=>a.activityId===p.id).length,1);
    assert.equal(residential.agents.length,20,'borrowing street parking never removes unrelated NPCs');
  }
});
