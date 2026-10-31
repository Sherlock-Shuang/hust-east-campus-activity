import {getRoadProfile} from './building-profiles.js';
import {createPlayerWorld} from './player-experience.js';
import {createPlayerMotion} from './player-motion.js';

// Activity pickups beside existing source roads. These are gameplay placements,
// not surveyed parking spaces; no source geometry or movement system is edited.
export const OPTO_ROAD_TRANSPORT_SITES=Object.freeze([
  {id:'opto-scooter-south-canteen',mode:'scooter',sourceId:'way/98831423',target:{x:506,z:274}},
  {id:'opto-hoverboard-qiming-south',mode:'hoverboard',sourceId:'way/98831423',target:{x:498,z:358}},
  {id:'opto-roadster-huxi-turn',mode:'roadster',sourceId:'way/98831435',target:{x:548,z:412}},
  {id:'opto-scooter-huxi-north',mode:'scooter',sourceId:'way/98831408',target:{x:611,z:475}},
  {id:'opto-hoverboard-building-north',mode:'hoverboard',sourceId:'way/1483567206',target:{x:662,z:525}},
  {id:'opto-scooter-building-west',mode:'scooter',sourceId:'way/98831408',target:{x:612,z:643}},
].map(s=>Object.freeze({...s,target:Object.freeze(s.target)})));
const RADII={scooter:1.05,roadster:2.6,hoverboard:1.7},INTERACT={scooter:2.8,roadster:3.6,hoverboard:2.8};
const LABELS={scooter:'电动车',roadster:'特斯拉喷气跑车',hoverboard:'电动飞行器'};
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function near(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/Math.max(l2,1e-9),0,1),x=a.x+dx*t,z=a.z+dz*t;return{x,z,t,distance:Math.hypot(p.x-x,p.z-z)};}
function inside(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
function touches(p,radius,rings){return inside(p,rings[0])&&!rings.slice(1).some(r=>inside(p,r))||rings.some(r=>r.some((a,i)=>near(p,a,r[(i+1)%r.length]).distance<radius));}
function linePose(points,progress){let remaining=clamp(progress,0,points.slice(1).reduce((sum,p,i)=>sum+distance(points[i],p),0));for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=distance(a,b);if(length<.001)continue;if(remaining<=length||i===points.length-1){const t=clamp(remaining/length,0,1),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;return{x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(-tx,-tz),nx:-tz,nz:tx};}remaining-=length;}return null;}
function nearestProgress(points,target){let sum=0,best;for(let i=1;i<points.length;i++){const length=distance(points[i-1],points[i]),p=near(target,points[i-1],points[i]);if(!best||p.distance<best.distance)best={distance:p.distance,progress:sum+p.t*length};sum+=length;}return best?.progress;}
function reservationRadius(r){return (r.height??0)>3?Math.max(.65,(r.radius??3.5)*.18):r.radius??.7;}

/** A bounded, deterministic source-road search, performed once at startup.
 * The passed vegetation is the exact rendered forest plan, avoiding a second
 * expensive forest build. Tall-tree radius is trunk clearance, not its canopy. */
