import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPlayerModels} from '../src/player-models.js';
import {sampleActorPose} from '../src/commute-actors.js';

test('faster player travel retains the original walking leg poses and cadence at both speeds',()=>{
  const rig=createPlayerModels(THREE);
  try{
    const shoes=rig.group.getObjectByName('player-walk').children.filter(mesh=>mesh.name.endsWith('-shoe'));
    assert.ok(shoes.length>=2);
    for(const [speed,oldSpeed] of [[3.2,2.2],[5.2,3.8]])for(const fps of [30,144]){
      rig.update({mode:'scooter'},0);rig.update({mode:'walk',speed,distance:0},0);
      for(let i=1;i<=fps;i++){
        const state={mode:'walk',speed,distance:speed*i/fps,yaw:i/fps,x:speed*i/fps};
        const before={...state};rig.update(state,1/fps);assert.deepEqual(state,before,'animation must not change travel state');
        const old=sampleActorPose({id:0,speed:oldSpeed,progress:oldSpeed*i/fps},'walk');
        for(const shoe of shoes){const p=new THREE.Vector3().setFromMatrixPosition(shoe.matrix);assert.ok(['ankleL','ankleR'].some(key=>p.distanceTo(new THREE.Vector3(...old.points[key]))<1e-8),'feet follow the previous walking pose at the previous cadence');}
      }
    }
  }finally{rig.dispose();}
});

test('changing walking speed or facing keeps animation phase continuous and vehicles do not advance the walk cycle',()=>{
  const rig=createPlayerModels(THREE);
  try{
    const walker=rig.group.getObjectByName('player-walk');
    rig.update({mode:'walk',speed:3.2,distance:0},0);
    rig.update({mode:'walk',speed:3.2,distance:.7},.2);
    const before=walker.children.map(mesh=>mesh.matrix.clone());
    rig.update({mode:'walk',speed:5.2,distance:.7,yaw:2.2},0);
    walker.children.forEach((mesh,i)=>assert.ok(mesh.matrix.equals(before[i]),'Shift and body turn do not jump the leg phase'));
    rig.update({mode:'walk',speed:0,distance:.7},.1);const stopped=walker.children.map(mesh=>mesh.matrix.clone());
    rig.update({mode:'walk',speed:0,distance:.7},10);walker.children.forEach((mesh,i)=>assert.ok(mesh.matrix.equals(stopped[i]),'idle animation stays still'));
    rig.update({mode:'scooter',speed:7.5,distance:500},1);
    rig.update({mode:'walk',speed:3.2,distance:500},0);
    const reference=sampleActorPose({id:0,speed:2.2,progress:0},'walk');
    for(const shoe of walker.children.filter(mesh=>mesh.name.endsWith('-shoe'))){const p=new THREE.Vector3().setFromMatrixPosition(shoe.matrix);assert.ok(['ankleL','ankleR'].some(key=>p.distanceTo(new THREE.Vector3(...reference.points[key]))<1e-8));}
  }finally{rig.dispose();}
});

test('player modes share one world origin and visible contact surfaces stay on ground',()=>{
  const rig=createPlayerModels(THREE);
  for(const mode of['walk','scooter','helicopter','roadster','hoverboard','spider']){
    rig.update({mode,x:0,y:0,z:0,yaw:0,speed:0,rotorPower:0,grounded:true},0);
    const model=rig.group.getObjectByName(`player-${mode}`),bounds=new THREE.Box3().setFromObject(mode==='spider'?model.getObjectByName('spider-character'):model);
    assert.equal(rig.group.children.filter(child=>child.visible).length,1);
    assert.ok(model.visible);
    assert.ok(bounds.min.y>=-.001&&bounds.min.y<=.005,`${mode} contact is at root ground height`);
    const height=bounds.max.y-bounds.min.y;
    assert.ok(mode==='helicopter'?height>3&&height<3.5:mode==='roadster'?height>1.2&&height<1.3:mode==='hoverboard'?height>2.0&&height<2.4:mode==='spider'?height>1.65&&height<1.9:height>1.58&&height<1.70);
    rig.update({mode,x:31,y:7,z:-12,yaw:.7,speed:0,rotorPower:0},0);
    assert.deepEqual(rig.group.position.toArray(),[31,7,-12]);
    assert.ok(Math.abs(rig.group.rotation.y-.7)<1e-8);
  }
  rig.dispose();
});

