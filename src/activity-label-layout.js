// Activity labels remain useful at a distance, but must not cover nearby wall
// copy. Use projected text rectangles instead of changing host marker positions.
export function projectWallTextRects(THREE,camera,items,width,height){
  const rects=[],point=new THREE.Vector3();
  for(const item of items){
    const dx=camera.position.x-item.x,dz=camera.position.z-item.z;
    if(dx*item.nx+dz*item.nz<=0||dx*dx+dz*dz>120*120)continue;
    const points=[];
    for(const u of[-.5,.5])for(const v of[-.5,.5]){
      point.set(item.x+item.nz*item.width*u,item.y+item.height*v,item.z-item.nx*item.width*u).project(camera);
      if(point.z<=-1||point.z>=1){points.length=0;break;}
      points.push({x:(point.x*.5+.5)*width,y:(-.5*point.y+.5)*height});
    }
    if(points.length!==4)continue;
    const rect={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
    if(rect.right>0&&rect.left<width&&rect.bottom>0&&rect.top<height)rects.push(rect);
  }
  return rects;
}

// Labels use translate(-50%,-100%): x/y is the centre of their bottom edge.
export function avoidWallText(x,y,labelWidth,labelHeight,rects,viewportHeight){
  const overlaps=(top,r)=>x+labelWidth/2>r.left-7&&x-labelWidth/2<r.right+7&&top>r.top-7&&top-labelHeight<r.bottom+7;
  if(!rects.some(r=>overlaps(y,r)))return y;
  const candidates=rects.flatMap(r=>[r.top-8,r.bottom+labelHeight+8]);
  candidates.sort((a,b)=>Math.abs(a-y)-Math.abs(b-y));
  return candidates.find(top=>top>=labelHeight+8&&top<=viewportHeight-8&&!rects.some(r=>overlaps(top,r)))??y;
}
