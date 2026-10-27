import {createTreeLayer} from './vegetation.js';
import {getRoadProfile} from './building-profiles.js';
import {waterFootprint} from './water-details.js';
import {planCanteenBoundary} from './yunyuan-canteen.js';

const CANTEEN='way/103814566',DORM='way/103815859';
const PHOTOS=['/references/local-campus/yunyuan-canteen-market.webp','/references/local-campus/yunyuan-food-dorm-junction.webp'];
const distance=(x,z,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/Math.max(1e-12,dx*dx+dz*dz)));return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);};
function edges(record){return(record?.shapes??[]).flatMap(shape=>{const ring=shape.getPoints().map(p=>({x:p.x,z:-p.y}));if(ring.length>1&&Math.hypot(ring[0].x-ring.at(-1).x,ring[0].z-ring.at(-1).z)<1e-7)ring.pop();const winding=ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0)<0?1:-1;
  return ring.map((a,i)=>{const b=ring[(i+1)%ring.length],length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;return{a,b,length,tx,tz,nx:-tz*winding,nz:tx*winding,yaw:-Math.atan2(tz,tx)};}).filter(e=>e.length>1);});}
function outline(p){const samples=[],tx=Math.cos(p.yaw??0),tz=-Math.sin(p.yaw??0),nx=-tz,nz=tx,w=p.width??(p.radius??.5)*2,d=p.depth??(p.radius??.5)*2;
  for(const side of[-1,1]){for(let n=0;n<=Math.ceil(w);n++){const u=(n/Math.ceil(w)-.5)*w,v=side*d/2;samples.push({x:p.x+tx*u+nx*v,z:p.z+tz*u+nz*v});}for(let n=0;n<=Math.ceil(d);n++){const u=side*w/2,v=(n/Math.ceil(d)-.5)*d;samples.push({x:p.x+tx*u+nx*v,z:p.z+tz*u+nz*v});}}
  samples.push({x:p.x,z:p.z});return samples;
}
function overlaps(a,b,margin=.3){const ax=[Math.cos(a.yaw??0),-Math.sin(a.yaw??0)],az=[-ax[1],ax[0]],bx=[Math.cos(b.yaw??0),-Math.sin(b.yaw??0)],bz=[-bx[1],bx[0]],delta=[b.x-a.x,b.z-a.z],dot=(u,v)=>u[0]*v[0]+u[1]*v[1];
  return[ax,az,bx,bz].every(axis=>Math.abs(dot(delta,axis))<Math.abs(dot(ax,axis))*a.width/2+Math.abs(dot(az,axis))*a.depth/2+Math.abs(dot(bx,axis))*b.width/2+Math.abs(dot(bz,axis))*b.depth/2+margin);}

/** Photo-derived local furnishings are registered to source building edges.
 * There is deliberately no exact point claim: candidates are rejected against
 * every building, water polygon and mapped road width before being accepted.
 */
