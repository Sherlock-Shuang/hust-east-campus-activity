import clipping from 'polygon-clipping';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {getRoadProfile} from './building-profiles.js';

const MAIN='way/1023544717',ARCADE='way/1528957937',ROAD='way/97080595';
const DATUM=.14,CONTACT_GAP=.02,TREAD=.38,RISER=.14;
const PHOTOS=['/references/local-campus/east-nine-curtainwall.webp','/references/local-campus/east-nine-approach.webp'];
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
// Micrometre snapping stabilises coincident clipping edges without modifying
// the source records (well below the precision of the captured map geometry).
const snap=n=>Math.round(n*1e6)/1e6;
function closed(ring){const result=ring.map(([x,z])=>[snap(x),snap(z)]);if(result.length&&(result[0][0]!==result.at(-1)[0]||result[0][1]!==result.at(-1)[1]))result.push([...result[0]]);return result;}
const clean=polygons=>polygons.map(p=>p.map(closed));
const poly=points=>[[closed(points.map(p=>[p.x,p.z]))]];
const sourcePolygons=r=>(r?.shapes||[]).map(s=>[closed(s.getPoints().map(p=>[p.x,-p.y])),...s.holes.map(h=>closed(h.getPoints().map(p=>[p.x,-p.y])))]);
function area(polygons){const ring=r=>Math.abs(r.reduce((n,p,i)=>{const q=r[(i+1)%r.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2);return polygons.reduce((n,p)=>n+ring(p[0])-p.slice(1).reduce((s,r)=>s+ring(r),0),0);}
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
const contains=(x,z,polygons)=>polygons.some(p=>inside({x,z},p[0].map(([x,z])=>({x,z})))&&!p.slice(1).some(r=>inside({x,z},r.map(([x,z])=>({x,z})))));
function sourceLines(record){
  const lines=[];record?.group?.updateWorldMatrix(true,true);record?.group?.traverse(o=>{if(!o.isLine||o.isLineSegments)return;const p=o.geometry.attributes.position,m=o.matrixWorld.elements,points=[];
    for(let i=0;i<p.count;i++)points.push({x:m[0]*p.getX(i)+m[4]*p.getY(i)+m[8]*p.getZ(i)+m[12],z:m[2]*p.getX(i)+m[6]*p.getY(i)+m[10]*p.getZ(i)+m[14]});if(points.length>1)lines.push(points);
  });return lines;
}
function ribbon(points,width){
  const sides=points.map((p,i)=>{const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=-(b.z-a.z)/l*width/2,nz=(b.x-a.x)/l*width/2;return[{x:p.x+nx,z:p.z+nz},{x:p.x-nx,z:p.z-nz}];});
  return sides.slice(1).map((s,i)=>poly([sides[i][0],s[0],s[1],sides[i][1]]));
}
function union(polygons){const nonempty=polygons.filter(p=>p?.length).map(clean);return nonempty.length?clipping.union(...nonempty):[];}
const intersection=(a,b)=>a.length&&b.length?clipping.intersection(clean(a),clean(b)):[];
const difference=(a,...cuts)=>a.length?clipping.difference(clean(a),...cuts.filter(p=>p?.length).map(clean)):[];

export function heightAtEastNineGround(plan,x,z){
  let y=DATUM;
  for(const s of [...plan?.walkSurfaces||[],...plan?.existingEntrySurfaces||[]])if(s.surfaceY>y&&inside({x,z},s.polygon)&&!(s.holes||[]).some(h=>inside({x,z},h)))y=s.surfaceY;
  return y;
}

function surfaceTopAt(plan,item,p){
  if(item.acrossSlope){const {a,b,c}=item.acrossSlope,dx=b.x-a.x,dz=b.z-a.z,ex=c.x-a.x,ez=c.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*ez-(p.z-a.z)*ex)/(dx*ez-dz*ex||1)));return item.startSurfaceY+(item.endSurfaceY-item.startSurfaceY)*t-CONTACT_GAP;}
  const axis=plan.axis||{anchor:{x:0,z:0},tx:0,tz:1},s=(p.x-axis.anchor.x)*axis.tx+(p.z-axis.anchor.z)*axis.tz,t=Math.max(0,Math.min(1,(s-item.start)/(item.end-item.start||1)));
  return item.startSurfaceY+(item.endSurfaceY-item.startSurfaceY)*t-CONTACT_GAP;
}

