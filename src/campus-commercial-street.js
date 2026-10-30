import polygonClipping from 'polygon-clipping';
import {streetFootprint,polygonsOverlap} from './street-clearance.js';
import {getRoadProfile} from './building-profiles.js';
import {applyWorldUV} from './surface-materials.js';
import {createCommercialFrontages} from './commercial-frontage-renderer.js';

export const CBD_BUILDING_IDS=Object.freeze(['way/1228820963','way/1228820964','way/1228820965']);
export const CBD_SHOPS=Object.freeze([
  {id:'burger-king',title:'汉堡王',subtitle:'BURGER KING',poiId:'node/11395851428',buildingId:'way/1228820964'},
  {id:'zhou-mapo',title:'周麻婆',subtitle:'',poiId:'node/11395851431',buildingId:'way/1228820963'},
  {id:'oxygen',title:'氧气层',subtitle:'',poiId:'node/11395851434',buildingId:'way/1228820965'},
  {id:'xiabu',title:'呷哺呷哺',subtitle:'',poiId:'node/11395851429',buildingId:'way/1228820964'},
  {id:'yoshinoya',title:'吉野家',subtitle:'YOSHINOYA',poiId:'node/11395851433',buildingId:'way/1228820965'},
  {id:'seven-eleven',title:'7-ELEVEN',subtitle:'',poiId:'node/11395851432',buildingId:'way/1228820963'},
]);
export const COMMERCIAL_EVIDENCE=Object.freeze({
  photo:'user-provided east-campus photographs, received 2026-10-30',photoPublished:'not published; capture time not verified',
  photoFiles:['883cd40f52827573d3974513d878ed5a.jpg','e31bc8a07adb7d1b34e7b14b6ff3e4f1.jpg','43c334aebc39317809895c21fb3d115b.jpg','0e01a27fa3dfa814b793a7cfd85fd55e.jpg'],
  historicPhoto:'https://www.sohu.com/a/370401712_771598',
  oxygenFloor:'https://dekrt.cn/tutorial/delicious/',
  observed:'用户实拍校准：汉堡王黑棕低平檐、白字双面店招和通高玻璃；呷哺呷哺灰坡顶、屋顶字架及菱形镂空；白墙两层楼竖长窄窗；氧气层 O₂ CAFE 在吉野家红橙色门面上层；内街可见 7-Eleven 条纹招牌。',
  uncertainty:'Source footprints and shop POIs are retained. Heights, pavilion subdivision, shop widths and street furnishings remain photo-informed estimates. The Zhou Mapo elevation is still unverified. The photographed bakery/service-centre block is not assigned to an uncertain neighbouring footprint. Unidentified canteen shops have no invented tenant names.',
});
const BASE=.14;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function outline(record){const p=record.shapes[0].getPoints().map(v=>({x:v.x,z:-v.y}));if(dist(p[0],p.at(-1))<.001)p.pop();return p;}
function frameFor(ring){
  const north=ring.slice().sort((a,b)=>a.z-b.z).slice(0,2).sort((a,b)=>a.x-b.x),origin=north[0],e=north[1],width=dist(origin,e),ex={x:(e.x-origin.x)/width,z:(e.z-origin.z)/width},ez={x:-ex.z,z:ex.x};
  const to=p=>({x:(p.x-origin.x)*ex.x+(p.z-origin.z)*ex.z,z:(p.x-origin.x)*ez.x+(p.z-origin.z)*ez.z});
  return {origin,ex,ez,width,depth:Math.max(...ring.map(p=>to(p).z)),yaw:-Math.atan2(ex.z,ex.x)};
}
const world=(f,x,z)=>({x:f.origin.x+f.ex.x*x+f.ez.x*z,z:f.origin.z+f.ex.z*x+f.ez.z*z});
function faceFor(ring,direction){
  const center={x:ring.reduce((s,p)=>s+p.x,0)/ring.length,z:ring.reduce((s,p)=>s+p.z,0)/ring.length};let best;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],length=dist(a,b),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length,x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    let nx=-tz,nz=tx;if((x-center.x)*nx+(z-center.z)*nz<0){nx=-nx;nz=-nz;}
    const score=nx*direction.x+nz*direction.z;if(!best||score>best.score)best={a,b,x,z,tx,tz,nx,nz,length,score};
  }return best;
}
function alongFace(face,point,width){
  const along=Math.max(width/2+.35,Math.min(face.length-width/2-.35,(point.x-face.a.x)*face.tx+(point.z-face.a.z)*face.tz));
  return {x:face.a.x+face.tx*along,z:face.a.z+face.tz*along,nx:face.nx,nz:face.nz};
}

