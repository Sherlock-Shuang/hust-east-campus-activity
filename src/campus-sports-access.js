import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

const SOURCE_IDS=Object.freeze({west:'way/1483567244',walkway:'way/1483567245',east:'way/1483567243',ramp:'way/1483567242'});
const DATUM=.14,RISE=.9,TREAD=.35,RISER=.15,STEP_COUNT=6,WALK_WIDTH=3.2,RAMP_WIDTH=4.5;
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);

/** geo-scene stores a projected source centreline in a THREE.Line beneath the
 * record group. Its y=.09 is a cartographic display offset, not terrain height. */
function sourcePath(record){
  const paths=[];
  record?.group?.traverse(object=>{if(!object.isLine||object.isLineSegments)return;const p=object.geometry?.getAttribute('position');if(!p||p.count<2)return;
    const points=Array.from({length:p.count},(_,i)=>({x:p.getX(i),z:p.getZ(i)})).filter((p,i,all)=>!i||distance(p,all[i-1])>1e-5);
    if(points.length>1)paths.push(points);
  });
  return paths.sort((a,b)=>b.reduce((n,p,i)=>n+(i?distance(p,b[i-1]):0),0)-a.reduce((n,p,i)=>n+(i?distance(p,a[i-1]):0),0))[0]||null;
}

function pathGeometry(points){
  const segments=[];let length=0;
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=distance(a,b);if(l<1e-5)continue;segments.push({a,b,start:length,length:l,dx:(b.x-a.x)/l,dz:(b.z-a.z)/l});length+=l;}
  return {points,segments,length,at(s,offset=0){s=Math.max(0,Math.min(length,s));const segment=segments.find(e=>s<=e.start+e.length+1e-7)||segments.at(-1),t=s-segment.start;
    return{x:segment.a.x+segment.dx*t-segment.dz*offset,z:segment.a.z+segment.dz*t+segment.dx*offset,dx:segment.dx,dz:segment.dz,yaw:-Math.atan2(segment.dz,segment.dx)};
  }};
}

/** The source has steps/footway/service connectivity but no elevation survey.
 * This models a 0.90 m raised north walk as an explicit display hypothesis.
 * Caller-owned source geometry, material maps and path coordinates stay intact. */
