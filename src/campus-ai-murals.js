import {planCanteenBoundary} from './yunyuan-canteen.js';
import {getReconstructionBuildings} from './campus-feature-selection.js';
import {CAMPUS_POETRY,paintCampusMural} from './campus-poetry-art.js';
import {planCampusPoetryPlacements} from './campus-poetry-placements.js';

// Lecture artwork in the game, separate from the source map and surveyed facade.
// Quiet inscriptions stay on real blank facade/display surfaces. They belong
// to the activity artwork layer, not the surveyed architecture.
export const AI_WALL_MESSAGES = Object.freeze([
  '让 Agent 操作电脑',
  '慕课、智慧树，AI 帮你学',
  '联网搜索，交给 AI',
  '文件处理，交给 AI',
  '整理桌面，让 AI 来',
  '邮件起草，让 AI 来',
  '视频太长？AI 帮你梳理',
  '微信 · QQ · 飞书，AI 帮你回复',
  '浏览器操作，交给 Agent',
]);

function hash(value) {
  let n=2166136261;
  for(const c of value)n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;
  return n;
}

function wallEdges(record) {
  return (record.shapes??[]).flatMap(shape=>{
    const ring=shape.getPoints().map(p=>({x:p.x,z:-p.y}));
    if(ring.length>1&&Math.hypot(ring[0].x-ring.at(-1).x,ring[0].z-ring.at(-1).z)<1e-6)ring.pop();
    const area=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a.x*b.z-b.x*a.z;},0);
    const sign=area<0?1:-1;
    return ring.map((a,i)=>{
      const b=ring[(i+1)%ring.length],length=Math.hypot(b.x-a.x,b.z-a.z);
      if(length<.01)return null;
      const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
      return {a,b,length,tx,tz,nx:-tz*sign,nz:tx*sign,cx:(a.x+b.x)/2,cz:(a.z+b.z)/2};
    }).filter(Boolean);
  });
}

function onWall(id,record,edge,{lines,width,height,y,along=0,out=.04,color='#666e65',surface,background=null,style='paint',priority='ambient',opacity=.72}) {
  return {id,featureId:record.id,building:record.feature.properties?.name||record.id,lines,width,height,
    x:edge.cx+edge.tx*along+edge.nx*out,y,z:edge.cz+edge.tz*along+edge.nz*out,
    nx:edge.nx,nz:edge.nz,yaw:Math.atan2(edge.nx,edge.nz),color,surface,background,style,priority,opacity,fadeStart:24,maxDistance:65};
}

function pathEdge(path) {
  const a=path.points[0],b=path.points.at(-1),length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  return {a,b,length,tx,tz,nx:-tz,nz:tx,cx:(a.x+b.x)/2,cz:(a.z+b.z)/2};
}

function roadDistance(edge,roads) {
  let closest=Infinity;
  for(const points of roads)for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,lengthSq=dx*dx+dz*dz;
    const t=lengthSq?Math.max(0,Math.min(1,((edge.cx-a.x)*dx+(edge.cz-a.z)*dz)/lengthSq)):0;
    const x=a.x+dx*t-edge.cx,z=a.z+dz*t-edge.cz,distance=Math.hypot(x,z);
    if(x*edge.nx+z*edge.nz>distance*.45)closest=Math.min(closest,distance);
  }
  return closest;
}

function inRing(x,z,ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside;
}

