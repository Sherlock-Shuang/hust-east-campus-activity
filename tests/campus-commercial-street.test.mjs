import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {createCommuteRoute} from '../src/commute-route.js';
import {createPlayerWorld} from '../src/player-experience.js';
import {createPlayerMotion} from '../src/player-motion.js';
import {createYunyuanSouthPrecinct} from '../src/yunyuan-south-precinct.js';
import {CBD_BUILDING_IDS,CBD_SHOPS,planCampusCommercialStreet,createCampusCommercialStreet} from '../src/campus-commercial-street.js';
import {createCommercialFrontages} from '../src/commercial-frontage-renderer.js';
import {getRoadProfile} from '../src/building-profiles.js';

const data=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8')),before=JSON.stringify(data);
const frame=createLocalFrame({longitude:114.427,latitude:30.517,coordinateSystem:'EPSG:4326'});
const model=createGeoScene(THREE,new THREE.Scene(),data,frame,geoToLocal),route=createCommuteRoute(data,{frame,geoToLocal});
const south=createYunyuanSouthPrecinct(THREE,model,{frame,geoToLocal});
const made=createCampusCommercialStreet(THREE,model,{frame,geoToLocal,southPlan:south.plan});
const architecture={buildings:[...south.infrastructure.buildings,...made.infrastructure.buildings],barriers:[...south.infrastructure.barriers,...made.infrastructure.barriers],walkSurfaces:[...south.infrastructure.walkSurfaces,...made.infrastructure.walkSurfaces],replacedBuildingIds:[...south.infrastructure.replacedBuildingIds,...made.infrastructure.replacedBuildingIds],replacedRoadIds:[...south.infrastructure.replacedRoadIds,...made.infrastructure.replacedRoadIds]};
const world=createPlayerWorld({...model,architectureInfrastructure:architecture});
const motion=()=>createPlayerMotion({world,route});
const local=([longitude,latitude])=>geoToLocal({longitude,latitude,height:0,coordinateSystem:'EPSG:4326'},frame);
const poly=ring=>ring.map(p=>[p.x,p.z]);
const close=(a,b,e=.001)=>assert.ok(Math.abs(a-b)<e,`${a} approximately ${b}`);
function area(polygons){return polygons.reduce((sum,p)=>sum+p.reduce((total,ring,i)=>total+(i?-1:1)*Math.abs(ring.reduce((a,[x,z],j)=>{const q=ring[(j+1)%ring.length];return a+x*q[1]-q[0]*z;},0)/2),0),0);}
function inside(p,ring){let value=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)value=!value;}return value;}
after(()=>{made.dispose();south.dispose();model.dispose();});

test('CBD shop identities remain attached to the three source footprints and the historic evidence remains explicit',()=>{
  assert.equal(made.plan.accepted,true);assert.deepEqual(made.infrastructure.replacedBuildingIds,[...CBD_BUILDING_IDS]);
  assert.ok(!made.infrastructure.replacedBuildingIds.includes('way/1228820962'),'unidentified neighbouring building is not relabelled');
  assert.ok(!made.infrastructure.replacedBuildingIds.includes('way/1228820967'),'substation is not a storefront');
  for(const shop of CBD_SHOPS){
    const point=local(data.features.find(f=>f.id===shop.poiId).geometry.coordinates);
    const matching=made.plan.buildings.filter(b=>b.sourceId===shop.buildingId);
    assert.ok(matching.some(b=>inside(point,b.rings[0])),`${shop.title} remains in its mapped building`);
    const f=made.plan.frontages.find(f=>f.id===shop.id);assert.equal(f.title,shop.title);assert.equal(f.sourceId,shop.buildingId);
  }
  assert.match(made.plan.evidence.uncertainty,/estimates|approximations/);
  assert.match(made.plan.evidence.uncertainty,/Unidentified canteen shops/);
  assert.equal(JSON.stringify(data),before);
  assert.deepEqual(planCampusCommercialStreet(model,{frame,geoToLocal,southPlan:south.plan}),made.plan);
});

