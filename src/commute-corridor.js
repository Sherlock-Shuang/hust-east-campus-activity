/** Keep junction lane offsets on the same sourced pavement polygons drawn by
 * the scene. This is a geometric envelope, not a surveyed lane centreline. */
export function createTrafficCorridor(surfaces,centerPose,length){
  if(!Array.isArray(surfaces)||!surfaces.length)return{limit:(_s,offset)=>offset,walkHeight:(_x,_z,y)=>y,walkFits:()=>true};
  const grid=new Map(),cell=24,cache=new Map(),margin=.52;
  for(const surface of surfaces){
    if(!surface.polygon?.length)continue;
    const b=surface.bounds??{minX:Math.min(...surface.polygon.map(p=>p.x)),maxX:Math.max(...surface.polygon.map(p=>p.x)),minZ:Math.min(...surface.polygon.map(p=>p.z)),maxZ:Math.max(...surface.polygon.map(p=>p.z))};
    for(let x=Math.floor(b.minX/cell);x<=Math.floor(b.maxX/cell);x++)for(let z=Math.floor(b.minZ/cell);z<=Math.floor(b.maxZ/cell);z++){const key=`${x},${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(surface);}
  }
  function polygonContains(polygon,x,z){let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)yes=!yes;}return yes;}
  function inside(x,z,y){
    for(const surface of grid.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)||[]){
      if(surface.rideAllowed===false)continue;
      if(Math.abs(y-(surface.surfaceY??surface.elevation??0))>.8)continue;
      if(polygonContains(surface.polygon,x,z))return true;
    }return false;
  }
  function walkFits(x,z,y,radius=.275){
    for(let n=-1;n<8;n++){const angle=n*Math.PI/4,px=x+(n<0?0:Math.cos(angle)*radius),pz=z+(n<0?0:Math.sin(angle)*radius);
      if(!(grid.get(`${Math.floor(px/cell)},${Math.floor(pz/cell)}`)||[]).some(s=>s.walkAllowed!==false&&Math.abs(y-(s.surfaceY??s.elevation??0))<.8&&polygonContains(s.polygon,px,pz)))return false;
    }return true;
  }
  function fits(p,offset){
    const x=p.x+p.offsetX*offset,z=p.z+p.offsetZ*offset;
    if(!inside(x,z,p.y))return false;
    for(let i=0;i<8;i++){const a=i*Math.PI/4;if(!inside(x+Math.cos(a)*margin,z+Math.sin(a)*margin,p.y))return false;}
    return true;
  }
  function envelope(index,direction){
    const key=index*2+(direction===1?1:0);if(cache.has(key))return cache.get(key);
    const p=centerPose(Math.min(length,index*.5));
    // Small source polygon seams are handled by the scene's junction patches;
    // if even the centre is outside a usable surface, do not invent a road.
    if(!fits(p,0)){cache.set(key,0);return 0;}
    let lo=0,hi=.5;while(hi<=24&&fits(p,hi*direction)){lo=hi;hi+=.5;}
    for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(fits(p,mid*direction))lo=mid;else hi=mid;}
    const limit=Math.max(0,lo-.025);cache.set(key,limit);return limit;
  }
  return{
    walkFits,
    limit(progress,offset){if(!offset)return offset;const index=Math.floor(Math.max(0,progress)*2),direction=Math.sign(offset),bound=Math.min(envelope(index,direction),envelope(index+1,direction));return direction*Math.min(Math.abs(offset),bound);},
    walkHeight(x,z,y){let result=y;for(const surface of grid.get(`${Math.floor(x/cell)},${Math.floor(z/cell)}`)||[]){const height=surface.surfaceY??surface.elevation??y;if(surface.walkAllowed===false||Math.abs(height-y)>.8||!polygonContains(surface.polygon,x,z))continue;result=Math.max(result,height);}return result;}
  };
}

/** A local sourced footway bypass shares the main commute clock/progress. It
 * only replaces the spatial path through one junction; it is not a second
 * traffic simulation or an invented full-campus pedestrian route. */
export function createPedestrianPathMapper(paths=[],sampleBase){
  const prepared=paths.filter(p=>p.points?.length>1&&p.endProgress>p.startProgress).map(path=>{
    const distances=[0];for(let i=1;i<path.points.length;i++)distances.push(distances.at(-1)+Math.hypot(path.points[i].x-path.points[i-1].x,path.points[i].z-path.points[i-1].z));
    const tangents=path.points.slice(1).map((p,i)=>{const d=distances[i+1]-distances[i];return{x:(p.x-path.points[i].x)/d,z:(p.z-path.points[i].z)/d};});
    const normals=path.points.map((_,i)=>{const a=tangents[Math.max(0,i-1)],b=tangents[Math.min(tangents.length-1,i)],nx=-a.z-b.z,nz=a.x+b.x,n=Math.hypot(nx,nz)||1,scale=1/Math.max(.6,(-b.z*nx+b.x*nz)/n);return{x:nx/n*scale,z:nz/n*scale};});
    return{...path,distances,normals,length:distances.at(-1)};
  });
  function sourcePose(path,progress,direction,sideShift,y){
    const scale=path.length/(path.endProgress-path.startProgress),s=(progress-path.startProgress)*scale;
    let i=1;while(i<path.points.length-1&&path.distances[i]<s)i++;
    const a=path.points[i-1],b=path.points[i],span=Math.max(.001,path.distances[i]-path.distances[i-1]),t=(s-path.distances[i-1])/span,dx=(b.x-a.x)/span,dz=(b.z-a.z)/span;
    const shoulder=direction*.32+Math.max(-.18,Math.min(.18,sideShift)),na=path.normals[i-1],nb=path.normals[i];
    return{x:a.x+(b.x-a.x)*t+(na.x+(nb.x-na.x)*t)*shoulder,z:a.z+(b.z-a.z)*t+(na.z+(nb.z-na.z)*t)*shoulder,y:(a.y??y)+((b.y??y)-(a.y??y))*t,
      pathDx:(dx+(nb.x-na.x)*shoulder/span)*scale,pathDz:(dz+(nb.z-na.z)*shoulder/span)*scale};
  }
  function transition(a,b,t,span){
    const t2=t*t,t3=t2*t,h0=2*t3-3*t2+1,h1=t3-2*t2+t,h2=-2*t3+3*t2,h3=t3-t2;
    const d0=(6*t2-6*t)/span,d1=3*t2-4*t+1,d2=(-6*t2+6*t)/span,d3=3*t2-2*t;
    return{x:h0*a.x+h1*span*a.pathDx+h2*b.x+h3*span*b.pathDx,z:h0*a.z+h1*span*a.pathDz+h2*b.z+h3*span*b.pathDz,y:a.y+(b.y-a.y)*t,
      pathDx:d0*a.x+d1*a.pathDx+d2*b.x+d3*b.pathDx,pathDz:d0*a.z+d1*a.pathDz+d2*b.z+d3*b.pathDz};
  }
  return(progress,base,direction=1,sideShift=0)=>{
    const path=prepared.find(p=>(p.direction===undefined||p.direction===direction)&&progress>=p.startProgress&&progress<=p.endProgress);if(!path)return base;
    const blend=Math.min(path.blendDistance??6,(path.endProgress-path.startProgress)*.2);let target=sourcePose(path,progress,direction,sideShift,base.y);
    // Join fixed endpoints. Blending against the motor-route offset at each
    // intermediate point inherits its folded inner corner and makes a walker
    // reverse toward the branch start that is already behind their feet.
    if(sampleBase&&progress<path.startProgress+blend){
      const a=sampleBase(path.startProgress,direction,sideShift),b=sourcePose(path,path.startProgress+blend,direction,sideShift,base.y);
      target=transition(a,b,(progress-path.startProgress)/blend,blend);
    }else if(sampleBase&&progress>path.endProgress-blend){
      const a=sourcePose(path,path.endProgress-blend,direction,sideShift,base.y),b=sampleBase(path.endProgress,direction,sideShift);
      target=transition(a,b,(progress-path.endProgress+blend)/blend,blend);
    }
    return{...base,...target,yaw:Math.atan2(-target.pathDx,-target.pathDz),pathScale:Math.hypot(target.pathDx,target.pathDz),offsetAlong:0,pedestrianPathId:path.id??null};
  };
}

/** Locate pedestrian crossings from the actual two spatial paths. Route
 * progress differs across a mapped bypass, so one shared stop-line coordinate
 * cannot safely represent both approaching users. */
export function createPedestrianCrossings(paths,poseAt,routeLength){
  const result=[],cross=(ax,az,bx,bz)=>ax*bz-az*bx;
  for(const path of paths||[]){
    const cell=4,grid=new Map(),direction=path.direction??1;
    for(let s=Math.max(0,path.startProgress-15);s<Math.min(routeLength,path.endProgress+15);s+=.5)for(const rideDirection of[-1,1])for(const lane of[0,1]){
      const a=poseAt(s,lane,'scooter',rideDirection),b=poseAt(Math.min(routeLength,s+.5),lane,'scooter',rideDirection),record={a,b,s};
      for(let x=Math.floor(Math.min(a.x,b.x)/cell);x<=Math.floor(Math.max(a.x,b.x)/cell);x++)for(let z=Math.floor(Math.min(a.z,b.z)/cell);z<=Math.floor(Math.max(a.z,b.z)/cell);z++){const key=`${x},${z}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(record);}
    }
    const contacts=[];
    for(let s=path.startProgress;s<path.endProgress;s+=.5){
      const a=poseAt(s,0,'walk',direction),b=poseAt(Math.min(path.endProgress,s+.5),0,'walk',direction),gx=Math.floor(a.x/cell),gz=Math.floor(a.z/cell),seen=new Set();
      for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++)for(const ride of grid.get(`${gx+x},${gz+z}`)||[]){
        if(seen.has(ride))continue;seen.add(ride);if(Math.abs(a.y-ride.a.y)>.8)continue;
        const vx=b.x-a.x,vz=b.z-a.z,wx=ride.b.x-ride.a.x,wz=ride.b.z-ride.a.z,den=cross(vx,vz,wx,wz);if(Math.abs(den)<1e-8)continue;
        const qx=ride.a.x-a.x,qz=ride.a.z-a.z,t=cross(qx,qz,wx,wz)/den,u=cross(qx,qz,vx,vz)/den;
        if(t>=0&&t<=1&&u>=0&&u<=1)contacts.push({walk:s+t*.5,ride:ride.s+u*.5});
      }
    }
    const groups=contacts.map(p=>({walkStart:p.walk-3,walkEnd:p.walk+3,rideStart:p.ride-4,rideEnd:p.ride+4}));
    // Merge intersecting stops/clearance windows and nearby crossings at the
    // same junction. A short 11 m gap cannot hold opposing queues: independent
    // locks would let each queue occupy the other's exit and form a cycle.
    let changed=true;while(changed){changed=false;outer:for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++){const a=groups[i],b=groups[j],rideOverlap=a.rideStart<=b.rideEnd+2&&b.rideStart<=a.rideEnd+2,walkOverlap=a.walkStart<=b.walkEnd+2&&b.walkStart<=a.walkEnd+2;const adjacentJunction=a.rideStart<=b.rideEnd+18&&b.rideStart<=a.rideEnd+18&&a.walkStart<=b.walkEnd+12&&b.walkStart<=a.walkEnd+12;if(rideOverlap||walkOverlap||adjacentJunction){for(const key of['walkStart','rideStart'])a[key]=Math.min(a[key],b[key]);for(const key of['walkEnd','rideEnd'])a[key]=Math.max(a[key],b[key]);groups.splice(j,1);changed=true;break outer;}}}
    for(const [index,g] of groups.entries())result.push({...g,id:`${path.id}-crossing-${index}`,pathId:path.id,direction,owner:null,lastOwner:'walk',since:0,accepting:true,hadOccupants:false,source:'intersection of mapped footway and cycle-band display paths',timingStatus:'scenario-estimate'});
  }
  return result;
}
