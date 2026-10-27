// Test the full footprint of inferred street furniture against the existing
// rendered source roads and footways. Centre-only tests miss narrow approaches
// and oblique intersections. This does not create a new road or access point.
export function streetFootprint(x,z,width,depth,yaw=0) {
  const c=Math.cos(yaw),s=Math.sin(yaw);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>({x:x+c*a*width/2+s*b*depth/2,z:z-s*a*width/2+c*b*depth/2}));
}

export function polygonsOverlap(a,b) {
  for(const polygon of[a,b])for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],nx=q.z-p.z,nz=p.x-q.x;
    if(Math.abs(nx)+Math.abs(nz)<1e-9)continue;
    let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
    for(const v of a){const d=v.x*nx+v.z*nz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
    for(const v of b){const d=v.x*nx+v.z*nz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
    if(amax<=bmin+1e-8||bmax<=amin+1e-8)return false;
  }
  return true;
}

export function createRoadClearance(route) {
  const surfaces=(route.roadSurfaces||[]).filter(p=>p.polygon?.length>=3&&Math.abs(p.surfaceY??.14)<.5).map(p=>({
    ...p,bounds:p.bounds||{minX:Math.min(...p.polygon.map(v=>v.x)),maxX:Math.max(...p.polygon.map(v=>v.x)),minZ:Math.min(...p.polygon.map(v=>v.z)),maxZ:Math.max(...p.polygon.map(v=>v.z))},
  }));
  return function obstructingSurface(x,z,width,depth,yaw=0){
    const ring=streetFootprint(x,z,width,depth,yaw),xs=ring.map(p=>p.x),zs=ring.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
    return surfaces.find(surface=>{
      const b=surface.bounds;
      return !(maxX<=b.minX||minX>=b.maxX||maxZ<=b.minZ||minZ>=b.maxZ)&&polygonsOverlap(ring,surface.polygon);
    })||null;
  };
}