export function planYunyuanForecourt(model,{existingTrees=[]}={}){
  const canteen=model?.buildings?.find(r=>r.id===CANTEEN),dorm=model?.buildings?.find(r=>r.id===DORM);
  const plan={sourceIds:[canteen?.id,dorm?.id].filter(Boolean),sculptures:[],parkingSigns:[],noticeboards:[],greenStrips:[],shrubs:[],trees:[],rejected:0,placementStatus:'photo-registered-estimate',photographs:[...PHOTOS]};
  if(!canteen)return plan;
  const area=waterFootprint(canteen),extent={minX:area.bounds.minX-40,maxX:Math.max(area.bounds.maxX,waterFootprint(dorm??{})?.bounds.maxX??area.bounds.maxX)+20,minZ:area.bounds.minZ-30,maxZ:Math.max(area.bounds.maxZ,waterFootprint(dorm??{})?.bounds.maxZ??area.bounds.maxZ)+25};
  const relevant=f=>f&&f.bounds.maxX>=extent.minX&&f.bounds.minX<=extent.maxX&&f.bounds.maxZ>=extent.minZ&&f.bounds.minZ<=extent.maxZ;
  const rendered=planCanteenBoundary(canteen),renderedFootprint=rendered&&waterFootprint({shapes:[{getPoints:()=>rendered.boundary.map(p=>({x:p.x,y:-p.z})),holes:[]}]}),buildingMasks=(model.buildings??[]).map(waterFootprint).filter(relevant),waterMasks=(model.water??[]).map(waterFootprint).filter(relevant),roadAreas=[],segments=[];
  if(renderedFootprint)buildingMasks.push(renderedFootprint);
  for(const r of model.roads??[]){const footprint=waterFootprint(r);if(relevant(footprint))roadAreas.push(footprint);const width=getRoadProfile(r.feature).width;r.group?.updateWorldMatrix(true,true);
    r.group?.traverse(o=>{if(!o.isLine||o.isLineSegments)return;const p=o.geometry.attributes.position,m=o.matrixWorld.elements,at=i=>({x:m[0]*p.getX(i)+m[4]*p.getY(i)+m[8]*p.getZ(i)+m[12],z:m[2]*p.getX(i)+m[6]*p.getY(i)+m[10]*p.getZ(i)+m[14]});for(let i=1;i<p.count;i++){const a=at(i-1),b=at(i);if(Math.max(a.x,b.x)+width>=extent.minX&&Math.min(a.x,b.x)-width<=extent.maxX&&Math.max(a.z,b.z)+width>=extent.minZ&&Math.min(a.z,b.z)-width<=extent.maxZ)segments.push({a,b,width,sourceId:r.id});}});
  }
  const blocked=(x,z)=>buildingMasks.some(f=>f.contains(x,z)||f.distance(x,z)<.25)||waterMasks.some(f=>f.contains(x,z)||f.distance(x,z)<.4)||roadAreas.some(f=>f.contains(x,z)||f.distance(x,z)<.35)||segments.some(s=>distance(x,z,s.a,s.b)<s.width/2+.4);
  const reservations=[];
  function accept(kind,p,{plant=false,tree=false}={}){
    if(outline(p).some(q=>blocked(q.x,q.z))){plan.rejected++;return false;}
    if(kind==='sculptures'&&rendered&&outline(p).some(q=>[rendered.adjacent,rendered.main].some(path=>path.points.slice(1).some((b,i)=>distance(q.x,q.z,path.points[i],b)<3.1)))){plan.rejected++;return false;}
    if(reservations.some(q=>overlaps(p,q))){plan.rejected++;return false;}
    if(tree&&[...existingTrees,...plan.trees].some(q=>Math.hypot(p.x-q.x,p.z-q.z)<(q.radius??3)+p.radius+1)){plan.rejected++;return false;}
    p.footprint=outline(p);p.positionStatus='estimated-from-source-building-edge';plan[kind].push(p);reservations.push(p);return true;
  }
  const ce=edges(canteen),south=ce.filter(e=>e.nz>.7).sort((a,b)=>b.length-a.length)[0],east=ce.filter(e=>e.nx>.7).sort((a,b)=>b.length-a.length)[0],west=ce.filter(e=>e.nx<-.7).sort((a,b)=>b.length-a.length)[0],north=ce.filter(e=>e.nz<-.7).sort((a,b)=>b.length-a.length)[0];
  const candidate=(e,u,out,details)=>({x:e.a.x+e.tx*u+e.nx*out,z:e.a.z+e.tz*u+e.nz*out,yaw:e.yaw,sourceId:details.sourceId??CANTEEN,edgeOffsetMetres:out,...details});
  if(south){
    const eastward=south.tx>0;
    outer:for(const fromCorner of[6,8,10,12,4])for(const out of[4.1,5.2,3.1,6.3]){if(accept('sculptures',candidate(south,eastward?south.length-fromCorner:fromCorner,out,{width:2.05,depth:2.05,height:3.8,kind:'abstract-stainless-globe'})))break outer;}
    for(const ratio of[.17,.47,.74]){for(const out of[2.3,3.5,4.7,1.4])if(accept('parkingSigns',candidate(south,south.length*ratio,out,{width:.76,depth:.66,height:1.35,kind:'movable-parking-sign'})))break;}
  }
  if(east&&plan.parkingSigns.length<3)for(const ratio of[.48,.77]){for(const out of[2.2,3.3,1.4])if(accept('parkingSigns',candidate(east,east.length*ratio,out,{width:.76,depth:.66,height:1.35,kind:'movable-parking-sign'})))break;if(plan.parkingSigns.length>=3)break;}
  const de=edges(dorm),dormBounds=waterFootprint(dorm??{})?.bounds,southHalf=dormBounds?(dormBounds.minZ+dormBounds.maxZ)/2:Infinity,fronts=de.filter(e=>e.nz>.75&&e.length>19&&(e.a.z+e.b.z)/2>southHalf).sort((a,b)=>b.length-a.length);
  if(fronts.length){
    outer:for(const e of fronts.slice().sort((a,b)=>(a.a.x+a.b.x)-(b.a.x+b.b.x)))for(const ratio of[.5,.35,.65])for(const out of[2.2,3.1,4.2])if(accept('noticeboards',candidate(e,e.length*ratio,out,{sourceId:DORM,width:12.2,depth:1.9,height:2.85,kind:'covered-public-noticeboard'})))break outer;
    for(const e of fronts)for(const ratio of[.13,.87,.3,.68]){
      let strip=null;for(const out of[1.55,2.4,3.3]){const p=candidate(e,e.length*ratio,out,{sourceId:DORM,width:2.55,depth:1.3,height:.06,kind:'low-grass-strip'});if(outline(p).every(q=>!blocked(q.x,q.z))&&!reservations.some(q=>overlaps(p,q,.45))){strip=p;break;}}
      if(!strip)continue;strip.footprint=outline(strip);strip.positionStatus='estimated-from-source-building-edge';plan.greenStrips.push(strip);
      const shrub={...strip,width:1.48,depth:1.3,radius:.74,height:1.15,kind:'clipped-low-round-shrub'};accept('shrubs',shrub,{plant:true});
      if(plan.shrubs.length>=5)break;
    }
  }
  // Trees only behind/along the far west end. Keep the photographed corner,
  // supermarket entrance and long dormitory frontage entirely free of trees.
  const treeOptions=[];if(west)for(const ratio of[-.10,-.20,-.30,-.40,-.50,.12,.30])for(const out of[8,10,12,14,18,22])treeOptions.push(candidate(west,west.length*ratio,out,{height:8.9,radius:1.9,form:'oval'}));
  if(north)for(const ratio of[.26,.8])for(const out of[6.5,9,13])treeOptions.push(candidate(north,north.length*ratio,out,{height:10.6,radius:2.85,form:'spreading'}));
  for(const p of treeOptions){if(accept('trees',{...p,width:p.radius*2,depth:p.radius*2,featureId:CANTEEN,seed:.13+plan.trees.length*.27,kind:'background-broadleaf'},{tree:true})&&plan.trees.length>=3)break;}
  plan.roadExclusions=segments;return plan;
}

