import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { waterFootprint } from './water-details.js';
import { planCanteenBoundary } from './yunyuan-canteen.js';

// Activity props, deliberately separate from the surveyed/static campus model.
// Positions are game placements, not claims about real campus aircraft or boats.
const NAMES={spider:'蜘蛛侠战衣',roadster:'特斯拉喷气跑车',hoverboard:'电动飞行器',helicopter:'直升机',boat:'湖畔游艇'};
const RADII={spider:.7,roadster:2.6,hoverboard:1.7,helicopter:5,boat:3.5};
const INTERACT={spider:2.5,roadster:3.6,hoverboard:2.8,helicopter:4.6,boat:3.1};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finite=Number.isFinite;
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
function segmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/Math.max(1e-9,dx*dx+dz*dz)));return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function routePose(route,progress){const p=route.points,at=Math.max(0,Math.min(route.length??p.at(-1).progress,progress));let i=1;while(i<p.length-1&&p[i].progress<at)i++;const a=p[i-1],b=p[i],length=Math.hypot(b.x-a.x,b.z-a.z),t=Math.max(0,Math.min(1,(at-a.progress)/Math.max(.01,b.progress-a.progress)));const seg=route.segments?.find(s=>at>=s.startProgress&&at<=s.endProgress);return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(a.x-b.x,a.z-b.z),width:seg?.width??8,progress:at,sourceId:seg?.sourceId};}
function sourceSpawn(model){const canteen=model.buildings?.find(r=>r.id==='way/103814566'),edge=canteen&&planCanteenBoundary(canteen)?.adjacent;if(!edge)return null;const[a,b]=edge.points,l=distance(a,b),tx=(b.x-a.x)/l,tz=(b.z-a.z)/l;return{x:a.x+tx*2.4-tz*10,z:a.z+tz*2.4+tx*10,yaw:Math.atan2(-tz,tx)};}