/** Original map footprints are never enlarged to fit a shop photograph. */
export function planCampusCommercialStreet(model,{frame,geoToLocal,southPlan}={}){
  const plan={accepted:false,evidence:COMMERCIAL_EVIDENCE,buildings:[],frontages:[],fixtures:[],barriers:[],walkSurfaces:[],replacedBuildingIds:[],replacedRoadIds:[],viewpoints:{},hardscapeExclusions:[],paving:[]};
  if(!frame||!geoToLocal||!model?.records)return plan;
  const source=new Map(model.records.map(r=>[r.id,r])),local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
  const buildings=new Map();
  for(const id of CBD_BUILDING_IDS){const r=source.get(id);if(r?.shapes?.length)buildings.set(id,{id,ring:outline(r),feature:r.feature});}
  if(buildings.size!==3)return plan;
  plan.accepted=true;plan.replacedBuildingIds=[...CBD_BUILDING_IDS];
  const volume=(id,sourceId,ring,height,style,roofRise=0)=>{
    const f=frameFor(ring),v={id,sourceId,label:style,rings:[ring],minHeight:BASE,height,estimated:true,style,roofRise,eaveHeight:height-roofRise,frame:f};plan.buildings.push(v);return v;
  };
  const north=buildings.get(CBD_BUILDING_IDS[0]),pavilion=buildings.get(CBD_BUILDING_IDS[1]),west=buildings.get(CBD_BUILDING_IDS[2]);
  volume('cbd-north-row',north.id,north.ring,6.65,'north-row',.85);
  volume('cbd-west-two-storey',west.id,west.ring,7.7,'west-two-storey');
  const pf=frameFor(pavilion.ring),sourcePolygon=pavilion.ring.map(p=>[p.x,p.z]);
  // The two POIs locate Burger King east of the rear pitched-roof restaurant.
  // The 40/60 facade split is estimated from the image, not an OSM subdivision.
  const split=pf.width*.4;
  for(const [id,lo,hi,height,style,rise]of[['cbd-rear-gable',-5,split,6.8,'rear-gable',1.15],['cbd-burger-pavilion',split,pf.width+5,4.18,'burger-pavilion',0]]){
    const clip=[world(pf,lo,-5),world(pf,hi,-5),world(pf,hi,pf.depth+5),world(pf,lo,pf.depth+5)].map(p=>[p.x,p.z]);
    for(const polygon of polygonClipping.intersection([sourcePolygon],[clip]))volume(id,pavilion.id,polygon[0].slice(0,-1).map(([x,z])=>({x,z})),height,style,rise);
  }
  const front=(shop,direction,width,options={})=>{
    const sourceBuilding=buildings.get(shop.buildingId),face=faceFor(sourceBuilding.ring,direction),p=local(source.get(shop.poiId).feature.geometry.coordinates),placed=alongFace(face,p,width);
    const item={...shop,brand:shop.id,sourceId:shop.buildingId,...placed,width,height:3.45,baseY:BASE,fasciaColor:'#39352e',frameColor:'#333a37',wallColor:'#b6a48c',estimated:true,maxProjection:.18,...options};plan.frontages.push(item);return item;
  };
  const bk=front(CBD_SHOPS[0],{x:1,z:0},11.9,{height:3.85,fasciaHeight:.84,fasciaColor:'#302824',wallColor:'#494039',textColor:'#ffffff',styleEvidence:'user photos: low dark fascia, full-height glazing and roundel'});
  const low=plan.buildings.find(v=>v.style==='burger-pavilion'),side=faceFor(low.rings[0],{x:0,z:1});
  plan.frontages.push({...bk,id:'burger-king-south',...alongFace(side,side,Math.min(12,side.length-.7)),width:Math.min(12,side.length-.7)});
  const zhou=front(CBD_SHOPS[1],{x:0,z:1},9.3,{fasciaColor:'#663d34',height:3.45,maxProjection:.12,styleEvidence:'unverified sign colour; mapped shop identity'});
  const oxygen=front(CBD_SHOPS[2],{x:1,z:0},8.8,{baseY:4.05,height:3.1,subtitle:'O₂ CAFE',fasciaHeight:.62,fasciaColor:'#3c4140',wallColor:'#deded5',textColor:'#f5eee0',maxProjection:.12,styleEvidence:'user photo shows O2 CAFE fascia upstairs over Yoshinoya'});
  const rear=plan.buildings.find(v=>v.style==='rear-gable'),rearFace=faceFor(rear.rings[0],{x:0,z:1});
  const xiabu=front(CBD_SHOPS[3],{x:0,z:1},Math.min(7.8,rearFace.length-.6),{...alongFace(rearFace,rearFace,Math.min(7.8,rearFace.length-.6)),baseY:rear.eaveHeight+.12,height:1.05,fasciaHeight:1.05,signOnly:true,backing:false,textColor:'#dfddd2',maxProjection:.12,styleEvidence:'user photo: freestanding roof lettering behind Burger King'});
  const yoshinoya=front(CBD_SHOPS[4],{x:1,z:0},8.8,{...alongFace(faceFor(west.ring,{x:1,z:0}),oxygen,8.8),height:3.55,fasciaHeight:.62,fasciaColor:'#bd462a',wallColor:'#dad9ce',textColor:'#fffaf0',maxProjection:.12,styleEvidence:'user photo: orange-red Yoshinoya fascia below Oxygen'});
  front(CBD_SHOPS[5],{x:0,z:1},5.5,{height:3.35,fasciaHeight:.62,fasciaColor:'#eceade',wallColor:'#d5d3c8',textColor:'#235c46',maxProjection:.12,styleEvidence:'user photo: striped fascia visible inside the lane; mapped POI locates the bay'});
  // Other bays stay anonymous: a map POI is not proof of a current storefront.
  const northFace=faceFor(north.ring,{x:0,z:1});
  for(const [index,t,width]of[[0,.12,7],[1,.65,6]]){
    const target=world(frameFor(north.ring),frameFor(north.ring).width*t,frameFor(north.ring).depth);
    plan.frontages.push({id:`cbd-north-neutral-${index}`,sourceId:north.id,brand:'neutral',title:'',subtitle:'',...alongFace(northFace,target,width),width,height:3.35,baseY:BASE,fasciaColor:['#666d5e','#6e5743','#58695d'][index],frameColor:'#4c524b',wallColor:'#c5c3ad',estimated:true,maxProjection:.12});
  }
  if(southPlan?.accepted){
    const sf=southPlan.frame,porches=southPlan.porches.slice().sort((a,b)=>a.z-b.z),start=porches[0].z+porches[0].depth/2+.6,end=porches[1].z-porches[1].depth/2-.6;
    // Complete only the lower, street-facing bays between the two porches.
    // Leave the real break between the two hall volumes and all stairs open.
    let index=0;
    for(const hall of southPlan.halls){
      const lo=Math.max(start,hall.start+.7),hi=Math.min(end,hall.end-.7),count=Math.floor((hi-lo)/5.2);if(count<1)continue;
      const pitch=(hi-lo)/count;
      for(let i=0;i<count;i++){
        const z=lo+(i+.5)*pitch,p=world(sf,hall.frontX+.3,z),width=pitch-.3;
        plan.frontages.push({id:`canteen-link-shop-${index}`,sourceId:southPlan.sourceId,brand:'neutral',title:'',x:p.x,z:p.z,nx:sf.ex.x,nz:sf.ex.z,width,height:2.94,baseY:BASE,fasciaColor:['#657168','#79634c','#705951','#647379'][index%4],frameColor:'#59615a',wallColor:'#c7c4af',estimated:true,maxProjection:.14,shutter:index%4===3,canopy:false});index++;
      }
    }
    const focus=plan.frontages.find(f=>f.id==='canteen-link-shop-2')||plan.frontages.find(f=>f.id.startsWith('canteen-link'));
    if(focus)plan.viewpoints['canteen-shops']={x:focus.x+focus.nx*7,z:focus.z+focus.nz*7,y:BASE,yaw:Math.atan2(focus.nx,focus.nz),pitch:-.06,mode:'walk',view:'first'};
  }
  const roadSegments=[];
  for(const r of model.roads){
    const g=r.feature.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[],profile=getRoadProfile(r.feature);
    for(const l of lines){const points=l.map(local);for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],length=dist(a,b);if(length<.01)continue;
      roadSegments.push({id:r.id,polygon:streetFootprint((a.x+b.x)/2,(a.z+b.z)/2,length,profile.width+.6,-Math.atan2(b.z-a.z,b.x-a.x)),a,b});
    }}
  }
  function approach(shop,roadId,frontDistance=0){
    const preferred={x:shop.x+shop.nx*frontDistance,z:shop.z+shop.nz*frontDistance};
    let nearest;for(const road of roadSegments.filter(r=>r.id===roadId)){
      const dx=road.b.x-road.a.x,dz=road.b.z-road.a.z,t=Math.max(0,Math.min(1,((preferred.x-road.a.x)*dx+(preferred.z-road.a.z)*dz)/(dx*dx+dz*dz))),p={x:road.a.x+dx*t,z:road.a.z+dz*t};
      if(!nearest||dist(p,preferred)<dist(nearest,preferred))nearest=p;
    }
    const p=nearest||{x:shop.x+shop.nx*5,z:shop.z+shop.nz*5};
    return {...p,y:BASE,yaw:Math.atan2(p.x-shop.x,p.z-shop.z),pitch:Math.atan2(BASE+1.65-(shop.baseY+shop.height-.4),dist(p,shop)),mode:'walk',view:'first',sourceRoadId:roadId};
  }
  plan.viewpoints.cbd=approach(bk,'way/1483567171');
  plan.viewpoints['cbd-zhou']=approach(zhou,'way/1483567195');
  plan.viewpoints['cbd-oxygen']=approach(oxygen,'way/1483567194',13);
  plan.viewpoints['cbd-yoshinoya']=approach(yoshinoya,'way/1483567194',8);
  // Furniture stays on spare hardscape; reject the whole footprint if it
  // overlaps any mapped road, footway, building or previously placed piece.
  const occupied=model.records.filter(r=>r.category==='building'&&r.shapes?.length).map(outline);
  const furniture=(type,x,z,width,depth,yaw=pf.yaw)=>{
    const footprint=streetFootprint(x,z,width+.4,depth+.4,yaw);
    if(occupied.some(p=>polygonsOverlap(footprint,p))||roadSegments.some(r=>polygonsOverlap(footprint,r.polygon)))return;
    const item={id:`cbd-${type}-${plan.fixtures.length}`,type,x,z,width,depth,yaw,polygon:streetFootprint(x,z,width,depth,yaw),estimated:true};plan.fixtures.push(item);occupied.push(footprint);
    plan.barriers.push({id:item.id,sourceId:pavilion.id,polygon:item.polygon,minHeight:BASE,height:type==='closed-umbrella'?3:type==='planter'?.8:1,label:'商业前场设施',estimated:true});
  };
  for(const along of[2,6,10,14,18,22]){const p=world(pf,along,pf.depth+3.8);furniture(along%3===1?'table':'planter',p.x,p.z,along%3===1?1.6:2.6,along%3===1?1.6:.65);}
  for(const offset of[4,6,8])for(const along of[2,7,12]){
    if(plan.fixtures.length>=8)break;
    const p=world(pf,pf.width+offset,along),type=along===2?'planter':along===7?'table':'closed-umbrella';
    furniture(type,p.x,p.z,type==='planter'?2.4:type==='table'?1.8:.6,type==='planter'?.65:type==='table'?1.6:.6,pf.yaw+Math.PI/2);
  }
  const patio=[world(pf,pf.width+2.4,.4),world(pf,pf.width+9,.4),world(pf,pf.width+9,pf.depth+.3),world(pf,pf.width+2.4,pf.depth+.3)];
  const cuts=[...occupied.slice(0,occupied.length-plan.fixtures.length),...roadSegments.map(r=>r.polygon)].filter(r=>polygonsOverlap(patio,r));
  const paved=polygonClipping.difference([patio.map(p=>[p.x,p.z])],...cuts.map(r=>[r.map(p=>[p.x,p.z])]));
  plan.paving=paved.map(poly=>poly.map(r=>r.map(([x,z])=>({x,z}))));
  plan.hardscapeExclusions=paved;
  return plan;
}