export function planOptoRoadTransport({model,route,frame,geoToLocal,groundAt,canPlaceMode,treeReservations=[]}={}){
  const items=[],rejected=[],empty={items,rejected,counts:{scooter:0,roadster:0,hoverboard:0}};
  if(!model?.records||!route?.points?.length||!frame||typeof geoToLocal!=='function')return empty;
  const project=c=>{const p=geoToLocal({longitude:c[0],latitude:c[1],height:0,coordinateSystem:'EPSG:4326'},frame);return{x:p.x,z:p.z};};
  const roads=(model.roads||[]).map(r=>{const g=r.feature.geometry;return{id:r.id,profile:getRoadProfile(r.feature),lines:(g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[]).map(l=>l.map(project))};});
  const world=createPlayerWorld(model),motion=groundAt&&canPlaceMode?null:createPlayerMotion({route,world});groundAt??=motion.groundAt;canPlaceMode??=motion.canPlaceMode;
  const blocks=[...world.buildings,...world.barriers,...world.water].filter(b=>world.water.includes(b)||((b.height??0)>.15&&(b.minHeight??0)<2.4)).map(b=>b.rings??(b.polygon?[b.polygon]:[])).filter(r=>r[0]?.length>=3);
  const entryAreas=(world.walkSurfaces||[]).filter(s=>/entry|approach|stair|porch/i.test(s.kind||s.id||'')).map(s=>[s.polygon,...(s.holes||[])]).filter(r=>r[0]?.length>=3);
  const reservations=[...treeReservations,...(model.photoForecourtReservations||[]),...(route.roadsideTrees||[]).map(p=>({...p,radius:.8,height:0})),...(route.parkingPlaces||[]).map(p=>({...p,radius:1.15,height:0}))];
  const clear=(p,radius,mode)=>{
    const g=groundAt(p.x,p.z,radius,.14);if(!g?.allowed||g.onBridge||!Number.isFinite(g.height)||Math.abs(g.height-.14)>.08)return false;
    if(blocks.some(r=>touches(p,radius+.12,r))||reservations.some(r=>distance(p,r)<radius+reservationRadius(r)+.25))return false;
    return canPlaceMode({...p,y:g.height,yaw:p.yaw??0},mode)?.ok===true;
  };
  for(const site of OPTO_ROAD_TRANSPORT_SITES){
    const road=roads.find(r=>r.id===site.sourceId),radius=RADII[site.mode];
    if(!road||road.profile.bridge||road.profile.tunnel||road.profile.elevation!==0||road.lines.length!==1||road.lines[0].length<2){rejected.push({id:site.id,reason:'missing-or-nonground-source-road'});continue;}
    const points=road.lines[0],progress=nearestProgress(points,site.target);let placed=false;
    for(const shift of[0,6,-6,12,-12,18,-18]){
      if(placed)break;const at=linePose(points,progress+shift);if(!at)continue;
      for(const side of[1,-1]){
        if(placed)break;
        for(const extra of[.45,1.5,3]){
          const offset=road.profile.width/2+radius+extra,p={x:at.x+at.nx*offset*side,z:at.z+at.nz*offset*side,yaw:at.yaw};
          // Preserve every road/sidewalk's entire current width, including
          // crossing ways, not just the road this pickup is associated with.
          if(roads.some(r=>r.lines.some(l=>l.some((b,i)=>i&&near(p,l[i-1],b).distance<r.profile.width/2+radius+.3))))continue;
          if(entryAreas.some(r=>touches(p,radius+1.2,r))||items.some(q=>distance(p,q)<radius+RADII[q.mode]+8)||!clear(p,radius,site.mode))continue;
          // Board from the front/rear roadside shoulder. A radial point toward
          // the road would put the walker back inside the motor lane when the
          // vehicle is parked close to the kerb.
          const boardingDistance=radius+.55;let boardingPose,approachPose;
          if(boardingDistance>INTERACT[site.mode])continue;
          for(const direction of[1,-1]){
            const dx=-Math.sin(at.yaw)*boardingDistance*direction,dz=-Math.cos(at.yaw)*boardingDistance*direction;
            const board={x:p.x+dx,z:p.z+dz,y:.14,yaw:at.yaw},approach={x:at.x+at.nx*(road.profile.width/2+.55)*side+dx,z:at.z+at.nz*(road.profile.width/2+.55)*side+dz,y:.14,yaw:at.yaw};
            const length=distance(approach,board),steps=Math.max(1,Math.ceil(length/.25));let approachable=true;
            for(let i=0;i<=steps;i++){const t=i/steps,q={x:approach.x+(board.x-approach.x)*t,z:approach.z+(board.z-approach.z)*t,yaw:at.yaw};if(!clear(q,.38,'walk')||roads.some(r=>r.profile.motor&&r.lines.some(l=>l.some((b,j)=>j&&near(q,l[j-1],b).distance<r.profile.width/2+.38)))){approachable=false;break;}}
            if(approachable){boardingPose=board;approachPose=approach;break;}
          }
          if(!boardingPose)continue;
          const y=groundAt(p.x,p.z,0,.14).height;
          items.push({id:site.id,mode:site.mode,label:LABELS[site.mode],source:'placed',x:p.x,y,z:p.z,yaw:p.yaw,sourceId:site.sourceId,placement:'光电楼沿路',interactionRadius:INTERACT[site.mode],clearanceRadius:radius,boardingPose:{...boardingPose,y:groundAt(boardingPose.x,boardingPose.z,0,.14).height},approachPose:{...approachPose,y:groundAt(approachPose.x,approachPose.z,0,.14).height},roadPose:{x:at.x,z:at.z,y:.14,yaw:at.yaw},taken:false});placed=true;break;
        }
      }
    }
    if(!placed)rejected.push({id:site.id,reason:'no-clear-roadside-vehicle-and-walking-access'});
  }
  return{...empty,counts:Object.fromEntries(Object.keys(empty.counts).map(mode=>[mode,items.filter(i=>i.mode===mode).length]))};
}
