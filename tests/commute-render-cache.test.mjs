import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createCommuteRoute} from '../src/commute-route.js';
import {createCommuteSimulation} from '../src/commute-simulation.js';
import {createCommuteScene} from '../src/commute-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
const fc=JSON.parse(readFileSync(new URL('../public/data/east-campus.geojson',import.meta.url),'utf8'));
const frame=createLocalFrame({longitude:114.42123985,latitude:30.51575845,coordinateSystem:'EPSG:4326'});
function fixture(t){
  const route=createCommuteRoute(fc,{frame,geoToLocal}),sim=createCommuteSimulation(route,{peakAgents:18,maxAgents:18,scooterShare:1,flowScale:0});
  const render=createCommuteScene(THREE,new THREE.Scene(),route,sim);t.after(()=>render.dispose());
  const meshes=()=>render.group.children.filter(o=>o.isInstancedMesh&&/scooter|pedestrian/.test(o.userData.component));
  const body=id=>meshes().find(o=>o.userData.component==='electric-scooter'&&o.userData.part==='paint'&&o.userData.joint==='fixed'&&o.userData.agentIds.includes(id));
  return {route,sim,render,meshes,body};
}
const matrixFor=(mesh,id)=>{const out=new THREE.Matrix4();mesh.getMatrixAt(mesh.userData.agentIds.indexOf(id),out);return out;};

test('unchanged traffic and parked instances do not upload again; moved actors, appearance and brakes invalidate the right data',t=>{
  const f=fixture(t);f.render.update();const versions=f.meshes().map(m=>[m,m.instanceMatrix.version,m.instanceColor?.version]);
  f.render.update();for(const [mesh,matrix,color]of versions){assert.equal(mesh.instanceMatrix.version,matrix);assert.equal(mesh.instanceColor?.version,color);}
  for(const mesh of f.meshes().filter(m=>m.count>0)){assert.deepEqual(mesh.instanceMatrix.updateRanges,[{start:0,count:mesh.count*16}]);if(mesh.instanceColor)assert.deepEqual(mesh.instanceColor.updateRanges,[{start:0,count:mesh.count*3}]);}
  const a=f.sim.agents.find(a=>a.kind==='scooter'),mesh=f.body(a.id),before=matrixFor(mesh,a.id),index=mesh.userData.agentIds.indexOf(a.id),originalColor=Array.from(mesh.instanceColor.array.slice(index*3,index*3+3));
  const parkedVersions=f.meshes().filter(m=>m.userData.component.startsWith('parked')).map(m=>[m,m.instanceMatrix.version]);
  a.x+=1.25;a.yaw+=.2;a.colorIndex=(a.colorIndex+1)%8;a.braking=true;f.render.update();
  const after=matrixFor(f.body(a.id),a.id);assert.ok(Math.abs(after.elements[12]-before.elements[12]-1.25)<.0001);
  assert.notDeepEqual(Array.from(mesh.instanceColor.array.slice(index*3,index*3+3)),originalColor);
  assert.ok(f.meshes().some(m=>m.material.emissiveIntensity===1.1&&m.userData.agentIds.includes(a.id)),'brake material membership follows current braking state');
  for(const [parked,version]of parkedVersions)assert.equal(parked.instanceMatrix.version,version,'unrelated parking stays uploaded once');
  // Wheel support also depends on direction and path scale, even if progress
  // has not changed. A fresh rig must produce exactly the cached scene result.
  a.pathScale=.7;a.direction=-1;a.lean=.12;f.render.update();
  const reference=createCommuteScene(THREE,new THREE.Scene(),f.route,f.sim);try{
    const referenceMeshes=reference.group.children.filter(o=>o.isInstancedMesh&&/scooter|pedestrian/.test(o.userData.component));
    for(const [i,m] of f.meshes().entries()){
      const other=referenceMeshes[i];assert.equal(m.name,other.name);assert.equal(m.count,other.count);
      assert.deepEqual(Array.from(m.instanceMatrix.array.slice(0,m.count*16)),Array.from(other.instanceMatrix.array.slice(0,other.count*16)));
    }
  }finally{reference.dispose();}
});

test('cached parking pickup and return update immediately, and changing detail distance preserves all visible rider identities',t=>{
  const f=fixture(t),item=f.render.scooterTransport.items.find(i=>i.origin==='parking');
  item.record.id=80001;f.render.update();
  const parkedIds=()=>new Set(f.meshes().filter(m=>m.userData.component.startsWith('parked')).flatMap(m=>m.userData.agentIds));
  assert.ok(parkedIds().has(item.record.id));assert.equal(f.render.scooterTransport.take(item).ok,true);assert.ok(!parkedIds().has(item.record.id));
  const pose={x:item.x+2,y:item.y,z:item.z+3,yaw:1};assert.equal(f.render.scooterTransport.release(item,pose).ok,true);assert.ok(parkedIds().has(item.record.id));
  const body=f.meshes().find(m=>m.userData.component==='parked-scooter'&&m.userData.joint==='fixed'&&m.userData.agentIds.includes(item.record.id));
  assert.ok(Math.abs(matrixFor(body,item.record.id).elements[12]-pose.x)<.0001);
  const rider=f.sim.agents.find(a=>a.kind==='scooter');f.sim.state.agents=[rider];
  const camera=new THREE.PerspectiveCamera(58,16/9,.1,1000);camera.position.set(rider.x,rider.y+2,rider.z+25);camera.lookAt(rider.x,rider.y+.9,rider.z);camera.updateMatrixWorld();
  f.render.setDetailDistanceScale(1);f.render.update(camera);
  assert.ok(f.meshes().some(m=>m.userData.component==='electric-scooter'&&m.userData.agentIds.includes(rider.id)));
  f.render.setDetailDistanceScale(.5);f.render.update(camera);
  assert.ok(!f.meshes().some(m=>m.userData.component==='electric-scooter'&&m.userData.agentIds.includes(rider.id)));
  assert.ok(f.meshes().some(m=>m.userData.component==='electric-scooter-distant'&&m.userData.agentIds.includes(rider.id)));
  f.render.setDetailDistanceScale(1);f.render.update(camera);
  assert.ok(f.meshes().some(m=>m.userData.component==='electric-scooter'&&m.userData.agentIds.includes(rider.id)));
});
