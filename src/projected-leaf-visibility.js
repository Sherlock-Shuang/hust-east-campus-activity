/** Invert the original per-leaf smoothstep once. Camera changes then need only
 * squared distances, with the original formula retained at numeric boundaries.
 * This preserves the same deterministic thinning, leaf sizes and near detail. */
export function createProjectedLeafVisibility(leaves,thresholds,level=0){
  const range=Float64Array.from(leaves,(leaf,i)=>{
    const t=.5-Math.sin(Math.asin(1-2*thresholds[i])/3);
    return (leaf.radius/(.9+1.1*t))**2;
  });
  return (camera,projectionViewport,out)=>{
    const multiplier=projectionViewport*projectionViewport;
    for(let i=0;i<leaves.length;i++){
      const leaf=leaves[i],dx=camera.x-leaf.x,dy=camera.y-(level+leaf.height),dz=camera.z-leaf.z;
      const distanceSq=dx*dx+dy*dy+dz*dz,limit=range[i]*multiplier;
      if(Math.abs(distanceSq-limit)<=Math.max(1,limit)*1e-10||distanceSq<.0001){
        const pixels=leaf.radius*projectionViewport/Math.max(.01,Math.hypot(dx,dy,dz));
        const t=Math.max(0,Math.min(1,(pixels-.9)/1.1)),density=t*t*(3-2*t);
        out[i]=density>=1||density>thresholds[i]?1:0;
      }else out[i]=distanceSq<limit?1:0;
    }
  };
}
