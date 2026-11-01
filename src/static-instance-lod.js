/** Static instance transforms never change: a camera update only selects them.
 * Keep GPU buffers intact when the selection is unchanged, and upload only the
 * changed span when it is. This avoids sending a campus-sized capacity buffer
 * for a handful of nearby windows/trees. Export can still select every source. */
export function createStaticInstanceSelection(mesh,{matrices,colors,ids,stableSlots=false}={}) {
  const selected=new Int32Array(mesh.instanceMatrix.count);selected.fill(-1);
  // Opaque instances have no painter ordering. Keep surviving source identities
  // in their old GPU slots as a frustum edge moves; fill holes from the tail.
  // Explicit source-order exports and transparent materials use the old order.
  const stable=stableSlots&&!([mesh.material].flat().some(m=>m?.transparent));
  const wanted=stable?new Uint32Array(matrices.length):null,placed=stable?new Uint32Array(matrices.length):null,ordered=stable?[]:null;
  let generation=0;
  const selectedIds=[];
  let lastCount=-1;
  function queueRange(attribute,first,last,components){
    if(!attribute)return;
    let start=first*components,end=(last+1)*components;
    // A second camera update can run before render consumes the first one.
    // Retain all pending writes, including slots temporarily outside count.
    const ranges=attribute.updateRanges;
    if(stable){
      // Preserve disjoint changes at opposite frustum edges. Bound GL calls:
      // after 16 ranges, coalesce to one span until the renderer consumes it.
      if(ranges.length<16){
        for(let i=ranges.length-1;i>=0;i--){const r=ranges[i];if(start<=r.start+r.count&&end>=r.start){start=Math.min(start,r.start);end=Math.max(end,r.start+r.count);ranges.splice(i,1);}}
        attribute.addUpdateRange(start,end-start);return;
      }
    }
    for(const range of ranges){start=Math.min(start,range.start);end=Math.max(end,range.start+range.count);}
    if(ranges.length){ranges[0].start=start;ranges[0].count=end-start;ranges.length=1;}
    else attribute.addUpdateRange(start,end-start);
  }
  function update(indices,{sourceOrder=false}={}){
    if(stable&&!sourceOrder){
      generation=(generation+1)>>>0;if(!generation){wanted.fill(0);placed.fill(0);generation=1;}
      for(const i of indices)wanted[i]=generation;
      ordered.length=0;let tail=lastCount-1;
      for(let slot=0;slot<=tail;slot++){
        let i=selected[slot];
        if(wanted[i]!==generation){while(tail>slot&&wanted[selected[tail]]!==generation)tail--;if(tail<=slot)break;i=selected[tail--];}
        ordered.push(i);placed[i]=generation;
      }
      for(const i of indices)if(placed[i]!==generation){ordered.push(i);placed[i]=generation;}
      indices=ordered;
    }
    const count=indices.length,oldCount=lastCount;let first=count,last=-1,runFirst=-1,runLast=-1;
    const flushRun=()=>{if(runFirst<0)return;queueRange(mesh.instanceMatrix,runFirst,runLast,16);queueRange(mesh.instanceColor,runFirst,runLast,3);runFirst=runLast=-1;};
    for(let slot=0;slot<count;slot++){
      const index=indices[slot];
      if(slot>=oldCount||selected[slot]!==index)selectedIds[slot]=ids?.[index]??null;
      if(selected[slot]===index)continue;
      const source=matrices[index].elements||matrices[index];
      mesh.instanceMatrix.array.set(source,slot*16);
      if(mesh.instanceColor){const c=colors?.[index],offset=slot*3;mesh.instanceColor.array[offset]=c?.r??1;mesh.instanceColor.array[offset+1]=c?.g??1;mesh.instanceColor.array[offset+2]=c?.b??1;}
      selected[slot]=index;first=Math.min(first,slot);last=slot;
      if(stable){if(runLast>=0&&slot!==runLast+1)flushRun();if(runFirst<0)runFirst=slot;runLast=slot;}
    }
    mesh.count=count;mesh.visible=count>0;lastCount=count;
    const dirty=last>=0;
    if(dirty||oldCount!==count){selectedIds.length=count;mesh.userData.instanceFeatureIds=selectedIds;}
    if(dirty){
      if(stable)flushRun();else{queueRange(mesh.instanceMatrix,first,last,16);queueRange(mesh.instanceColor,first,last,3);}
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    }
    return dirty||oldCount!==count;
  }
  return {update};
}

