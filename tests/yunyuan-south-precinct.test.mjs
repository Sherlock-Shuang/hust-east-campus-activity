import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createYunyuanSouthPrecinct,planYunyuanSouthPrecinct,YUNYUAN_SOUTH_BUILDING_ID,YUNYUAN_SOUTH_ROAD_IDS} from '../src/yunyuan-south-precinct.js';
const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),before=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.427,latitude:30.517,coordinateSystem:'EPSG:4326'}),scene=new THREE.Scene(),model=createGeoScene(THREE,scene,data,frame,geoToLocal),route=createCommuteRoute(data,{frame,geoToLocal});
const made=createYunyuanSouthPrecinct(THREE,model,{frame,geoToLocal});
const world=createPlayerWorld({...model,architectureInfrastructure:made.infrastructure});
const motion=()=>createPlayerMotion({world,route});
const close=(a,b,t=.001)=>assert.ok(Math.abs(a-b)<t,`${a} approximately ${b}`);
after(()=>{made.dispose();model.dispose();});

test('south student canteens have a separate evidence-derived identity without relabeling the northern market',()=>{
  assert.equal(made.plan.accepted,true);assert.deepEqual(made.infrastructure.replacedBuildingIds,[YUNYUAN_SOUTH_BUILDING_ID]);
  assert.deepEqual(made.infrastructure.replacedRoadIds,[...YUNYUAN_SOUTH_ROAD_IDS]);assert.equal(made.plan.halls.length,2);
  const [north,south]=made.plan.halls;assert.equal(north.label,'学生二食堂');assert.equal(south.label,'学生一食堂');assert.ok(north.z<south.z);
  assert.ok(made.plan.evidence.uncertainty.includes('spatial inference'));assert.ok(made.plan.evidence.market.includes('未核实'));
  assert.equal(JSON.stringify(data),before);assert.deepEqual(planYunyuanSouthPrecinct(model,{frame,geoToLocal}),made.plan);
});

test('all three source stair flights have twenty gradual treads joined to the same raised gallery level',()=>{
  assert.equal(made.plan.stairs.length,3);
  for(const flight of made.plan.stairs){assert.equal(flight.steps.length,20);close(flight.steps[0].surfaceY,.31);close(flight.steps.at(-1).surfaceY,3.54);for(const s of flight.steps)close(s.riser,.17);assert.ok(flight.steps.every(s=>s.depth>.4));}
  assert.ok(made.plan.walkSurfaces.filter(s=>s.bridge).every(s=>s.surfaceY===3.54&&s.deckDepth===.25));
});

test('walkers can climb each complete flight without the old four-metre virtual bridge snapping them upward',()=>{
  for(const stair of made.plan.stairs){
    const m=motion(),dx=(stair.b.x-stair.a.x)/stair.length,dz=(stair.b.z-stair.a.z)/stair.length,start={x:stair.first.x-dx*.8,z:stair.first.z-dz*.8,yaw:Math.atan2(-dx,-dz)};
    assert.equal(m.placeWalker(start).ok,true,`${stair.id} lower approach`);close(m.state.y,.14);let maxDelta=0,previous=m.state.y;const visited=new Set();
    const travel=stair.run+stair.upperLandingLength+1.1;
    for(let i=0;i<6000&&Math.hypot(m.state.x-start.x,m.state.z-start.z)<travel;i++){
      m.step(1/120,{forward:.45});maxDelta=Math.max(maxDelta,m.state.y-previous);previous=m.state.y;visited.add(m.state.y.toFixed(2));
      assert.equal(m.state.blockedReason,'',`${stair.id} blocked at ${m.state.x},${m.state.z},y=${m.state.y}`);
    }
    close(m.state.y,3.54,.02);assert.ok(maxDelta<.19,`only a single riser per move, got ${maxDelta}`);assert.ok(visited.size>=20,'visits intermediate stair elevations');
    // Walk back down the same source line, preserving the lower ground level.

    for(let i=0;i<6000&&Math.hypot(m.state.x-stair.first.x,m.state.z-stair.first.z)>.25;i++){
      m.step(1/120,{forward:-.45});
      assert.equal(m.state.blockedReason,'',`${stair.id} descending blocked at y=${m.state.y}`);
      if(m.state.y<.32)break;
    }
    assert.ok(m.state.y<.32,`${stair.id} returns to the bottom tread`);
    assert.ok(Math.hypot(m.state.x-stair.first.x,m.state.z-stair.first.z)<.5,`${stair.id} returns along the same stair flight`);
  }
});

