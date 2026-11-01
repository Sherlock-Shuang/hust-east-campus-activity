/** Keep per-part actor slots stable between simulation ticks. Appearance,
 * braking and camera selection may change independently from actor motion.
 * Only changed slots are written; colours do not upload for movement alone. */
export function createDynamicInstanceSelection(mesh,{applies=()=>true,matrixFor,colorFor,idFor=record=>record.agent.id??null}){
  const records=[],versions=[],colors=[],ids=[];
  function queueRange(attribute,first,last,components){
    if(!attribute||last<first)return;
    let start=first*components,end=(last+1)*components;
    // Multiple traffic/transport updates may precede the next actual draw.
    // Three.js consumes these ranges on render, not when needsUpdate is set.
    for(const range of attribute.updateRanges){start=Math.min(start,range.start);end=Math.max(end,range.start+range.count);}
    if(attribute.updateRanges.length){Object.assign(attribute.updateRanges[0],{start,count:end-start});attribute.updateRanges.length=1;}
    else attribute.addUpdateRange(start,end-start);
    attribute.needsUpdate=true;
  }
  function update(candidates){
    let count=0,firstMatrix=Infinity,lastMatrix=-1,firstColor=Infinity,lastColor=-1;
    for(const record of candidates){
      if(!applies(record))continue;
      const slot=count++;
      if(records[slot]===record&&versions[slot]===record.version)continue;
      mesh.setMatrixAt(slot,matrixFor(record));
      firstMatrix=Math.min(firstMatrix,slot);lastMatrix=slot;
      const color=colorFor?.(record);
      if(color&&colors[slot]!==color){
        mesh.setColorAt(slot,color);colors[slot]=color;
        firstColor=Math.min(firstColor,slot);lastColor=slot;
      }
      records[slot]=record;versions[slot]=record.version;ids[slot]=idFor(record);
    }
    // Do not retain actors which left the view/completed their route. Keeping
    // the array itself avoids fresh filter/map arrays for every mesh part.
    records.length=versions.length=colors.length=ids.length=count;
    mesh.count=count;mesh.userData.agentIds=ids;
    queueRange(mesh.instanceMatrix,firstMatrix,lastMatrix,16);
    queueRange(mesh.instanceColor,firstColor,lastColor,3);
  }
  return{update};
}
