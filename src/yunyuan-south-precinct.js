import polygonClipping from 'polygon-clipping';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {streetFootprint} from './street-clearance.js';
import {applyWorldUV} from './surface-materials.js';

export const YUNYUAN_SOUTH_BUILDING_ID='way/103757021';
export const YUNYUAN_SOUTH_ROAD_IDS=Object.freeze(['way/110398904','way/110398905','way/110398906','way/110398907']);
export const YUNYUAN_SOUTH_EVIDENCE=Object.freeze({
  sourceId:YUNYUAN_SOUTH_BUILDING_ID,
  sourceUrl:'https://www.openstreetmap.org/way/103757021',
  article:'https://www.sohu.com/a/332453170_154724',
  officialGuide:'https://hq.hust.edu.cn/ysfw/stfw.htm',
  historicShopArticle:'https://www.sohu.com/a/251055569_154724',
  photoDate:'user reference received 2026-10-30; capture date not independently verified',
  photoFiles:['92554cbfd49deba97eacfa2733f40c19.jpg','d32d5e5fbf4fdd735759a382cd930886.jpg'],
  observed:'本轮实拍直接确认学生一食堂：米灰墙、两道灰色水平带、深平挑檐和四方柱、宽楼梯及两道中间钢栏、连续二层金属栏外廊、底层小门面，主入口右侧蓝绿玻璃雨棚。学二布局仍沿用此前学生会照片和源地图。',
  uncertainty:'Source polygon is unchanged. The two hall divisions, 3.4 m raised-floor offset, porch depth, stair width, columns and window spacing remain photograph-informed estimates. The OSM node only says 学生食堂; identifying the shared outline with 学一/学二 is a spatial inference from the official address, adjacent dormitories and mapped connected stairs. The new photo confirms the student-one facade details but supplies no measured facade dimensions.',
  market:'教育超市韵苑店在北侧韵苑食堂底层；东学店仅核实到紫荆路与东三路交会处，未把未核实商业店名贴到本楼。',
});
const BASE=.14, UPPER=3.54, FLOOR_OFFSET=UPPER-BASE;
const distance=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z);
const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
function segmentPolygon(a,b,width){return streetFootprint((a.x+b.x)/2,(a.z+b.z)/2,distance(a,b),width,-Math.atan2(b.z-a.z,b.x-a.x));}

/** A photographic reconstruction above one unmodified mapped footprint. All
 * elevations are explicit estimates; GIS road endpoints are used exactly. */
