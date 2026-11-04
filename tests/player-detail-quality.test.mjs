import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPlayerModels} from '../src/player-models.js';

test('walking fabric is private, its anchored details stay bounded, and it leaves the riding material intact',()=>{
  const rig=createPlayerModels(THREE);
  try{
    rig.update({mode:'walk',speed:3.2,distance:0,grounded:true},0);rig.update({mode:'walk',speed:3.2,distance:.6,grounded:true},1/60);
    const walker=rig.group.getObjectByName('player-walk'),rider=rig.group.getObjectByName('player-scooter');
    const coat=walker.children.find(m=>m.name==='player-coat-torso'),ridingCoat=rider.children.find(m=>m.name==='player-coat-torso');
    assert.notEqual(coat.material,ridingCoat.material);assert.ok(coat.material.bumpMap);assert.equal(ridingCoat.material.bumpMap,null);
    const details=walker.children.filter(m=>m.name.startsWith('player-detail-'));assert.equal(details.length,5);
    for(const mesh of details){
      if(mesh.name.includes('-torso-'))assert.deepEqual(mesh.matrix.elements,coat.matrix.elements);
      else assert.ok(walker.children.some(shoe=>shoe.name==='player-rubber-shoe'&&shoe.matrix.equals(mesh.matrix)),'shoe details copy an actual animated ankle matrix');
      assert.ok(mesh.geometry.boundingSphere?.radius!==Infinity);
    }
    let triangles=0;walker.traverse(mesh=>{if(mesh.geometry)triangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;});
    assert.ok(triangles<8000&&walker.children.length<=34,'fine details have a fixed local geometry/draw budget');
    rig.update({mode:'walk',waterMode:'swim',elapsed:1},1/60);
    assert.equal(coat.material,ridingCoat.material);assert.ok(details.every(m=>!m.visible));
  }finally{rig.dispose();}
});

test('foot contacts follow animated feet and real platform support, and disappear over unsupported ground or other modes',()=>{
  let support=4.2,queries=0;
  const rig=createPlayerModels(THREE,{groundAt:(x,z,radius,y)=>{queries++;assert.equal(radius,0);assert.equal(y,4.2);return{height:support,allowed:true};}});
  try{
    const state={mode:'walk',x:10,y:4.2,z:5,yaw:.7,speed:3.2,distance:0,grounded:true,waterMode:'dry'};
    // Constructor intentionally has no active support: first explicit update
    // supplies the current grounded pose, including its actual platform layer.
    rig.update(state,0);rig.update({...state,distance:.25},1/60);
    const walker=rig.group.getObjectByName('player-walk'),contacts=walker.children.filter(m=>m.name.startsWith('player-foot-contact'));
    assert.equal(contacts.length,2);assert.ok(queries>=4);
    for(const mesh of contacts){
      assert.equal(mesh.visible,true);const world=new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      assert.ok(Math.abs(world.y-4.202)<1e-7,'contact remains on the upper platform rather than base campus ground');
      assert.ok(mesh.material.opacity>0&&mesh.material.opacity<=.2);
    }
    assert.notEqual(contacts[0].material.opacity,contacts[1].material.opacity,'lifted and planted feet receive different contact strength');
    support=.14;rig.update({...state,distance:.3},1/60);assert.ok(contacts.every(m=>!m.visible),'no projected patch floats below a foot over a ledge');
    support=4.2;
    for(const changed of [{mode:'scooter'},{mode:'spider'},{mode:'hoverboard'},{mode:'walk',grounded:false},{mode:'walk',waterMode:'swim'},{mode:'walk',waterMode:'surf'}]){
      rig.update({...state,...changed},1/60);assert.ok(contacts.every(m=>!m.visible));
    }
    rig.update({...state,speed:0},0);assert.ok(contacts.every(m=>m.visible),'returning to a valid dry walk restores the contacts');
  }finally{rig.dispose();}
});

test('character detail textures stay under 24KiB and are disposed exactly once with the rig',()=>{
  const rig=createPlayerModels(THREE),textures=new Set(),counts=new Map();rig.update({mode:'walk',grounded:true},0);
  rig.group.traverse(mesh=>{for(const key of ['map','bumpMap'])if(mesh.material?.[key])textures.add(mesh.material[key]);});
  assert.equal(textures.size,2);assert.ok([...textures].reduce((sum,t)=>sum+(t.image.data?.byteLength||0),0)<=24*1024);
  for(const texture of textures)texture.addEventListener('dispose',()=>counts.set(texture,(counts.get(texture)||0)+1));
  rig.dispose();rig.dispose();for(const texture of textures)assert.equal(counts.get(texture),1);
});

test('jacket and backpack seams sit on the real animated mesh surface instead of floating in front of it',()=>{
  const rig=createPlayerModels(THREE);
  try{
    rig.update({mode:'walk',speed:3.2,distance:0,yaw:.8,grounded:true},0);rig.update({mode:'walk',speed:3.2,distance:.5,yaw:.8,grounded:true},1/60);
    const walker=rig.group.getObjectByName('player-walk'),ray=new THREE.Raycaster();
    for(const [detailName,targetName,side] of [['player-detail-torso-player-jacket-seams','player-coat-torso',-1],['player-detail-torso-player-bag-stitching','player-bag-torso',1]]){
      const detail=walker.getObjectByName(detailName),target=walker.getObjectByName(targetName),vertices=detail.geometry.attributes.position;
      const outward=new THREE.Vector3(0,0,side).transformDirection(detail.matrixWorld);
      for(let i=0;i<vertices.count;i+=Math.max(1,Math.floor(vertices.count/75))){
        const point=new THREE.Vector3().fromBufferAttribute(vertices,i).applyMatrix4(detail.matrixWorld);
        ray.set(point.addScaledVector(outward,.05),outward.clone().negate());const hit=ray.intersectObject(target,false)[0];
        assert.ok(hit,`${detailName} remains within its garment footprint`);
        assert.ok(Math.abs(hit.distance-.05)<.007,`${detailName} must stay within 7mm of the actual triangulated surface`);
      }
    }
  }finally{rig.dispose();}
});
