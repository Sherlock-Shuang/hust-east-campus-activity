import clipping from 'polygon-clipping';
import { applyWorldUV } from './surface-materials.js';
import { getRoadProfile } from './building-profiles.js';

const EAST_FIELD = 'way/1023821172', COURTS = 'way/98867870', STAND = 'way/103488176';
const PHOTO = 'https://www.sohu.com/a/421773661_673149';
const mix = (a,b,t) => ({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
const length = (a,b) => Math.hypot(b.x-a.x,b.z-a.z);
const ringOf = shape => {
  const p=shape.getPoints(1).map(v=>({x:v.x,z:-v.y}));
  if(p.length>1&&length(p[0],p.at(-1))<.001)p.pop();return p;
};
const poly = ring => [ring.map(p=>[p.x,p.z])];
function signedArea(ring){return ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0)/2;}
export function sportsOffsetRing(ring,distance){
  const sign=Math.sign(signedArea(ring))||1;
  return ring.map((p,i)=>{
    const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];
    const al=length(a,p),bl=length(p,b),an={x:sign*(p.z-a.z)/al,z:-sign*(p.x-a.x)/al},bn={x:sign*(b.z-p.z)/bl,z:-sign*(b.x-p.x)/bl};
    const d=Math.max(.2,1+an.x*bn.x+an.z*bn.z);
    return{x:p.x+(an.x+bn.x)*distance/d,z:p.z+(an.z+bn.z)*distance/d};
  });
}
function lineOf(record){
  const line=record?.group?.children.find(child=>child.isLine&&!child.isLineSegments),p=line?.geometry?.attributes.position;
  return p?Array.from({length:p.count},(_,i)=>({x:p.getX(i),z:p.getZ(i)})):[];
}
function nearest(ring,p){
  let best={distance:Infinity};
  for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],l=length(a,b),t=Math.max(0,Math.min(1,((p.x-a.x)*(b.x-a.x)+(p.z-a.z)*(b.z-a.z))/(l*l))),q=mix(a,b,t),d=length(p,q);if(d<best.distance)best={point:q,edge:i,t,distance:d};}
  return best;
}
function rectangle(a,b,width){const l=length(a,b),nx=-(b.z-a.z)/l*width/2,nz=(b.x-a.x)/l*width/2;return[{x:a.x+nx,z:a.z+nz},{x:b.x+nx,z:b.z+nz},{x:b.x-nx,z:b.z-nz},{x:a.x-nx,z:a.z-nz}];}
function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p.z)!==(b[1]>p.z)&&p.x<(b[0]-a[0])*(p.z-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function obstaclesForKerb(a,b,paving){return[0,.5,1].every(t=>{const p=mix(a,b,t);return[[.18,0],[-.18,0],[0,.18],[0,-.18]].some(([dx,dz])=>{const q={x:p.x+dx,z:p.z+dz};return paving.some(poly=>inRing(q,poly[0])&&!poly.slice(1).some(h=>inRing(q,h)));});});}
function pointOnRing(ring,fraction){let total=0;const edges=ring.map((a,i)=>{const l=length(a,ring[(i+1)%ring.length]);total+=l;return l;});let s=total*fraction;for(let i=0;i<edges.length;i++){if(s<=edges[i])return mix(ring[i],ring[(i+1)%ring.length],s/edges[i]);s-=edges[i];}return ring[0];}

/** Footprints are the captured OSM polygons. Gate locations, fence heights,
 * path widths and stand elevations are explicitly modelled estimates. */
export function planSportsInfrastructure(model){
  const byId=new Map((model?.records||[]).map(r=>[r.id,r])),enclosures=[],barriers=[],walkSurfaces=[];
  const obstacles=(model?.records||[]).filter(r=>['water','building'].includes(r.category)).flatMap(r=>(r.shapes||[]).map(shape=>[ringOf(shape).map(p=>[p.x,p.z]),...shape.holes.map(h=>ringOf(h).map(p=>[p.x,p.z]))]));
  for(const record of model?.roads||[]){const profile=getRoadProfile(record.feature);if(!profile.motor)continue;const line=lineOf(record);for(let i=1;i<line.length;i++)if(length(line[i-1],line[i])>.01)obstacles.push(poly(rectangle(line[i-1],line[i],profile.width+.16)));}
  for(const id of[EAST_FIELD,COURTS]){
    const record=byId.get(id);if(!record?.shapes?.length)continue;
    const ring=ringOf(record.shapes[0]);if(ring.length<3)continue;
    const minZ=Math.min(...ring.map(p=>p.z)),maxZ=Math.max(...ring.map(p=>p.z)),gates=[];
    if(id===EAST_FIELD){
      for(const [sourceId,index,width]of[['way/1528957939',0,4.4],['way/1483567184',1,4.4]]){
        const p=lineOf(byId.get(sourceId))[index];if(!p)continue;const near=nearest(ring,p);gates.push({...near,width,sourceId,approach:p,estimated:true});
      }
      const north=lineOf(byId.get('way/1483567245'));
      if(north.length){const p=mix(north[0],north[1],.5),near=nearest(ring,p);gates.push({...near,width:4.4,sourceId:'way/1483567245',approach:p,approachY:1.04,estimated:true});}
    }else{
      // The local roadside photo establishes the western court frontage; two
      // open passages are modelling assumptions, not surveyed door locations.
      let west=0;for(let i=1;i<ring.length;i++)if((ring[i].x+ring[(i+1)%ring.length].x)<(ring[west].x+ring[(west+1)%ring.length].x))west=i;
      for(const t of[.23,.78])gates.push({edge:west,t,point:mix(ring[west],ring[(west+1)%ring.length],t),width:3.8,estimated:true});
    }
    let perimeter=0;const starts=ring.map((a,i)=>{const start=perimeter;perimeter+=length(a,ring[(i+1)%ring.length]);return start;});
    for(const gate of gates){gate.progress=starts[gate.edge]+gate.t*length(ring[gate.edge],ring[(gate.edge+1)%ring.length]);gate.ends=[-1,1].map(sign=>pointOnRing(ring,((gate.progress+sign*gate.width/2+perimeter)%perimeter)/perimeter));}
    const panels=[];
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length],l=length(a,b);if(l<.01)continue;
      const cuts=gates.flatMap(g=>[-perimeter,0,perimeter].map(shift=>[Math.max(0,g.progress+shift-starts[i]-g.width/2),Math.min(l,g.progress+shift-starts[i]+g.width/2)])).filter(([lo,hi])=>hi>lo).sort((a,b)=>a[0]-b[0]);
      let start=0;const sections=[];for(const [lo,hi]of cuts){if(lo>start)sections.push([start,lo]);start=Math.max(start,hi);}if(start<l)sections.push([start,l]);
      for(const [lo,hi]of sections){const n=Math.ceil((hi-lo)/2.65);for(let j=0;j<n;j++){
        const aa=mix(a,b,(lo+(hi-lo)*j/n)/l),bb=mix(a,b,(lo+(hi-lo)*(j+1)/n)/l),north=(aa.z+bb.z)/2<minZ+30;
        const height=id===COURTS?3.5:north?1.65:1.85;
        const panel={a:aa,b:bb,height,base:id===COURTS?.26:north?.48:.28,colour:id===COURTS?'#345e50':north?'#a2a8a2':'#526d60',sourceId:id};panels.push(panel);
        barriers.push({polygon:rectangle(aa,bb,.19),minHeight:.02,height,label:'操场围栏',sourceId:id});
      }}
    }
    // An outside paved strip follows the source perimeter, never the axis-
    // aligned bounding box. Clip building/water footprints out of its area.
    let paving=clipping.difference(poly(sportsOffsetRing(ring,2.7)),poly(sportsOffsetRing(ring,.22)));
    for(const obstacle of obstacles)paving=clipping.difference(paving,obstacle);
    for(const polygon of paving)walkSurfaces.push({polygon:polygon[0].map(([x,z])=>({x,z})),holes:polygon.slice(1).map(r=>r.map(([x,z])=>({x,z}))),surfaceY:.14});
    const connectors=[];
    for(const gate of gates){
      if(!gate.approach||length(gate.point,gate.approach)<.3)continue;
      const a=gate.point,b=gate.approach,l=length(a,b),parts=Math.max(1,Math.ceil(l/.7));
      for(let j=0;j<parts;j++){const aa=mix(a,b,j/parts),bb=mix(a,b,(j+1)/parts),y0=.12+((gate.approachY??.14)-.14)*j/parts,y1=.12+((gate.approachY??.14)-.14)*(j+1)/parts;
        connectors.push({a:aa,b:bb,y0,y1,width:3.2});walkSurfaces.push({polygon:rectangle(aa,bb,3.2),surfaceY:Math.max(y0,y1)+.02});
      }
    }
    enclosures.push({id,ring,gates,panels,paving,connectors,minZ,maxZ});
  }
  const standRecord=byId.get(STAND);let stand=null;
  if(standRecord?.shapes?.length&&byId.has(EAST_FIELD)){
    const ring=ringOf(standRecord.shapes[0]);
    if(ring.length===4){
      let longest=0;for(let i=1;i<4;i++)if(length(ring[i],ring[(i+1)%4])>length(ring[longest],ring[(longest+1)%4]))longest=i;
      let a=ring[longest],b=ring[(longest+1)%4],c=ring[(longest+2)%4],d=ring[(longest+3)%4];
      if((a.x+b.x)<(c.x+d.x))[a,b,c,d]=[d,c,b,a];
      const span=length(a,b),depth=length(a,d),at=(s,t)=>mix(mix(a,b,s),mix(d,c,s),t);
      stand={id:STAND,ring,a,b,c,d,span,depth,at,rows:6,rise:.3,aisles:[.04,.34,.66,.96],estimated:true};
      let last=0;const sections=[];for(const a of stand.aisles){sections.push([last,a-.75/span]);last=a+.75/span;}sections.push([last,1]);
      for(let row=0;row<6;row++)for(const [lo,hi]of sections)if(hi>lo)walkSurfaces.push({polygon:[at(lo,row/6),at(hi,row/6),at(hi,(row+1)/6),at(lo,(row+1)/6)],surfaceY:.14+(row+1)*.3});
      // Half-height steps replace terraces inside the four circulation aisles.
      for(const s of stand.aisles)for(let step=0;step<12;step++)walkSurfaces.push({polygon:[at(s-.75/span,step/12),at(s+.75/span,step/12),at(s+.75/span,(step+1)/12),at(s-.75/span,(step+1)/12)],surfaceY:.14+(step+1)*.15});
    }
  }
  return{enclosures,stand,barriers,walkSurfaces,replacedBuildingIds:stand?[STAND]:[],estimated:true};
}