export function planYunyuanSouthPrecinct(model,{frame,geoToLocal}={}){
  const plan={accepted:false,evidence:YUNYUAN_SOUTH_EVIDENCE,sourceId:YUNYUAN_SOUTH_BUILDING_ID,halls:[],porches:[],galleries:[],stairs:[],columns:[],rails:[],barriers:[],walkSurfaces:[],buildings:[],replacedBuildingIds:[],replacedRoadIds:[],viewpoints:{},floorY:BASE,galleryY:UPPER};
  const source=model.records?.find(r=>r.id===YUNYUAN_SOUTH_BUILDING_ID);
  if(!source?.shapes?.length||!frame||typeof geoToLocal!=='function')return plan;
  const ring=source.shapes[0].getPoints().map(p=>({x:p.x,z:-p.y}));if(distance(ring[0],ring.at(-1))<.001)ring.pop();
  if(ring.length!==4)return plan;
  // The source winding is NW, SW, SE, NE. Select these corners by latitude
  // order instead of depending on clockwise vs counterclockwise serialization.
  const north=ring.slice().sort((a,b)=>a.z-b.z).slice(0,2).sort((a,b)=>a.x-b.x),origin=north[0],ne=north[1];
  const width=distance(origin,ne),ex={x:(ne.x-origin.x)/width,z:(ne.z-origin.z)/width},ez={x:-ex.z,z:ex.x};
  const at=(x,z)=>({x:origin.x+ex.x*x+ez.x*z,z:origin.z+ex.z*x+ez.z*z});
  const to=(p)=>({x:(p.x-origin.x)*ex.x+(p.z-origin.z)*ex.z,z:(p.x-origin.x)*ez.x+(p.z-origin.z)*ez.z});
  const depth=Math.max(...ring.map(p=>to(p).z)),yaw=-Math.atan2(ex.z,ex.x);
  if(width<20||depth<40)return plan;
  const local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
  const sourceLines=new Map(YUNYUAN_SOUTH_ROAD_IDS.map(id=>[id,model.records.find(r=>r.id===id)?.feature?.geometry?.coordinates?.map(local)]));
  if([...sourceLines.values()].some(points=>!points||points.length<2))return plan;
  plan.accepted=true;plan.height=7.88;plan.boundary=ring;plan.frame={origin,ex,ez,width,depth,yaw};
  plan.replacedBuildingIds=[YUNYUAN_SOUTH_BUILDING_ID];plan.replacedRoadIds=[...YUNYUAN_SOUTH_ROAD_IDS];
  const rect=(x,z,w,d)=>streetFootprint(at(x,z).x,at(x,z).z,w,d,yaw);
  const building=(id,x,z,w,d,minHeight,height,label)=>{const p={id,sourceId:source.id,label,rings:[rect(x,z,w,d)],minHeight,height,estimated:true};plan.buildings.push(p);return p;};
  const barrier=(id,poly,minHeight,height,label)=>plan.barriers.push({id,sourceId:source.id,polygon:poly,minHeight,height,label,estimated:true});
  const galleryLine=sourceLines.get('way/110398905'),mainStart=to(galleryLine[1]),mainEnd=to(galleryLine[2]),frontX=Math.min(mainStart.x,mainEnd.x)-1.7;
  const split=(mainStart.z+mainEnd.z)/2,innerGap=1.1;
  for(const [key,label,start,end]of[['xueer','学生二食堂',.4,split-innerGap],['xueyi','学生一食堂',split+innerGap,depth-.4]]){
    const hall={id:key,label,x:frontX/2,z:(start+end)/2,width:frontX,depth:end-start,start,end,frontX,height:7.88,upperFloorY:UPPER};
    plan.halls.push(hall);building(`${key}-hall`,hall.x,hall.z,hall.width,hall.depth,BASE,hall.height,label);
  }
  for(let i=1;i<galleryLine.length;i++){
    const a=galleryLine[i-1],b=galleryLine[i],length=distance(a,b),width=3.4,id=`south-gallery-${i}`;
    if(length<.01)continue;
    const gallery={id,a,b,width,length,polygon:segmentPolygon(a,b,width),surfaceY:UPPER};plan.galleries.push(gallery);
    plan.walkSurfaces.push({...gallery,sourceId:'way/110398905',kind:'gallery',bridge:true,deckDepth:.25,estimated:true});
  }
  // Source polyline corners need a shared landing; uncapped rectangular
  // ribbons leave triangular support holes at the north stair/diagonal join.
  for(const [i,p]of galleryLine.entries())plan.walkSurfaces.push({id:`south-gallery-joint-${i}`,sourceId:'way/110398905',polygon:streetFootprint(p.x,p.z,3.4,3.4,yaw),surfaceY:UPPER,bridge:true,deckDepth:.25,kind:'gallery-joint',estimated:true});
  // A continuous open two-level colonnade, with larger entrance porches where
  // the two mapped east-facing stairways meet the gallery. No opaque box fills it.
  for(const [key,stairId]of[['xueyi','way/110398904'],['xueer','way/110398907']]){
    const target=to(sourceLines.get(stairId).at(-1)),porch={id:`${key}-porch`,hallId:key,x:(frontX+target.x)/2,z:target.z,width:target.x-frontX+.8,depth:14.2,height:7.88,front:target.x+.4,stairWidth:key==='xueyi'?6.6:4.8};
    plan.porches.push(porch);
    plan.walkSurfaces.push({id:porch.id,sourceId:source.id,polygon:rect(porch.x,porch.z,porch.width,porch.depth),surfaceY:UPPER,bridge:true,deckDepth:.25,kind:'porch',estimated:true});
    for(const x of [frontX+.6,porch.front-.65])for(const dz of [-6.1,-porch.stairWidth/2-.55,porch.stairWidth/2+.55,6.1]){
      const col={id:`${key}-column-${x}-${dz}`,x,z:porch.z+dz,width:.6,depth:.7,height:7.55};plan.columns.push(col);barrier(col.id,rect(col.x,col.z,col.width,col.depth),BASE,col.height,'食堂方柱');
    }
    // Split the front guard at the real stair landing, never fence its entrance.
    const stairWidth=porch.stairWidth;
    for(const side of[-1,1]){
      const a=at(porch.front,porch.z+side*(stairWidth/2+.15)),b=at(porch.front,porch.z+side*(porch.depth/2));plan.rails.push({id:`${key}-front-rail-${side}`,a,b,y:UPPER});
    }
  }
  for(const id of ['way/110398904','way/110398906','way/110398907']){
    const points=sourceLines.get(id),reversed=id==='way/110398906',a=reversed?points.at(-1):points[0],b=reversed?points[0]:points.at(-1),length=distance(a,b),width=id==='way/110398907'?4.8:id==='way/110398904'?6.6:2.7;
    const count=20,upperLandingLength=2,run=Math.min(8.7,length-upperLandingLength-.5),landing=length-run-upperLandingLength,first=mix(a,b,landing/length),stairEnd=mix(a,b,(length-upperLandingLength)/length),steps=[];
    plan.walkSurfaces.push({id:`${id}:upper-landing`,sourceId:id,polygon:segmentPolygon(stairEnd,b,width),surfaceY:UPPER,kind:'stair-landing',bridge:false,estimated:true});
    plan.walkSurfaces.push({id:`${id}:approach`,sourceId:id,polygon:segmentPolygon(a,first,width),surfaceY:BASE,kind:'approach',estimated:true});
    for(let i=0;i<count;i++){
      const start=mix(first,stairEnd,i/count),end=mix(first,stairEnd,(i+1)/count),surfaceY=BASE+FLOOR_OFFSET*(i+1)/count,step={id:`${id}:step:${i}`,sourceId:id,a:start,b:end,polygon:segmentPolygon(start,end,width),width,depth:run/count,surfaceY,riser:FLOOR_OFFSET/count,index:i};
      steps.push(step);plan.walkSurfaces.push({...step,kind:'stair',bridge:false,estimated:true});
    }
    const stair={id,a,b,first,stairEnd,width,length,run,upperLandingLength,steps};plan.stairs.push(stair);
    const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    const offsets=[-width/2-.04,width/2+.04];
    if(id==='way/110398904')offsets.push(-width/6,width/6);
    for(const [index,offset]of offsets.entries()){
      const aa={x:first.x-dz*offset,z:first.z+dx*offset},bb={x:stairEnd.x-dz*offset,z:stairEnd.z+dx*offset};
      plan.rails.push({id:`${id}:stair-rail:${index}`,a:aa,b:bb,y:BASE,endY:UPPER,stair:true,divider:index>1});
      // Short per-step barriers match the sloped rail; a single high prism would
      // block someone walking underneath the neighbouring raised gallery.
      for(const step of steps){const pa={x:step.a.x-dz*offset,z:step.a.z+dx*offset},pb={x:step.b.x-dz*offset,z:step.b.z+dx*offset};barrier(`${step.id}:rail:${index}`,segmentPolygon(pa,pb,.1),step.surfaceY,step.surfaceY+1.05,'楼梯扶手');}
    }
  }
  // Main longitudinal gallery: leave both ends open to the porch connections.
  const a=galleryLine[1],b=galleryLine[2],length=distance(a,b),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
  for(const side of[-1,1]){
    const aa=mix(a,b,.12),bb=mix(a,b,.88),off=1.68*side;
    plan.rails.push({id:`south-gallery-rail:${side}`,a:{x:aa.x-dz*off,z:aa.z+dx*off},b:{x:bb.x-dz*off,z:bb.z+dx*off},y:UPPER});
  }
  for(const rail of plan.rails)if(!rail.stair)barrier(rail.id,segmentPolygon(rail.a,rail.b,.09),rail.y,rail.y+1.08,'连廊栏杆');
  const south=sourceLines.get('way/110398904')[0],northStair=sourceLines.get('way/110398907')[0];
  const pose=(point,zoffset=0)=>({x:point.x+12,z:point.z+zoffset,y:BASE,yaw:Math.PI/2,mode:'walk',view:'first'});
  plan.viewpoints={southCanteen:pose(south,4),southCanteenNorth:pose(northStair,4)};
  plan.inspection={position:[south.x+18,3.5,south.z+13],target:[galleryLine[0].x,5,galleryLine[0].z]};
  return plan;
}