export function planCampusAIMurals(model,records,{frame,geoToLocal}) {
  const source=new Map(model.records.map(r=>[r.id,r])),plan=[];
  const local=c=>geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);
  const canteen=source.get('way/103814566'),canteenShape=canteen&&planCanteenBoundary(canteen);
  if(canteenShape&&records.get(canteen.id)?.displayMode==='yunyuan-local-photo-informed'){
    const built=records.get(canteen.id),base=built.baseHeight+.08;
    // The player's original spawn faces this wall. Stay between the actual
    // door glass (top 3.415m) and floor cornice (bottom 4.66m), not over windows.
    plan.push(onWall('canteen-arrival',canteen,pathEdge(canteenShape.adjacent),{
      lines:['AI 不止会聊天'],width:2.7,height:.55,y:base+4.01,along:.65,out:.38,
      color:'#626b63',surface:'canteen-entry-blank-band',priority:'arrival',opacity:.65,
    }));
    // Reuse the existing dark 3.48 x 3.33m display on the main entry tower.
    // Its front face is at +.485m, so a .04m decal would be buried inside it.
    plan.push(onWall('canteen-entry-display',canteen,pathEdge(canteenShape.main),{
      lines:['让 Agent 操作电脑','搜索 · 文件 · 浏览器'],width:1.8,height:1.1,y:base+3.92,out:.515,
      color:'#a7ad9e',surface:'canteen-existing-entry-display',priority:'arrival',
    }));
    const messages=[
      ['电脑里的杂事，交给 Agent','联网搜索 · 处理文件 · 整理桌面与存储'],
      ['视频太长？让 AI 帮你学','慕课 · 智慧树 · 视频内容梳理'],
    ];
    canteenShape.rear.forEach((path,i)=>{
      const edge=pathEdge(path),{length}=edge;
      const h=records.get(canteen.id).height,base=records.get(canteen.id).baseHeight+.08;
      // The rear wall has window frames centred at .275h and .775h, height 1.95m.
      const low=base+h*.275+.975+.12,high=base+h*.775-.975-.12;
      const height=Math.min(1.1,high-low);
      if(height>.8)plan.push(onWall(`canteen-${i}`,canteen,edge,{lines:messages[i],width:Math.min(10,length-4),height,y:(low+high)/2,surface:'canteen-rear-blank-wall'}));
    });
  }

  const gym=source.get('way/103488139'),gymBuilt=records.get(gym?.id);
  if(gym&&gymBuilt?.displayMode==='landmark-photo-informed'){
    const edges=wallEdges(gym).filter(e=>e.length>28&&e.nz<.3).sort((a,b)=>a.nz-b.nz).slice(0,2);
    const messages=[['浏览器也能由 Agent 操作','线上仿真模拟，让 AI 辅助你探索'],['微信、QQ、飞书','让 AI 帮你回复消息']];
    edges.forEach((edge,i)=>{
      const low=8.6,high=gymBuilt.height-.7,height=Math.min(1.2,high-low);
      if(height>1)plan.push(onWall(`gym-${i}`,gym,edge,{lines:messages[i],width:Math.min(10,edge.length-5),height,y:low+height/2,out:.14,color:'#66716f',surface:'gym-upper-blank-wall'}));
    });
  }

  const eastNine=source.get('way/1023544717');
  if(eastNine&&records.get(eastNine.id)?.displayMode==='east-nine-photo-informed'){
    // This source edge is the existing A-wing end wall. Its right half is the
    // staircase; the original vertical building title starts above this area.
    const a=local([114.4221113,30.5161631]),b=local([114.4221485,30.5163435]);
    const length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
    plan.push(onWall('east-nine-a',eastNine,{tx,tz,nx:-tz,nz:tx,cx:(a.x+b.x)/2,cz:(a.z+b.z)/2},{
      lines:['配环境太烦？','让 Agent 来','把时间留给真正想学的东西'],width:4.6,height:1.8,y:4.6,along:-4.35,out:.06,surface:'east-nine-a-blank-end-wall',
    }));
  }

  const roads=model.roads.flatMap(r=>{
    const geometry=r.feature.geometry,tags=r.feature.properties?.tags??{};
    if(tags.tunnel==='yes'||tags.bridge==='yes')return [];
    return (geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[]).map(line=>line.map(local));
  });
  const footprints=getReconstructionBuildings(model).flatMap(r=>{
    const built=records.get(r.id);
    if(!built||built.profile.isRoof||built.displayMode==='part-composite-base')return [];
    return r.shapes.map(shape=>{
      const ring=shape.getPoints().map(p=>({x:p.x,z:-p.y}));
      const holes=shape.holes.map(h=>h.getPoints().map(p=>({x:p.x,z:-p.y})));
      return {ring,holes,low:built.baseHeight,high:built.height,minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minZ:Math.min(...ring.map(p=>p.z)),maxZ:Math.max(...ring.map(p=>p.z))};
    });
  });
  const clearApproach=(edge,y)=>{
    // A road may be nearby while another wing blocks the viewing side. Keep a
    // real standing/viewing corridor in front of the paint, including concave wings.
    for(let distance=2;distance<=28;distance+=2){
      const x=edge.cx+edge.nx*distance,z=edge.cz+edge.nz*distance;
      if(footprints.some(p=>p.low<=y+.08&&p.high+.08>=1.7&&x>=p.minX&&x<=p.maxX&&z>=p.minZ&&z<=p.maxZ&&inRing(x,z,p.ring)&&!p.holes.some(h=>inRing(x,z,h))))return false;
    }
    return true;
  };
  const candidates=[];
  for(const r of model.buildings){
    const built=records.get(r.id),p=built?.profile;
    if(!p||!built.mesh||built.displayMode||p.isPart||p.isRoof||p.baseHeight>0||p.facadeFeatures?.balconies||p.facadeFeatures?.stairTower)continue;
    const levels=Math.max(1,Math.round((p.height-p.baseHeight)/(p.floorHeight||3.4))),step=(p.height-p.baseHeight)/levels;
    if(levels<3)continue;
    const windowH=p.kind==='dormitory'?1.68:p.windowHeight,slab=p.baseHeight+.08+step;
    // Clear the upper edge of the projecting floor strip, the next window sill
    // and its AC units. Paint is placed directly on the remaining plaster.
    const low=slab+.34,high=slab+step*.56-windowH/2-.23,height=Math.min(.95,high-low);
    if(height<.68)continue;
    for(const [i,edge]of wallEdges(r).entries()){
      if(edge.length<20||edge.cx<-160||edge.cx>1050||edge.cz<-420||edge.cz>850)continue;
      const distance=roadDistance(edge,roads);
      if(distance<3||distance>24||!clearApproach(edge,(low+high)/2))continue;
      candidates.push({r,edge,height,y:(low+high)/2,distance,key:hash(`${r.id}/${i}/ai-walls-2026`)});
    }
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.key-b.key);
  const used=new Set(plan.map(p=>p.featureId)),chosen=[];
  for(const candidate of candidates){
    const {r,edge}=candidate;
    if(used.has(r.id)||chosen.some(p=>Math.hypot(p.edge.cx-edge.cx,p.edge.cz-edge.cz)<65))continue;
    chosen.push(candidate);used.add(r.id);
    if(chosen.length===AI_WALL_MESSAGES.length)break;
  }
  chosen.forEach(({r,edge,height,y},i)=>plan.push(onWall(`scattered-${i}`,r,edge,{
    lines:[AI_WALL_MESSAGES[i]],width:Math.min(11,edge.length-3),height:Math.min(.48,height),y,color:i%3===1?'#64716e':'#756b62',surface:'generic-clear-spandrel',
  })));
  for(const placement of planCampusPoetryPlacements(model,records,{frame,geoToLocal})){
    const poem=CAMPUS_POETRY.find(p=>p.id===placement.poetryId);
    if(!poem)continue;
    plan.push({...placement,...poem,id:`poem-${poem.id}`,poetryId:poem.id,
      color:placement.ink||'#56635c',opacity:.82,fadeStart:12,maxDistance:40,
      priority:'discovery',background:null,style:'poetry'});
  }
  return plan;
}

