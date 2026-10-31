import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {planYunyuanSouthPrecinct} from '../src/yunyuan-south-precinct.js';
import {getRoadProfile} from '../src/building-profiles.js';
import {streetFootprint} from '../src/street-clearance.js';
import {footprintIntersectsRing} from '../src/yunyuan-parking.js';
import {createCanteenStreetLife,planCanteenStreetLife,CANTEEN_STREET_SOURCES} from '../src/canteen-street-life.js';
const source=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(){const model=createGeoScene(THREE,new THREE.Scene(),source,frame,geoToLocal),southPlan=planYunyuanSouthPrecinct(model,{frame,geoToLocal});return{model,options:{frame,geoToLocal,southPlan}};}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);}
function edgeSamples(poly){return poly.flatMap((a,i)=>Array.from({length:9},(_,k)=>{const b=poly[(i+1)%poly.length],t=k/8;return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t};}));}

test('photograph-guided canteen plan is deterministic and leaves all source coordinates unchanged',()=>{
  const {model,options}=fixture(),before=JSON.stringify(source);
  try{const a=planCanteenStreetLife(model,options),b=planCanteenStreetLife(model,options);assert.deepEqual(a,b);assert.equal(a.accepted,true);assert.equal(a.id,'canteen-street');assert.deepEqual(a.sources,CANTEEN_STREET_SOURCES);assert.ok(a.trees.length>=24&&a.trees.length<=32);assert.ok(a.parking.length>=24&&a.parking.length<=40);assert.equal(new Set(a.parking.map(p=>p.id)).size,a.parking.length);assert.ok(new Set(a.parking.map(p=>p.clusterId)).size>=7);assert.ok(a.parking.some(p=>p.z>245));assert.ok(a.trees.filter(p=>p.z>270).length>=4);assert.ok(a.trees.every(t=>t.height>=12.8&&t.height<16.6&&t.radius>=8.7));assert.equal(JSON.stringify(source),before);assert.deepEqual(planCanteenStreetLife().trees,[]);}finally{model.dispose();}
});

test('every trunk and full scooter boundary keeps all source carriageways, footways and entrances open',()=>{
  const {model,options}=fixture();try{
    const p=planCanteenStreetLife(model,options),project=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
    const roads=model.records.filter(r=>r.feature?.geometry?.type==='LineString'&&r.feature.properties?.tags?.highway).map(r=>({...getRoadProfile(r.feature),id:r.id,points:r.feature.geometry.coordinates.map(project)})).filter(r=>!r.bridge&&!r.tunnel);
    for(const t of p.trees)for(const road of roads)for(let i=1;i<road.points.length;i++)assert.ok(segmentDistance(t,road.points[i-1],road.points[i])>=road.width/2+t.trunkRadius+.15,`${t.id} clears ${road.id}`);
    const polygons=p.parking.map(s=>streetFootprint(s.x,s.z,1.05,2.24,s.yaw));
    for(const [i,poly]of polygons.entries()){
      for(const q of edgeSamples(poly))for(const road of roads)for(let j=1;j<road.points.length;j++)assert.ok(segmentDistance(q,road.points[j-1],road.points[j])>=road.width/2+.1,`scooter ${p.parking[i].id} clears ${road.id}`);
      for(const surface of options.southPlan.walkSurfaces.filter(s=>/stair|approach/.test(s.kind)))assert.equal(footprintIntersectsRing(poly,surface.polygon),false);
      for(let j=i+1;j<polygons.length;j++)assert.equal(footprintIntersectsRing(poly,polygons[j]),false,'parked scooters do not overlap');
      for(const t of p.trees)assert.ok(edgeSamples(poly).every(q=>distance(q,t)>t.trunkRadius+.2));
    }
    assert.ok(p.barriers.every(b=>b.polygon.length===12&&b.height<=5.24),'only trunks and poles block movement, never broad canopies');
    assert.ok(p.dapplePatches.every(patch=>patch.surfaceType==='open-lower-forecourt'?patch.y===.022:patch.y>=.147&&patch.y<=.15));
    assert.ok(new Set(p.dapplePatches.map(patch=>patch.sourceId)).has(CANTEEN_STREET_SOURCES.walk));
  }finally{model.dispose();}
});

