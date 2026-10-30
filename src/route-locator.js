/** Nearest projection on an immutable source-road route. Bounds only reject
 * distant segments; the projection equations and source-order ties are kept.
 * Rebuild the locator when rebuilding the route, just like its surface index. */
export function createRouteLocator(segments) {
  const entries=segments.map((segment,index)=>{
    const dx=segment.to.x-segment.from.x,dz=segment.to.z-segment.from.z;
    return {segment,index,dx,dz,l2:dx*dx+dz*dz,minX:Math.min(segment.from.x,segment.to.x),maxX:Math.max(segment.from.x,segment.to.x),minZ:Math.min(segment.from.z,segment.to.z),maxZ:Math.max(segment.from.z,segment.to.z)};
  });
  function branch(items) {
    let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
    for(const item of items){minX=Math.min(minX,item.minX);minZ=Math.min(minZ,item.minZ);maxX=Math.max(maxX,item.maxX);maxZ=Math.max(maxZ,item.maxZ);}
    const node={minX,minZ,maxX,maxZ};
    if(items.length<=4){node.items=items;return node;}
    const axis=maxX-minX>=maxZ-minZ?'X':'Z';
    items.sort((a,b)=>(a[`min${axis}`]+a[`max${axis}`])-(b[`min${axis}`]+b[`max${axis}`])||a.index-b.index);
    const middle=items.length>>1;
    node.left=branch(items.slice(0,middle));node.right=branch(items.slice(middle));return node;
  }
  const root=branch(entries);
  const squareDistance=(p,b)=>{
    const dx=Math.max(0,b.minX-p.x,p.x-b.maxX),dz=Math.max(0,b.minZ-p.z,p.z-b.maxZ);
    return dx*dx+dz*dz;
  };
  return function locate(p) {
    let best={distance:Infinity},bestIndex=Infinity;
    function visit(node) {
      // A bounding square is conservative even at equal-distance corners.
      // The small margin also retains boundary candidates under FP rounding.
      const radius=best.distance+1e-7;
      if(p.x+radius<node.minX||p.x-radius>node.maxX||p.z+radius<node.minZ||p.z-radius>node.maxZ)return;
      if(node.items){
        for(const {segment:seg,index,dx,dz,l2} of node.items){
          const t=Math.max(0,Math.min(1,((p.x-seg.from.x)*dx+(p.z-seg.from.z)*dz)/l2)),x=seg.from.x+dx*t,z=seg.from.z+dz*t,d=Math.hypot(p.x-x,p.z-z);
          if(d<best.distance||d===best.distance&&d!==Infinity&&index<bestIndex){bestIndex=index;best={distance:d,x,z,progress:seg.startProgress+t*seg.length,yaw:Math.atan2(-dx,-dz),width:seg.width,sourceId:seg.sourceId};}
        }
        return;
      }
      const leftFirst=squareDistance(p,node.left)<=squareDistance(p,node.right);
      visit(leftFirst?node.left:node.right);visit(leftFirst?node.right:node.left);
    }
    visit(root);return best;
  };
}