export function createSportsAccess(THREE,model,{surfaces}={}){
  if(!Array.isArray(model?.records))throw new TypeError('Projected source scene records are required.');
  const group=new THREE.Group();group.name='东操场北侧 · 源步道、双台阶与缓坡';
  const records=new Map(model.records.map(r=>[r.id,r])),paths=new Map();
  for(const id of Object.values(SOURCE_IDS)){const points=sourcePath(records.get(id));if(points)paths.set(id,pathGeometry(points));}
  const counts={sourceFeatures:paths.size,stairs:0,treads:0,platforms:0,walkways:0,ramps:0,handrailPosts:0,retainingWalls:0,pavingJoints:0,walkSurfaces:0,drawCalls:0};
  group.userData={category:'sports-access',coordinateSystem:'LOCAL_ENU',units:'metres',estimated:true,
    positionEvidence:'unaltered projected source LineString centreline vertices',
    elevationEvidence:'source has no terrain heights; 0.90 m raised walk and matching steps/ramp are display estimates',
    dimensions:{groundSurfaceY:DATUM,raisedSurfaceY:DATUM+RISE,walkWidthMetres:WALK_WIDTH,rampWidthMetres:RAMP_WIDTH,stepCountPerFlight:STEP_COUNT,riserMetres:RISER,treadDepthMetres:TREAD,geometryBelowContactMetres:.02,measured:false},
    sourceIds:[...paths.keys()],sourcePaths:[...paths].map(([sourceId,path])=>({sourceId,points:path.points.map(p=>({...p}))})),
    sources:[...paths.keys()].map(id=>records.get(id)?.feature?.properties?.sourceUrl).filter(Boolean),sections:[]};
  const geometries=new Set(),materials=new Set(),batches=new Map(),walkSurfaces=[];
  const own=m=>{materials.add(m);return m;};
  const material=(borrowed,color,roughness)=>{const m=borrowed?.clone?borrowed.clone():new THREE.MeshStandardMaterial();m.color.set(color);m.roughness=roughness;m.side=THREE.FrontSide;return own(m);};
  const paving=material(surfaces?.paving,'#c7c9c4',.92),stone=material(surfaces?.concrete,'#c3c5be',.9);
  const nose=own(new THREE.MeshStandardMaterial({color:'#858e88',roughness:.9})),metal=own(new THREE.MeshStandardMaterial({color:'#a5b1ad',metalness:.6,roughness:.38})),seam=own(new THREE.MeshStandardMaterial({color:'#7e857e',roughness:.97}));
  function bake(g,m){
    const flat=g.index?g.toNonIndexed():g;if(flat!==g)g.dispose();flat.computeVertexNormals();
    const p=flat.getAttribute('position'),n=flat.getAttribute('normal'),uv=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){const horizontal=Math.abs(n.getY(i))>.65;uv[i*2]=horizontal?p.getX(i):Math.abs(n.getX(i))>Math.abs(n.getZ(i))?p.getZ(i):p.getX(i);uv[i*2+1]=horizontal?p.getZ(i):p.getY(i);}
    flat.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if(!batches.has(m))batches.set(m,[]);batches.get(m).push(flat);
  }
  function box(w,h,d,m,x,y,z,yaw=0){if(w<=0||h<=0||d<=0)return;const g=new THREE.BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);bake(g,m);}
  function tube(a,b,r,m){const start=new THREE.Vector3(a.x,a.y,a.z),end=new THREE.Vector3(b.x,b.y,b.z),delta=end.clone().sub(start),length=delta.length();if(length<1e-5)return;
    const g=new THREE.CylinderGeometry(r,r,length,8);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));g.translate((a.x+b.x)/2,(a.y+b.y)/2,(a.z+b.z)/2);bake(g,m);
  }
  function ribbonPrism(a,b,width,fromY,toY,m,bottom=.065){
    const dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);if(length<1e-5)return;
    const nx=-dz/length*width/2,nz=dx/length*width/2;
    const corners=[{x:a.x+nx,z:a.z+nz},{x:b.x+nx,z:b.z+nz},{x:b.x-nx,z:b.z-nz},{x:a.x-nx,z:a.z-nz}],top=[fromY-.02,toY-.02,toY-.02,fromY-.02],positions=[];
    for(const [i,j,k] of [[0,1,2],[0,2,3]])for(const n of[i,j,k])positions.push(corners[n].x,top[n],corners[n].z);
    for(let i=0;i<4;i++){const j=(i+1)%4;for(const[n,y]of[[i,bottom],[j,bottom],[i,top[i]],[i,top[i]],[j,bottom],[j,top[j]]])positions.push(corners[n].x,y,corners[n].z);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));bake(g,m);
    return corners;
  }
  function support(polygon,surfaceY,sourceId,kind,extra={}){walkSurfaces.push({polygon:polygon.map(p=>({...p})),surfaceY,sourceId,kind,estimated:true,...extra});}
  function flatSection(path,start,end,width,surfaceY,sourceId,kind){
    if(end-start<1e-5)return;const a=path.at(start),b=path.at(end),polygon=ribbonPrism(a,b,width,surfaceY,surfaceY,kind==='tread'?stone:paving);support(polygon,surfaceY,sourceId,kind,{startDistance:start,endDistance:end});
  }
  function crossJoint(path,s,width,surfaceY){const p=path.at(s);box(.012,.003,width-.12,seam,p.x,surfaceY-.0185,p.z,p.yaw);counts.pavingJoints++;}
  const middle=paths.get(SOURCE_IDS.walkway),westHigh=middle?.points[0],eastHigh=middle?.points.at(-1);
  function makeStairs(sourceId,highPoint,fallbackAscending){
    const path=paths.get(sourceId);if(!path||path.length<STEP_COUNT*TREAD+.2)return;
    const ascending=highPoint?distance(path.points.at(-1),highPoint)<distance(path.points[0],highPoint):fallbackAscending;
    const flightLength=STEP_COUNT*TREAD,start=(path.length-flightLength)/2,end=start+flightLength;
    const firstHeight=ascending?DATUM:DATUM+RISE,lastHeight=ascending?DATUM+RISE:DATUM;
    flatSection(path,0,start,WALK_WIDTH,firstHeight,sourceId,'platform');flatSection(path,end,path.length,WALK_WIDTH,lastHeight,sourceId,'platform');counts.platforms+=2;
    for(let k=0;k<STEP_COUNT;k++){
      const height=DATUM+(ascending?(k+1)*RISER:RISE-(k+1)*RISER),a=start+k*TREAD,b=a+TREAD;
      flatSection(path,a,b,WALK_WIDTH,height,sourceId,'tread');
      const p=path.at(a+.035);box(.07,.012,WALK_WIDTH-.06,nose,p.x,height-.024,p.z,p.yaw);counts.treads++;
    }
    for(const [a,b,h] of [[0,start,firstHeight],[end,path.length,lastHeight]])for(let s=a+.85;s<b-.1;s+=.85)crossJoint(path,s,WALK_WIDTH,h);
    // The guards flank only the flight and short returns. No cross-bar or end
    // wall closes either platform or the connecting path/ramp junction.
    const stations=[Math.max(.05,start-.32),start,end,Math.min(path.length-.05,end+.32)];
    const railHeight=s=>firstHeight+(lastHeight-firstHeight)*Math.max(0,Math.min(1,(s-start)/flightLength));
    for(const side of[-1,1]){
      const points=stations.map(s=>({...path.at(s,side*(WALK_WIDTH/2+.075)),s}));
      for(const p of points){const y=railHeight(p.s)-.02;tube({...p,y},{...p,y:y+.94},.026,metal);box(.14,.025,.14,stone,p.x,y+.0125,p.z,p.yaw);counts.handrailPosts++;}
      for(let i=1;i<points.length;i++)for(const height of[.5,.94])tube({...points[i-1],y:railHeight(points[i-1].s)-.02+height},{...points[i],y:railHeight(points[i].s)-.02+height},height>.8?.033:.021,metal);
      const a=path.at(start,side*(WALK_WIDTH/2+.20)),b=path.at(end,side*(WALK_WIDTH/2+.20));
      ribbonPrism(a,b,.18,firstHeight+.12,lastHeight+.12,stone);counts.retainingWalls++;
    }
    group.userData.sections.push({sourceId,kind:'stairs',length:path.length,ascending,startSurfaceY:firstHeight,endSurfaceY:lastHeight,flightStart:start,flightEnd:end,stepCount:STEP_COUNT});counts.stairs++;
  }
  makeStairs(SOURCE_IDS.west,westHigh,true);makeStairs(SOURCE_IDS.east,eastHigh,false);
  if(middle){
    // Shared vertices keep neighbouring paved strips joined at the original
    // bends; trapezoidal top faces leave no wedge-shaped grass slots.
    const sides=middle.points.map((p,i)=>{const a=middle.points[Math.max(0,i-1)],b=middle.points[Math.min(middle.points.length-1,i+1)],l=distance(a,b)||1,nx=-(b.z-a.z)/l*WALK_WIDTH/2,nz=(b.x-a.x)/l*WALK_WIDTH/2;return[{x:p.x+nx,z:p.z+nz},{x:p.x-nx,z:p.z-nz}];});
    for(let i=1;i<middle.points.length;i++){
      const polygon=[sides[i-1][0],sides[i][0],sides[i][1],sides[i-1][1]],positions=[],top=DATUM+RISE-.02,bottom=.065;
      for(const tri of[[0,1,2],[0,2,3]])for(const k of tri)positions.push(polygon[k].x,top,polygon[k].z);
      for(let k=0;k<4;k++){const j=(k+1)%4;for(const[n,y]of[[k,bottom],[j,bottom],[k,top],[k,top],[j,bottom],[j,top]])positions.push(polygon[n].x,y,polygon[n].z);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));bake(g,paving);support(polygon,DATUM+RISE,SOURCE_IDS.walkway,'walkway');
    }
    for(let s=.8;s<middle.length-.2;s+=3.2)crossJoint(middle,s,WALK_WIDTH,DATUM+RISE);
    // Low retaining edges stop before the three-way eastern landing so a
    // pedestrian can turn onto either steps or the service-road slope.
    for(const segment of middle.segments)for(const side of[-1,1]){const start=Math.max(segment.start,1.8),end=Math.min(segment.start+segment.length,middle.length-2.6);if(end-start<.1)continue;
      ribbonPrism(middle.at(start,side*(WALK_WIDTH/2+.12)),middle.at(end,side*(WALK_WIDTH/2+.12)),.18,DATUM+RISE+.065,DATUM+RISE+.065,stone);counts.retainingWalls++;
    }
    group.userData.sections.push({sourceId:SOURCE_IDS.walkway,kind:'walkway',length:middle.length,surfaceY:DATUM+RISE});counts.walkways++;
  }
  const ramp=paths.get(SOURCE_IDS.ramp);
  if(ramp){
    const ascending=eastHigh?distance(ramp.points.at(-1),eastHigh)<distance(ramp.points[0],eastHigh):true;
    const height=s=>DATUM+RISE*(ascending?s/ramp.length:1-s/ramp.length);
    for(const segment of ramp.segments){ribbonPrism(segment.a,segment.b,RAMP_WIDTH,height(segment.start),height(segment.start+segment.length),paving);
      const pieces=Math.ceil(segment.length/.6);for(let i=0;i<pieces;i++){const a=segment.start+segment.length*i/pieces,b=segment.start+segment.length*(i+1)/pieces,p=ramp.at(a),q=ramp.at(b),nx=-segment.dz*RAMP_WIDTH/2,nz=segment.dx*RAMP_WIDTH/2;
        support([{x:p.x+nx,z:p.z+nz},{x:q.x+nx,z:q.z+nz},{x:q.x-nx,z:q.z-nz},{x:p.x-nx,z:p.z-nz}],height((a+b)/2),SOURCE_IDS.ramp,'ramp',{startSurfaceY:height(a),endSurfaceY:height(b),startDistance:a,endDistance:b});
      }
    }
    for(let s=1;s<ramp.length-.2;s+=3.2)crossJoint(ramp,s,RAMP_WIDTH,height(s));
    group.userData.sections.push({sourceId:SOURCE_IDS.ramp,kind:'ramp',length:ramp.length,ascending,startSurfaceY:height(0),endSurfaceY:height(ramp.length),slope:RISE/ramp.length});counts.ramps++;
  }
  for(const [material,parts]of batches){const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());geometries.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.name=material===paving?'体育场灰砖步道与接坡':material===stone?'体育场台阶与侧挡墙':material===metal?'台阶侧扶手':material===nose?'灰石踏步鼻口':'步道铺装接缝';mesh.castShadow=material===metal||material===stone;mesh.receiveShadow=true;mesh.renderOrder=206;mesh.userData={...group.userData,component:'estimated-sports-access-detail'};group.add(mesh);}
  counts.walkSurfaces=walkSurfaces.length;counts.drawCalls=group.children.length;group.userData.counts={...counts};
  let disposed=false;
  return{group,counts,walkSurfaces,dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();group.clear();}};
}
