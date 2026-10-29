import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createOptoC118Interior,planOptoC118Interior,OPTO_C118_EVIDENCE} from '../src/opto-c118-interior.js';
import {createC118Navigation,crossedC118Door} from '../src/c118-navigation.js';
const plan=planOptoC118Interior(),close=(a,b,t=.025)=>assert.ok(Math.abs(a-b)<=t,`${a} should be near ${b}`);
const motion=()=>createC118Navigation({plan,spawn:plan.spawn,colliders:plan.colliders,walkSurfaces:plan.walkSurfaces});
function travel(m,target,speed=.5){
  let maxRise=0,previous=m.state.y;
  for(let i=0;i<14000;i++){
    const dx=target.x-m.state.x,dz=target.z-m.state.z,d=Math.hypot(dx,dz);if(d<.045)return{maxRise};
    const v=Math.min(speed,d*8);m.step(1/120,{moveX:dx/d*v,moveZ:dz/d*v});maxRise=Math.max(maxRise,Math.abs(m.state.y-previous));previous=m.state.y;
    assert.equal(m.state.blockedReason,'',`walking blocked at ${m.state.x},${m.state.y},${m.state.z}`);
  }
  assert.fail('walker did not reach target');
}

test('two user photos revise the rake, cross aisle and mid-side doors while dimensions and 520 seats remain estimates',()=>{
  assert.equal(OPTO_C118_EVIDENCE.id,'opto-c118');assert.equal(OPTO_C118_EVIDENCE.userPhotos.length,2);
  assert.equal(plan.dimensions,'photo-estimate');assert.equal(plan.layoutEstimated,true);assert.equal(plan.seatCount,520);
  assert.ok(OPTO_C118_EVIDENCE.uncertain.some(s=>s.includes('座位数')));
  assert.equal(plan.seatRows.filter(r=>r.section==='front').length,10);assert.equal(plan.seatRows.filter(r=>r.section==='rear').length,10);
  close(plan.crossAisle.endZ-plan.crossAisle.startZ,1.8);close(plan.crossAisle.y,2.66);close(plan.seatRows.at(-1).y-plan.config.floorY,5.92);
  assert.ok(plan.audienceSteps.every(s=>s.riser<=.18));assert.equal(plan.doors.length,4);assert.doesNotThrow(()=>JSON.stringify(plan));
});

test('default spawn and both entry viewpoints are at real clear side-door platforms, not chair rows',()=>{
  const m=motion();close(m.state.y,plan.crossAisle.y);assert.equal(crossedC118Door(plan,m.state),false);
  for(const [name,pose]of Object.entries(plan.viewpoints)){assert.equal(m.placeWalker(pose).ok,true,`${name} has a clear player capsule`);close(m.state.y,pose.y);}
  assert.equal(m.placeWalker(plan.spawn).ok,true);travel(m,{x:0,z:plan.crossAisle.z});close(m.state.y,plan.crossAisle.y);
  for(const b of plan.blocks)assert.equal(m.placeWalker({x:(b.x0+b.x1)/2,z:plan.seatRows[4].z,yaw:0}).ok,false,'chairs remain solid');
});

test('all four longitudinal aisles climb two-stage seating and descend without a >0.18m snap',()=>{
  for(const aisle of plan.aisles){const m=motion(),x=(aisle.x0+aisle.x1)/2,start={x,z:plan.seatRows[0].startZ-.25,yaw:0},end={x,z:plan.seatRows.at(-1).endZ+.8};
    assert.equal(m.placeWalker(start).ok,true);close(m.state.y,plan.config.floorY);
    const up=travel(m,end);close(m.state.y,plan.seatRows.at(-1).y);assert.ok(up.maxRise<=.181,`${aisle.id} rises only one tread: ${up.maxRise}`);
    const down=travel(m,start);close(m.state.y,plan.config.floorY);assert.ok(down.maxRise<=.181,`${aisle.id} descends only one tread`);
  }
});

test('both short stage stairways remain climbable and connect laterally to the stage',()=>{
  for(const side of[-1,1]){const m=motion(),x=side*(plan.stage.halfWidth+(plan.config.width/2-.9-plan.stage.halfWidth)/2),start={x,z:plan.stage.front+1.15,yaw:0};
    assert.equal(m.placeWalker(start).ok,true);const up=travel(m,{x,z:plan.stage.front-.43},.25);close(m.state.y,plan.stage.height);assert.ok(up.maxRise<=.181);
    travel(m,{x:side*(plan.stage.halfWidth-.7),z:plan.stage.front-.43},.25);close(m.state.y,plan.stage.height);
  }
});

