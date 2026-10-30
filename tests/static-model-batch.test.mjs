import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {batchRigidModelBody} from '../src/static-model-batch.js';
import {createHoverboardModel} from '../src/hoverboard-model.js';

test('rigid model batches retain exact transformed attributes, material/shadow boundaries and named originals',()=>{
  const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial(),owned=[];
  const add=(name,x,options={})=>{const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.position.set(x,.4,-.2);mesh.rotation.set(.1,.2,.3);Object.assign(mesh,options);root.add(mesh);return mesh;};
  const a=add('first',-1),b=add('second',1),shadow=add('different-shadow',3,{castShadow:true}),order=add('different-order',4,{renderOrder:2});
  const dynamic=new THREE.Group();dynamic.name='animated';root.add(dynamic);dynamic.add(new THREE.Mesh(geometry,material));
  const glassMaterial=new THREE.MeshStandardMaterial({transparent:true,opacity:.5}),glass=new THREE.Mesh(geometry,glassMaterial);root.add(glass);
  const result=batchRigidModelBody(THREE,root,{name:'fixture',ownGeometry:g=>(owned.push(g),g)});
  try{
    assert.equal(result.sourceMeshes,2);assert.equal(result.batches,1);assert.equal(result.originals.visible,false);
    assert.equal(root.getObjectByName('first'),a);assert.equal(root.getObjectByName('second'),b);assert.equal(shadow.parent,root);assert.equal(order.parent,root);assert.equal(glass.parent,root);assert.equal(dynamic.parent,root);
    const batch=result.batchMeshes[0];assert.equal(batch.material,material);assert.equal(batch.castShadow,a.castShadow);assert.deepEqual(batch.userData.sourceParts,['first','second']);
    for(const range of batch.userData.sourceRanges){const source=root.getObjectByName(range.name),expected=source.geometry.clone().applyMatrix4(source.matrix);
      for(const [key,attribute]of Object.entries(expected.attributes))assert.deepEqual(batch.geometry.attributes[key].array.slice(range.start*attribute.itemSize,(range.start+range.count)*attribute.itemSize),attribute.array,key);
      assert.deepEqual(Array.from(batch.geometry.index.array.slice(range.indexStart,range.indexStart+range.indexCount)),Array.from({length:range.indexCount},(_,i)=>range.start+(source.geometry.index?.getX(i)??i)));
      expected.dispose();
    }
    const clone=root.clone(true);clone.visible=true;clone.position.set(20,3,-10);clone.updateMatrixWorld(true);
    assert.equal(clone.getObjectByName('fixture-authored-parts').visible,false);
    const drawn=[];clone.traverseVisible(o=>{if(o.isMesh)drawn.push(o);});assert.equal(drawn.length,5,'one body batch, two flag-separated parts, one animated part and glass');
  }finally{for(const g of owned)g.dispose();geometry.dispose();material.dispose();glassMaterial.dispose();}
});

