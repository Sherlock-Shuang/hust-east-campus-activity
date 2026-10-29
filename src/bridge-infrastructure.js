import {streetFootprint} from './street-clearance.js';

// Collision envelopes come from the same authored sizes as the visible bridge
// parts. They describe the existing reconstruction, not new survey evidence.
export function bridgeRailBarrier({id,sourceId,a,b,width,minHeight,height,label='桥侧护栏'}){
  const length=Math.hypot(b.x-a.x,b.z-a.z);
  if(length<.001)return null;
  return{id,sourceId,label,polygon:streetFootprint((a.x+b.x)/2,(a.z+b.z)/2,length,width,-Math.atan2(b.z-a.z,b.x-a.x)),minHeight,height};
}

export function planBridgeStructure({points,width,surfaceY,sourceId}){
  const piers=[],rails=[],barriers=[];
  for(let j=1;j<points.length;j++){
    const a=points[j-1],b=points[j],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    if(length<.001)continue;
    const count=Math.max(1,Math.floor(length/24)),pierHeight=Math.max(.3,surfaceY-.75);
    for(let k=0;k<count;k++){
      const t=(k+.5)/count,x=a.x+dx*t,z=a.z+dz*t,id=`${sourceId}:pier:${j}:${k}`;
      const part={id,x,z,y:pierHeight/2,height:pierHeight,radiusTop:.7,radiusBottom:.84};
      piers.push(part);
      barriers.push({id,sourceId,label:'高架桥墩',minHeight:0,height:pierHeight,
        // CylinderGeometry uses sin(theta),cos(theta). Its wider octagonal base
        // gives a conservative envelope for the same slightly tapered pier.
        polygon:Array.from({length:8},(_,i)=>({x:x+Math.sin(i*Math.PI/4)*part.radiusBottom,z:z+Math.cos(i*Math.PI/4)*part.radiusBottom}))});
    }
    if(length<=.1)continue;
    for(const side of [-1,1]){
      const nx=-dz/length*width*.49*side,nz=dx/length*width*.49*side;
      const ar={x:a.x+nx,z:a.z+nz},br={x:b.x+nx,z:b.z+nz},id=`${sourceId}:rail:${j}:${side}`;
      const part={id,x:(ar.x+br.x)/2,z:(ar.z+br.z)/2,y:surfaceY+.75,length,height:1,width:.14,yaw:-Math.atan2(dz,dx)};
      rails.push(part);barriers.push(bridgeRailBarrier({id,sourceId,a:ar,b:br,width:part.width,minHeight:part.y-part.height/2,height:part.y+part.height/2}));
    }
  }
  return{piers,rails,barriers};
}
