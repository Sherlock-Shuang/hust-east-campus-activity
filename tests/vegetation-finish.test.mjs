import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createTreeLayer,createShrubLayer} from '../src/vegetation.js';

const trees=Array.from({length:6},(_,i)=>({x:i*12,y:.1,z:0,height:12,radius:4,seed:i/6,featureId:`finish/${i}`}));
const triangles=g=>(g.index?.count||g.attributes.position.count)/3;

function checkCanopyNormals(geometry,minAlignment=.85){
  const p=geometry.attributes.position,n=geometry.attributes.normal;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),face=new THREE.Vector3(),authored=new THREE.Vector3();
  let volumeVertices=0;
  for(let i=0;i<p.count;i+=3){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    face.subVectors(b,a).cross(c.sub(a)).normalize();
    for(let j=0;j<3;j++){
      authored.fromBufferAttribute(n,i+j);
      assert.ok(Number.isFinite(authored.lengthSq())&&Math.abs(authored.length()-1)<1e-5,'normals stay finite and normalized');
      const alignment=face.dot(authored);
      assert.ok(alignment>minAlignment,'volume shading keeps the real leaf face orientation');
      if(alignment<.995)volumeVertices++;
    }
  }
  assert.ok(volumeVertices>p.count*.1,'the canopy has soft bough volume beyond flat triangle normals');
}

test('tree and shrub foliage retain real folded faces while gaining modest volume shading',()=>{
  const tree=createTreeLayer(THREE,trees),shrub=createShrubLayer(THREE,[{x:0,z:0,height:1,radius:1}]);
  try{
    for(const layer of [tree,shrub])for(const mesh of layer.group.children){
      if(!mesh.material.map)continue;
      // Shrub geometry is already compressed into its low, wide bounds; its
      // inverse-transpose normal transform also widens the angular difference.
      checkCanopyNormals(mesh.geometry,layer===shrub?.75:.85);
      assert.equal(mesh.material.transparent,false);
      assert.equal(mesh.material.alphaTest,.43);
      assert.equal(mesh.material.alphaToCoverage,false);
      assert.equal(mesh.material.emissive.getHex(),0,'volume comes from normals, not emitted light');
    }
  }finally{tree.dispose();shrub.dispose();}
});

test('refined trunks preserve fixed instance batches and the original distant triangle budget',()=>{
  for(const detail of ['street','forest']){
    const layer=createTreeLayer(THREE,trees,{detail}),meshes=layer.group.children;
    try{
      assert.equal(meshes.length,36);
      assert.equal(new Set(meshes.map(m=>m.material)).size,4);
      for(const mesh of meshes){
        assert.equal(mesh.isInstancedMesh,true);
        assert.equal(mesh.instanceMatrix.count,1);
        assert.deepEqual(mesh.userData.instanceFeatureIds,mesh.count?[`finish/${mesh.userData.variant}`]:[]);
        if(mesh.userData.part==='branches-distant')assert.equal(triangles(mesh.geometry),detail==='street'?84:60);
        if(mesh.userData.part==='branches')assert.ok(triangles(mesh.geometry)<=(detail==='street'?2200:1000));
        if(mesh.userData.part==='whitewash')assert.ok(triangles(mesh.geometry)<=200);
      }
    }finally{layer.dispose();}
  }
});

test('refined shared geometry, instances, materials and mask are each released once',()=>{
  const layer=createTreeLayer(THREE,trees),resources=new Map();
  layer.group.traverse(mesh=>{
    if(!mesh.isInstancedMesh)return;
    for(const resource of [mesh,mesh.geometry,mesh.material,mesh.material.map].filter(Boolean)){
      if(resources.has(resource))continue;
      resources.set(resource,0);resource.addEventListener('dispose',()=>resources.set(resource,resources.get(resource)+1));
    }
  });
  layer.dispose();layer.dispose();
  for(const [resource,count]of resources)assert.equal(count,1,`${resource.type||resource.constructor.name} released once`);
  assert.equal(layer.group.children.length,0);
});