test('player wheels and rotor animation advance from travel and power without moving contact origin',()=>{
  const rig=createPlayerModels(THREE);
  const state={mode:'scooter',speed:3,distance:0,steeringAngle:.2};
  rig.update(state,0);
  const wheel=rig.group.getObjectByName('player-scooter').children.find(p=>p.name==='player-rubber-frontWheel');
  const initial=wheel.matrix.clone();
  rig.update({...state,distance:1},.1);
  assert.ok(!wheel.matrix.equals(initial));
  rig.update({mode:'helicopter',rotorPower:0},.1);
  const rotor=rig.group.getObjectByName('helicopter-main-rotor'),angle=rotor.rotation.y;
  rig.update({mode:'helicopter',rotorPower:0},.1);assert.equal(rotor.rotation.y,angle);
  rig.update({mode:'helicopter',rotorPower:1},.1);assert.notEqual(rotor.rotation.y,angle);
  assert.ok(rig.group.getObjectByName('helicopter-rotor-motion-disc').visible);
  assert.deepEqual(rig.group.position.toArray(),[0,0,0]);
  rig.dispose();
});

test('integrated spider web remains attached to its world anchor as the player changes pose',()=>{
  const rig=createPlayerModels(THREE),anchor={x:4,y:28,z:-30};
  for(const pose of[{x:0,y:5,z:0,yaw:0,pitch:0,lean:0},{x:11,y:8,z:-12,yaw:.8,pitch:-.2,lean:.1}]){
    rig.update({mode:'spider',...pose,grounded:false,anchor,webTension:1,ropeLength:32,view:'first'},1/60);
    const model=rig.group.getObjectByName('player-spider'),web=model.getObjectByName('spider-web-main'),meta=model.userData;
    const endpoint=new THREE.Vector3();
    for(let i=0;i<meta.webSides;i++)endpoint.add(new THREE.Vector3().fromBufferAttribute(web.geometry.attributes.position,meta.webSegments*meta.webSides+i));
    endpoint.divideScalar(meta.webSides).applyMatrix4(web.matrixWorld);
    assert.ok(endpoint.distanceTo(new THREE.Vector3(anchor.x,anchor.y,anchor.z))<1e-5,'world transform must update before rope geometry');
    assert.equal(model.getObjectByName('spider-character').visible,false);
    assert.equal(web.visible,true);
  }
  rig.update({mode:'walk',grounded:true},0);
  assert.equal(rig.group.getObjectByName('player-spider').visible,false);
  rig.dispose();
});

test('player disposal releases each attached shared geometry/material once and is idempotent',()=>{
  const rig=createPlayerModels(THREE),scene=new THREE.Scene();scene.add(rig.group);
  const geometries=new Set(),materials=new Set(),disposed=new Map();
  rig.group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
  for(const resource of[...geometries,...materials])resource.addEventListener('dispose',()=>disposed.set(resource,(disposed.get(resource)||0)+1));
  rig.dispose();rig.dispose();
  assert.equal(scene.children.length,0);
  for(const resource of[...geometries,...materials])assert.equal(disposed.get(resource),1);
});

test('inactive player rigs skip world updates while mode switches and parked clones keep correct transforms',()=>{
  const rig=createPlayerModels(THREE),scene=new THREE.Scene();scene.add(rig.group);
  try{
    const helicopter=rig.group.getObjectByName('player-helicopter'),board=rig.group.getObjectByName('player-hoverboard');
    let inactiveRecomposes=0;for(const root of[helicopter,board])root.traverse(object=>{const update=object.updateMatrix;object.updateMatrix=function(){inactiveRecomposes++;return update.call(this);};});
    for(let i=0;i<10;i++){rig.update({mode:'walk',x:i,y:.14,z:-i,speed:2,distance:i},1/60);scene.updateMatrixWorld(true);}
    assert.equal(inactiveRecomposes,0,'hidden vehicles do no matrix composition in player/main/shadow passes');
    rig.update({mode:'hoverboard',x:31,y:7,z:-12,yaw:.7},1/60);
    assert.ok(inactiveRecomposes>0);assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(board.matrixWorld).toArray(),[31,7,-12]);
    rig.update({mode:'walk',x:0,y:0,z:0},0);
    const clone=helicopter.clone(true);clone.visible=true;clone.position.set(4,0,8);clone.updateMatrixWorld(true);
    const rotor=clone.getObjectByName('helicopter-main-rotor'),world=new THREE.Vector3().setFromMatrixPosition(rotor.matrixWorld);
    assert.ok(Math.abs(world.x-4)<1e-8&&Math.abs(world.z-8.12)<1e-8,'parked template clones are standard groups with working world transforms');
  }finally{rig.dispose();}
});