/** Exact visible slab plane, for structural column feet and signs. Unlike the
 * discretised walking-contact samples this includes the gentle ramp slope and
 * already subtracts the 2 cm character contact gap. Do not subtract it twice. */
export function surfaceHeightAtEastNineGround(plan,x,z){
  let y=DATUM-CONTACT_GAP;
  for(const item of plan?.surfaces||[])if(contains(x,z,item.polygons))y=Math.max(y,surfaceTopAt(plan,item,{x,z}));
  if(plan?.edgeBands?.length&&contains(x,z,plan.edgeBands))y=Math.max(y,DATUM-CONTACT_GAP+.004);
  for(const s of plan?.existingEntrySurfaces||[])if(inside({x,z},s.polygon)&&!(s.holes||[]).some(h=>inside({x,z},h)))y=Math.max(y,s.surfaceY);
  return y;
}

/** Only horizontal boundaries come from the map. The B/C height changes are
 * deliberately local photo hypotheses, not a campus-wide elevation survey.
 * The entire parking forecourt remains at .14 m. Platform ends ramp down;
 * front and rear steps connect the same gallery surface instead of making an
 * isolated raised box in front of a lower arcade. The independent A stairs are
 * untouched. A caller must move only intersecting column bases to heightAt(). */
export function planEastNineGround(model,{entrySurfaces=[]}={}){
  const records=model?.records||[],main=records.find(r=>r.id===MAIN),arcade=records.find(r=>r.id===ARCADE),road=records.find(r=>r.id===ROAD);
  const plan={forecourtPolygons:[],entryApproachPolygons:[],existingEntrySurfaces:entrySurfaces.filter(s=>/^east-nine-a-east-/.test(s.id??'')).map(s=>({...s,polygon:s.polygon.map(p=>({...p})),holes:(s.holes||[]).map(r=>r.map(p=>({...p})))})),arcadePolygons:sourcePolygons(arcade),galleryPlatforms:[],walkSurfaces:[],edgeBands:[],steps:[],ramps:[],surfaces:[],evidence:{photos:PHOTOS,footprints:'unaltered source building/arcade, lake, greens and road widths',surface:'grey-brown herringbone forecourt, quieter gallery slabs and pale stone roadside drainage band',dimensions:'all paving dimensions, local B/C risers and platform extents are photo-informed estimates; no surveyed levels',groundDatum:DATUM,geometryBelowContact:CONTACT_GAP,parkingForecourtRaised:false,mainSourceId:MAIN,arcadeSourceId:ARCADE,roadSourceId:ROAD}};
  const bridge=plan.arcadePolygons[0]?.[0]?.slice(0,-1).map(([x,z])=>({x,z})),roadLine=sourceLines(road)[0];
  if(!bridge?.length||!roadLine?.length||!main)return plan;
  const anchor=bridge[0],end=bridge[5]||bridge.reduce((a,b)=>b.z>a.z?b:a),length=Math.hypot(end.x-anchor.x,end.z-anchor.z),tx=(end.x-anchor.x)/length,tz=(end.z-anchor.z)/length,nx=tz,nz=-tx;
  const station=p=>(p.x-anchor.x)*tx+(p.z-anchor.z)*tz,at=(s,n)=>({x:anchor.x+tx*s+nx*n,z:anchor.z+tz*s+nz*n});
  const stations=bridge.map(station),min=Math.min(...stations),max=Math.max(...stations);
  function section(s){const cuts=[];for(let i=0;i<bridge.length;i++){const a=bridge[i],b=bridge[(i+1)%bridge.length],sa=station(a),sb=station(b);if((sa<=s&&sb>s)||(sb<=s&&sa>s)){const p=mix(a,b,(s-sa)/(sb-sa));cuts.push((p.x-anchor.x)*nx+(p.z-anchor.z)*nz);}}cuts.sort((a,b)=>a-b);return cuts.length>=2?{back:cuts[0],front:cuts.at(-1)}:null;}
  plan.axis={anchor:{...anchor},tx,tz,nx,nz,min,max};
  const nearestRoad=p=>{let best=null;for(let i=1;i<roadLine.length;i++){const a=roadLine[i-1],b=roadLine[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(l2||1))),q=mix(a,b,t),d=Math.hypot(p.x-q.x,p.z-q.z);if(!best||d<best.distance)best={...q,distance:d};}return best;};
  const critical=[min+.001,...stations.filter(s=>s>min+.001&&s<max-.001),max-.001].sort((a,b)=>a-b).filter((s,i,a)=>!i||s-a[i-1]>.001);
  const front=critical.map(s=>{const cut=section(s);return cut&&at(s,cut.front);}).filter(Boolean),envelope=[];
  for(let i=1;i<front.length;i++)envelope.push(poly([front[i-1],front[i],nearestRoad(front[i]),nearestRoad(front[i-1])]));
  // The photographed A east doorway belongs to the source end-wall edge,
  // outside the curved arcade envelope. Connect that existing frontage to its
  // adjacent source service/lakeside roads at the LOW forecourt datum.
  const eastIndices=[[114.4221113,30.5161631],[114.4221485,30.5163435]].map(c=>main.feature?.geometry?.coordinates?.[0]?.findIndex(p=>Math.abs(p[0]-c[0])<1e-7&&Math.abs(p[1]-c[1])<1e-7));
  const mainRing=sourcePolygons(main)[0]?.[0],motorSegments=(model.roads||[]).filter(r=>getRoadProfile(r.feature).motor).flatMap(r=>sourceLines(r).flatMap(line=>line.slice(1).map((b,i)=>({a:line[i],b}))));
  const closestMotor=(p,outward)=>{let best=null;for(const {a,b}of motorSegments){const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(l2||1))),q=mix(a,b,t),d=Math.hypot(p.x-q.x,p.z-q.z);if(outward&&(q.x-p.x)*outward.x+(q.z-p.z)*outward.z<.5)continue;if(!best||d<best.distance)best={...q,distance:d};}return best;};
  let entryEnvelope=[];
  if(eastIndices.every(i=>Number.isInteger(i)&&i>=0)&&mainRing){const [a,b]=eastIndices.map(i=>({x:mainRing[i][0],z:mainRing[i][1]})),l=Math.hypot(b.x-a.x,b.z-a.z),outward={x:-(b.z-a.z)/l,z:(b.x-a.x)/l},mid=mix(a,b,.5);if(contains(mid.x+outward.x*.5,mid.z+outward.z*.5,sourcePolygons(main))){outward.x*=-1;outward.z*=-1;}const aa=closestMotor(a,outward),bb=closestMotor(b,outward);if(aa&&bb){entryEnvelope=poly([a,b,bb,aa]);envelope.push(entryEnvelope);plan.evidence.entryApproach='photo-estimated low paving between the unchanged A east source end-wall and adjacent mapped roads on its OUTWARD side; existing seven-step geometry retained';}}
  const roadCuts=(model.roads||[]).flatMap(r=>{if(r.shapes?.length)return[sourcePolygons(r)];const width=getRoadProfile(r.feature).width;return sourceLines(r).flatMap(line=>ribbon(line,width+.04));});
  const sourceCuts=records.filter(r=>['green','water'].includes(r.category)).map(sourcePolygons).filter(p=>p.length);
  const mainPolygons=sourcePolygons(main),forecourtEnvelope=union(envelope);
  const entryCuts=plan.existingEntrySurfaces.map(s=>[[s.polygon.map(p=>[p.x,p.z]),...(s.holes||[]).map(r=>r.map(p=>[p.x,p.z]))]]);
  plan.forecourtPolygons=difference(forecourtEnvelope,mainPolygons,...sourceCuts,...roadCuts,...entryCuts);
  plan.entryApproachPolygons=intersection(plan.forecourtPolygons,entryEnvelope);
  const arcadeCuts=sourceCuts.length?difference(plan.arcadePolygons,...sourceCuts):plan.arcadePolygons;
  plan.arcadePolygons=arcadeCuts;
  const ground=union([plan.forecourtPolygons,plan.arcadePolygons]);
  const roadWidth=getRoadProfile(road.feature).width,outer=union(ribbon(roadLine,roadWidth+1.08)),inner=union(ribbon(roadLine,roadWidth+.08));
  plan.edgeBands=intersection(difference(outer,inner),plan.forecourtPolygons);
  const wings=difference(mainPolygons,sourcePolygons(arcade)).map(p=>{const r=p[0].slice(0,-1),centre=r.reduce((a,p)=>({x:a.x+p[0]/r.length,z:a.z+p[1]/r.length}),{x:0,z:0});return{polygons:[p],centre};}).sort((a,b)=>a.centre.z-b.centre.z);
  const sourceId=ARCADE;
  function surface(polygons,y0,y1,s0,s1,kind,id,extra={}){
    if(!polygons.length||area(polygons)<.001)return null;
    const item={id,sourceId,kind,polygons,startSurfaceY:y0,endSurfaceY:y1,surfaceY:(y0+y1)/2,start:s0,end:s1,estimated:true,...extra};plan.surfaces.push(item);
    for(const [j,p]of polygons.entries())plan.walkSurfaces.push({id:`${id}/${j}`,sourceId,kind,platformId:extra.platformId,side:extra.side,step:extra.step,polygon:p[0].map(([x,z])=>({x,z})),holes:p.slice(1).map(r=>r.map(([x,z])=>({x,z}))),surfaceY:item.surfaceY,estimated:true,evidence:'local photo-informed B/C grade estimate; not surveyed'});
    return item;
  }
  surface(plan.forecourtPolygons,DATUM,DATUM,min,max,'forecourt','east-nine-forecourt-paving');
  surface(plan.arcadePolygons,DATUM,DATUM,min,max,'gallery','east-nine-gallery-paving');
  for(const [wing,index,plateauWidth,transition,stepCount]of[['B',1,14,6,4],['C',2,8,5,3]]){
    if(!wings[index])continue;
    const centre=station(wings[index].centre),plateauStart=Math.max(min+8,centre-plateauWidth/2),plateauEnd=Math.min(max-8,centre+plateauWidth/2),start=Math.max(min+3,plateauStart-transition),finish=Math.min(max-3,plateauEnd+transition),rise=stepCount*RISER;
    if(plateauEnd<=plateauStart||start>=finish)continue;
    const platformId=`east-nine-${wing.toLowerCase()}-gallery-platform`,height=s=>DATUM+rise*Math.max(0,Math.min(1,(s-start)/(plateauStart-start),(finish-s)/(finish-plateauEnd)));
    const entry={id:platformId,wing,sourceId,start,end:finish,plateauStart,plateauEnd,rise,stepCount,surfaceY:DATUM+rise,estimated:true,frontage:[],polygons:[],rampGap:null};
    // A central gap is created only if the WHOLE low-slope approach fits the
    // source-constrained forecourt. It cannot eat into a green or the roadway.
    const rampWidth=3.0,rampDepth=rise*12;
    for(const shift of[0,-2.2,2.2]){const a=centre+shift-rampWidth/2,b=a+rampWidth,ca=section(a),cb=section(b);if(!ca||!cb||a<plateauStart+.2||b>plateauEnd-.2)continue;
      const q=poly([at(a,ca.front+.9),at(b,cb.front+.9),at(b,cb.front+.9+rampDepth),at(a,ca.front+.9+rampDepth)]),cut=intersection(q,ground);
      if(area(cut)>=area(q)*.999){entry.rampGap={start:a,end:b,width:rampWidth,depth:rampDepth,polygons:cut,slope:1/12};break;}
    }
    const values=[start,plateauStart,plateauEnd,finish,...stations.filter(s=>s>start&&s<finish),...(entry.rampGap?[entry.rampGap.start,entry.rampGap.end]:[])];
    for(let s=start+.28;s<finish;s+=.28)if(s<plateauStart||s>plateauEnd)values.push(s);values.sort((a,b)=>a-b);
    const samples=values.filter((s,i,a)=>!i||s-a[i-1]>.0001),parts=[];
    for(let i=1;i<samples.length;i++){
      const a=samples[i-1],b=samples[i],ca=section(a),cb=section(b);if(!ca||!cb)continue;
      const y0=height(a),y1=height(b),middle=(a+b)/2,backRun=stepCount*TREAD;
      const deck=intersection(poly([at(a,ca.back+backRun),at(b,cb.back+backRun),at(b,cb.front+.9),at(a,ca.front+.9)]),ground);
      const slab=surface(deck,y0,y1,a,b,'gallery-platform',`${platformId}/deck-${i}`,{platformId});if(slab)parts.push(deck);
      entry.frontage.push({a:at(a,ca.front+.9),b:at(b,cb.front+.9),startSurfaceY:y0,endSurfaceY:y1});
      const frontGap=entry.rampGap&&middle>entry.rampGap.start&&middle<entry.rampGap.end;
      for(const side of['front','rear'])for(let step=1;step<=stepCount;step++){
        if(side==='front'&&frontGap)continue;
        const lo=side==='front'?.9+(stepCount-step)*TREAD:(step-1)*TREAD,hi=lo+TREAD;
        const aa=side==='front'?ca.front:ca.back,bb=side==='front'?cb.front:cb.back;
        const q=intersection(poly([at(a,aa+lo),at(b,bb+lo),at(b,bb+hi),at(a,aa+hi)]),ground),h0=DATUM+(y0-DATUM)*step/stepCount,h1=DATUM+(y1-DATUM)*step/stepCount;
        const tread=surface(q,h0,h1,a,b,'step',`${platformId}/${side}-${step}-${i}`,{platformId,side,step,stepCount,nose:{a:at(a,aa+(side==='front'?hi:lo)),b:at(b,bb+(side==='front'?hi:lo))}});
        if(tread){plan.steps.push(tread);parts.push(q);}
      }
    }
    if(entry.rampGap){const gap=entry.rampGap,a=gap.start,b=gap.end,ca=section(a),cb=section(b),n=Math.ceil(gap.depth/.28);
      for(let j=0;j<n;j++){const lo=j/n*gap.depth,hi=(j+1)/n*gap.depth,y0=DATUM+rise*(1-lo/gap.depth),y1=DATUM+rise*(1-hi/gap.depth),q=intersection(poly([at(a,ca.front+.9+lo),at(b,cb.front+.9+lo),at(b,cb.front+.9+hi),at(a,ca.front+.9+hi)]),ground);
        const ramp=surface(q,y0,y1,a,b,'access-ramp',`${platformId}/front-ramp-${j}`,{platformId,acrossSlope:{a:at(a,ca.front+.9+lo),b:at(a,ca.front+.9+hi),c:at(b,cb.front+.9+lo)}});if(ramp){plan.ramps.push(ramp);parts.push(q);}
      }
    }
    entry.polygons=union(parts);plan.galleryPlatforms.push(entry);
  }
  // End transitions use the same strips as the platform and stair surfaces,
  // with a continuous longitudinal slope instead of retaining-wall dead ends.
  for(const p of plan.galleryPlatforms)plan.ramps.push(...plan.surfaces.filter(s=>s.platformId===p.id&&Math.abs(s.startSurfaceY-s.endSurfaceY)>.00001));
  plan.heightAt=(x,z)=>heightAtEastNineGround(plan,x,z);
  return plan;
}