test('the gallery is a thin overhead deck with an unobstructed ground-floor route',()=>{
  const gallery=made.plan.galleries[1],a=gallery.a,b=gallery.b,p={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
  const m=motion();assert.equal(m.placeWalker({...p,yaw:0}).ok,true);close(m.state.y,.14);
  close(m.groundAt(p.x,p.z,0,.14).height,.14);assert.ok(!made.infrastructure.buildings.some(b=>b.id===YUNYUAN_SOUTH_BUILDING_ID),'solid generic footprint replaced by two west-side hall volumes');
});

test('photographed triple-lane student-one stairs remain climbable on both sides of the new divider rails',()=>{
  const stair=made.plan.stairs.find(s=>s.id==='way/110398904'),dx=(stair.b.x-stair.a.x)/stair.length,dz=(stair.b.z-stair.a.z)/stair.length;
  const dividers=made.plan.rails.filter(r=>r.id.startsWith(stair.id)&&r.divider);
  assert.equal(dividers.length,2);assert.ok(stair.width>=6);
  for(const offset of[-stair.width/3,0,stair.width/3]){
    const m=motion(),start={x:stair.first.x-dx*.8-dz*offset,z:stair.first.z-dz*.8+dx*offset,yaw:Math.atan2(-dx,-dz)};
    assert.equal(m.placeWalker(start).ok,true);
    for(let i=0;i<6000&&Math.hypot(m.state.x-start.x,m.state.z-start.z)<stair.run+stair.upperLandingLength+1;i++){
      m.step(1/120,{forward:.45});
      assert.equal(m.state.blockedReason,'',`lane ${offset} clears steel rails and porch columns`);
    }
    close(m.state.y,3.54,.02);
  }
});

test('blue-green canopy has headroom over the gallery and its fine supports disappear at distance',()=>{
  const canopy=made.group.getObjectByName('south-glazed-gallery-canopy'),frameMesh=made.group.getObjectByName('south-canopy-frame');
  assert.ok(canopy?.isInstancedMesh);assert.ok(frameMesh?.isInstancedMesh);
  made.group.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(canopy);
  assert.ok(bounds.min.y>made.plan.galleryY+2.2,'standing players have unobstructed headroom');
  assert.ok(bounds.max.y<made.plan.height,'canopy fits below the main roof');
  made.update({x:10000,z:10000});assert.equal(frameMesh.visible,false);assert.equal(canopy.visible,true);
  made.update(null);assert.equal(frameMesh.visible,true);
});

test('scene geometry remains finite, is batched, and disposing twice frees each small procedural texture once',()=>{
  made.group.updateMatrixWorld(true);let drawCalls=0,instances=0;
  made.group.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite));if(o.isMesh){drawCalls++;if(o.isInstancedMesh)instances+=o.count;for(const n of o.geometry.attributes.position.array)assert.ok(Number.isFinite(n));}});
  assert.ok(drawCalls<40,`headless model uses ${drawCalls} batches`);assert.ok(instances>400);
  const isolated=createYunyuanSouthPrecinct(THREE,model,{frame,geoToLocal}),textures=new Set();isolated.group.traverse(o=>{if(o.material?.map)textures.add(o.material.map);});let disposals=0;for(const t of textures)t.addEventListener('dispose',()=>disposals++);isolated.dispose();isolated.dispose();assert.equal(disposals,textures.size);assert.equal(textures.size,1);
  const gpuCheck=createYunyuanSouthPrecinct(THREE,model,{frame,geoToLocal}),instanceDisposals=new Map();
  gpuCheck.group.traverse(o=>{if(o.isInstancedMesh){instanceDisposals.set(o,0);o.addEventListener('dispose',()=>instanceDisposals.set(o,instanceDisposals.get(o)+1));}});
  gpuCheck.dispose();gpuCheck.dispose();assert.ok(instanceDisposals.size>0);for(const count of instanceDisposals.values())assert.equal(count,1,'instance attributes release exactly once');
});