test('real hoverboard rigid body keeps every source triangle and world-space pose while rotors and rider animate independently',()=>{
  const model=createHoverboardModel(THREE),root=model.group,hidden=root.getObjectByName('hoverboard-rigid-body-authored-parts');
  const batches=root.children.filter(o=>o.userData.rigidBodyBatch),position=new THREE.Vector3(),expectedPosition=new THREE.Vector3();
  try{
    assert.ok(hidden.children.length>=200);assert.ok(batches.length<=12);assert.ok(root.userData.rigidBodyBatch.savedDraws>=200);
    assert.equal(root.getObjectByName('hoverboard-open-white-deck').parent,hidden);
    assert.equal(root.getObjectByName('hoverboard-standing-rider').parent,root);
    const originalTriangles=hidden.children.reduce((n,o)=>n+(o.geometry.index?.count??o.geometry.attributes.position.count)/3,0);
    const batchedTriangles=batches.reduce((n,o)=>n+(o.geometry.index?.count??o.geometry.attributes.position.count)/3,0);assert.equal(batchedTriangles,originalTriangles);
    for(const batch of batches)for(const range of batch.userData.sourceRanges){
      const source=root.getObjectByName(range.name),expected=source.geometry.clone().applyMatrix4(source.matrix);
      assert.equal(batch.material,source.material);assert.equal(batch.castShadow,source.castShadow);assert.equal(batch.receiveShadow,source.receiveShadow);assert.equal(batch.renderOrder,source.renderOrder);assert.equal(batch.layers.mask,source.layers.mask);
      for(const [key,attribute]of Object.entries(expected.attributes))assert.deepEqual(batch.geometry.attributes[key].array.slice(range.start*attribute.itemSize,(range.start+range.count)*attribute.itemSize),attribute.array,range.name+': '+key);
      if(batch.geometry.index)assert.deepEqual(Array.from(batch.geometry.index.array.slice(range.indexStart,range.indexStart+range.indexCount)),Array.from({length:range.indexCount},(_,i)=>range.start+source.geometry.index.getX(i)),range.name+': triangle topology');
      else{assert.equal(source.geometry.index,null);assert.equal(range.count,range.indexCount);}
      expected.dispose();
    }
    let rotorAngle;const rotor=root.getObjectByName('hoverboard-two-blade-propeller-0'),rotorGeometry=rotor.children[0].geometry;
    for(const state of [{pitch:0,lean:0,speed:0,rotorPower:0},{pitch:-.16,lean:.2,speed:36,rotorPower:1,verticalSpeed:5},{pitch:.1,lean:-.15,speed:12,rotorPower:.6,verticalSpeed:-3}]){
      root.position.set(31,17,-28);root.rotation.set(state.pitch,.7,state.lean,'YXZ');model.update(state,1/60);root.updateWorldMatrix(true,true);
      for(const batch of batches)for(const range of batch.userData.sourceRanges){
        const source=root.getObjectByName(range.name),attribute=source.geometry.attributes.position;
        // Cover each triangle at its original vertex positions. Float32 baking
        // may round local transforms, but changes no topology or visual scale.
        for(let i=0;i<range.count;i++){
          expectedPosition.fromBufferAttribute(attribute,i).applyMatrix4(source.matrixWorld);
          position.fromBufferAttribute(batch.geometry.attributes.position,range.start+i).applyMatrix4(batch.matrixWorld);
          assert.ok(position.distanceTo(expectedPosition)<1e-6,`${range.name}: transformed vertex ${i}`);
        }
      }
      assert.equal(rotor.parent,root);assert.equal(rotor.children[0].geometry,rotorGeometry);if(rotorAngle!==undefined)assert.notEqual(rotor.rotation.y,rotorAngle);rotorAngle=rotor.rotation.y;
      const visible=[];root.traverseVisible(o=>{if(o.isMesh)visible.push(o);});assert.ok(hidden.children.every(o=>!visible.includes(o)),'authored source bodies never double draw');
      assert.ok(visible.includes(root.getObjectByName('hoverboard-wood-propeller-0-0')));
    }
  }finally{model.dispose();}
});

test('batched hoverboard survives hide/re-entry and disposes every original/shared/batched resource once',()=>{
  const model=createHoverboardModel(THREE),scene=new THREE.Scene();scene.add(model.group);
  const resources=new Set(),disposals=new Map();model.group.traverse(o=>{if(o.geometry)resources.add(o.geometry);if(o.material)resources.add(o.material);});
  for(const resource of resources)resource.addEventListener('dispose',()=>disposals.set(resource,(disposals.get(resource)||0)+1));
  const body=model.group.children.filter(o=>o.userData.rigidBodyBatch);
  model.group.visible=false;model.update({rotorPower:0},1/60);model.group.visible=true;model.update({rotorPower:1,speed:36,pitch:-.1,lean:.12},1/60);
  const visible=[];model.group.traverseVisible(o=>{if(o.isMesh)visible.push(o);});assert.ok(body.every(o=>visible.includes(o)));assert.equal(model.group.getObjectByName('hoverboard-rigid-body-authored-parts').visible,false);
  model.dispose();model.dispose();assert.equal(scene.children.length,0);for(const resource of resources)assert.equal(disposals.get(resource),1);
});