function renderTexture(THREE){
  const size=64,data=new Uint8Array(size*size*4);let seed=0x6b2a951f;
  for(let i=0;i<size*size;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const value=248+Math.floor(seed/4294967296*8); // <3% neutral micro-grain
    data.set([value,value,value,255],i*4);
  }
  const texture=new THREE.DataTexture(data,size,size);
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(8,8);
  texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps=true;texture.anisotropy=4;texture.needsUpdate=true;return texture;
}

export function createYunyuanSouthPrecinct(THREE,model,options={}){
  const plan=planYunyuanSouthPrecinct(model,options),group=new THREE.Group();group.name='学一 · 学二食堂照片校准';group.userData={component:'yunyuan-south-precinct',...YUNYUAN_SOUTH_EVIDENCE,estimated:true};
  const infrastructure={buildings:plan.buildings,barriers:plan.barriers,walkSurfaces:plan.walkSurfaces,replacedBuildingIds:plan.replacedBuildingIds,replacedRoadIds:plan.replacedRoadIds,viewpoints:plan.viewpoints};
  const geometry=new Set(),materials=new Set(),textures=new Set(),batches=new Map(),slabBatches=new Map(),dummy=new THREE.Object3D();let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometry.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());group.removeFromParent();group.clear();};
  if(!plan.accepted)return{group,plan,infrastructure,viewpoints:plan.viewpoints,dispose,update(){}};
  const {origin,ex,ez,yaw}=plan.frame,at=(x,z)=>({x:origin.x+ex.x*x+ez.x*z,z:origin.z+ex.z*x+ez.z*z});
  const mat=(color,roughness=.9,metalness=0)=>{const m=new THREE.MeshStandardMaterial({color,roughness,metalness});materials.add(m);return m;};
  const plaster=mat('#ddd9c9'),grey=mat('#898a81'),shadow=mat('#50574b'),concrete=mat('#aaa99e'),glass=mat('#4c6259',.35,.15),metal=mat('#b9bdb6',.38,.62),dark=mat('#3b443d'),warm=mat('#c7b58e'),canopyGlass=mat('#8aafa5',.26,.18);
  const paint=renderTexture(THREE);textures.add(paint);plaster.map=paint;concrete.map=paint;
  const boxGeo=new THREE.BoxGeometry(1,1,1);geometry.add(boxGeo);
  function box(name,m,x,y,z,w,h,d,angle=yaw){const key=`${name}/${m.uuid}`;if(!batches.has(key))batches.set(key,{name,material:m,items:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,angle,0);dummy.scale.set(w,h,d);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());}
  const localBox=(name,m,x,y,z,w,h,d)=>{const p=at(x,z);box(name,m,p.x,y,p.z,w,h,d);};
  function beam(name,m,a,b,y,thickness=.045,endY=y){const length=distance(a,b),p= new THREE.Vector3(a.x,y,a.z),q=new THREE.Vector3(b.x,endY,b.z),mid=p.clone().add(q).multiplyScalar(.5),len=p.distanceTo(q);const key=`${name}/${m.uuid}`;if(!batches.has(key))batches.set(key,{name,material:m,items:[]});dummy.position.copy(mid);dummy.quaternion.setFromUnitVectors(new THREE.Vector3(1,0,0),q.sub(p).normalize());dummy.scale.set(len,thickness,thickness);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());dummy.rotation.set(0,0,0);return length;}
  function slab(name,poly,top,depth,m){const shape=new THREE.Shape(poly.map(p=>new THREE.Vector2(p.x,-p.z))),geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false});geo.rotateX(-Math.PI/2);geo.translate(0,top-depth,0);applyWorldUV(geo);const flat=geo.index?geo.toNonIndexed():geo;if(flat!==geo)geo.dispose();const key=name+'/'+m.uuid;if(!slabBatches.has(key))slabBatches.set(key,{name,material:m,items:[]});slabBatches.get(key).items.push(flat);}
  for(const h of plan.halls){
    localBox('south-hall-shell',plaster,h.x,(BASE+h.height)/2,h.z,h.width,h.height-BASE,h.depth);
    for(const y of [3.32,6.12])localBox('south-grey-horizontal-band',grey,h.frontX+.06,y,h.z,.16,y===3.32?.32:.22,h.depth);
    localBox('south-flat-roof-coping',grey,h.x,h.height+.14,h.z,h.width+.5,.28,h.depth+.4);
    // Side and rear openings are modest repeated windows, with explicitly
    // estimated spacing. The front is dominated by the photographed entrances.
    const count=Math.floor(h.depth/4.2);
    for(let i=0;i<count;i++)for(const y of [1.76,5.2]){
      if(i%3===1)continue;
      const z=h.start+(i+.5)*h.depth/count;
      localBox('south-recessed-window',dark,h.frontX+.1,y,z,.13,1.67,2.8);
      localBox('south-window-glazing',glass,h.frontX+.19,y,z,.06,1.49,2.6);
      localBox('south-window-transom',metal,h.frontX+.24,y+.28,z,.06,.055,2.61);
      for(const k of[-1,0,1])localBox('south-window-bars',metal,h.frontX+.25,y,z+k*.65,.04,1.5,.035);
    }
    // No fabricated tenants/advertisements on the unphotographed western side.
    for(const side of[-1,1])for(let i=0;i<4;i++)for(const y of [1.76,5.2]){
      const z=h.z+side*(h.depth/2+.05),x=3+i*(h.width-6)/3;
      localBox('south-end-window-reveal',grey,x,y,z,2.6,1.75,.12);
      localBox('south-end-window',glass,x,y,z+side*.07,2.4,1.55,.07);
      localBox('south-end-window-frame',metal,x,y,z+side*.12,.045,1.55,.06);
    }
  }
  for(const p of plan.porches){
    localBox('south-porch-large-overhang',plaster,p.x-.1,p.height-.02,p.z,p.width+1.6,.35,p.depth+1.2);
    localBox('south-weathered-canopy-edge',grey,p.front+.55,p.height+.1,p.z,.14,.35,p.depth+1.24);
    for(const dz of[-5,0,5])localBox('south-porch-recessed-light',warm,p.x,p.height-.212,p.z+dz,.62,.018,.46);
    const h=plan.halls.find(h=>h.id===p.hallId);
    localBox('south-main-entrance-reveal',shadow,h.frontX+.28,5.12,p.z,.26,3.04,7.3);
    localBox('south-main-entrance-glass',glass,h.frontX+.43,5.12,p.z,.055,2.8,6.9);
    for(const dz of[-3.45,-1.7,0,1.7,3.45])localBox('south-main-door-mullion',metal,h.frontX+.48,5.12,p.z+dz,.06,2.84,.065);
    localBox('south-main-door-transom',metal,h.frontX+.48,5.98,p.z,.06,.07,6.93);
    for(const dz of[-.22,.22])localBox('south-main-door-handle',metal,h.frontX+.59,4.65,p.z+dz,.14,.65,.035);
    if(p.hallId==='xueyi'){
      // The user's street photo exposes the long blue-green canopy to the
      // north (viewer-right) of the principal porch. Its supports share the
      // existing outside gallery rail, keeping the walking strip clear.
      const canopyStart=h.start+.8,canopyEnd=p.z-p.depth/2-.45,canopyDepth=canopyEnd-canopyStart,canopyX=h.frontX+1.68,canopyZ=(canopyStart+canopyEnd)/2;
      localBox('south-glazed-gallery-canopy',canopyGlass,canopyX,7.43,canopyZ,3.35,.065,canopyDepth);
      for(const x of[h.frontX+.08,h.frontX+3.26])localBox('south-canopy-frame',metal,x,7.38,canopyZ,.055,.10,canopyDepth);
      for(let z=canopyStart;z<=canopyEnd;z+=1.35)localBox('south-canopy-frame',metal,canopyX,7.38,z,3.35,.10,.05);
      for(let z=canopyStart+.2;z<canopyEnd;z+=5.4)localBox('south-canopy-frame',metal,h.frontX+3.26,(UPPER+7.38)/2,z,.06,7.38-UPPER,.06);
      // Paired exposed rain pipes are visible beside the deep entrance eave.
      for(const dz of[7.48,7.78]){
        localBox('south-exposed-pipework',metal,h.frontX+.34,5.88,p.z-dz,.10,3.18,.10);
        localBox('south-exposed-pipework',metal,h.frontX+.34,7.42,p.z-dz+.72,.10,.10,1.5);
      }
      // A 2018 student-union close-up explicitly places a glazed optical shop
      // below 学一. Reproduce the shopfront construction, not its historical
      // brand, phone number, advertisements or an invented current tenant.
      localBox('south-historic-shop-recess',shadow,h.frontX+.28,1.64,p.z,.25,2.94,7.4);
      localBox('south-historic-shop-glass',glass,h.frontX+.43,1.58,p.z,.055,2.66,7.1);
      localBox('south-historic-shop-fascia',grey,h.frontX+.44,3.03,p.z,.13,.26,7.4);
      for(const dz of[-3.55,-1.8,0,1.8,3.55])localBox('south-shop-window-mullion',metal,h.frontX+.49,1.58,p.z+dz,.06,2.7,.055);
      for(const dz of[-.2,.2])localBox('south-shop-door-handle',metal,h.frontX+.59,1.37,p.z+dz,.13,.68,.035);
      localBox('south-shop-threshold',concrete,h.frontX+.52,.19,p.z,.7,.1,7.4);
    }else for(const side of[-1,1]){
      const z=p.z+side*5.2;
      localBox('south-lower-service-door',dark,h.frontX+.15,1.55,z,.12,2.7,2.3);
      for(let i=0;i<11;i++)localBox('south-lower-service-louvers',grey,h.frontX+.23,.46+i*.2,z,.055,.06,2.27);
    }
    // Lettering is optional decoration: headless planning remains DOM-free.
    if(typeof document!=='undefined'){
      const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=160;const ctx=canvas.getContext('2d');
      if(ctx){ctx.font='700 122px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#aaa99b';ctx.fillText(h.label,512,82);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;textures.add(tex);const material=new THREE.MeshStandardMaterial({map:tex,transparent:true,alphaTest:.2,side:THREE.DoubleSide,roughness:.8});materials.add(material);const geo=new THREE.PlaneGeometry(11.8,1.8);geometry.add(geo);const sign=new THREE.Mesh(geo,material),q=at(p.front,p.z);sign.position.set(q.x,p.height+1.18,q.z);sign.rotation.y=Math.PI/2+yaw;sign.name='south-evidenced-roof-lettering';group.add(sign);}
    }
  }
  for(const c of plan.columns)localBox('south-porch-square-column',grey,c.x,(BASE+c.height)/2,c.z,c.width,c.height-BASE,c.depth);
  const deckUnion=polygonClipping.union(...plan.walkSurfaces.filter(s=>s.bridge).map(s=>[s.polygon.map(p=>[p.x,p.z])]));
  // Union the overlapping porch/gallery tops before extrusion: coplanar strips
  // would flicker from a low walking camera even after a geometry merge.
  for(const poly of deckUnion)slab('south-open-gallery-deck',poly[0].map(([x,z])=>({x,z})),UPPER,.25,concrete);
  for(const surface of plan.walkSurfaces.filter(s=>s.kind==='stair'||s.kind==='stair-landing')){
    const rings=surface.surfaceY===UPPER?polygonClipping.difference([surface.polygon.map(p=>[p.x,p.z])],deckUnion):[[surface.polygon.map(p=>[p.x,p.z])]];
    for(const poly of rings)slab('south-mapped-step',poly[0].map(([x,z])=>({x,z})),surface.surfaceY,surface.surfaceY-BASE,concrete);
    if(surface.kind!=='stair')continue;
    const dx=surface.b.x-surface.a.x,dz=surface.b.z-surface.a.z,len=Math.hypot(dx,dz),half=surface.width/2;
    const a={x:surface.a.x-dz/len*half,z:surface.a.z+dx/len*half},b={x:surface.a.x+dz/len*half,z:surface.a.z-dx/len*half};
    beam('south-stair-nosing',grey,a,b,surface.surfaceY+.009,.025);
  }
  // Transverse support beams below decks keep the first-floor void visible.
  for(const p of plan.porches)for(const dz of[-6.1,6.1])localBox('south-porch-support-beam',grey,p.x,UPPER-.42,p.z+dz,p.width,.4,.32);
  for(const rail of plan.rails){
    const top=rail.y+1.04,end=(rail.endY??rail.y)+1.04;
    beam('south-metal-top-rail',metal,rail.a,rail.b,top,.065,end);beam('south-metal-bottom-rail',metal,rail.a,rail.b,rail.y+.2,.04,(rail.endY??rail.y)+.2);
    const length=distance(rail.a,rail.b),n=Math.ceil(length/.32);
    for(let i=0;i<=n;i++){
      const t=i/n,p=mix(rail.a,rail.b,t),y=rail.y+((rail.endY??rail.y)-rail.y)*t;
      box('south-vertical-rail-bars',metal,p.x,y+.61,p.z,.028,.85,.028,0);
      if(i%5===0)box('south-rail-posts',metal,p.x,y+.54,p.z,.06,1.08,.06,0);
    }
  }
  for(const {name,material,items}of batches.values()){
    const mesh=new THREE.InstancedMesh(boxGeo,material,items.length);mesh.name=name;items.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=!/rail|bars|window/.test(name);mesh.receiveShadow=true;mesh.userData={component:name,sourceId:plan.sourceId,estimated:true,instanceCount:items.length};group.add(mesh);
  }
  for(const {name,material,items}of slabBatches.values()){
    const combined=mergeGeometries(items,false);items.forEach(g=>g.dispose());geometry.add(combined);const mesh=new THREE.Mesh(combined,material);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=false;mesh.userData={component:name,sourceId:plan.sourceId,estimated:true};group.add(mesh);
  }
  const center=at(plan.frame.width/2,plan.frame.depth/2),fine=[];
  group.traverse(o=>{if(o.isMesh&&/window-bars|window-transom|rail-bars|rail-posts|door-handle|louvers|stair-nosing|canopy-frame|pipework/.test(o.name))fine.push(o);});
  function update(camera,{detailDistanceScale=1}={}){
    group.visible=true;const p=camera?.position||camera,near=!p||Math.hypot(p.x-center.x,p.z-center.z)<240*detailDistanceScale;
    for(const mesh of fine)mesh.visible=near;
  }
  return{group,plan,infrastructure,viewpoints:plan.viewpoints,dispose,update};
}