export function createCampusCommercialStreet(THREE,model,options={}){
  const plan=planCampusCommercialStreet(model,options),group=new THREE.Group();group.name='学一学二店廊与东 CBD';group.userData={component:'campus-commercial-street',...COMMERCIAL_EVIDENCE};
  const geometries=new Set(),materials=new Set(),batches=new Map(),dummy=new THREE.Object3D(),unit=new THREE.BoxGeometry(1,1,1);geometries.add(unit);let disposed=false;
  const material=color=>{const m=new THREE.MeshStandardMaterial({color,roughness:.88});materials.add(m);return m;};
  const plaster=material('#e2e0d7'),brick=material('#919592'),roof=material('#5d6362'),brown=material('#453831'),trim=material('#c5c4b9'),glass=material('#63756f'),frame=material('#d6d7c7');
  const box=(name,m,x,y,z,w,h,d,angle=0,roll=0)=>{const key=name+'/'+m.uuid;if(!batches.has(key))batches.set(key,{name,m,items:[]});dummy.position.set(x,y,z);dummy.rotation.set(0,angle,roll);dummy.scale.set(w,h,d);dummy.updateMatrix();batches.get(key).items.push(dummy.matrix.clone());};
  function slab(name,ring,bottom,top,m,sourceId){
    const shape=new THREE.Shape(ring.map(p=>new THREE.Vector2(p.x,-p.z))),g=new THREE.ExtrudeGeometry(shape,{depth:top-bottom,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,bottom,0);geometries.add(g);const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={sourceId,estimated:true};group.add(mesh);
  }
  for(const b of plan.buildings){
    const f=b.frame,m=b.style==='burger-pavilion'?brown:b.style==='rear-gable'?brick:plaster;
    slab(b.id,b.rings[0],BASE,b.eaveHeight,m,b.sourceId);
    if(b.roofRise){
      const verts=[],ring=b.rings[0];
      // A narrow central ridge follows the longitudinal direction of the
      // source volume. Each perimeter segment is joined to the nearest ridge.
      const height=p=>b.eaveHeight+b.roofRise*Math.max(0,1-Math.abs((p.x-f.origin.x)*f.ez.x+(p.z-f.origin.z)*f.ez.z-f.depth/2)/(f.depth/2));
      const localRing=ring.map(p=>[(p.x-f.origin.x)*f.ex.x+(p.z-f.origin.z)*f.ex.z,(p.x-f.origin.x)*f.ez.x+(p.z-f.origin.z)*f.ez.z]);
      for(const bounds of[[-5,-5,f.width+5,f.depth/2],[-5,f.depth/2,f.width+5,f.depth+5]]){
        const [x,z,xx,zz]=bounds,clip=[[x,z],[xx,z],[xx,zz],[x,zz]];
        for(const part of polygonClipping.intersection([localRing],[clip])){
          const points=part[0].slice(0,-1).map(([u,v])=>world(f,u,v));
          for(let i=1;i<points.length-1;i++)for(const p of[points[0],points[i],points[i+1]])verts.push(p.x,height(p)+.07,p.z);
        }
      }
      for(let i=0;i<ring.length;i++){
        const a=ring[i],q=ring[(i+1)%ring.length],da=(a.x-f.origin.x)*f.ez.x+(a.z-f.origin.z)*f.ez.z-f.depth/2,dq=(q.x-f.origin.x)*f.ez.x+(q.z-f.origin.z)*f.ez.z-f.depth/2,points=[a];
        if(da*dq<0){const t=da/(da-dq);points.push({x:a.x+(q.x-a.x)*t,z:a.z+(q.z-a.z)*t});}points.push(q);
        for(let j=1;j<points.length;j++){const p=points[j-1],v=points[j];verts.push(p.x,b.eaveHeight,p.z,v.x,b.eaveHeight,v.z,p.x,height(p),p.z,v.x,b.eaveHeight,v.z,v.x,height(v),v.z,p.x,height(p),p.z);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));g.computeVertexNormals();geometries.add(g);const roofMat=roof.clone();roofMat.side=THREE.DoubleSide;materials.add(roofMat);const mesh=new THREE.Mesh(g,roofMat);mesh.name='cbd-pitched-roof';mesh.userData={sourceId:b.sourceId,estimated:true};mesh.castShadow=true;group.add(mesh);
    }else slab('cbd-flat-roof-coping',b.rings[0],b.height-.06,b.height+.14,roof,b.sourceId);
    for(let i=0;i<b.rings[0].length;i++){
      const a=b.rings[0][i],q=b.rings[0][(i+1)%b.rings[0].length],length=dist(a,q),angle=-Math.atan2(q.z-a.z,q.x-a.x);
      for(const y of b.style==='burger-pavilion'?[.25,3.98]:[.26,3.75,b.eaveHeight-.16])box('cbd-horizontal-wall-bands',trim,(a.x+q.x)/2,y,(a.z+q.z)/2,length,.12,.08,angle);
      if(b.style==='burger-pavilion')box('cbd-low-dark-parapet',brown,(a.x+q.x)/2,4.08,(a.z+q.z)/2,length,.33,.12,angle);
      if(b.style==='west-two-storey')for(const y of[3.80,7.52])box('cbd-white-projecting-cornice',plaster,(a.x+q.x)/2,y,(a.z+q.z)/2,length+.12,.18,.22,angle);
    }
    if(b.style==='north-row'||b.style==='west-two-storey'){
      const face=faceFor(b.rings[0],b.style==='north-row'?{x:0,z:1}:{x:0,z:-1}),whiteBlock=b.style==='west-two-storey',count=Math.floor(face.length/(whiteBlock?1.6:2.7));
      for(let i=0;i<count;i++){
        const s=(i+.5)*face.length/count,p={x:face.a.x+face.tx*s+face.nx*.06,z:face.a.z+face.tz*s+face.nz*.06},angle=Math.atan2(face.nx,face.nz),y=whiteBlock?5.65:4.65,h=whiteBlock?2.28:1.35,w=whiteBlock?.70:1.74;
        box('cbd-upper-window-surrounds',frame,p.x,y,p.z,w+.16,h+.16,.09,angle);box('cbd-upper-window-glass',glass,p.x+face.nx*.055,y,p.z+face.nz*.055,w,h,.07,angle);
        if(!whiteBlock)box('cbd-upper-window-mullions',frame,p.x+face.nx*.1,y,p.z+face.nz*.1,.045,h,.04,angle);
        else box('cbd-upper-window-transoms',roof,p.x+face.nx*.1,y+.55,p.z+face.nz*.1,w,.035,.04,angle);
      }
    }
    if(b.style==='rear-gable'){
      const face=faceFor(b.rings[0],{x:0,z:1}),angle=Math.atan2(face.nx,face.nz),count=Math.floor((face.length-.6)/.54);
      // Small dark diamond recesses describe the photographed perforated grey
      // gable wall without adding alpha cards or opening its collision shell.
      for(let row=0;row<4;row++)for(let i=0;i<count;i++){
        const s=.4+(i+.5)*(face.length-.8)/count+(row%2)*.15;
        if(s>face.length-.3)continue;
        box('cbd-gable-diamond-recesses',roof,face.a.x+face.tx*s+face.nx*.045,4.20+row*.32,face.a.z+face.tz*s+face.nz*.045,.13,.13,.026,angle,Math.PI/4);
      }
      for(let y=.45;y<b.eaveHeight-.1;y+=.18)box('cbd-grey-brick-course-joints',trim,face.x+face.nx*.026,y,face.z+face.nz*.026,face.length-.2,.012,.012,angle);
    }
  }
  // Separate slabs are clipped around source paths, so the terrace never
  // paints over their road surface or introduces a second movement layer.
  for(const rings of plan.paving){
    const shape=new THREE.Shape(rings[0].map(p=>new THREE.Vector2(p.x,-p.z)));
    for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(ring.map(p=>new THREE.Vector2(p.x,-p.z))));
    const g=new THREE.ExtrudeGeometry(shape,{depth:.055,bevelEnabled:false});g.rotateX(-Math.PI/2);g.translate(0,.055,0);applyWorldUV(g);geometries.add(g);
    const mesh=new THREE.Mesh(g,options.surfaces?.paving||trim);mesh.name='cbd-clipped-patio-paving';mesh.receiveShadow=true;group.add(mesh);
  }
  for(const {name,m,items}of batches.values()){
    const mesh=new THREE.InstancedMesh(unit,m,items.length);mesh.name=name;items.forEach((matrix,i)=>mesh.setMatrixAt(i,matrix));mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();mesh.castShadow=!name.includes('window');mesh.receiveShadow=true;group.add(mesh);
  }
  const fronts=createCommercialFrontages(THREE,{frontages:plan.frontages,fixtures:plan.fixtures});group.add(fronts.group);
  const infrastructure={buildings:plan.buildings,barriers:plan.barriers,walkSurfaces:plan.walkSurfaces,replacedBuildingIds:plan.replacedBuildingIds,replacedRoadIds:[]};
  const fine=[];group.traverse(o=>{if(o.isMesh&&/diamond-recesses|brick-course|window-transoms|window-mullions/.test(o.name))fine.push(o);});
  const detailCenter=plan.buildings[0]?.frame.origin;
  function update(camera,options={}){fronts.update(camera,options);const p=camera?.position||camera,near=!p||!detailCenter||Math.hypot(p.x-detailCenter.x,p.z-detailCenter.z)<170*(options.detailDistanceScale||1);for(const mesh of fine)mesh.visible=near;}
  function dispose(){if(disposed)return;disposed=true;fronts.dispose();group.traverse(o=>{if(o.isInstancedMesh)o.dispose();});geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.removeFromParent();group.clear();}
  return {group,plan,infrastructure,viewpoints:plan.viewpoints,update,dispose};
}
