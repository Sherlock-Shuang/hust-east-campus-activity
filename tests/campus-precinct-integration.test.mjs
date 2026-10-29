import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {campusLandmarkArrival} from '../src/campus-landmark-arrival.js';
import {pointInLandcover} from '../src/campus-landcover.js';
import {crossedInteriorDoor,nearbyInterior} from '../src/building-interiors.js';

test('refined precincts replace generic solids once, retain original GIS, and supply clear visitor arrivals',()=>{
  const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
  const raw=read('east-campus.geojson'),original=JSON.stringify(raw),data=mergeCampusExtension(raw,read('opto-southeast.geojson'));
  const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
  const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),campus=createCampus3D(THREE,model,{frame,geoToLocal});
  try{
    const world=createPlayerWorld(model),plan=campus.yunyuanSouthPlan;
    assert.equal(plan.accepted,true);
    assert.equal(campus.records.get(plan.sourceId).displayMode,'yunyuan-south-photo-informed');
    assert.equal(campus.records.get(plan.sourceId).group.children.length,0,'old opaque building is not left over the open arcade');
    assert.ok(!world.buildings.some(b=>b.id===plan.sourceId));
    for(const id of plan.replacedRoadIds){
      assert.ok(world.replacedRoadIds.includes(id));
      assert.equal(campus.records.get(id).group.children.length,0,'old flat bridge geometry is removed');
      assert.ok(!model.bridgeInfrastructure.walkSurfaces.some(s=>s.sourceId===id));
    }
    for(const place of ['einstein','opto','opto-main','yunyuan-south','xueer']){
      const pose=campusLandmarkArrival(campus,place);
      assert.ok(pose&&Number.isFinite(pose.x+pose.z+pose.yaw),place);
      const route={points:[{x:pose.x+15,z:pose.z+15,y:.16},{x:pose.x+15,z:pose.z-100,y:.16}]};
      const player=createPlayerMotion({route,world});
      assert.equal(player.placeWalker(pose).ok,true,`${place} visitor is not spawned in a solid`);
      assert.ok(Math.abs(player.state.y-pose.y)<.03,`${place} arrival height`);
    }
    assert.equal(campus.optoEntries.length,2,'both visible building doors lead to the existing hall');
    for(const entry of campus.optoEntries){
      const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
      assert.equal(player.placeWalker(entry.approach).ok,true);
      let previous={...player.state},crossed=null;
      for(let step=0;step<2400&&!crossed;step++){
        player.step(1/120,{moveX:-entry.doorGate.normal.x,moveZ:-entry.doorGate.normal.z});
        if(step%24===0){crossed=crossedInteriorDoor(campus.optoEntries,previous,player.state);previous={...player.state};}
      }
      assert.equal(crossed?.id,entry.id,`${entry.id}: full campus colliders allow the ground approach, stairs and actual door crossing`);
      assert.equal(player.placeWalker(entry.returnPose).ok,true,'same door has a safe return');
      assert.equal(nearbyInterior([entry],player.state),null,'returned walker is clear of the entry gate');
    }
    assert.equal(campus.optoApproachPlan.bridges.length,6);
    for(const id of campus.optoApproachPlan.replacedRoadIds){
      assert.ok(world.replacedRoadIds.includes(id));
      assert.equal(campus.records.get(id).group.children.length,0,'original floating bridge and piers are not rendered');
      assert.ok(!model.bridgeInfrastructure.walkSurfaces.some(s=>s.sourceId===id));
    }
    assert.equal(campusLandmarkArrival(campus,null),null,'ordinary spawn is unchanged');
    for(const tree of campus.landcoverPlan.trees){
      assert.equal(pointInLandcover(tree.x,tree.z,campus.einsteinSquarePlan.polygons),false,'square paving stays clear');
      assert.ok(!plan.walkSurfaces.some(s=>pointInLandcover(tree.x,tree.z,[[s.polygon.map(p=>[p.x,p.z])]])),'tree does not grow through a canteen stair');
    }
    assert.equal(JSON.stringify(raw),original);
  }finally{campus.dispose();model.dispose();}
});