export function planWorldTransport({model,route,groundAt=()=>({height:.14,allowed:true}),canPlaceMode}={}){
  const items=[],rejected=[],spawn=sourceSpawn(model);
  const blockers=[...(model.buildings||[]),...(model.water||[])].map(waterFootprint).filter(Boolean);
  const barriers=[...(model.architectureInfrastructure?.barriers||[]),...(model.sportsInfrastructure?.barriers||[]),...(model.parkingInfrastructure?.barriers||[])];
  const reservations=model.photoForecourtReservations||[];
  function clear(p,mode,radius=RADII[mode]){
    if(![p.x,p.z,p.yaw].every(finite))return false;
    if(mode!=='spider'&&mode!=='walk'&&spawn&&distance(p,spawn)<radius+1.2)return false;
    const g=groundAt(p.x,p.z,radius,p.y??.14);if(!g.allowed)return false;
    if(blockers.some(b=>b.contains(p.x,p.z)||b.distance(p.x,p.z)<radius))return false;
    if(barriers.some(b=>b.polygon?.length&&(inside(p,b.polygon)||b.polygon.some((a,i)=>segmentDistance(p,a,b.polygon[(i+1)%b.polygon.length])<radius))))return false;
    if(reservations.some(q=>distance(p,q)<radius+(q.radius??1)))return false;
    if(items.some(q=>q.mode!=='boat'&&distance(p,q)<radius+RADII[q.mode]+2))return false;
    if(canPlaceMode&&canPlaceMode({...p,y:g.height},mode)?.ok===false)return false;
    return true;
  }
  function add(mode,pose,extra={}){const item={id:`world-${mode}-${items.filter(p=>p.mode===mode).length+1}`,mode,label:NAMES[mode],source:'placed',x:pose.x,z:pose.z,y:pose.y??groundAt(pose.x,pose.z,0,.14).height,yaw:pose.yaw??0,interactionRadius:INTERACT[mode],taken:false,...extra};items.push(item);return item;}
  // Only this source lawn can host the single helicopter; no fallback aircraft.
  const lawn=waterFootprint((model.records||[]).find(r=>r.id==='way/98867860')||{});
  if(lawn){const b=lawn.bounds,cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,candidates=[];for(let x=b.minX+6;x<b.maxX-6;x+=3)for(let z=b.minZ+6;z<b.maxZ-6;z+=3)candidates.push({x,z,yaw:Math.PI/2});candidates.sort((a,b)=>Math.hypot(a.x-cx,a.z-cz)-Math.hypot(b.x-cx,b.z-cz));const p=candidates.find(p=>lawn.contains(p.x,p.z)&&lawn.distance(p.x,p.z)>6&&clear(p,'helicopter'));if(p)add('helicopter',p,{placement:'韵苑草坪',sourceId:'way/98867860'});else rejected.push({mode:'helicopter',reason:'韵苑草坪没有足够净空'});}
  function roadside(mode,target,index){
    const offsets=[0,6,-6,12,-12,20,-20,32,-32,48,-48,70,-70];
    for(const shift of offsets){const p=routePose(route,target+shift);for(const side of[1,-1])for(const extra of[1.5,3,5,7]){const offset=p.width/2+RADII[mode]+extra,q={x:p.x+Math.cos(p.yaw)*offset*side,z:p.z-Math.sin(p.yaw)*offset*side,yaw:p.yaw};if(clear(q,mode))return add(mode,q,{placement:'校园路边',routeProgress:p.progress,sourceId:p.sourceId});}}
    rejected.push({mode,index,reason:'路边没有足够净空'});return null;
  }
  const length=route.length??route.points.at(-1).progress;
  for(const [i,t]of[.412,.25,.88].entries())roadside('roadster',length*t,i);
  for(const [i,t]of[.397,.13,.29,.72,.94].entries())roadside('hoverboard',length*t,i);
  let nearSuit=false;
  if(spawn){for(const side of[1,-1])for(const d of[3.4,4.8,6.2]){if(nearSuit)break;const p={x:spawn.x+Math.cos(spawn.yaw)*d*side,z:spawn.z-Math.sin(spawn.yaw)*d*side,yaw:spawn.yaw+.3};if(clear(p,'spider')){add('spider',p,{placement:'韵苑食堂前'});nearSuit=true;}}}
  const suiteFractions=nearSuit?[.045,.12,.19,.28,.335,.49,.65,.78,.95]:[.40,.045,.12,.19,.28,.335,.49,.65,.78,.95];
  for(const[i,t]of suiteFractions.entries())roadside('spider',length*t,i);
  // Two shore-parallel boats are moored in the real lake polygon, away from its
  // island holes and buildings. Boarding positions stay on solid land.
  const lake=(model.water||[]).find(r=>r.id==='relation/13705236'),water=lake&&waterFootprint(lake);
  if(water){const candidates=[];for(const rings of water.polygons)for(let i=0;i<rings[0].length;i++){const a=rings[0][i],b=rings[0][(i+1)%rings[0].length],len=distance(a,b);if(len<9)continue;const tx=(b.x-a.x)/len,tz=(b.z-a.z)/len;for(let along=4;along<len-4;along+=5)for(const side of[-1,1]){const bank={x:a.x+tx*along,z:a.z+tz*along},nx=-tz*side,nz=tx*side,p={x:bank.x+nx*2.1,z:bank.z+nz*2.1,yaw:Math.atan2(-tx,-tz)},shore={x:bank.x-nx*1.7,z:bank.z-nz*1.7,yaw:Math.atan2(-nx,-nz)};if(!water.contains(p.x,p.z)||water.distance(p.x,p.z)<1.3||!clear(shore,'walk',.45))continue;const hull=[-2.7,-2.1,0,2.1,2.7].flatMap(v=>[-1,1].map(w=>({x:p.x+tx*v+nx*w*(Math.abs(v)>2.2?.5:1.2),z:p.z+tz*v+nz*w*(Math.abs(v)>2.2?.5:1.2)})));if(hull.some(q=>!water.contains(q.x,q.z)))continue;const y=lake.mesh?.position.y??.022;if(canPlaceMode&&canPlaceMode({...p,y},'boat')?.ok===false)continue;const nearRoute=Math.min(...route.points.map(q=>distance(q,shore)));if(nearRoute>80)continue;candidates.push({...p,y,boardingPose:{...shore,y:groundAt(shore.x,shore.z,0,.14).height},score:nearRoute,sourceId:lake.id});}}
    candidates.sort((a,b)=>a.score-b.score);for(const p of candidates){if(items.filter(i=>i.mode==='boat').length===2)break;if(items.some(q=>q.mode==='boat'&&distance(p,q)<90))continue;add('boat',p,{placement:'东九湖岸',boardingPose:p.boardingPose,sourceId:lake.id});}
  }
  return{items,rejected,counts:Object.fromEntries(Object.keys(NAMES).map(mode=>[mode,items.filter(i=>i.mode===mode).length]))};
}

