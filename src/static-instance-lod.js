/** Static instance transforms never change: a camera update only selects them.
 * Keep GPU buffers intact when the selection is unchanged, and upload only the
 * active prefix when it is. This avoids sending a campus-sized capacity buffer
 * for a handful of nearby windows/trees. Export can still select every source. */
export function createStaticInstanceSelection(mesh,{matrices,colors,ids}={}) {
  const selected=new Int32Array(matrices.length);selected.fill(-1);
  let lastCount=-1;
  function update(indices){
    const count=indices.length,oldCount=lastCount;let dirty=false;
    for(let slot=0;slot<count;slot++){
      const index=indices[slot];if(selected[slot]===index)continue;
      const source=matrices[index].elements||matrices[index];
      mesh.instanceMatrix.array.set(source,slot*16);
      if(mesh.instanceColor){const c=colors?.[index],offset=slot*3;mesh.instanceColor.array[offset]=c?.r??1;mesh.instanceColor.array[offset+1]=c?.g??1;mesh.instanceColor.array[offset+2]=c?.b??1;}
      selected[slot]=index;dirty=true;
    }
    mesh.count=count;mesh.visible=count>0;lastCount=count;
    if(dirty||oldCount!==count){mesh.userData.instanceFeatureIds=indices.map(i=>ids?.[i]??null);}
    if(dirty&&count){
      for(const [attribute,components]of [[mesh.instanceMatrix,16],[mesh.instanceColor,3]])if(attribute){attribute.clearUpdateRanges();attribute.addUpdateRange(0,count*components);attribute.needsUpdate=true;}
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
  return {query(position,radius,out=[]){
    out.length=0;
    const minX=Math.floor((position.x-radius)/cellSize),maxX=Math.floor((position.x+radius)/cellSize),minZ=Math.floor((position.z-radius)/cellSize),maxZ=Math.floor((position.z+radius)/cellSize);
    if((maxX-minX+1)*(maxZ-minZ+1)>cells.size*2){for(const cell of cells.values())if(cell.x>=minX&&cell.x<=maxX&&cell.z>=minZ&&cell.z<=maxZ)out.push(...cell.indices);}
    else for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++){const cell=cells.get(`${x}/${z}`);if(cell)out.push(...cell.indices);}
    // Stable source order keeps uploads still across grid-cell transitions and
    // preserves the instance-to-source mapping used by object inspection.
    out.sort((a,b)=>a-b);return out;
  }};
}