test('front and mid-side return doors require the correct side, width and platform height',()=>{
  for(const door of plan.doors){const m=motion(),start={x:door.x-door.side*.9,z:door.z,yaw:0};assert.equal(m.placeWalker(start).ok,true);close(m.state.y,door.y);
    travel(m,{x:door.x+door.side*.5,z:door.z},.3);assert.equal(crossedC118Door(plan,m.state),true,door.id);
    assert.equal(crossedC118Door(plan,{...m.state,y:door.y+2}),false,'flying above a doorway cannot trigger exit');
    assert.equal(crossedC118Door(plan,{...m.state,y:door.y-1}),false,'wrong floor cannot trigger exit');
    assert.equal(crossedC118Door(plan,{...m.state,z:door.z+door.width}),false);
    travel(m,{x:start.x,z:start.z},.3);close(m.state.y,door.y);assert.equal(crossedC118Door(plan,m.state),false,'recess and inside platform connect in both directions');
  }
  assert.equal(plan.exit.id,'c118-return');assert.equal(plan.exit.doorId,'c118-front-left-door','old front exit alias remains');
});

test('configuration rejects seats in the rear wall, excessive risers and insufficient headroom',()=>{
  assert.throws(()=>planOptoC118Interior({rows:25}),/rear circulation/);
  assert.throws(()=>planOptoC118Interior({width:20,centreSeats:22,sideSeats:6}),/side circulation/);
  assert.throws(()=>planOptoC118Interior({rearRowRise:.5}),/rearRowRise/);
  assert.throws(()=>planOptoC118Interior({rows:19.5}),/integer/);
  assert.throws(()=>planOptoC118Interior({frontRows:19}),/frontRows/);
  const smaller=planOptoC118Interior({rows:16,frontRows:8,centreSeats:16});assert.equal(smaller.seatCount,384);
});

test('rendered aisle treads match navigation height; video surface and new photo cues are retained',()=>{
  const hall=createOptoC118Interior(THREE);hall.group.updateMatrixWorld(true);
  for(const s of hall.plan.audienceSteps.filter(s=>s.aisle==='left-main'&&s.row%3===0)){
    const x=(s.polygon[0].x+s.polygon[2].x)/2,z=(s.polygon[0].z+s.polygon[2].z)/2;
    const ray=new THREE.Raycaster(new THREE.Vector3(x,s.surfaceY+.2,z),new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(hall.group,true)[0];assert.ok(hit);close(hit.point.y,s.surfaceY,.003);
  }
  assert.equal(hall.videoScreen.name,'c118-video-screen');assert.equal(hall.videoScreen.visible,false);close(hall.videoScreen.geometry.parameters.width,9.8);close(hall.videoScreen.geometry.parameters.height,6);
  for(const name of['c118-grand-piano-case','c118-middle-aisle-wood-guard','c118-side-light-strip','c118-ceiling-low-beams','c118-seat-headrests'])assert.ok(hall.group.getObjectByName(name),name);
  for(const d of hall.plan.doors){
    const ray=new THREE.Raycaster(new THREE.Vector3(d.x-d.side*.8,d.y+1.2,d.z),new THREE.Vector3(d.side,0,0));
    const hit=ray.intersectObject(hall.group,true)[0];
    assert.ok(!hit||hit.distance>1.3,`${d.id}: decorative panels must not cover the physical opening`);
  }
  hall.dispose();
});

test('instances, LOD, material ownership and repeatable disposal stay bounded',()=>{
  const hall=createOptoC118Interior(THREE),original=JSON.stringify(hall.plan);let meshes=0,instances=0;const geometries=new Set(),materials=new Set(),textures=new Set();
  hall.group.traverse(o=>{assert.ok(o.matrix.elements.every(Number.isFinite));if(!o.isMesh)return;meshes++;geometries.add(o.geometry);materials.add(o.material);if(o.material.map)textures.add(o.material.map);assert.ok(o.geometry.attributes.position.array.every(Number.isFinite));if(o.isInstancedMesh){instances+=o.count;assert.ok([...o.instanceMatrix.array].every(Number.isFinite));}assert.equal(o.castShadow,false);});
  assert.ok(meshes<=80,`${meshes} draw calls`);assert.ok(instances>5000&&instances<8000);assert.ok(geometries.size<=9);
  assert.deepEqual(hall.colliders,plan.colliders);const box=new THREE.Box3().setFromObject(hall.group);assert.ok(box.min.y>=-.021);assert.ok(box.max.y<12);
  hall.update({position:{x:0,z:100}});assert.ok(hall.group.children.some(o=>!o.visible&&o.name==='c118-seat-foot-brackets'));
  hall.update(null);assert.ok(hall.group.children.filter(o=>o.name==='c118-seat-foot-brackets').every(o=>o.visible));
  let dg=0,dm=0,dt=0;geometries.forEach(g=>g.addEventListener('dispose',()=>dg++));materials.forEach(m=>m.addEventListener('dispose',()=>dm++));textures.forEach(t=>t.addEventListener('dispose',()=>dt++));assert.equal(textures.size,3);
  hall.dispose();hall.dispose();assert.equal(hall.group.children.length,0);assert.equal(dg,geometries.size);assert.equal(dm,materials.size);assert.equal(dt,textures.size);assert.equal(JSON.stringify(hall.plan),original);
});
