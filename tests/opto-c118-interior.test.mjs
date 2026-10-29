import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createOptoC118Interior,planOptoC118Interior,OPTO_C118_EVIDENCE} from '../src/opto-c118-interior.js';
import {createPlayerMotion} from '../src/player-motion.js';

const plan=planOptoC118Interior();
const route={length:30,points:[{x:-9.95,y:.16,z:-8.5,progress:0},{x:-9.95,y:.16,z:14,progress:30}],segments:[{startProgress:0,endProgress:30,width:2}]};
const motion=()=>createPlayerMotion({route,world:{barriers:plan.colliders,walkSurfaces:plan.walkSurfaces,bounds:plan.bounds,buildings:[],water:[]}});
const tick=(p,seconds,input)=>{for(let i=0;i<seconds*120;i++)p.step(1/120,input);};
const close=(a,b,tolerance=.025)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} should be near ${b}`);

test('C118 identity is grounded in a C118 event; unsurveyed dimensions and seating stay explicit',()=>{
  assert.equal(OPTO_C118_EVIDENCE.id,'opto-c118');assert.equal(plan.dimensions,'photo-estimate');
  assert.equal(plan.layoutEstimated,true);assert.equal(plan.seatCount,520);
  assert.match(OPTO_C118_EVIDENCE.photo,/6882948/);
  assert.ok(OPTO_C118_EVIDENCE.uncertain.some(s=>s.includes('座位数')));
  assert.doesNotThrow(()=>JSON.stringify(plan));
});

test('photo-visible door, front cross aisle, both main aisles and stage have safe full walking clearance',()=>{
  const p=motion();
  for(const at of [plan.spawn,{x:-11.5,z:plan.spawn.z},plan.viewpoints.front,
    {x:-5.88,z:0},{x:5.88,z:0},plan.viewpoints.rear,{x:0,z:-13}]){
    assert.equal(p.placeWalker({yaw:0,...at}).ok,true,`safe full capsule at ${JSON.stringify(at)}`);
    assert.equal(p.state.grounded,true);assert.ok(Number.isFinite(p.state.y));
  }
  assert.equal(p.placeWalker({...plan.spawn}).ok,true);
  tick(p,1,{moveX:1,moveZ:0});assert.ok(p.state.x>plan.spawn.x+1,'entry opens toward the front cross aisle');
});

test('audience chair rows and wall panels block walking; stairs and aisles do not teleport above them',()=>{
  const p=motion();assert.equal(p.placeWalker(plan.spawn).ok,true);
  for(const at of [{x:0,z:plan.seatRows[3].z},{x:11,z:6},{x:0,z:-17}])assert.equal(p.placeWalker({yaw:0,...at}).ok,false);
  assert.equal(p.placeWalker({x:5.88,z:-5.8,yaw:0}).ok,true);
  const initial={...p.state};let last=p.state.y,maxRise=0;
  for(let i=0;i<4*120;i++){p.step(1/120,{moveX:0,moveZ:1});maxRise=Math.max(maxRise,p.state.y-last);last=p.state.y;}
  assert.ok(p.state.z>initial.z+10,'main aisle reaches the rear seating tiers');
  assert.ok(maxRise<=.181,`maximum step ${maxRise} respects real tread bounds`);
  assert.ok(p.state.y<3);assert.equal(p.state.blockedReason,'');
  for(const sign of [-1,1]){
    assert.equal(p.placeWalker({x:sign*9.5,z:-8.7,yaw:0}).ok,true);
    let prev=p.state.y,max=0;
    for(let i=0;i<240;i++){p.step(1/120,{moveX:0,moveZ:-.28});max=Math.max(max,p.state.y-prev);prev=p.state.y;}
    assert.ok(p.state.y>plan.config.floorY+.5,'photo-visible stage stairs elevate gradually');assert.ok(max<=.181);
  }
});

test('configuration cannot create a squeezed aisle or rows through a rear wall',()=>{
  assert.throws(()=>planOptoC118Interior({rows:25}),/rear circulation/);
  assert.throws(()=>planOptoC118Interior({width:20,centreSeats:22,sideSeats:6}),/side circulation/);
  assert.throws(()=>planOptoC118Interior({rowRise:.25}),/rowRise/);
  assert.throws(()=>planOptoC118Interior({rows:19.5}),/integer/);
  const small=planOptoC118Interior({rows:16,centreSeats:16});assert.equal(small.seatCount,384);
});

test('shared geometry produces bounded draw counts, finite instances and repeatable disposal',()=>{
  const hall=createOptoC118Interior(THREE),original=JSON.stringify(hall.plan);
  let meshes=0,instances=0;const geometries=new Set(),materials=new Set(),textures=new Set();
  hall.group.traverse(o=>{
    assert.ok(o.matrix.elements.every(Number.isFinite));
    if(!o.isMesh)return;meshes++;geometries.add(o.geometry);materials.add(o.material);if(o.material.map)textures.add(o.material.map);
    const attr=o.geometry.attributes.position;for(let i=0;i<attr.array.length;i++)assert.ok(Number.isFinite(attr.array[i]));
    if(o.isInstancedMesh){instances+=o.count;assert.ok([...o.instanceMatrix.array].every(Number.isFinite));}
    assert.equal(o.castShadow,false);
  });
  assert.ok(meshes<65,`only ${meshes} mesh draw calls for ${instances} instances`);
  assert.ok(instances>5000);assert.ok(geometries.size<10);
  assert.deepEqual(hall.colliders,plan.colliders,'plan and visible model share the same collision data');
  assert.ok(hall.group.getObjectByName('c118-curved-stage'));
  assert.ok(hall.group.getObjectByName('c118-hanging-speaker-array').isInstancedMesh);
  assert.ok(hall.group.getObjectByName('c118-seat-back-cushions').isInstancedMesh);
  const box=new THREE.Box3().setFromObject(hall.group);assert.ok(box.min.y>=-.021);assert.ok(box.max.y<10);
  let disposedGeometries=0,disposedMaterials=0,disposedTextures=0;
  geometries.forEach(g=>g.addEventListener('dispose',()=>disposedGeometries++));
  materials.forEach(m=>m.addEventListener('dispose',()=>disposedMaterials++));
  textures.forEach(t=>t.addEventListener('dispose',()=>disposedTextures++));assert.equal(textures.size,3);
  hall.dispose();hall.dispose();assert.equal(hall.group.children.length,0);
  assert.equal(disposedGeometries,geometries.size);assert.equal(disposedMaterials,materials.size);assert.equal(disposedTextures,textures.size);
  assert.equal(JSON.stringify(hall.plan),original);
});