test('low pavilion and pitched restaurant volumes partition rather than enlarge their original mapped buildings',()=>{
  for(const id of CBD_BUILDING_IDS){
    const source=model.records.find(r=>r.id===id).shapes[0].getPoints().map(v=>[v.x,-v.y]);
    const parts=made.plan.buildings.filter(b=>b.sourceId===id),union=polygonClipping.union(...parts.map(b=>[poly(b.rings[0])]));
    close(area(polygonClipping.difference([source],union)),0,.00001);
    close(area(polygonClipping.difference(union,[source])),0,.00001);
    for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++)close(area(polygonClipping.intersection([poly(parts[i].rings[0])],[poly(parts[j].rings[0])])),0,.00001);
  }
  const burger=made.plan.buildings.find(b=>b.style==='burger-pavilion'),rear=made.plan.buildings.find(b=>b.style==='rear-gable');
  assert.ok(burger.height>=3.5&&burger.height<5,'photographed low pavilion does not retain the old 10.5m generic block');
  assert.ok(rear.height>burger.height&&rear.roofRise>.5);
  const oxygen=made.plan.frontages.find(f=>f.id==='oxygen'),oxygenBuilding=made.plan.buildings.find(b=>b.sourceId===oxygen.sourceId);
  assert.ok(oxygen.baseY>3.5,'upstairs oxygen shop');assert.ok(oxygen.baseY+oxygen.height<oxygenBuilding.height);
  for(const b of made.plan.buildings){assert.ok(b.height<9);assert.ok(world.buildings.includes(b),'physics consumes the replacement volume');}
  for(const id of CBD_BUILDING_IDS)assert.ok(!world.buildings.some(b=>b.id===id),'no invisible generic collision volume remains');
});

test('pitched restaurant end walls close below the ridge instead of leaving triangular holes',()=>{
  made.group.updateMatrixWorld(true);let checked=0;
  for(const b of made.plan.buildings.filter(b=>b.roofRise>0)){
    const ring=b.rings[0],center=ring.reduce((s,p)=>({x:s.x+p.x/ring.length,z:s.z+p.z/ring.length}),{x:0,z:0});
    for(let i=0;i<ring.length;i++){
      const a=ring[i],q=ring[(i+1)%ring.length],dx=q.x-a.x,dz=q.z-a.z,length=Math.hypot(dx,dz);
      if(Math.abs((dx*b.frame.ex.x+dz*b.frame.ex.z)/length)>.4)continue;
      const p={x:(a.x+q.x)/2,z:(a.z+q.z)/2};let nx=-dz/length,nz=dx/length;
      if((p.x-center.x)*nx+(p.z-center.z)*nz<0){nx=-nx;nz=-nz;}
      const ray=new THREE.Raycaster(new THREE.Vector3(p.x+nx*2,b.eaveHeight+b.roofRise*.45,p.z+nz*2),new THREE.Vector3(-nx,0,-nz),0,2.15);
      const hit=ray.intersectObject(made.group,true)[0];assert.ok(hit,`${b.id} end ${i} is physically closed above the eaves`);close(hit.distance,2,.01);checked++;
    }
  }
  assert.ok(checked>=4);
});

test('food-hall shop bays leave the central passage and both stair porches open',()=>{
  const shops=made.plan.frontages.filter(f=>f.id.startsWith('canteen-link-shop'));
  assert.ok(shops.length>=6);assert.ok(shops.every(f=>f.title===''),'unverified tenants are anonymous');
  const sf=south.plan.frame,localZ=p=>(p.x-sf.origin.x)*sf.ez.x+(p.z-sf.origin.z)*sf.ez.z;
  for(const f of shops){
    const z=localZ(f),lo=z-f.width/2,hi=z+f.width/2;
    assert.ok(south.plan.halls.some(h=>lo>h.start&&hi<h.end),`${f.id} stays within a hall wall`);
    for(const p of south.plan.porches)assert.ok(hi<=p.z-p.depth/2||lo>=p.z+p.depth/2,`${f.id} avoids porch/stair access`);
    assert.ok(f.baseY+f.height<south.plan.galleryY-.25,'shop does not intersect the overhead gallery deck');
  }
  const gallery=south.plan.galleries[1],m=motion();
  assert.equal(m.placeWalker({x:(gallery.a.x+gallery.b.x)/2,z:(gallery.a.z+gallery.b.z)/2,y:.14,yaw:0}).ok,true);
  close(m.state.y,.14);
});

test('all three mapped CBD lanes and advertised viewpoints remain physically accessible at ground level',()=>{
  for(const id of ['way/1483567195','way/1483567196','way/1483567197']){
    const points=data.features.find(f=>f.id===id).geometry.coordinates.map(local),m=motion();
    for(let i=1;i<points.length;i++)for(let j=0;j<=24;j++){
      const a=points[i-1],b=points[i],t=j/24,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t;
      for(const mode of ['walk','scooter']){
        const result=m.placeMode({x,z,y:.14,yaw:Math.atan2(a.x-b.x,a.z-b.z)},mode);
        assert.equal(result.ok,true,`${id} ${mode} sample ${i}:${j} must not be blocked by storefronts or furniture`);close(m.state.y,.14);
      }
    }
  }
  for(const [key,pose]of Object.entries(made.viewpoints)){
    const m=motion(),result=m.placeWalker(pose);assert.equal(result.ok,true,`${key} view is a real standing position`);close(m.state.y,.14);
  }
});