/** Broad phase for static details. The exact original frustum/distance test is
 * still performed by the caller, so this only removes impossible candidates. */
export function createStaticXZIndex(positions,cellSize=64){
  const cells=new Map();
  positions.forEach((p,i)=>{const x=Math.floor(p.x/cellSize),z=Math.floor(p.z/cellSize),key=`${x}/${z}`;if(!cells.has(key))cells.set(key,{x,z,indices:[]});cells.get(key).indices.push(i);});
  const cached=[];let previousMinX,previousMaxX,previousMinZ,previousMaxZ;
  return {query(position,radius,out=[]){
    out.length=0;
    const minX=Math.floor((position.x-radius)/cellSize),maxX=Math.floor((position.x+radius)/cellSize),minZ=Math.floor((position.z-radius)/cellSize),maxZ=Math.floor((position.z+radius)/cellSize);
    if(minX!==previousMinX||maxX!==previousMaxX||minZ!==previousMinZ||maxZ!==previousMaxZ){
      cached.length=0;
      if((maxX-minX+1)*(maxZ-minZ+1)>cells.size*2){for(const cell of cells.values())if(cell.x>=minX&&cell.x<=maxX&&cell.z>=minZ&&cell.z<=maxZ)cached.push(...cell.indices);}
      else for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const cell=cells.get(`${x}/${z}`);if(cell)cached.push(...cell.indices);}
      // Camera movement inside the same cell rectangle has identical broad
      // phase candidates. Reuse their stable source order until an edge moves.
      cached.sort((a,b)=>a-b);previousMinX=minX;previousMaxX=maxX;previousMinZ=minZ;previousMaxZ=maxZ;
    }
    // Keep caller-owned outputs independent, including callers that filter or
    // clear their candidate array between queries.
    for(let i=0;i<cached.length;i++)out.push(cached[i]);return out;
  }};
}

/** Stateful distance bands without drawing two LODs at once. A small spatial
 * dead band prevents a tree switching meshes every time a camera bobs across a
 * threshold. A changed quality scale starts from its exact budget immediately;
 * reset() also makes export/inspection independent from previous camera state. */
export function createDistanceLodSelection(count,thresholds,{hysteresis=.1}={}){
  const levels=new Int8Array(count);levels.fill(-1);
  const fraction=Number.isFinite(hysteresis)?Math.max(0,Math.min(.25,hysteresis)):.1;
  let lastScale=null,exact=[],outward=[],inward=[];
  function reset(){levels.fill(-1);}
  function setScale(scale=1){
    const value=Number.isFinite(scale)&&scale>0?scale:1;
    if(lastScale===value)return false;
    lastScale=value;exact=thresholds.map(d=>(d*value)**2);outward=thresholds.map(d=>(d*value*(1+fraction))**2);inward=thresholds.map(d=>(d*value*(1-fraction))**2);reset();return true;
  }
  function levelAt(index,distanceSq){
    let level=levels[index];
    if(level<0||level===undefined){level=0;while(level<exact.length&&distanceSq>exact[level])level++;}
    else{
      while(level<outward.length&&distanceSq>outward[level])level++;
      while(level>0&&distanceSq<inward[level-1])level--;
    }
    levels[index]=level;return level;
  }
  setScale(1);return{setScale,levelAt,reset};
}
