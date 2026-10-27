/** Use the rendered source partition for walking under East Nine's arcade.
 * Columns remain finite obstacles, not whole-footprint invisible walls.
 * Viewpoints are inspection aids, not surveyed entrance positions. */
export function collectEastNineAccess(group){
  const data=group?.userData||{},buildings=data.collisionBuildings||[];
  const raised=buildings.find(b=>b.minHeight>Math.min(...buildings.map(b=>b.minHeight))+.5),ring=raised?.rings?.[0]||[];
  const barriers=(data.columnPositions||[]).map((p,i)=>({
    sourceId:data.raisedBridgeSourceId,id:`east-nine-column-${i}`,label:'东九柱廊圆柱',
    minHeight:p.baseHeight??(buildings.length?Math.min(...buildings.map(b=>b.minHeight)):0),height:raised?.minHeight??data.bridgeClearHeight,
    polygon:Array.from({length:16},(_,j)=>({x:p.x+p.radius*Math.cos(j*Math.PI/8),z:p.z+p.radius*Math.sin(j*Math.PI/8)})),
  }));
  const walkSurfaces=[];group?.traverse?.(o=>{if(o.userData.walkSurfaces)walkSurfaces.push(...o.userData.walkSurfaces);});
  const viewpoints={};
  if(ring.length){
    const z=(Math.min(...ring.map(p=>p.z))+Math.max(...ring.map(p=>p.z)))/2;
    const crossings=ring.flatMap((a,i)=>{const b=ring[(i+1)%ring.length];return (a.z<=z&&b.z>z)||(b.z<=z&&a.z>z)?[a.x+(b.x-a.x)*(z-a.z)/(b.z-a.z)]:[];});
    if(crossings.length>=2){
      const front=Math.max(...crossings),back=Math.min(...crossings);
      viewpoints.forecourt={x:front+30,z:z+8,yaw:Math.PI/2+.16,pitch:-.23};
      viewpoints.paving={x:front+38,z:z+10,yaw:Math.PI/2+.42,pitch:.05};
      // Between the two column rows, looking along the open gallery.
      viewpoints.arcade={x:(front+back)/2,z,yaw:Math.PI+.12,pitch:-.08};
    }
  }
  const landing=walkSurfaces.find(s=>s.id==='east-nine-a-east-landing'),firstStep=walkSurfaces.find(s=>s.id==='east-nine-a-east-step-1');
  if(landing&&firstStep){
    const center=s=>s.polygon.reduce((a,p)=>({x:a.x+p.x/s.polygon.length,z:a.z+p.z/s.polygon.length}),{x:0,z:0});
    const a=center(landing),b=center(firstStep),length=Math.hypot(b.x-a.x,b.z-a.z),nx=(b.x-a.x)/length,nz=(b.z-a.z)/length;
    if(length>.1)viewpoints.entrance={x:a.x+nx*23,z:a.z+nz*23,yaw:Math.atan2(nx,nz),pitch:-.25};
  }
  return{buildings,barriers,walkSurfaces,viewpoints,replacedBuildingIds:buildings.length?['way/1023544717','way/1528957937']:[]};
}
