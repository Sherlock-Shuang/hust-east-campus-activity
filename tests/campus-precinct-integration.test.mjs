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
    for(const place of ['einstein','opto','opto-main','opto-left','opto-rear','opto-east','yunyuan-south','xueer','east-gate','yunyuan-gate']){
      const pose=campusLandmarkArrival(campus,place);
      assert.ok(pose&&Number.isFinite(pose.x+pose.z+pose.yaw),place);
      const route={points:[{x:pose.x+15,z:pose.z+15,y:.16},{x:pose.x+15,z:pose.z-100,y:.16}]};
      const player=createPlayerMotion({route,world});
      assert.equal(player.placeWalker(pose).ok,true,`${place} visitor is not spawned in a solid`);
      assert.ok(Math.abs(player.state.y-pose.y)<.03,`${place} arrival height`);
    }
    assert.equal(campus.optoEntries.length,3,'main-court left hall, east door and rear foyer inner door enter C118');
    assert.ok(!campus.optoEntries.some(e=>e.id==='opto-c118-main'),'research-centre main staircase is not a C118 shortcut');
    for(const entry of campus.optoEntries){
      const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
      assert.equal(player.placeWalker(entry.approach).ok,true);
      let previous={...player.state},crossed=null;
      assert.ok(entry.accessPath.length>=2);
      for(const [i,target]of entry.accessPath.slice(1).entries()){
        let reached=false;
        for(let step=0;step<1800&&!crossed;step++){
          const dx=target.x-player.state.x,dz=target.z-player.state.z,d=Math.hypot(dx,dz);
          if(d<.16){reached=true;break;}
          player.step(1/120,{moveX:dx/d,moveZ:dz/d});
          crossed=crossedInteriorDoor(campus.optoEntries,previous,player.state);previous={...player.state};
        }
        assert.ok(reached||crossed,`${entry.id} segment ${i} blocked at ${JSON.stringify({x:player.state.x,y:player.state.y,z:player.state.z})}`);
        if(crossed){assert.equal(i,entry.accessPath.length-2,'the college exterior door does not itself open the auditorium');break;}
        player.suspend();previous={...player.state};
      }
      assert.equal(crossed?.id,entry.id,`${entry.id}: full campus colliders allow its actual route and door crossing`);
      assert.equal(crossed.url,entry.url,'each access opens the intended interior viewpoint');
      assert.equal(player.placeWalker(entry.returnPose).ok,true,'same door has a safe return');
      assert.equal(nearbyInterior([entry],player.state),null,'returned walker is clear of the entry gate');
    }
    assert.equal(campus.gatePlan.gates.length,2);
    assert.equal(campus.records.get('way/104350466').group.children.length,0,'generic solid gate is replaced by open posts and lintel');
    assert.ok(!world.buildings.some(b=>b.id==='way/104350466'));
    for(const gate of campus.gatePlan.gates)for(const opening of gate.openings){
      const local=(x,z)=>({x:gate.x+x*Math.cos(gate.yaw)+z*Math.sin(gate.yaw),z:gate.z-x*Math.sin(gate.yaw)+z*Math.cos(gate.yaw),y:.14,yaw:gate.yaw});
      const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
      const start=local(opening.x,7),end=local(opening.x,-7);
      assert.equal(player.placeWalker(start).ok,true,`${gate.id}/${opening.id}: clear approach`);
      for(let i=0;i<700&&Math.hypot(end.x-player.state.x,end.z-player.state.z)>.2;i++)player.step(1/120,{moveX:-Math.sin(gate.yaw),moveZ:-Math.cos(gate.yaw)});
      assert.ok(Math.hypot(end.x-player.state.x,end.z-player.state.z)<.3,`${gate.id}/${opening.id}: complete ground passage`);
      assert.ok(player.state.y<.3,'gate cannot snap the walker onto its lintel');
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