test('street furnishings and clipped paving leave all source roads and neighbouring buildings clear',()=>{
  const roadPolygons=[];
  for(const record of model.roads){
    const g=record.feature.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[],half=getRoadProfile(record.feature).width/2;
    for(const line of lines){const points=line.map(local);for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<.01)continue;
      const nx=-dz/length*half,nz=dx/length*half;
      roadPolygons.push({id:record.id,polygon:[[a.x+nx,a.z+nz],[b.x+nx,b.z+nz],[b.x-nx,b.z-nz],[a.x-nx,a.z-nz]]});
    }}
  }
  const buildingPolygons=model.buildings.flatMap(r=>r.shapes.map(shape=>({id:r.id,polygon:shape.getPoints().map(p=>[p.x,-p.y])})));
  assert.ok(made.plan.fixtures.length>0);assert.ok(made.plan.paving.length>0);
  for(const obstacle of [...roadPolygons,...buildingPolygons]){
    for(const fixture of made.plan.fixtures)close(area(polygonClipping.intersection([poly(fixture.polygon)],[obstacle.polygon])),0,.00001);
    close(area(polygonClipping.intersection(made.plan.paving.map(rings=>rings.map(poly)),[obstacle.polygon])),0,.00001);
  }
  made.group.updateMatrixWorld(true);let pavements=0;
  made.group.traverse(o=>{if(o.name==='cbd-clipped-patio-paving'){pavements++;const v=new THREE.Vector3();for(let i=0;i<o.geometry.attributes.position.count;i++){v.fromBufferAttribute(o.geometry.attributes.position,i).applyMatrix4(o.matrixWorld);assert.ok(v.y<.14,'paving remains below the walking datum and source road markings');}}});
  assert.ok(pavements>0);
});

test('frontage skins stay within their shallow projection limits, including the narrow Oxygen alley',()=>{
  for(const f of made.plan.frontages){
    const rendered=createCommercialFrontages(THREE,{frontages:[f]}),matrix=new THREE.Matrix4(),v=new THREE.Vector3();
    rendered.group.updateMatrixWorld(true);let maximum=-Infinity;
    rendered.group.traverse(o=>{if(!o.isInstancedMesh)return;const positions=o.geometry.attributes.position;
      for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);for(let j=0;j<positions.count;j++){
        v.fromBufferAttribute(positions,j).applyMatrix4(matrix).applyMatrix4(o.matrixWorld);maximum=Math.max(maximum,(v.x-f.x)*f.nx+(v.z-f.z)*f.nz);
      }}
    });
    assert.ok(maximum<=f.maxProjection+.001,`${f.id} projects ${maximum}m past a ${f.maxProjection}m allowance`);rendered.dispose();
  }
});

test('commercial detail is finite and batched, distance culled, and released exactly once',()=>{
  let draws=0,instances=0;made.group.updateMatrixWorld(true);
  made.group.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite));if(o.isMesh){draws++;if(o.isInstancedMesh)instances+=o.count;for(const n of o.geometry.attributes.position.array)assert.ok(Number.isFinite(n));}});
  assert.ok(draws<=70,`whole commercial area uses ${draws} headless batches`);assert.ok(instances>100);
  made.update({position:new THREE.Vector3(10000,2,10000)});
  const detail=[];made.group.traverse(o=>{if(o.userData.component==='commercial-frontage-batch')detail.push(o);});
  assert.ok(detail.length>0);assert.ok(detail.every(o=>!o.visible),'distant shop frames and window dressing are culled');
  made.update(null);assert.ok(detail.every(o=>o.visible),'full export restores detail');
  const isolated=createCampusCommercialStreet(THREE,model,{frame,geoToLocal,southPlan:south.plan}),resources=new Set();
  isolated.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);for(const m of(Array.isArray(o.material)?o.material:o.material?[o.material]:[])){resources.add(m);if(m.map)resources.add(m.map);}});
  const counts=new Map();for(const r of resources)r.addEventListener('dispose',()=>counts.set(r,(counts.get(r)||0)+1));
  isolated.dispose();isolated.dispose();for(const r of resources)assert.equal(counts.get(r),1,'resource is disposed once');
});

test('the real canvas sign painter keeps all supplied brand text in one shared atlas',()=>{
  const oldDocument=globalThis.document,written=[];
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({clearRect(){},fillRect(){},beginPath(){},arc(){},fill(){},measureText(text){return{width:String(text).length*80};},fillText(text){written.push(text);}})})};
  let signage;try{signage=createCommercialFrontages(THREE,{frontages:made.plan.frontages});}finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
  for(const shop of CBD_SHOPS)assert.ok(written.includes(shop.title),`${shop.title} is actually painted`);
  const atlases=[];signage.group.traverse(o=>{if(o.userData.component==='commercial-sign-atlas')atlases.push(o);});
  assert.equal(atlases.length,1);assert.equal(signage.counts.textures,1);
  assert.ok(atlases[0].userData.labels.every(l=>l.title.length>0));
  let count=0;atlases[0].material.map.addEventListener('dispose',()=>count++);signage.dispose();signage.dispose();assert.equal(count,1);
});
