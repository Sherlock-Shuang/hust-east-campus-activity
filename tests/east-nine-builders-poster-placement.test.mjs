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

const read=name=>JSON.parse(readFileSync(new URL(`../public/data/${name}`,import.meta.url),'utf8'));
const data=mergeCampusExtension(read('east-campus.geojson'),read('opto-southeast.geojson'));
const sourceBefore=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal);
const campus=createCampus3D(THREE,model,{frame,geoToLocal});
campus.group.updateMatrixWorld(true);
const item=planEastNineBuildersPoster(model,{frame,geoToLocal});
const world=createPlayerWorld(model);
const player=createPlayerMotion({world,route:{points:[{x:400,z:400,y:.14},{x:1000,z:400,y:.14}]}});
const pointOnPoster=(u,v)=>new THREE.Vector3(item.x+item.nz*u*item.width,item.y+v*item.height,item.z-item.nx*u*item.width);
const grid=[-.5,-.25,0,.25,.5];
after(()=>{campus.dispose();model.dispose();});

test('the portrait uses the actual north wall and preserves its original aspect without changing source data',()=>{
  assert.ok(item);
  assert.equal(item.featureId,EAST_NINE_BUILDERS_POSTER_SOURCE_ID);
  assert.ok(item.nz<-.98,'the card faces north toward the road, not the east/lake facade');
  const normal=new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0),item.yaw);
  assert.ok(normal.dot(new THREE.Vector3(item.nx,0,item.nz))>.99999);
  assert.ok(Math.abs(item.width/item.height-987/1347)<1e-12,'the uploaded portrait is neither stretched nor cropped');
  assert.equal(JSON.stringify(data),sourceBefore);
  assert.deepEqual(planEastNineBuildersPoster(model,{frame,geoToLocal}),item);
});

test('every part of the card is supported by blank teaching-wing wall, clear of windows, doorway, canopy and columns',()=>{
  const normal=new THREE.Vector3(item.nx,0,item.nz);
  for(const u of grid)for(const v of grid){
    // Begin outside all facade details so a projecting window or canopy
    // cannot be hidden behind the starting point of the support probe.
    const origin=pointOnPoster(u,v).addScaledVector(normal,.65);
    const hit=new THREE.Raycaster(origin,normal.clone().negate(),0,1.3).intersectObject(campus.group,true)[0];
    assert.equal(hit?.object.userData.component,'teaching-wing',`poster (${u}, ${v}) covers ${hit?.object.userData.component||hit?.object.name||'empty space'}`);
    assert.equal(hit.object.userData.featureId,EAST_NINE_BUILDERS_POSTER_SOURCE_ID);
    assert.ok(Math.abs(hit.distance-.71)<.002,'the image sits 6cm outside its supporting wall');
  }
});

test('ordinary footway approach and close scan viewpoint are walkable and see the complete portrait at eye level',()=>{
  const road=model.records.find(record=>record.id===item.approach.sourceId);
  const roadPoints=road.feature.geometry.coordinates.map(([longitude,latitude])=>geoToLocal({longitude,latitude,coordinateSystem:'EPSG:4326'},frame));
  const roadStart=new THREE.Vector2(roadPoints[0].x,roadPoints[0].z),roadEnd=new THREE.Vector2(roadPoints[1].x,roadPoints[1].z);
  const approachPoint=new THREE.Vector2(item.approach.x,item.approach.z);
  assert.ok(Math.abs(approachPoint.distanceTo(roadStart)+approachPoint.distanceTo(roadEnd)-roadStart.distanceTo(roadEnd))<.001,'the ordinary viewpoint is on the real north entrance footway');
  for(const [name,pose]of Object.entries({approach:item.approach,inspection:item.inspection})){
    assert.equal(player.placeWalker(pose).ok,true,`${name}: the ordinary player must fit at the viewpoint`);
    assert.ok(Math.abs(player.state.y-pose.y)<.02,`${name}: feet remain on the ground`);
    const distance=Math.hypot(pose.x-item.x,pose.z-item.z);
    assert.ok(name==='approach'?distance>12&&distance<15:distance>3&&distance<5);
    assert.ok(((pose.x-item.x)*item.nx+(pose.z-item.z)*item.nz)/distance>.9,'the viewer sees the front of the card');
    const eye=new THREE.Vector3(pose.x,player.state.y+1.65,pose.z);
    for(const u of grid)for(const v of grid){
      const delta=pointOnPoster(u,v).sub(eye),length=delta.length();
      const hit=new THREE.Raycaster(eye,delta.normalize(),0,length-.005).intersectObject(campus.group,true)[0];
      assert.equal(Boolean(hit),false,`${name} (${u}, ${v}) is obscured by ${hit?.object.userData.component||hit?.object.name}`);
    }
  }
  assert.equal(player.placeWalker(item.approach).ok,true);
  for(let frameNumber=0;frameNumber<1800;frameNumber++){
    const dx=item.inspection.x-player.state.x,dz=item.inspection.z-player.state.z,distance=Math.hypot(dx,dz);
    if(distance<.14)break;
    const amount=Math.min(.45,Math.max(.035,distance*.16));
    player.step(1/60,{moveX:dx/distance*amount,moveZ:dz/distance*amount});
    assert.equal(player.state.blockedReason,'','a normal walk from the source footway to the scan point stays clear');
    assert.ok(Math.abs(player.state.y-.14)<.02,'the walk stays on the ground');
  }
  assert.ok(Math.hypot(player.state.x-item.inspection.x,player.state.z-item.inspection.z)<.14,'the scan point is reachable by walking, without teleporting across an obstacle');
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