function groundMaterials(THREE,surfaces){
  const textures=[],materials=[],size=512,tile=2.4,fract=x=>x-Math.floor(x),hash=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453),byte=x=>Math.max(0,Math.min(255,Math.round(x)));
  function texture(data,color){const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(1/tile,1/tile);t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;t.generateMipmaps=true;t.anisotropy=8;if(color)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;textures.push(t);return t;}
  function paving(herring){const color=new Uint8Array(size*size*4),bump=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const u=x/size,v=y/size;let edge,idX,idY;
      if(herring){const px=u*20,py=v*20,ix=Math.floor(px),iy=Math.floor(py),phase=((ix-iy)%4+4)%4,horizontal=phase<2,bx=ix-(phase===1?1:0),by=iy-(phase===2?1:0),fx=px-bx,fy=py-by;edge=(horizontal?Math.min(fx,2-fx,fy,1-fy):Math.min(fx,1-fx,fy,2-fy))*.12;idX=bx;idY=by;}
      else{const px=u*4,py=v*6,ix=Math.floor(px),iy=Math.floor(py);edge=Math.min(fract(px)*.6,(1-fract(px))*.6,fract(py)*.4,(1-fract(py))*.4);idX=ix;idY=iy;}
      const seam=edge<.0028,grain=(hash(x,y)-.5)*5,variation=(hash((idX+20)%20,(idY+20)%20)-.5)*(herring?13:7),n=(seam?(herring?94:123):(herring?143:163))+variation+grain,at=(y*size+x)*4;
      color.set([byte(n+2),byte(n),byte(n-(herring?5:3)),255],at);const h=seam?112:156+grain;bump.set([byte(h),byte(h),byte(h),255],at);
    }
    const m=new THREE.MeshStandardMaterial({name:herring?'东九前场灰褐人字小砖':'柱廊灰石铺装',map:texture(color,true),bumpMap:texture(bump,false),bumpScale:herring?.006:.0035,roughness:.91});m.userData={estimated:true,tileMetres:tile,brickMetres:herring?[.24,.12]:[.6,.4],jointMetres:.0056,displacement:false};materials.push(m);return m;
  }
  const pavers=paving(true),gallery=paving(false);
  const stone=surfaces?.concrete?.clone()||new THREE.MeshStandardMaterial();stone.name='浅灰踏步与排水铺石';stone.color.set(surfaces?.concrete?'#f1f1e9':'#b8b9b0');stone.roughness=.92;materials.push(stone);
  const edge=gallery.clone();edge.name='沿路浅灰分缝石带';edge.color.set('#ffffff');materials.push(edge);
  const nose=new THREE.MeshStandardMaterial({color:'#92978e',roughness:.96});materials.push(nose);
  return{pavers,gallery,stone,edge,nose,dispose(){materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());}};
}

