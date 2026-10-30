import {createStaticInstanceSelection} from './static-instance-lod.js';
import {cacheStaticTransforms} from './render-performance.js';

/** One material draw batch, with GPU instance capacity bounded by the nearby
 * district candidates rather than the whole campus. Lightweight source
 * descriptors stay available for re-entry/export; shared geometry/materials
 * are borrowed and are NEVER disposed when an instance buffer is evicted. */
export function createResidentInstanceBatch(THREE,{parent,name,geometry,material,matrices,colors,ids,
  configure=()=>{},cooldownMs=1500,now=()=>performance.now()}={}){
  let mesh=null,selection=null,capacity=0,sourceCount=0,lastNeeded=now(),overcapacitySince=null,disposed=false;
  const stats={name,sourceInstances:matrices.length,fullCapacityBytes:matrices.length*(64+(colors?.some(Boolean)?12:0)),residentCapacity:0,residentBytes:0,allocations:0,evictions:0};
  function release(){
    if(!mesh)return;mesh.removeFromParent();mesh.dispose();mesh=null;selection=null;capacity=0;
    stats.residentCapacity=stats.residentBytes=0;stats.evictions++;
  }
  function allocate(count){
    release();capacity=Math.min(matrices.length,Math.max(16,2**Math.ceil(Math.log2(Math.max(1,count)))));
    mesh=new THREE.InstancedMesh(geometry,material,capacity);mesh.name=name;mesh.frustumCulled=false;
    if(colors?.some(Boolean))mesh.setColorAt(0,new THREE.Color('white'));
    configure(mesh);parent.add(mesh);cacheStaticTransforms(mesh);
    selection=createStaticInstanceSelection(mesh,{matrices,colors,ids});sourceCount=matrices.length;
    stats.residentCapacity=capacity;stats.residentBytes=mesh.instanceMatrix.array.byteLength+(mesh.instanceColor?.array.byteLength||0);stats.allocations++;overcapacitySince=null;
  }
  return{stats,get mesh(){return mesh;},update(indices,{reserve=indices.length,forceFull=false}={}){
    if(disposed)return;stats.sourceInstances=matrices.length;const time=now(),needed=Math.max(indices.length,Math.min(matrices.length,reserve));
    if(indices.length)lastNeeded=time;
    if(!indices.length&&forceFull){release();return;}
    if(!indices.length&&!forceFull){if(time-lastNeeded>=cooldownMs)release();else if(mesh)selection.update([]);return;}
    const target=forceFull?matrices.length:needed;
    if(target<capacity/4){overcapacitySince??=time;}else overcapacitySince=null;
    if(!mesh||target>capacity||sourceCount!==matrices.length||overcapacitySince!==null&&time-overcapacitySince>=cooldownMs)allocate(target);
    selection.update(indices);
  },release,dispose(){if(disposed)return;release();disposed=true;}};
}