export function createSportsInfrastructure(THREE,model,{surfaces}={}){
  const plan=planSportsInfrastructure(model),group=new THREE.Group();group.name='东操场与路东篮球场 · 围栏、入口、步道与低看台';
  group.userData={category:'sports-infrastructure',estimated:true,photoSource:PHOTO,footprintBasis:'unmodified source polygon',dimensionBasis:'photo-informed estimates; no surveyed fence alignment, heights or gates'};
  const ownedGeometry=new Set(),ownedMaterials=new Set(),ownedTextures=new Set(),batches=new Map(),counts={fencePanels:0,fencePosts:0,gateOpenings:0,pavedAreas:0,seats:0,standSteps:0};
  const box=new THREE.BoxGeometry(1,1,1);ownedGeometry.add(box);
  const standard=(colour,name)=>{const material=new THREE.MeshStandardMaterial({color:colour,roughness:.86,metalness:.06,name});ownedMaterials.add(material);return material;};
  const stone=standard('#b0ada4','浅灰石路缘'),brick=standard('#8a7166','低矮砖红基座'),paving=surfaces?.paving?.clone()||standard('#b4b4a8','灰砖人行道');ownedMaterials.add(paving);
  const dark=standard('#495b54','绿色框架'),white=standard('#c3c7bf','浅灰栏杆'),seatMats=['#728ba0','#c9bd80','#b6717c'].map(c=>standard(c,'低看台彩色座椅'));
  const rgba=new Uint8Array(64*64*4);for(let y=0;y<64;y++)for(let x=0;x<64;x++){const i=(y*64+x)*4,v=x<2||y<2;rgba[i]=rgba[i+1]=rgba[i+2]=v?255:0;rgba[i+3]=255;}
  const wireTexture=new THREE.DataTexture(rgba,64,64,THREE.RGBAFormat);wireTexture.wrapS=wireTexture.wrapT=THREE.RepeatWrapping;wireTexture.magFilter=THREE.LinearFilter;wireTexture.minFilter=THREE.LinearMipmapLinearFilter;wireTexture.generateMipmaps=true;wireTexture.needsUpdate=true;ownedTextures.add(wireTexture);
  const netMats=new Map();function netMaterial(colour){if(netMats.has(colour))return netMats.get(colour);const m=standard(colour,'透空焊接细网片');m.alphaMap=wireTexture;m.alphaTest=.28;m.side=THREE.DoubleSide;netMats.set(colour,m);return m;}
  function instance(key,material,x,y,z,sx,sy,sz,yaw=0){if(!batches.has(key))batches.set(key,{material,matrices:[]});const m=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(sx,sy,sz));batches.get(key).matrices.push(m);}
  function beam(key,material,a,b,y,width=.05,height=.05){const l=length(a,b);if(l>.001)instance(key,material,(a.x+b.x)/2,y,(a.z+b.z)/2,l,height,width,-Math.atan2(b.z-a.z,b.x-a.x));}
  function mesh(geometry,material,name){ownedGeometry.add(geometry);const m=new THREE.Mesh(geometry,material);m.name=name;m.receiveShadow=true;group.add(m);return m;}
  function surface(polygons,y,material,name){const shapes=polygons.map(p=>{const s=new THREE.Shape(p[0].map(([x,z])=>new THREE.Vector2(x,-z)));for(const r of p.slice(1))s.holes.push(new THREE.Path(r.map(([x,z])=>new THREE.Vector2(x,-z))));return s;});if(!shapes.length)return;const m=mesh(applyWorldUV(new THREE.ShapeGeometry(shapes),1,'xy'),material,name);m.rotation.x=-Math.PI/2;m.position.y=y;return m;}
  const netPositions=new Map();function net(panel){const {a,b,height,base,colour}=panel,l=length(a,b),h=height-base,items=netPositions.get(colour)||{positions:[],uv:[],indices:[]},o=items.positions.length/3;
    items.positions.push(a.x,base,a.z,b.x,base,b.z,b.x,height,b.z,a.x,height,a.z);items.uv.push(0,0,l/.09,0,l/.09,h/.09,0,h/.09);items.indices.push(o,o+1,o+2,o,o+2,o+3);netPositions.set(colour,items);
  }
  for(const enclosure of plan.enclosures){
    counts.gateOpenings+=enclosure.gates.length;counts.pavedAreas+=enclosure.paving.length;
    const path=surface(enclosure.paving,.12,paving,'源边界外侧灰砖步道');if(path)path.userData={sourceId:enclosure.id,widthEstimate:2.48};
    for(const p of enclosure.panels){
      counts.fencePanels++;const frame=p.colour==='#a2a8a2'?white:dark;
      beam('fence-plinth-'+(p.base>.4?'brick':'stone'),p.base>.4?brick:stone,p.a,p.b,p.base/2,.22,p.base);
      for(const at of[p.a,p.b]){instance('fence-post-'+p.colour,frame,at.x,p.height/2,at.z,.075,p.height,.075);instance('post-caps-'+p.colour,frame,at.x,p.height+.025,at.z,.095,.05,.095);counts.fencePosts++;}
      beam('fence-top-'+p.colour,frame,p.a,p.b,p.height-.035,.048,.055);beam('fence-bottom-'+p.colour,frame,p.a,p.b,p.base+.05,.045,.045);
      if(p.height>3)beam('fence-middle',dark,p.a,p.b,1.85,.04,.045);
      net(p);
    }
    for(const gate of enclosure.gates){
      const edgeA=enclosure.ring[gate.edge],edgeB=enclosure.ring[(gate.edge+1)%enclosure.ring.length],l=length(edgeA,edgeB),dx=(edgeB.x-edgeA.x)/l,dz=(edgeB.z-edgeA.z)/l;
      for(const end of gate.ends)instance('gate-piers',stone,end.x,.67,end.z,.25,1.34,.25);
      // Flush threshold: no plinth/rail spans a passable entrance.
      beam('gate-threshold',stone,{x:gate.point.x-dx*gate.width/2,z:gate.point.z-dz*gate.width/2},{x:gate.point.x+dx*gate.width/2,z:gate.point.z+dz*gate.width/2},.075,.8,.15);
    }
    for(const c of enclosure.connectors){
      const r=rectangle(c.a,c.b,c.width),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(r.flatMap((p,i)=>[p.x,(i===0||i===3)?c.y0:c.y1,p.z]),3));g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();mesh(applyWorldUV(g,1,'xz'),paving,'入口坡道连接');
    }
    // Individual outer kerbs include joints; entrances remain open across the
    // full width of the perimeter walk. Surface paving supplies brick joints.
    const outer=sportsOffsetRing(enclosure.ring,2.7);
    for(let i=0;i<outer.length;i++){const a=outer[i],b=outer[(i+1)%outer.length],l=length(a,b),n=Math.ceil(l/1.15);for(let j=0;j<n;j++){
      const aa=mix(a,b,(j+.02)/n),bb=mix(a,b,(j+.98)/n),mid=mix(aa,bb,.5);if(enclosure.gates.some(g=>length(g.point,mid)<g.width/2+3))continue;
      if(obstaclesForKerb(aa,bb,enclosure.paving))beam('walk-kerbs',stone,aa,bb,.12,.16,.24);
    }}
  }
  for(const [colour,p]of netPositions){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p.positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(p.uv,2));g.setIndex(p.indices);g.computeVertexNormals();mesh(g,netMaterial(colour),'真实透空网片 · 孔距估计90mm');}
  if(plan.stand){
    const s=plan.stand,span=s.span,at=s.at,yaw=-Math.atan2(s.b.z-s.a.z,s.b.x-s.a.x),depth=s.depth;
    for(let row=0;row<s.rows;row++){
      const y=.12+(row+1)*s.rise;
      // Split terraces around stair aisles, otherwise a full row slab would
      // conceal the half-height steps and produce inaccessible risers.
      let last=0;const sections=[];for(const a of s.aisles){sections.push([last,a-.75/span]);last=a+.75/span;}sections.push([last,1]);
      for(const [lo,hi]of sections){if(hi<=lo)continue;const p=at((lo+hi)/2,(row+.5)/6);instance('stand-concrete',stone,p.x,y/2,p.z,(hi-lo)*span,y,depth/6,yaw);}
      const seats=Math.floor(span/.54);for(let col=1;col<seats;col++){const t=col/seats;if(s.aisles.some(a=>Math.abs(a-t)*span<1.05))continue;const p=at(t,(row+.55)/6),back=at(t,(row+.84)/6),colour=Math.min(2,Math.floor(t*3));
        instance('seat-pan-'+colour,seatMats[colour],p.x,y+.22,p.z,.44,.075,.42,yaw);instance('seat-back-'+colour,seatMats[colour],back.x,y+.43,back.z,.44,.39,.07,yaw);counts.seats++;
      }
    }
    for(const a of s.aisles)for(let step=0;step<12;step++){const p=at(a,(step+.5)/12),h=.12+(step+1)*.15;instance('stand-aisle-step',stone,p.x,h/2,p.z,1.5,h,depth/12,yaw);const q=at(a,step/12+.004);instance('stand-step-nose',white,q.x,h+.008,q.z,1.45,.016,.045,yaw);counts.standSteps++;}
    const backA=at(0,1),backB=at(1,1);beam('stand-back-wall',stone,backA,backB,1.05,.2,2.1);
    const roofCentre=at(.5,.82);instance('stand-low-roof',white,roofCentre.x,4.18,roofCentre.z,span+.18,.16,depth*.36,yaw);
    plan.barriers.push({polygon:rectangle(backA,backB,.2),minHeight:0,height:2.1,label:'看台后墙',sourceId:s.id});
    for(let t=.03;t<1;t+=.095){const p=at(t,.98);instance('stand-roof-column',dark,p.x,3.08,p.z,.09,2.2,.09);plan.barriers.push({polygon:[{x:p.x-.045,z:p.z-.045},{x:p.x+.045,z:p.z-.045},{x:p.x+.045,z:p.z+.045},{x:p.x-.045,z:p.z+.045}],minHeight:1.98,height:4.18,label:'看台棚柱'});}
    plan.barriers.push({polygon:[at(0,.64),at(1,.64),at(1,1),at(0,1)],minHeight:4.1,height:4.26,label:'看台棚顶',sourceId:s.id});
  }
  for(const [key,b]of batches){const m=new THREE.InstancedMesh(box,b.material,b.matrices.length);m.name=key;b.matrices.forEach((matrix,i)=>m.setMatrixAt(i,matrix));m.instanceMatrix.needsUpdate=true;m.castShadow=m.receiveShadow=true;m.computeBoundingSphere();group.add(m);}
  group.userData.counts=counts;
  const east=plan.enclosures.find(e=>e.id===EAST_FIELD),court=plan.enclosures.find(e=>e.id===COURTS);
  const inspections={};
  if(east){const gate=east.gates.find(g=>g.sourceId==='way/1483567245')||{point:pointOnRing(east.ring,.6)},p=gate.point;inspections.field={target:[p.x,1,p.z+26],position:[p.x+33,18,p.z-31]};}
  if(court){const p=court.gates[0].point;inspections.fence={target:[p.x,1.7,p.z],position:[p.x-14,5,p.z+17]};}
  if(plan.stand){const p=plan.stand.at(.35,.5);inspections.stand={target:[p.x,1.4,p.z],position:[p.x+19,8,p.z+15]};}
  let disposed=false;
  return{group,plan,counts,inspections,dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const r of ownedGeometry)r.dispose();for(const r of ownedMaterials)r.dispose();for(const r of ownedTextures)r.dispose();}};
}