export function createYunyuanForecourt(THREE,model,{surfaces,existingTrees=[]}={}){
  const plan=planYunyuanForecourt(model,{existingTrees}),group=new THREE.Group();group.name='韵苑街角 · 实拍前场设施';
  const provenance={component:'yunyuan-forecourt',sourceIds:plan.sourceIds,photographs:PHOTOS,sourceUrl:'/references/local-campus/index.html',sourceFootprintsUnchanged:true,placement:'photo-registered estimates constrained by source buildings and road corridors',uncertainty:'雕塑、P牌、宣传栏及绿带按用户街景估计配准；非设施测绘，截图日期不等于拍摄日期。'};group.userData={...provenance,counts:Object.fromEntries(['sculptures','parkingSigns','noticeboards','greenStrips','shrubs','trees'].map(k=>[k,plan[k].length]))};
  const geometries=new Set(),materials=new Set(),textures=new Set(),batches=new Map(),dummy=new THREE.Object3D();
  const ownGeo=g=>(geometries.add(g),g),mat=(color,roughness=.84,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness,side:THREE.DoubleSide});materials.add(m);return m;};
  const box=ownGeo(new THREE.BoxGeometry(1,1,1)),stone=mat('#6b4037',.87),concrete=surfaces?.concrete??mat('#999d92'),wood=mat('#4b382a',.91),roof=mat('#584231'),steel=mat('#ccd0c8',.24,.94),frame=mat('#aeb9b5',.55,.45),blue=mat('#1e6a9d'),panel=mat('#8db0aa',.53),grass=surfaces?.grass??mat('#6c7b4c',.98),leaf=mat('#334a2a',.97),dark=mat('#303f33');
  function instance(name,geometry,material,p,x,y,z,sx,sy,sz,roll=0){const key=`${name}/${geometry.uuid}/${material.uuid}`;if(!batches.has(key))batches.set(key,{name,geometry,material,items:[],ids:[]});const yaw=p.yaw??0,tx=Math.cos(yaw),tz=-Math.sin(yaw);dummy.position.set(p.x+tx*x-tz*z,y,p.z+tz*x+tx*z);dummy.rotation.set(0,yaw,roll);dummy.scale.set(sx,sy,sz);dummy.updateMatrix();const batch=batches.get(key);batch.items.push(dummy.matrix.clone());batch.ids.push(p.sourceId);}
  function standalone(name,geometry,material,p){const o=new THREE.Mesh(ownGeo(geometry),material);o.name=name;o.castShadow=true;o.receiveShadow=true;o.renderOrder=205;o.userData={...provenance,component:name,sourceId:p.sourceId,placementStatus:p.positionStatus};group.add(o);return o;}
  for(const p of plan.sculptures){
    instance('yunyuan-sculpture-low-footing',box,concrete,p,0,.18,0,2.05,.22,2.05);
    const base=standalone('yunyuan-sculpture-dark-stone-plinth',new THREE.CylinderGeometry(.61,.82,.92,4,1),stone,p);base.position.set(p.x,.75,p.z);base.rotation.y=p.yaw+Math.PI/4;
    // Broad curled sheet-metal ribbons wrap a globe-shaped volume. No human
    // body, head, arms or legs are introduced into this abstract sculpture.
    for(let ribbon=0;ribbon<5;ribbon++){
      const vertices=[],indices=[],rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.32+ribbon*.42,ribbon*1.22,.2+ribbon*.16)),segments=48;
      for(let k=0;k<=segments;k++){
        const t=k/segments,angle=(.14+t*1.67)*Math.PI,latitude=.28*Math.sin(angle*1.4+ribbon),radius=.92+.09*Math.sin(angle*2.2+ribbon),width=(.11+.07*Math.sin(t*Math.PI))*(ribbon%2?1.2:1);
        for(const side of[-1,1]){const a=angle+side*width/radius,v=new THREE.Vector3(Math.cos(a)*Math.cos(latitude)*radius,Math.sin(latitude)*radius,Math.sin(a)*Math.cos(latitude)*radius).applyQuaternion(rotation);vertices.push(p.x+v.x,2.35+v.y,p.z+v.z);}
        if(k){const i=k*2;indices.push(i-2,i,i-1,i-1,i,i+1);}
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();standalone('yunyuan-abstract-stainless-ribbon',geo,steel,p);
    }
    const inner=standalone('yunyuan-abstract-folded-core',new THREE.SphereGeometry(.67,20,14,0,Math.PI*1.6,.16,Math.PI*.85),steel,p);inner.position.set(p.x,2.27,p.z);inner.scale.set(.85,1.25,.95);inner.rotation.set(.35,.6,-.4);
  }
  let pMaterial=blue;
  if(typeof document!=='undefined'&&plan.parkingSigns.length){const canvas=document.createElement('canvas');canvas.width=192;canvas.height=256;const c=canvas.getContext('2d');if(c){c.fillStyle='#176799';c.fillRect(0,0,192,256);c.strokeStyle='#dce8e0';c.lineWidth=6;c.strokeRect(8,8,176,240);c.fillStyle='#eef3e9';c.font='bold 148px sans-serif';c.textAlign='center';c.fillText('P',96,165);c.font='24px sans-serif';c.fillText('规范停车',96,216);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;textures.add(texture);pMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:.75,side:THREE.DoubleSide});materials.add(pMaterial);}}
  const signFace=ownGeo(new THREE.PlaneGeometry(1,1));
  for(const p of plan.parkingSigns){
    instance('yunyuan-movable-P-board',box,blue,p,0,.91,0,.69,.88,.075);instance('yunyuan-movable-P-lettering',signFace,pMaterial,p,0,.91,.046,.67,.86,1);
    for(const side of[-1,1]){instance('yunyuan-P-board-side-frame',box,frame,p,side*.36,.81,0,.035,1.12,.055);instance('yunyuan-P-board-feet',box,frame,p,side*.27,.18,0,.065,.12,.63);}
  }
  for(const p of plan.noticeboards){
    for(const x of[-5.7,-1.9,1.9,5.7])instance('yunyuan-brown-noticeboard-posts',box,wood,p,x,1.34,0,.16,2.5,.17);
    for(const x of[-3.8,0,3.8]){instance('yunyuan-noticeboard-frames',box,wood,p,x,1.48,0,3.56,1.42,.16);instance('yunyuan-noticeboard-inset-panels',box,panel,p,x,1.48,.10,3.28,1.16,.045);
      for(let line=0;line<5;line++)instance('yunyuan-noticeboard-faint-rules',box,frame,p,x,1.78-line*.13,.127,2.7,.012,.008);}
    for(const side of[-1,1]){const o=standalone('yunyuan-brown-noticeboard-roof',new THREE.BoxGeometry(12.0,.1,.88),roof,p);o.position.set(p.x+Math.sin(p.yaw)*side*.38,2.73,p.z+Math.cos(p.yaw)*side*.38);o.rotation.set(side*.14,p.yaw,0);}
  }
  for(const p of plan.greenStrips){instance('yunyuan-narrow-front-lawn',box,grass,p,0,.095,0,p.width,.06,p.depth);for(const side of[-1,1])instance('yunyuan-lawn-low-edging',box,concrete,p,0,.13,side*(p.depth/2+.03),p.width,.1,.08);}
  const shrubGeometry=ownGeo(new THREE.SphereGeometry(1,18,12));{const positions=shrubGeometry.attributes.position;for(let i=0;i<positions.count;i++){const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i),r=1+.045*Math.sin(x*19+z*13)*Math.cos(y*17);positions.setXYZ(i,x*r,y*r,z*r);}positions.needsUpdate=true;shrubGeometry.computeVertexNormals();}
  for(const p of plan.shrubs){instance('yunyuan-low-clipped-round-shrubs',shrubGeometry,leaf,p,0,.17+p.height/2,0,p.radius,p.height/2,p.depth/2);for(const side of[-1,1])instance('yunyuan-shrub-ground-shadows',box,dark,p,side*.25,.14,0,.45,.018,.52);}
  for(const{name,geometry,material,items,ids}of batches.values()){const o=new THREE.InstancedMesh(geometry,material,items.length);o.name=name;items.forEach((m,i)=>o.setMatrixAt(i,m));o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.castShadow=true;o.receiveShadow=true;o.renderOrder=204;o.userData={...provenance,component:name,instanceSourceIds:ids};group.add(o);}
  const trees=plan.trees.length?createTreeLayer(THREE,plan.trees,{name:'yunyuan-background-broadleaf',detail:'forest',whitewash:false,barkMaterial:surfaces?.bark}):null;if(trees)group.add(trees.group);
  let disposed=false;return{group,plan,update(camera){trees?.update(camera);},dispose(){if(disposed)return;disposed=true;trees?.dispose();group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.removeFromParent();group.clear();}};
}
