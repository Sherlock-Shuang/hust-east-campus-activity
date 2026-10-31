import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeCampusExtension} from '../src/campus-data-merge.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createCampus3D} from '../src/campus-3d.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {EAST_NINE_BUILDERS_POSTER_SOURCE_ID,planEastNineBuildersPoster} from '../src/east-nine-builders-poster-placement.js';
import {createEastNinePosterFacadeCover} from '../src/east-nine-poster-facade-cover.js';

const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const sourceBefore=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
campus.group.updateMatrixWorld(true);
const item=planEastNineBuildersPoster(model,{frame,geoToLocal});
const world=createPlayerWorld(model);
const collisionBefore=JSON.stringify(model.architectureInfrastructure);
const doors=[],wings=[];
campus.group.traverse(object=>{
  if(object.userData.component==='double-glass-door')doors.push(object);
  if(object.userData.component==='teaching-wing'&&object.userData.wingLabel==='A')wings.push(object);
});
const doorMatrices=doors.map(door=>door.matrixWorld.toArray());
const cover=createEastNinePosterFacadeCover(THREE,{scene:campus.group,placement:item});
cover.setVisible(true);campus.group.updateMatrixWorld(true);
const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
const pointOnPoster=(u,v)=>new THREE.Vector3(item.x+item.nz*u*item.width,item.y+v*item.height,item.z-item.nx*u*item.width);
const grid=[-.5,-.25,0,.25,.5];
after(()=>{cover.dispose();campus.dispose();model.dispose();});

test('the giant portrait nearly fills the actual north wall height and preserves its original aspect and source data',()=>{
  assert.ok(item);
  assert.equal(item.featureId,EAST_NINE_BUILDERS_POSTER_SOURCE_ID);
  assert.ok(item.nz<-.98,'the card faces north toward the road, not the east/lake facade');
  const normal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),item.yaw);
  assert.ok(normal.dot(new THREE.Vector3(item.nx,0,item.nz))>.99999);
  assert.ok(Math.abs(item.width/item.height-987/1347)<1e-12,'the uploaded portrait is neither stretched nor cropped');
  assert.equal(wings.length,1);
  const wall=new THREE.Box3().setFromObject(wings[0]);
  assert.ok(item.height/(wall.max.y-wall.min.y)>.95,'the requested full-height card occupies nearly the whole existing wall');
  assert.ok(Math.abs(item.y-item.height/2-wall.min.y-.35)<.001);
  assert.ok(Math.abs(wall.max.y-item.y-item.height/2-.35)<.001);
  assert.ok(item.width>14&&item.height>19,'this is a building-scale portrait');
  assert.ok(Math.hypot(item.x-item.northEntrance.x,item.z-item.northEntrance.z)-item.width/2>35,'the poster stays far from the original north door');
  assert.equal(JSON.stringify(data),sourceBefore);
  assert.equal(JSON.stringify(model.architectureInfrastructure),collisionBefore,'the visual facade treatment does not modify walking/collision infrastructure');
  assert.deepEqual(planEastNineBuildersPoster(model,{frame,geoToLocal}),item);
});

test('the authorised window overlay reveals original wall behind every part of the full-height card',()=>{
  assert.ok(cover.stats.affectedInstances>0,'the large card intentionally covers the selected window decorations');
  const normal=new THREE.Vector3(item.nx,0,item.nz);
  for(const u of grid)for(const v of grid){
    // Begin outside all facade details so a projecting window or canopy
    // cannot be hidden behind the starting point of the support probe.
    const origin=pointOnPoster(u,v).addScaledVector(normal,.65);
    const hit=new THREE.Raycaster(origin,normal.clone().negate(),0,1.3).intersectObject(campus.group,true)[0];
    assert.equal(hit?.object.userData.component,'teaching-wing',`poster (${u}, ${v}) covers ${hit?.object.userData.component||hit?.object.name||'empty space'}`);
    assert.equal(hit.object.userData.featureId,EAST_NINE_BUILDERS_POSTER_SOURCE_ID);
    assert.ok(Math.abs(hit.distance-.662)<.002,'the image sits 1.2cm outside its supporting wall');
  }
});

