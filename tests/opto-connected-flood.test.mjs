import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planOptoC118Interior} from '../src/opto-c118-interior.js';
import {optoFloodRegistration,optoFloodPatches} from '../src/opto-flood-registration.js';
import {sampleC118Flood,createC118FloodEffect} from '../src/c118-flood-effect.js';
import {sampleCampusFloodwater} from '../src/campus-floodwater.js';
import {campusTsunamiFront} from '../src/campus-tsunami-timeline.js';
import {createC118Swimming} from '../src/c118-swimming.js';

const plan=planOptoC118Interior({withFoyer:true}),f=plan.foyer,registration=optoFloodRegistration(plan);
const portals=[{x:0,z:f.front},{x:f.end,z:(f.near+f.far)/2}];

test('C2 and C1 wet door thresholds have the same water height as their campus coordinates, including late joins and calm mode',()=>{
  for(const p of portals)for(const elapsed of[2,10,25,30,35,40,300])for(const reducedMotion of[false,true]){
    const world=registration.toCampus({...p,y:f.y+1.65});
    const campus=sampleCampusFloodwater(world,{elapsed,front:campusTsunamiFront(elapsed),reducedMotion});
    const interior=sampleC118Flood(plan,{...p,y:f.y+1.65},elapsed,{reducedMotion});
    if(campus.waterY>0){
      assert.ok(Math.abs(interior.waterY-f.y-campus.waterY)<1e-10);
      assert.equal(interior.submerged,campus.depth>.02);
    }
  }
  // C2 is on the eastern inner courtyard; C1 opens toward the west approach.
  assert.ok(Math.abs(registration.toCampus(portals[0]).x-646.194)<.02);
  assert.ok(Math.abs(registration.toCampus(portals[0]).z-636.379)<.02);
  const c1=registration.toCampus(portals[1]);assert.ok(c1.x>688&&c1.x<690&&c1.z>688&&c1.z<690);
});

test('water geometry covers both outdoor views, foyer, corridor and hall without adding draw calls',()=>{
  const patches=optoFloodPatches(plan);
  for(const p of[{x:0,z:0},{x:0,z:f.back+3},{x:-30,z:(f.near+f.far)/2},
    {x:0,z:f.front+9},{x:f.end-9,z:(f.near+f.far)/2}]){
    assert.equal(patches.filter(([x0,x1,z0,z1])=>p.x>=x0&&p.x<=x1&&p.z>=z0&&p.z<=z1).length,1);
  }
  const effect=createC118FloodEffect(THREE,{plan});effect.update({active:true,elapsed:3});
  const water=effect.group.getObjectByName('c118-rising-water');water.geometry.computeBoundingBox();
  assert.ok(water.geometry.boundingBox.min.x<=f.end-11);
  assert.ok(water.geometry.boundingBox.max.z>=f.front+11);
  let meshes=0;effect.group.traverse(o=>{if(o.geometry)meshes++;});assert.equal(meshes,6);
  // Confirm the connected branch receives the actual same clock and affine frame.
  assert.equal(water.material.uniforms.uCampusFront.value,campusTsunamiFront(3));
  assert.equal(water.material.uniforms.uDatum.value,f.y);
  effect.dispose();
});

// Follow waypoints using ordinary controls while counteracting current and
// keeping eye height inside the door aperture. No teleport between rooms.
function travel(swim,target,seconds=35){
  for(let i=0;i<seconds*120;i++){
    const s=swim.state,dx=target.x-s.x,dz=target.z-s.z,dy=target.y-s.y;
    if(Math.hypot(dx,dz)<.12&&Math.abs(dy)<.15||s.exitDoorId)return;
    const w=sampleC118Flood(plan,s,50);
    swim.step(1/120,{elapsed:50,moveX:Math.max(-.8,Math.min(.8,dx))-w.currentX*.7/2.7,
      moveZ:Math.max(-.8,Math.min(.8,dz))-w.currentZ*.7/2.7,vertical:Math.abs(dy)<.03?-.011:Math.max(-1,Math.min(1,dy*2))});
  }
  assert.fail(`did not reach ${JSON.stringify(target)} from ${JSON.stringify(swim.state)}`);
}

test('a swimmer can go from C2 through the foyer and C1 corridor to the west exterior',()=>{
  const swim=createC118Swimming(plan),y=f.y+1.65,z=(f.near+f.far)/2;
  swim.enter({x:0,y,z:f.front-1});
  for(const p of[{x:0,y,z},{x:-16,y,z},{x:f.end+1,y,z},{x:f.end-.5,y,z}])travel(swim,p);
  assert.equal(swim.state.exitDoorId,'opto-c1');
});

test('a swimmer can enter C118 through a rear door, return to the foyer and leave C2',()=>{
  const swim=createC118Swimming(plan),y=f.y+1.4,x=f.doors[0].x;
  swim.enter({x,y,z:f.back+2});
  for(const p of[{x,y,z:f.back-2},{x,y,z:f.back+4},{x:0,y,z:f.front-2},{x:0,y,z:f.front+.5}])travel(swim,p);
  assert.equal(swim.state.exitDoorId,'opto-c2');
});

test('rising swimmers are held beneath corridor ceilings and cannot escape over C2 door lintels',()=>{
  for(const p of[{x:-30,z:(f.near+f.far)/2},{x:0,z:f.front-.5}]){
    const swim=createC118Swimming(plan);swim.enter({...p,y:f.y+(p.x===0?4:1.65)});
    for(let i=0;i<600;i++){
      const w=sampleC118Flood(plan,swim.state,50);
      swim.step(1/120,{elapsed:50,vertical:1,moveX:-w.currentX*.7/2.7,moveZ:p.x===0?1:-w.currentZ*.7/2.7});
    }
    assert.equal(swim.state.exitDoorId,null);
    assert.ok(swim.state.y+.17<=f.y+(p.x===0?f.height+.7:3.25));
    if(p.x===0)assert.ok(swim.state.z<f.front);
  }
});
