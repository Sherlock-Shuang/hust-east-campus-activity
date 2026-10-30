import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {planOptoC118Interior,createOptoC118Interior} from '../src/opto-c118-interior.js';
import {createC118Navigation} from '../src/c118-navigation.js';
import {optoFoyerExit,isInsideC118} from '../src/opto-foyer.js';
import {interiorExitEntry,interiorReturnSnapshot,nearbyInterior} from '../src/building-interiors.js';

const plan=planOptoC118Interior({withFoyer:true}),f=plan.foyer;
const motion=spawn=>createC118Navigation({plan,spawn,colliders:plan.colliders,walkSurfaces:plan.walkSurfaces});
function travel(m,target){
  for(let i=0;i<16000;i++){
    const dx=target.x-m.state.x,dz=target.z-m.state.z,d=Math.hypot(dx,dz);if(d<.045)return;
    const v=Math.min(.6,d*8);m.step(1/120,{moveX:dx/d*v,moveZ:dz/d*v});
    assert.equal(m.state.blockedReason,'',`blocked at ${m.state.x},${m.state.y},${m.state.z}`);
  }
  assert.fail('route did not reach destination');
}

test('C2 foyer reaches both C118 rear doors, descends to the cross aisle and returns without teleporting',()=>{
  for(const door of f.doors){
    const m=motion(plan.viewpoints.c2Lobby);
    assert.equal(isInsideC118(plan,m.state),false);
    travel(m,{x:door.x,z:f.back+3});travel(m,{x:door.x,z:f.back-1});
    assert.equal(isInsideC118(plan,m.state),true);assert.ok(Math.abs(m.state.y-f.y)<.025);
    travel(m,{x:door.x,z:plan.crossAisle.z});assert.ok(Math.abs(m.state.y-plan.crossAisle.y)<.025);
    travel(m,{x:door.x,z:f.back+3});assert.equal(isInsideC118(plan,m.state),false);
    assert.ok(Math.abs(m.state.y-f.y)<.025);
  }
});

test('turning left after C2 leads straight through C1 west exit, and the reverse path remains walkable',()=>{
  const mid=(f.near+f.far)/2,m=motion(plan.viewpoints.c2Lobby);
  travel(m,{x:0,z:mid});travel(m,{x:f.end-.6,z:mid});
  assert.equal(optoFoyerExit(plan,m.state),'opto-c1');
  travel(m,{x:0,z:mid});travel(m,{x:0,z:f.front+.6});
  assert.equal(optoFoyerExit(plan,m.state),'opto-c2');
  for(const pose of [{...m.state,y:f.y+2},{...m.state,x:4},{...m.state,y:NaN},null])assert.equal(optoFoyerExit(plan,pose),null);
  const reverse=motion(plan.viewpoints.c1Lobby);travel(reverse,{x:0,z:mid});travel(reverse,plan.viewpoints.c2Lobby);
  assert.equal(optoFoyerExit(plan,reverse.state),null,'arrival and inside landing must not immediately exit');
});

test('solid brand wall, corridor walls and furnishings cannot be walked through',()=>{
  const m=motion(plan.viewpoints.c2Lobby);
  for(const pose of [{x:0,z:f.back,y:f.y},{x:-30,z:f.near-.1,y:f.y},{x:-30,z:f.far+.1,y:f.y},{x:-30,z:f.near+.4,y:f.y}]){
    assert.equal(m.placeWalker(pose).ok,false);
  }
});

test('rendered rear openings stay clear, and each doorway has an unobstructed view of the actual stage screen',()=>{
  const hall=createOptoC118Interior(THREE,{withFoyer:true});hall.group.updateMatrixWorld(true);
  const screen=hall.group.getObjectByName('c118-led-screen'),matrix=new THREE.Matrix4();screen.getMatrixAt(0,matrix);
  const target=new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(screen.matrixWorld);
  for(const door of f.doors){
    const start=new THREE.Vector3(door.x,door.y+1.65,door.z+.4);
    const ray=new THREE.Raycaster(start,new THREE.Vector3(0,0,-1),0,1.3);
    assert.equal(ray.intersectObject(hall.group,true).length,0,'white door leaves must not close the passage');
    ray.set(start,target.clone().sub(start).normalize());ray.far=start.distanceTo(target)+.1;
    const hit=ray.intersectObject(hall.group,true)[0];
    assert.match(hit?.object.name||'',/^c118-(video-screen|led-screen|screen-frame)$/);
  }
  hall.dispose();
});

test('expanded scene remains batched and all GPU resources are released exactly once',()=>{
  const hall=createOptoC118Interior(THREE,{withFoyer:true}),owned=new Set(),counts=new Map();let meshes=0;
  hall.group.traverse(o=>{if(!o.isMesh)return;meshes++;owned.add(o.geometry);owned.add(o.material);if(o.material.map)owned.add(o.material.map);if(o.isInstancedMesh)owned.add(o);});
  assert.ok(meshes<100,`${meshes} draw calls`);
  for(const resource of owned){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
  hall.dispose();hall.dispose();for(const count of counts.values())assert.equal(count,1);
});

test('C2-to-C1 return resolves only host-owned door identity and preserves the selected character',()=>{
  const entries=['opto-c1','opto-c2'].map((id,i)=>({id,workId:'opto-c118',x:i,z:i,y:.14,approach:{x:i,z:i,y:.14},returnPose:{x:10+i,z:20+i,y:.14,yaw:.9+i},url:`./c118.html?view=c${i+1}Lobby`}));
  const opened={...entries[1],kind:'building-interior'},saved={mode:'spider',view:'third',state:{x:1,z:1,y:.14,vx:3,vz:4,speed:5}};
  const selected=interiorExitEntry(opened,entries,'opto-c1');assert.equal(selected,entries[0]);
  const next=interiorReturnSnapshot(saved,selected);assert.equal(next.mode,'spider');assert.equal(next.view,'third');
  assert.equal(next.state.x,10);assert.equal(next.state.z,20);assert.equal(next.lookHeading,.9);assert.equal(next.state.speed,0);assert.equal(saved.state.speed,5);
  for(const id of ['evil','https://other.example',null,{id:'opto-c1'}])assert.equal(interiorExitEntry(opened,entries,id),opened);
  assert.equal(interiorExitEntry({...opened,kind:'portal'},entries,'opto-c1').id,opened.id);
  for(const entry of entries)assert.equal(nearbyInterior([entry],{...entry,mode:'walk'}).url,entry.url);
});