test('the full-card approach and close QR viewpoint are walkable, unobstructed and fit ordinary first-person views',()=>{
  for(const [name,pose]of Object.entries({approach:item.approach,inspection:item.inspection})){
    assert.equal(player.placeWalker(pose).ok,true,`${name}: the ordinary player must fit at the viewpoint`);
    assert.ok(Math.abs(player.state.y-pose.y)<.02,`${name}: feet remain on the ground`);
    const target=name==='approach'?item:item.qr,distance=Math.hypot(pose.x-target.x,pose.z-target.z);
    assert.ok(name==='approach'?distance>31&&distance<33:distance>7&&distance<9);
    assert.ok(((pose.x-item.x)*item.nx+(pose.z-item.z)*item.nz)/distance>.9,'the viewer sees the front of the card');
    const eye=new THREE.Vector3(pose.x,player.state.y+1.65,pose.z);
    const camera=new THREE.PerspectiveCamera(45,1280/720,.06,2000);
    camera.position.copy(eye);camera.rotation.set(-pose.pitch,pose.yaw,0,'YXZ');camera.updateMatrixWorld(true);
    for(const u of grid)for(const v of grid){
      const {qrRegion:r}=item;
      const point=name==='approach'?pointOnPoster(u,v):pointOnPoster(r.left+(u+.5)*(r.right-r.left)-.5,.5-r.top-(v+.5)*(r.bottom-r.top));
      const projected=point.clone().project(camera);
      assert.ok(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&projected.z>-1&&projected.z<1,`${name}: intended image region fits the actual walking field of view`);
      const delta=point.sub(eye),length=delta.length();
      const hit=new THREE.Raycaster(eye,delta.normalize(),0,length-.005).intersectObject(campus.group,true)[0];
      assert.equal(Boolean(hit),false,`${name} (${u}, ${v}) is obscured by ${hit?.object.userData.component||hit?.object.name}`);
    }
  }
  assert.equal(player.placeWalker(item.approach).ok,true);
  for(let frameNumber=0;frameNumber<3600;frameNumber++){
    const dx=item.inspection.x-player.state.x,dz=item.inspection.z-player.state.z,distance=Math.hypot(dx,dz);
    if(distance<.14)break;
    const amount=Math.min(.45,Math.max(.035,distance*.16));
    player.step(1/60,{moveX:dx/distance*amount,moveZ:dz/distance*amount});
    assert.equal(player.state.blockedReason,'','a normal walk through the north forecourt to the scan point stays clear');
    assert.ok(Math.abs(player.state.y-.14)<.02,'the walk stays on the ground');
  }
  assert.ok(Math.hypot(player.state.x-item.inspection.x,player.state.z-item.inspection.z)<.14,'the scan point is reachable by walking, without teleporting across an obstacle');
});

test('the original north entrance doors and mapped walking approach remain intact and accessible',()=>{
  assert.equal(doors.length,2);
  const normal=new THREE.Vector3(item.nx,0,item.nz);
  for(const [index,door]of doors.entries()){
    assert.deepEqual(door.matrixWorld.toArray(),doorMatrices[index]);assert.equal(door.visible,true);
    const target=door.getWorldPosition(new THREE.Vector3()),origin=target.clone().addScaledVector(normal,3);
    const hit=new THREE.Raycaster(origin,normal.clone().negate(),0,3.2).intersectObject(campus.group,true)[0];
    assert.equal(hit?.object.userData.component,'double-glass-door','north door glass remains the first visible entrance surface');
  }
  assert.equal(player.placeWalker(item.entranceApproach).ok,true);
  const atDoor={x:item.northEntrance.x+item.nx*2.6,z:item.northEntrance.z+item.nz*2.6,y:.14,yaw:item.yaw};
  for(let frameNumber=0;frameNumber<2400;frameNumber++){
    const dx=atDoor.x-player.state.x,dz=atDoor.z-player.state.z,distance=Math.hypot(dx,dz);
    if(distance<.14)break;
    const amount=Math.min(.45,Math.max(.035,distance*.16));player.step(1/60,{moveX:dx/distance*amount,moveZ:dz/distance*amount});
    assert.equal(player.state.blockedReason,'','the pre-existing north-door approach remains open');
  }
  assert.ok(Math.hypot(player.state.x-atDoor.x,player.state.z-atDoor.z)<.14);
});

test('the planner fails closed when the source building, north edge or mapped entrance footway is missing',()=>{
  const options={frame,geoToLocal};
  assert.equal(planEastNineBuildersPoster(null,options),null);
  assert.equal(planEastNineBuildersPoster(model),null);
  assert.equal(planEastNineBuildersPoster({records:model.records.filter(record=>record.id!==EAST_NINE_BUILDERS_POSTER_SOURCE_ID)},options),null);
  assert.equal(planEastNineBuildersPoster({records:model.records.filter(record=>record.id!=='way/655063746')},options),null);
  const source=model.records.find(record=>record.id===EAST_NINE_BUILDERS_POSTER_SOURCE_ID);
  const changed={...source,feature:structuredClone(source.feature)};
  changed.feature.geometry.coordinates[0]=changed.feature.geometry.coordinates[0].filter(([longitude,latitude])=>Math.abs(longitude-114.4215014)>1e-7||Math.abs(latitude-30.5164424)>1e-7);
  assert.equal(planEastNineBuildersPoster({records:model.records.map(record=>record===source?changed:record)},options),null,'a nearby east wall is not a fallback for a missing north edge');
});
