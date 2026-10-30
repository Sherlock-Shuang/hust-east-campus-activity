import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** Batch only opaque, rigid direct children of one moving model root. Animated
 * subgroups and transparent parts keep their authored draw/animation order.
 * Original named meshes remain inspectable under a hidden identity group;
 * their owning model continues to own/dispose the original resources. */
export function batchRigidModelBody(THREE,root,{name='rigid-body',ownGeometry=g=>g}={}){
  const buckets=new Map();
  for(const source of root.children){
    if(!source.isMesh||source.isSkinnedMesh||source.isInstancedMesh||source.children.length||!source.visible||Array.isArray(source.material)||source.material.transparent||source.material.transmission>0)continue;
    const geometry=source.geometry;
    if(!geometry?.attributes.position||Object.keys(geometry.morphAttributes).length||geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity||Object.values(geometry.attributes).some(a=>a.isInterleavedBufferAttribute))continue;
    if(source.matrixAutoUpdate)source.updateMatrix();
    if(source.matrix.determinant()<=0)continue;
    const signature=Object.keys(geometry.attributes).sort().map(key=>{const a=geometry.attributes[key];return `${key}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}:${a.gpuType}`;}).join(',');
    // Indexed/nonindexed sources remain separate. This keeps the authored
    // vertex storage without expanding cylinders or adding identity indices.
    const key=`${source.material.uuid}/${source.castShadow}/${source.receiveShadow}/${source.renderOrder}/${source.layers.mask}/${source.frustumCulled}/${!!geometry.index}/${signature}`;
    let bucket=buckets.get(key);if(!bucket)buckets.set(key,bucket={sources:[],first:source});bucket.sources.push(source);
  }
  const originals=new THREE.Group();originals.name=`${name}-authored-parts`;originals.visible=false;originals.matrixAutoUpdate=false;
  // Retain geometry/name inspection without recomposing hundreds of invisible
  // source matrices in each main/shadow pass. Clones use normal Group methods.
  const updateWorld=originals.updateMatrixWorld;
  originals.updateMatrixWorld=function(force){if(this.visible)return updateWorld.call(this,force);};
  const batches=[];
  for(const {sources,first}of buckets.values()){
    if(sources.length<2)continue;
    const pieces=[],sourceRanges=[];let vertices=0,indices=0;
    try{
      for(const source of sources){
        const part=source.geometry.clone().applyMatrix4(source.matrix),count=part.attributes.position.count;
        const indexCount=part.index?.count??count;
        pieces.push(part);sourceRanges.push({name:source.name,start:vertices,count,indexStart:indices,indexCount});vertices+=count;indices+=indexCount;
      }
      const combined=mergeGeometries(pieces,false);
      if(!combined)throw new Error(`Incompatible rigid body geometry in ${name}.`);
      ownGeometry(combined);combined.computeBoundingBox();combined.computeBoundingSphere();
      const mesh=new THREE.Mesh(combined,first.material);mesh.name=`${name}-batch-${batches.length}`;
      mesh.castShadow=first.castShadow;mesh.receiveShadow=first.receiveShadow;mesh.renderOrder=first.renderOrder;mesh.layers.mask=first.layers.mask;mesh.frustumCulled=first.frustumCulled;
      mesh.matrixAutoUpdate=false;mesh.userData={rigidBodyBatch:true,sourceParts:sources.map(s=>s.name),sourceRanges};
      root.add(mesh);batches.push(mesh);for(const source of sources)originals.add(source);
    }finally{for(const part of pieces)part.dispose();}
  }
  if(originals.children.length)root.add(originals);
  return {sourceMeshes:originals.children.length,batches:batches.length,savedDraws:originals.children.length-batches.length,originals,batchMeshes:batches};
}