export function createEastNineGround(THREE,model,{surfaces,entrySurfaces=[]}={}){
  const plan=planEastNineGround(model,{entrySurfaces}),group=new THREE.Group();group.name='东九楼下 · 铺装、局部平台与浅阶';
  group.userData={component:'east-nine-ground',...plan.evidence,estimated:true,sourceFootprintPreserved:true,platforms:plan.galleryPlatforms.map(p=>({id:p.id,wing:p.wing,rise:p.rise,stepCount:p.stepCount,start:p.start,end:p.end,centralRamp:!!p.rampGap}))};
  const materials=groundMaterials(THREE,surfaces),batches=new Map(),geometries=new Set();
  const axis=plan.axis||{anchor:{x:0,z:0},tx:0,tz:1,nx:1,nz:0};
  function bake(g,material){const flat=g.index?g.toNonIndexed():g;if(flat!==g)g.dispose();flat.computeVertexNormals();const p=flat.attributes.position,n=flat.attributes.normal,uv=new Float32Array(p.count*2);
    for(let i=0;i<p.count;i++){if(Math.abs(n.getY(i))>.6){uv[i*2]=p.getX(i)*axis.nx+p.getZ(i)*axis.nz;uv[i*2+1]=p.getX(i)*axis.tx+p.getZ(i)*axis.tz;}else{uv[i*2]=Math.abs(n.getX(i))>Math.abs(n.getZ(i))?p.getZ(i):p.getX(i);uv[i*2+1]=p.getY(i);}}
    flat.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));if(!batches.has(material))batches.set(material,[]);batches.get(material).push(flat);
  }
  const topHeight=(item,p)=>surfaceTopAt(plan,item,p);
  function surfaceMesh(item,material,vertical=true){
    for(const polygon of item.polygons){const outer=polygon[0].map(([x,z])=>new THREE.Vector2(x,z)),holes=polygon.slice(1).map(r=>r.map(([x,z])=>new THREE.Vector2(x,z))),triangles=THREE.ShapeUtils.triangulateShape(outer,holes),all=[...outer,...holes.flat()],positions=[];
      for(const tri of triangles){const p=tri.map(i=>({x:all[i].x,z:all[i].y})),cross=(p[1].x-p[0].x)*(p[2].z-p[0].z)-(p[1].z-p[0].z)*(p[2].x-p[0].x);if(cross>0)[p[1],p[2]]=[p[2],p[1]];for(const v of p)positions.push(v.x,topHeight(item,v),v.z);}
      if(vertical&&item.surfaceY>DATUM+.03)for(const ring of polygon)for(let i=1;i<ring.length;i++){const a={x:ring[i-1][0],z:ring[i-1][1]},b={x:ring[i][0],z:ring[i][1]},ha=topHeight(item,a),hb=topHeight(item,b);for(const [p,y]of[[a,.11],[a,ha],[b,.11],[a,ha],[b,hb],[b,.11]])positions.push(p.x,y,p.z);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));bake(g,material);
    }
  }
  for(const item of plan.surfaces){const material=item.kind==='forecourt'?materials.pavers:item.kind==='step'?materials.stone:materials.gallery;surfaceMesh(item,material);}
  if(plan.edgeBands.length)surfaceMesh({polygons:plan.edgeBands,start:0,end:1,startSurfaceY:DATUM+.004,endSurfaceY:DATUM+.004,surfaceY:DATUM+.004},materials.edge,false);
  // A narrow stone nose and occasional transverse seam give the long steps
  // depth at walking height; no geometry noise changes the flat forecourt.
  for(const item of plan.steps){if(!item.nose||item.surfaceY<DATUM+.065)continue;const {a,b}=item.nose,dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);if(l<.03)continue;
    const sign=item.side==='front'?1:-1,nx=-dz/l,nz=dx/l,aa={x:a.x+dx/l*.008+nx*sign*.036,z:a.z+dz/l*.008+nz*sign*.036},bb={x:b.x-dx/l*.008+nx*sign*.036,z:b.z-dz/l*.008+nz*sign*.036};
    const corners=[{x:aa.x+nx*.021,z:aa.z+nz*.021},{x:bb.x+nx*.021,z:bb.z+nz*.021},{x:bb.x-nx*.021,z:bb.z-nz*.021},{x:aa.x-nx*.021,z:aa.z-nz*.021}];
    // Keep noses wholly inside the tread. Re-clipping a 4 cm strip on the
    // exact source edge creates unnecessary near-coincident sliver polygons.
    if(corners.every(p=>contains(p.x,p.z,item.polygons)))surfaceMesh({...item,polygons:poly(corners),startSurfaceY:item.startSurfaceY+.003,endSurfaceY:item.endSurfaceY+.003},materials.nose,false);
  }
  for(const [material,parts]of batches){const geometry=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());geometries.add(geometry);const mesh=new THREE.Mesh(geometry,material);mesh.name=material.name||'踏步鼻口';mesh.receiveShadow=true;mesh.castShadow=false;mesh.renderOrder=203;mesh.userData={component:'east-nine-ground-surface',estimated:true,sourceIds:[MAIN,ARCADE,ROAD],materialEvidence:plan.evidence.surface};group.add(mesh);}
  const infrastructure={walkSurfaces:plan.walkSurfaces,barriers:[]};let disposed=false;
  return{group,plan,infrastructure,heightAt:(x,z)=>heightAtEastNineGround(plan,x,z),surfaceHeightAt:(x,z)=>surfaceHeightAtEastNineGround(plan,x,z),dispose(){if(disposed)return;disposed=true;group.removeFromParent();geometries.forEach(g=>g.dispose());materials.dispose();group.clear();}};
}