test('additional reservations affect only inferred placements and missing source data fails closed',()=>{
  const {model,options}=fixture();try{const base=planCanteenStreetLife(model,options),t=base.trees[0],modified=planCanteenStreetLife(model,{...options,existingTrees:[{x:t.x,z:t.z,trunkRadius:2}]});assert.ok(modified.trees.every(p=>distance(t,p)>3));
    const missing={...model,records:model.records.filter(r=>r.id!==CANTEEN_STREET_SOURCES.walk)};assert.equal(planCanteenStreetLife(missing,options).accepted,false);
    const blocked=planCanteenStreetLife(model,{...options,groundAt:()=>({allowed:false,height:.14})});assert.equal(blocked.trees.length,0);assert.equal(blocked.parking.length,0);
  }finally{model.dispose();}
});

test('street trees use shared instances and LOD; time modes update stable ground shaders without lights or leaf shadow draws',()=>{
  const {model,options}=fixture(),layer=createCanteenStreetLife(THREE,model,options);try{
    const meshes=[],lights=[];layer.group.traverse(o=>{if(o.isMesh)meshes.push(o);if(o.isLight)lights.push(o);});assert.equal(lights.length,0);assert.ok(meshes.length<30);assert.ok(meshes.filter(m=>m.name.startsWith('canteen-street-canopy')).every(m=>m.isInstancedMesh&&!m.castShadow));
    // The handheld renderer uses a transparent canvas without multisampling:
    // alpha-to-coverage there exposes white page pixels at every leaf edge.
    const foliage=meshes.filter(m=>m.name.startsWith('canteen-street-canopy')&&m.material.map);
    assert.ok(foliage.length>=4,'near, distant and horizon foliage all covered');
    for(const mesh of foliage){
      assert.equal(mesh.material.alphaToCoverage,false,`${mesh.name}: safe without MSAA`);
      assert.equal(mesh.material.transparent,false,`${mesh.name}: surviving pixels are opaque`);
      assert.ok(mesh.material.alphaTest>=.4,`${mesh.name}: empty leaf mask pixels are discarded`);
    }
    const dapple=layer.group.getObjectByName('canteen-world-fixed-dapple'),pools=layer.group.getObjectByName('canteen-warm-ground-pools');assert.equal(dapple.geometry,pools.geometry);assert.equal(dapple.material.depthWrite,false);assert.equal(dapple.userData.worksWithoutShadows,true);
    const compile=m=>{const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};m.onBeforeCompile(shader);return shader;};
    const shader=compile(dapple.material),pool=compile(pools.material);assert.ok(shader.fragmentShader.includes('fwidth(leaves)'));assert.ok(!shader.fragmentShader.includes('uniform float time'));assert.ok(shader.vertexShader.includes('position.xz'));assert.equal(shader.uniforms.csStrength.value,.46);
    const bark=meshes.find(m=>m.name.includes('-branches-')).material,barkShader=compile(bark);assert.ok(barkShader.fragmentShader.includes('barkPatch'));assert.ok(!/float\s+patch\b/.test(barkShader.fragmentShader),'GLSL patch is reserved');
    layer.setTimeOfDay('sunset');assert.equal(shader.uniforms.csStrength.value,.19);assert.equal(shader.uniforms.csWarmth.value,1);assert.equal(pools.visible,true);
    layer.setTimeOfDay('night');assert.equal(dapple.visible,false);assert.equal(shader.uniforms.csStrength.value,0);assert.ok(pool.uniforms.csStrength.value>.4);assert.equal(layer.group.userData.timeOfDay,'night');
    const camera=new THREE.PerspectiveCamera(60,1,.1,2500);camera.position.set(510,1.8,246);camera.lookAt(515,8,190);layer.update(camera,{detailDistanceScale:1});layer.setTimeOfDay('day');assert.equal(pools.visible,false);assert.equal(dapple.visible,true);
    let disposed=0;dapple.geometry.addEventListener('dispose',()=>disposed++);layer.dispose();layer.dispose();assert.equal(disposed,1);assert.equal(layer.group.children.length,0);
  }finally{layer.dispose();model.dispose();}
});