function createFoldedSuit(THREE){
  const group=new THREE.Group(),geometries=new Set(),materials=new Set();group.name='folded-spider-suit';
  const mat=color=>{const m=new THREE.MeshStandardMaterial({color,roughness:.91,metalness:0});materials.add(m);return m;};const red=mat('#a72d37'),blue=mat('#1f3e6b'),dark=mat('#18202a'),white=mat('#e5e6df');
  function form(name,scale,position,material,rotation=[0,0,0]){const g=new THREE.SphereGeometry(1,16,10);g.scale(...scale);geometries.add(g);const m=new THREE.Mesh(g,material);m.name=name;m.position.set(...position);m.rotation.set(...rotation);m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
  form('folded-blue-legs',[.26,.10,.34],[.01,.10,.15],blue);form('folded-red-chest',[.32,.085,.32],[0,.24,0],red);
  form('folded-left-sleeve',[.095,.09,.26],[-.29,.18,.02],red,[0,-.55,0]);form('folded-right-sleeve',[.095,.09,.25],[.23,.32,.01],red,[0,.8,.13]);
  form('loose-mask',[.15,.07,.19],[-.04,.11,-.44],red,[.05,0,0]);
  for(const side of[-1,1])form(`mask-eye-${side}`,[.045,.009,.065],[-.04+side*.064,.179,-.47],white,[0,side*.35,side*-.15]);
  form('chest-spider-body',[.035,.009,.065],[0,.328,-.04],dark);
  function line(points,name,r=.004){const g=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p))),12,r,3,false);geometries.add(g);const m=new THREE.Mesh(g,dark);m.name=name;group.add(m);}
  for(const side of[-1,1])for(let i=0;i<4;i++)line([[side*.02,.329,-.07+i*.023],[side*(.07+i*.011),.331,-.16+i*.07],[side*(.13+i*.014),.313,-.22+i*.12]],'embroidered-spider-leg',.007);
  for(let i=-2;i<=2;i++)line([[i*.065,.31,-.24],[i*.07,.331,-.04],[i*.065,.312,.22]],'cloth-web-thread');
  return{group,dispose(){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}};
}

