/** Activity-only rendering helpers. They never change collision or story state. */
export function freezeStaticLibrary(root,{animations=[]}={}){
  const saved=[],nodes=new WeakSet();let dynamic=animations.length>0;
  root.traverse(object=>{if(object.isSkinnedMesh||object.morphTargetInfluences?.length||object.userData?.libraryDynamic)dynamic=true;});
  // The building GLB has no animated nodes. Refuse a future animated replacement
  // rather than freezing its doors, characters, pages or other moving parts.
  if(!dynamic){
    root.updateWorldMatrix(true,true);
    root.traverse(object=>{
      saved.push([object,object.matrixAutoUpdate,object.matrixWorldAutoUpdate]);nodes.add(object);
      object.matrixAutoUpdate=false;object.matrixWorldAutoUpdate=false;
    });
  }
  return {
    count:saved.length,isStatic:object=>nodes.has(object),
    dispose(){for(const [object,local,world] of saved){object.matrixAutoUpdate=local;object.matrixWorldAutoUpdate=world;nodes.delete(object);}saved.length=0;}
  };
}

/** Conservative world bounds reduce candidates; Three still decides exact hits. */
export function createLibraryRaycastIndex(THREE,objects,isStatic=()=>false){
  const entries=[],candidates=[],hits=[],point=new THREE.Vector3();
  let queries=0,lastCandidates=0,totalCandidates=0,disposed=false,staticOnly=true;
  for(const object of objects){
    let bounds=null;
    if(isStatic(object)&&object.isMesh&&!object.isInstancedMesh&&!object.isSkinnedMesh&&!object.morphTargetInfluences?.length){
      if(!object.geometry.boundingBox)object.geometry.computeBoundingBox();
      bounds=object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld).expandByScalar(1e-5);
    }
    if(!bounds)staticOnly=false;
    entries.push({object,bounds});
  }
  return {
    nearest(raycaster){
      if(disposed)return undefined;
      candidates.length=0;hits.length=0;
      for(const {object,bounds} of entries){
        // Unfrozen / potentially moving objects always use the original exact
        // path. Never let an old cached AABB hide an occluder that has moved.
        if(!bounds||bounds.containsPoint(raycaster.ray.origin)||
          (raycaster.ray.intersectBox(bounds,point)&&point.distanceToSquared(raycaster.ray.origin)<=raycaster.far*raycaster.far))candidates.push(object);
      }
      queries++;lastCandidates=candidates.length;totalCandidates+=lastCandidates;
      raycaster.intersectObjects(candidates,false,hits);return hits[0];
    },
    get stats(){return {objects:entries.length,queries,lastCandidates,totalCandidates};},
    get staticOnly(){return staticOnly&&!disposed;},
    dispose(){disposed=true;entries.length=candidates.length=hits.length=0;}
  };
}

/** Reuse only a fully static query. Null (no readable book) is also a result. */
export function createLibraryRayMemo(){
  const key=new Float64Array(10);let valid=false,enabled=false,result=null,hits=0;
  return {
    reuse(raycaster,x,z,cacheable){
      const o=raycaster.ray.origin,d=raycaster.ray.direction;enabled=cacheable===true;
      if(enabled&&valid&&key[0]===o.x&&key[1]===o.y&&key[2]===o.z&&key[3]===d.x&&key[4]===d.y&&key[5]===d.z&&key[6]===raycaster.near&&key[7]===raycaster.far&&key[8]===x&&key[9]===z){hits++;return true;}
      key[0]=o.x;key[1]=o.y;key[2]=o.z;key[3]=d.x;key[4]=d.y;key[5]=d.z;key[6]=raycaster.near;key[7]=raycaster.far;key[8]=x;key[9]=z;valid=false;return false;
    },
    commit(value){result=value;valid=enabled;},
    invalidate(){valid=false;},
    get value(){return result;},get hits(){return hits;}
  };
}

/** Input/physics keep their original rAF cadence; only unchanged pixels wait. */
export function createLibraryDrawGate({idleInterval=1000}={}){
  let lastDraw=-Infinity,draws=0,skipped=0;
  return {
    shouldDraw(now,dirty=false,animated=false){
      if(dirty||animated||now-lastDraw>=idleInterval){lastDraw=now;draws++;return true;}
      skipped++;return false;
    },
    get stats(){return {draws,skipped,lastDraw,idleInterval};}
  };
}
