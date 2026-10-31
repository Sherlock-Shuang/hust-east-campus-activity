import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createEastNinePosterFacadeCover} from '../src/east-nine-poster-facade-cover.js';

function fixture(){
  const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial(),placement={x:9,y:10,z:-13,yaw:.6,width:10,height:16,sourceId:'way/1023544717'};
  const parent=new THREE.Group();parent.position.set(placement.x,placement.y,placement.z);parent.rotation.y=placement.yaw;scene.add(parent);
  const matrix=(x,y,z,sx,sy,sz,yaw=0)=>new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(sx,sy,sz));
  function make(component,transforms,featureId=placement.sourceId){const mesh=new THREE.InstancedMesh(geometry,material,transforms.length);mesh.name=component;mesh.userData={component,featureId};mesh.renderOrder=201;mesh.castShadow=true;mesh.receiveShadow=true;transforms.forEach((m,i)=>mesh.setMatrixAt(i,m));parent.add(mesh);return mesh;}
  const inside=make('wing-window',[matrix(0,0,.1,2,2,.1)]);
  const band=make('floor-band',[matrix(0,0,.05,20,.2,.16)]);
  const edge=make('wing-window',[matrix(5,0,.1,2,2,.1)]);
  const outside=make('wing-window',[matrix(8,0,.1,2,2,.1)]);
  const door=make('entry-door',[matrix(0,0,.1,3,4,.1)]);
  const adjacent=make('wing-window',[matrix(0,0,.1,2,2,.1,Math.PI/2),matrix(0,0,4,2,2,.1)]);
  const otherBuilding=make('wing-window',[matrix(0,0,.1,2,2,.1)],'other-building');
  const originals=new Map();for(const mesh of [inside,band,edge,outside,door,adjacent,otherBuilding])originals.set(mesh,Array.from(mesh.instanceMatrix.array));
  scene.updateMatrixWorld(true);const cover=createEastNinePosterFacadeCover(THREE,{scene,placement});
  return{scene,geometry,material,placement,parent,inside,band,edge,outside,door,adjacent,otherBuilding,originals,cover};
}

test('a flush wall wrap clips only its rectangle and preserves long-band and edge-window fragments',()=>{
  const f=fixture();try{
    assert.equal(f.cover.active,false);assert.equal(f.cover.group.visible,false);
    for(const [mesh,matrix]of f.originals)assert.deepEqual(Array.from(mesh.instanceMatrix.array),matrix);
    assert.equal(f.cover.stats.affectedInstances,3);assert.equal(f.cover.stats.outsideFragments,3);
    f.cover.setVisible(true);assert.equal(f.cover.active,true);assert.equal(f.cover.group.visible,true);
    const matrix=new THREE.Matrix4();f.inside.getMatrixAt(0,matrix);assert.equal(matrix.determinant(),0);
    for(const mesh of [f.outside,f.door,f.adjacent,f.otherBuilding])assert.deepEqual(Array.from(mesh.instanceMatrix.array),f.originals.get(mesh),'unrelated openings/facades remain unchanged');
    const band=f.cover.group.children.find(m=>m.name==='floor-band-outside-poster');assert.equal(band.count,2);assert.equal(band.geometry,f.geometry);assert.equal(band.material,f.material);assert.equal(band.renderOrder,201);
    const points=[];for(let i=0;i<band.count;i++){band.getMatrixAt(i,matrix);const e=matrix.elements;points.push([e[12]-e[0]/2,e[12]+e[0]/2]);assert.ok(Math.abs(e[5]-.2)<1e-6);}
    assert.ok(Math.abs(points[0][0]+10)<1e-6);assert.ok(Math.abs(points[0][1]+5.005)<1e-5);assert.ok(Math.abs(points[1][0]-5.005)<1e-5);assert.ok(Math.abs(points[1][1]-10)<1e-6);
    const edge=f.cover.group.children.find(m=>m.name==='wing-window-outside-poster');assert.equal(edge.count,1);edge.getMatrixAt(0,matrix);assert.ok(Math.abs(matrix.elements[12]-5.5025)<1e-5);
    f.cover.setVisible(false);assert.equal(f.cover.group.visible,false);for(const [mesh,matrix]of f.originals)assert.deepEqual(Array.from(mesh.instanceMatrix.array),matrix);
  }finally{f.cover.dispose();f.geometry.dispose();f.material.dispose();}
});

test('dispose restores original instances and releases only the owned replacement instance buffers',()=>{
  const f=fixture();let geometryDisposed=0,materialDisposed=0,replacementDisposed=0;f.geometry.addEventListener('dispose',()=>geometryDisposed++);f.material.addEventListener('dispose',()=>materialDisposed++);
  for(const mesh of f.cover.group.children)mesh.addEventListener('dispose',()=>replacementDisposed++);
  f.cover.setVisible(true);f.cover.dispose();f.cover.dispose();f.cover.setVisible(true);
  assert.equal(f.cover.active,false);assert.equal(f.cover.group.parent,null);assert.equal(f.cover.group.children.length,0);assert.equal(replacementDisposed,2);assert.equal(geometryDisposed,0);assert.equal(materialDisposed,0);
  for(const [mesh,matrix]of f.originals)assert.deepEqual(Array.from(mesh.instanceMatrix.array),matrix);
  f.geometry.dispose();f.material.dispose();
});