export function createWorldTransport({THREE,scene,model,route,groundAt,canPlaceMode,playerModels}={}){
  const plan=planWorldTransport({model,route,groundAt,canPlaceMode}),items=plan.items;
  const group=new THREE.Group();group.name='活动载具与战衣';group.userData={dynamicActivityProps:true,excludeFromCampusExport:true};scene.add(group);
  const suit=createFoldedSuit(THREE),resources=[suit],mergedGeometries=new Set();
  // Parked props do not animate: bake their local transforms once and batch by
  // material. Repeated vehicles share these buffers instead of submitting every
  // nut, rotor blade and panel as an additional draw call each frame.
  function staticTemplate(source,mode){
    if(!source)throw new Error(`Missing player model for world transport: ${mode}`);
    const cloned=source.clone(true);cloned.visible=true;
    cloned.traverse(o=>{if(o.name==='hoverboard-standing-rider'||/roadster-driver-|roadster-upper-arm-|roadster-forearm-/.test(o.name)||o.name==='boat-driver'||o.name==='yacht-driver')o.visible=false;if(o.name==='helicopter-rotor-motion-disc'||o.name==='roadster-cold-gas-condensation')o.visible=false;});
    cloned.updateMatrixWorld(true);const batches=new Map(),result=new THREE.Group();
    cloned.traverse(o=>{
      if(!o.isMesh||o.isSkinnedMesh)return;for(let p=o;p;p=p.parent)if(!p.visible)return;
      // Every current transport part has one material; retain a future authored
      // material-array mesh without flattening away its face groups.
      if(Array.isArray(o.material)){const copy=o.clone();copy.applyMatrix4(o.parent.matrixWorld);result.add(copy);return;}
      let geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);if(geometry.index){const expanded=geometry.toNonIndexed();geometry.dispose();geometry=expanded;}
      const signature=Object.keys(geometry.attributes).sort().map(k=>`${k}:${geometry.attributes[k].itemSize}`).join(','),key=`${o.material.uuid}/${signature}`;
      if(!batches.has(key))batches.set(key,{material:o.material,geometries:[],names:[],castShadow:o.castShadow,receiveShadow:o.receiveShadow,renderOrder:o.renderOrder});const batch=batches.get(key);batch.geometries.push(geometry);batch.names.push(...(o.userData.sourceParts||[o.name]));
    });
    for(const batch of batches.values()){
      const geometry=mergeGeometries(batch.geometries,false);if(!geometry)throw new Error('Static transport parts have incompatible geometry.');mergedGeometries.add(geometry);for(const g of batch.geometries)g.dispose();
      const mesh=new THREE.Mesh(geometry,batch.material);mesh.name=`parked-${mode}-material`;mesh.userData.sourceParts=batch.names;mesh.castShadow=batch.castShadow;mesh.receiveShadow=batch.receiveShadow;mesh.renderOrder=batch.renderOrder;result.add(mesh);
    }
    result.userData={staticBatched:true,drawMeshes:result.children.length,sourceMeshes:[...batches.values()].reduce((n,b)=>n+b.names.length,0)};return result;
  }
  const templates={spider:staticTemplate(suit.group,'spider')};
  for(const mode of['roadster','hoverboard','helicopter','boat'])templates[mode]=staticTemplate(playerModels?.group.getObjectByName(`player-${mode}`),mode);
  for(const item of items){const visual=templates[item.mode].clone(true);visual.visible=true;visual.name=item.id;
    visual.position.set(item.x,item.y,item.z);visual.rotation.set(0,item.yaw,0);group.add(visual);item.visual=visual;
  }
  const ringGeometry=new THREE.RingGeometry(.52,.57,40),ringMaterial=new THREE.MeshBasicMaterial({color:'#edf4da',transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
  const ring=new THREE.Mesh(ringGeometry,ringMaterial);ring.rotation.x=-Math.PI/2;ring.visible=false;ring.name='nearby-transport-ring';group.add(ring);let disposed=false;
  function nearest(pose){if(!pose||!finite(pose.x)||!finite(pose.z))return null;let best=null,bestDistance=Infinity;for(const item of items){if(item.taken)continue;const at=item.mode==='boat'&&item.boardingPose?item.boardingPose:item,d=distance(pose,at);if(d>item.interactionRadius||Math.abs((pose.y??at.y)-at.y)>.45)continue;if(d<bestDistance){best=item;bestDistance=d;}}return best;}
  function take(item){if(disposed||!items.includes(item)||item.taken)return{ok:false,reason:'载具已在使用中'};item.taken=true;item.visual.visible=false;ring.visible=false;return{ok:true,item,pose:{x:item.x,y:item.y,z:item.z,yaw:item.yaw}};}
  function release(item,pose){if(disposed||!items.includes(item)||!item.taken||!pose||![pose.x,pose.y,pose.z,pose.yaw].every(finite))return{ok:false,reason:'无法放下载具'};Object.assign(item,{x:pose.x,y:pose.y,z:pose.z,yaw:pose.yaw,taken:false});if(item.mode==='boat'&&item.boardingPose&&distance(item,item.boardingPose)>8)item.boardingPose=null;item.visual.position.set(item.x,item.y,item.z);item.visual.rotation.set(0,item.yaw,0);item.visual.visible=true;return{ok:true};}
  function getDismountCandidates(item,pose){const result=[],base=item.mode==='helicopter'?5:item.mode==='roadster'?2:item.mode==='boat'?2.2:1.4;for(const radius of[base,base+1.1,base+2.5,...(item.mode==='boat'?[6.8]:[])])for(const offset of[Math.PI/2,-Math.PI/2,Math.PI,0,Math.PI/4,-Math.PI/4,Math.PI*.75,-Math.PI*.75]){const angle=(pose.yaw??0)+offset;result.push({x:pose.x-Math.sin(angle)*radius,z:pose.z-Math.cos(angle)*radius,yaw:pose.yaw??0});}if(item.boardingPose&&distance(pose,item.boardingPose)<8)result.push({...item.boardingPose});return result;}
  function update(dt,pose){if(disposed)return;for(const item of items)item.visual.visible=!item.taken&&(!pose||distance(item,pose)<220);const candidate=pose?.mode==='walk'?nearest(pose):null;ring.visible=!!candidate;if(candidate){const p=candidate.boardingPose||candidate;ring.position.set(p.x,p.y+.018,p.z);ring.scale.setScalar(candidate.mode==='spider'?1:1.5);}}
  function dispose(){if(disposed)return;disposed=true;group.removeFromParent();group.clear();for(const resource of resources)resource.dispose();for(const geometry of mergedGeometries)geometry.dispose();mergedGeometries.clear();ringGeometry.dispose();ringMaterial.dispose();}
  return{group,items,plan,nearest,take,release,getDismountCandidates,update,dispose};
}