export function createCampusAIMurals(THREE,model,records,options) {
  const plan=planCampusAIMurals(model,records,options),group=new THREE.Group();
  group.name='校园墙上的文字与诗';
  group.userData={component:'campus-ai-murals',artwork:true,source:'activity-copy-and-authored-poetry',count:plan.length};
  const artworks=[];
  for(const item of plan){
    if(typeof document==='undefined')break;
    const canvas=document.createElement('canvas');
    canvas.width=Math.min(2048,Math.max(384,Math.ceil(item.width*220)));
    canvas.height=Math.max(32,Math.round(canvas.width*item.height/item.width));
    const ctx=canvas.getContext('2d');if(!ctx)continue;
    paintCampusMural(ctx,canvas,item);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    // Matte pigment follows the building light. Small translucent strokes and
    // a gentle distance fade preserve the architectural silhouette.
    const material=new THREE.MeshStandardMaterial({map:texture,roughness:1,transparent:true,opacity:item.opacity,alphaTest:.015,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    material.addEventListener('dispose',()=>texture.dispose());
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(item.width,item.height),material);
    mesh.name=`ai-wall-${item.id}`;mesh.position.set(item.x,item.y,item.z);mesh.rotation.y=item.yaw;mesh.renderOrder=208;
    mesh.raycast=()=>{};mesh.receiveShadow=true;
    mesh.userData={component:'campus-ai-mural',artwork:true,featureId:item.featureId,text:item.text||item.lines.join('\n'),surface:item.surface,priority:item.priority};
    group.add(mesh);artworks.push({mesh,item});
  }
  function update(camera){
    if(!camera)return;
    for(const {mesh,item} of artworks){
      const distance=camera.position.distanceTo(mesh.position),fade=Math.max(0,Math.min(1,(item.maxDistance-distance)/(item.maxDistance-item.fadeStart)));
      mesh.visible=fade>0;mesh.material.opacity=item.opacity*fade*fade*(3-2*fade);
      item.visible=mesh.visible;
    }
  }
  return {group,plan,update};
}
