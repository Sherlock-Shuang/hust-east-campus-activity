/** Playable campus movement in metres/seconds; deliberately simplified controls,
 * not a road-safety or aircraft flight model. No renderer or DOM dependencies.
 * Local forward is -Z. Positive turn is left (increasing yaw).
 * y is the feet / wheel / helicopter skid contact plane, not the actor centre.
 */
import {createWebSwingMotion} from './web-swing-motion.js';
const STEP=1/120,BASE_Y=.14,EPS=1e-7,STEP_UP=.22;
const MODES=new Set(['walk','scooter','helicopter','roadster','hoverboard','spider','boat']);
// Roadster dimensions and dynamics below are gameplay/model estimates, not
// Tesla engineering or flight-envelope data. The visual uses cold-gas mist.
// Hoverboard performance and collision margins are simulation estimates.
const HOVERBOARD={cruiseSpeed:24,fastSpeed:36,reverseSpeed:7,verticalSpeed:5.8,ceiling:60,footX:.74,footZ:.36};
const ROADSTER={wheelbase:2.65,wheelRadius:.37,halfTrack:.88,groundSpeed:12,boostSpeed:18,reverseSpeed:3,flightSpeed:18,flightBoostSpeed:28,gravity:9.81,liftAcceleration:18,maxAscent:8.4,maxDescent:32,ceiling:80};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const approach=(value,target,amount)=>value<target?Math.min(target,value+amount):Math.max(target,value-amount);
const finite=Number.isFinite;
function distanceToSegment(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=l2?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/l2,0,1):0;return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
function inRing(p,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)hit=!hit;}return hit;}
function polygonRecords(records){return(records||[]).filter(r=>r.rings?.[0]?.length>=3).map(record=>{const ring=record.rings[0];return{...record,minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minZ:Math.min(...ring.map(p=>p.z)),maxZ:Math.max(...ring.map(p=>p.z))};});}
function overlapsPolygon(p,radius,polygon){
  if(p.x+radius<polygon.minX||p.x-radius>polygon.maxX||p.z+radius<polygon.minZ||p.z-radius>polygon.maxZ)return false;
  const rings=polygon.rings;if(inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r)))return true;
  return rings.some(r=>r.some((a,i)=>distanceToSegment(p,a,r[(i+1)%r.length])<radius-EPS));
}
function standardBodySamples(x,z,yaw,mode){const radius=mode==='spider'?.37:mode==='walk'?.26:mode==='scooter'?.42:4;
  if(mode==='boat')return[-2.7,-2.1,-1.1,0,1.1,2.1,2.7].map(offset=>({x:x-Math.sin(yaw)*offset,z:z-Math.cos(yaw)*offset,radius:Math.abs(offset)>2.5?.5:Math.abs(offset)>2?1.0:1.2,minY:-.38,maxY:2.75}));
  if(mode==='spider')return[{x,z,radius,minY:0,maxY:2.08}];
  if(mode==='helicopter')return[{x:x+Math.sin(yaw)*.12,z:z+Math.cos(yaw)*.12,radius},{x:x+Math.sin(yaw)*4.22,z:z+Math.cos(yaw)*4.22,radius:.72}];
  if(mode==='roadster')return[-1.225,-.8,-.4,0,.4,.8,1.225].map(offset=>({x:x-Math.sin(yaw)*(offset-.022),z:z-Math.cos(yaw)*(offset-.022),radius:1.1}));
  if(mode!=='scooter')return[{x,z,radius}];
  return[-.50,.52].map(offset=>({x:x-Math.sin(yaw)*offset,z:z-Math.cos(yaw)*offset,radius}));
}

export function createPlayerMotion({route,world={},traffic=()=>[],getPoseAt}={}){
  if(!route?.points||route.points.length<2)throw new TypeError('Player movement requires a metre-scale route.');
  const points=route.points.map((p,i)=>({...p,progress:finite(p.progress)?p.progress:i?NaN:0}));
  for(let i=1;i<points.length;i++)if(!finite(points[i].progress))points[i].progress=points[i-1].progress+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z);
  const length=route.length??points.at(-1).progress,buildings=polygonRecords(world.buildings),water=polygonRecords(world.water),bounds=world.bounds;
  const bridgeSurfaceCells=new Map(),bridgeSolidCells=new Map(),walkSurfaceCells=new Map(),barrierCells=new Map(),surfaceCell=24;
  const bridgeSurfaces=[...(route.roadSurfaces||[]),...(world.walkSurfaces||[]).filter(s=>s.bridge)].filter(s=>s.bridge&&s.polygon?.length>=3&&finite(s.surfaceY));
  // Elevated decks are slabs, not columns extending to the ground. Keep the
  // source height and the same thickness as the rendered bridge ribbon.
  const bridgeSolids=bridgeSurfaces.filter(s=>s.surfaceY>BASE_Y+.35).map(s=>({...s,id:`bridge-deck:${s.sourceId??''}`,label:'桥面净空不足',minHeight:s.surfaceY-(s.deckDepth??.75),height:s.surfaceY,rings:[s.polygon]}));
  const barriers=polygonRecords([...(world.barriers||[]).filter(b=>b.polygon?.length>=3&&finite(b.height)&&b.height>(b.minHeight??0)).map(b=>({...b,minHeight:b.minHeight??0,rings:[b.polygon]})),...bridgeSolids]);
  const walkSurfaces=(world.walkSurfaces||[]).filter(s=>!s.bridge&&s.polygon?.length>=3&&finite(s.surfaceY));
  function addIndexed(cells,record,polygon){
    const b=record.bounds??{minX:Math.min(...polygon.map(p=>p.x)),maxX:Math.max(...polygon.map(p=>p.x)),minZ:Math.min(...polygon.map(p=>p.z)),maxZ:Math.max(...polygon.map(p=>p.z))};
    for(let x=Math.floor(b.minX/surfaceCell);x<=Math.floor(b.maxX/surfaceCell);x++)for(let z=Math.floor(b.minZ/surfaceCell);z<=Math.floor(b.maxZ/surfaceCell);z++){const key=`${x}/${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(record);}
  }
  function indexedIn(cells,minX,minZ,maxX,maxZ){
    const x0=Math.floor(minX/surfaceCell),z0=Math.floor(minZ/surfaceCell),x1=Math.floor(maxX/surfaceCell),z1=Math.floor(maxZ/surfaceCell);
    if(x0===x1&&z0===z1)return cells.get(`${x0}/${z0}`)||[];
    const found=new Set();for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const record of cells.get(`${x}/${z}`)||[])found.add(record);return found;
  }
  for(const barrier of barriers)addIndexed(barrierCells,barrier,barrier.polygon);
  for(const solid of bridgeSolids)addIndexed(bridgeSolidCells,solid,solid.polygon);
  for(const surface of walkSurfaces)addIndexed(walkSurfaceCells,surface,surface.polygon);
  function walkHeight(x,z,base){for(const s of walkSurfaceCells.get(`${Math.floor(x/surfaceCell)}/${Math.floor(z/surfaceCell)}`)||[])if(inRing({x,z},s.polygon)&&!(s.holes||[]).some(h=>inRing({x,z},h)))base=Math.max(base,s.surfaceY);return base;}
  // Infrastructure is deliberately separate from buildings: fence rails do
  // not become roof targets or web anchors. Height values are absolute local Y.
  function barrierAt(p,radius,minY=0,maxY=2){
    if(!barriers.length)return null;
    for(const b of indexedIn(barrierCells,p.x-radius,p.z-radius,p.x+radius,p.z+radius))if(p.y+minY<b.height-EPS&&p.y+maxY>b.minHeight+EPS&&overlapsPolygon(p,radius,b))return b;return null;
  }
  function barrierSweep(from,to,radius,minY=0,maxY=2){
    if(!barriers.length)return false;
    const candidates=indexedIn(barrierCells,Math.min(from.x,to.x)-radius,Math.min(from.z,to.z)-radius,Math.max(from.x,to.x)+radius,Math.max(from.z,to.z)+radius);
    if(!candidates.size&&!candidates.length)return false;
    const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z)/Math.max(.04,Math.min(.12,radius))));
    for(let i=0;i<=steps;i++){const t=i/steps,p={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t};for(const b of candidates)if(p.y+minY<b.height-EPS&&p.y+maxY>b.minHeight+EPS&&overlapsPolygon(p,radius,b))return true;}return false;
  }
  function barrierVertical(from,to,radius,minY=0,maxY=2){
    let y=to.y,reason='';if(!barriers.length)return {y,reason};for(const b of indexedIn(barrierCells,to.x-radius,to.z-radius,to.x+radius,to.z+radius)){
      if(!overlapsPolygon(to,radius,b))continue;
      if(from.y+minY>=b.height-EPS&&y+minY<b.height){y=Math.max(y,b.height-minY+.005);reason=b.label||'围栏边界';}
      else if(from.y+maxY<=b.minHeight+EPS&&y+maxY>b.minHeight){y=Math.min(y,b.minHeight-maxY-.005);reason=b.label||'上方设施净空不足';}
    }return {y,reason};
  }
  // Camera clearance needs only height, not route progress or water permission.
  // The actual campus route is level; its bridge decks already have a spatial
  // index. Keep non-level/custom routes on the full contact query below.
  const levelRoute=points.every(p=>Math.abs((p.y??.16)-.02-BASE_Y)<1e-10);
  let maximumGroundHeight=Math.max(BASE_Y,...points.map(p=>(p.y??.16)-.02),...walkSurfaces.map(s=>s.surfaceY));
  for(const surface of bridgeSurfaces){
    if(finite(surface.surfaceY))maximumGroundHeight=Math.max(maximumGroundHeight,surface.surfaceY);
    const b=surface.bounds??{minX:Math.min(...surface.polygon.map(p=>p.x)),maxX:Math.max(...surface.polygon.map(p=>p.x)),minZ:Math.min(...surface.polygon.map(p=>p.z)),maxZ:Math.max(...surface.polygon.map(p=>p.z))};
    for(let x=Math.floor(b.minX/surfaceCell);x<=Math.floor(b.maxX/surfaceCell);x++)for(let z=Math.floor(b.minZ/surfaceCell);z<=Math.floor(b.maxZ/surfaceCell);z++){const key=`${x}/${z}`;if(!bridgeSurfaceCells.has(key))bridgeSurfaceCells.set(key,[]);bridgeSurfaceCells.get(key).push(surface);}
  }
  let accumulator=0,verticalSpeed=0,previousBodyPose=null,jumpPending=false,zipPending=false,pointPending=false;
  let roadsterAcceleration=0,roadsterYawRate=0;
  let groundAcceleration=0,walkYawRate=0;
  let boardAcceleration=0,boardYawRate=0,boardLastVertical=0,boardTargeted=false;
  const state={mode:'walk',x:0,y:BASE_Y,z:0,yaw:0,speed:0,vx:0,vz:0,steeringAngle:0,lean:0,pitch:0,distance:0,grounded:true,rotorPower:0,flightEnabled:false,jetPower:0,forwardJetPower:0,blockedReason:'',progress:0,verticalSpeed:0,elapsed:0,braking:false,acceleration:0,yawRate:0,altitudeTarget:null,flightPhase:'ground'};
  function resetRoadsterControls(){roadsterAcceleration=0;roadsterYawRate=0;state.acceleration=0;state.yawRate=0;state.forwardJetPower=0;state.altitudeTarget=null;state.flightPhase=state.mode==='roadster'?(state.grounded?(state.flightEnabled?'armed':'ground'):'coasting'):'ground';}
  function resetGroundControls(){groundAcceleration=0;walkYawRate=0;state.vx=0;state.vz=0;}
  function worldWalk(input,brake){
    // Keep velocity on the captured activity state: returning from a work,
    // restoring a saved walk or placing a new actor must never revive a hidden
    // velocity from the previously active pose.
    const magnitude=Math.hypot(input.moveX,input.moveZ),normalizer=Math.max(1,magnitude),speed=input.fast?5.2:3.2;
    const targetX=brake?0:input.moveX/normalizer*speed,targetZ=brake?0:input.moveZ/normalizer*speed;
    const dx=targetX-state.vx,dz=targetZ-state.vz,error=Math.hypot(dx,dz),before=Math.hypot(state.vx,state.vz);
    // Ease the actual world velocity, not the avatar's heading. Reversing or
    // releasing a stick therefore brakes smoothly without walking in an arc.
    if(error<.001){state.vx=targetX;state.vz=targetZ;groundAcceleration=0;}
    else{
      const slowing=targetX*state.vx+targetZ*state.vz<0||Math.hypot(targetX,targetZ)<before;
      groundAcceleration=approach(Math.max(0,groundAcceleration),brake?18:slowing?15:11,STEP*(brake?100:60));
      const change=Math.min(error,error*(1-Math.exp(-14*STEP)),groundAcceleration*STEP);
      state.vx+=dx/error*change;state.vz+=dz/error*change;
    }
    state.speed=Math.hypot(state.vx,state.vz);state.acceleration=(state.speed-before)/STEP;
    let angle=0;
    if(!brake&&magnitude>1e-5){const wanted=Math.atan2(-input.moveX,-input.moveZ);angle=Math.atan2(Math.sin(wanted-state.yaw),Math.cos(wanted-state.yaw));}
    const targetRate=clamp(angle*12,-8,8);
    walkYawRate=approach(walkYawRate,targetRate,STEP*60);
    // Stop exactly at the requested facing, including a 180-degree reversal.
    const rotation=Math.abs(walkYawRate*STEP)>Math.abs(angle)?angle:walkYawRate*STEP;
    if(rotation===angle)walkYawRate=rotation/STEP;
    return state.yaw+rotation;
  }
  function groundSpeed(target,{acceleration,deceleration,brake=false}){
    const before=state.speed,error=target-before;
    if(Math.abs(error)<1e-8){state.speed=target;groundAcceleration=0;state.acceleration=0;return;}
    const slowing=target*before<0||Math.abs(target)<Math.abs(before),jerk=brake?100:state.mode==='walk'?60:24;
    // A short throttle ramp removes the one-frame kick. An explicit brake
    // cancels positive drive immediately; it must never accelerate into a queue.
    if(brake&&groundAcceleration*before>0)groundAcceleration=0;
    const desired=Math.sign(error)*Math.min(slowing?deceleration:acceleration,Math.sqrt(2*jerk*Math.abs(error)));
    groundAcceleration=approach(groundAcceleration,desired,jerk*STEP);
    const change=groundAcceleration*STEP;
    state.speed=change*error>0&&Math.abs(change)>=Math.abs(error)?target:before+change;
    if(state.speed===target)groundAcceleration=0;
    state.acceleration=(state.speed-before)/STEP;
  }
  function resetBoardControls(){boardAcceleration=0;boardYawRate=0;boardLastVertical=0;boardTargeted=false;}
  function boardSpeed(target,fast,brake){
    const before=state.speed,error=target-before;
    if(Math.abs(error)<1e-8){state.speed=target;boardAcceleration=0;state.acceleration=0;return;}
    const slowing=target*before<0||Math.abs(target)<Math.abs(before),limit=brake?20:slowing?12:fast?14:10,jerk=brake?110:70;
    if(brake&&boardAcceleration*before>0)boardAcceleration=0;
    const desired=Math.sign(error)*Math.min(limit,Math.sqrt(2*jerk*Math.abs(error)));
    boardAcceleration=approach(boardAcceleration,desired,jerk*STEP);
    const change=boardAcceleration*STEP;
    state.speed=change*error>0&&Math.abs(change)>=Math.abs(error)?target:before+change;
    if(state.speed===target)boardAcceleration=0;
    state.acceleration=(state.speed-before)/STEP;
  }
  function boardVertical(input,vertical,floor,ceiling,authority){
    const command=input.brake?0:vertical,explicitTarget=!input.brake&&finite(input.altitudeTarget)?clamp(input.altitudeTarget,floor,ceiling):null;
    const deceleration=input.brake?18:14;
    let targetSpeed;
    if(command){state.altitudeTarget=null;targetSpeed=command*HOVERBOARD.verticalSpeed;}
    else{
      // Capture the stopping point once, so releasing Q/E arrests vertical
      // motion without pulling the platform back through a springy oscillation.
      if(explicitTarget!==null)state.altitudeTarget=explicitTarget;
      else if(state.altitudeTarget===null||boardLastVertical||boardTargeted)state.altitudeTarget=clamp(state.y+verticalSpeed*Math.abs(verticalSpeed)/(2*deceleration),floor,ceiling);
      state.altitudeTarget=clamp(state.altitudeTarget,floor,ceiling);
      const error=state.altitudeTarget-state.y;
      targetSpeed=Math.sign(error)*Math.min(HOVERBOARD.verticalSpeed,Math.abs(error)*4,Math.sqrt(2*10*Math.abs(error)));
      if(Math.abs(error)<.001&&Math.abs(verticalSpeed)<.04){state.y=state.altitudeTarget;verticalSpeed=0;targetSpeed=0;}
    }
    // Ease into decks, roofs, people, the water clearance and flight ceiling.
    // Collision clamps remain the final guard, including at a full sprint.
    const gap=targetSpeed<0?Math.max(0,state.y-floor):Math.max(0,ceiling-state.y);
    const approachSpeed=Math.min(HOVERBOARD.verticalSpeed,Math.max(.18,gap*2.4),Math.sqrt(2*7*Math.max(.006,gap)));
    targetSpeed=clamp(targetSpeed,-approachSpeed,approachSpeed)*authority;
    const slowing=targetSpeed*verticalSpeed<0||Math.abs(targetSpeed)<Math.abs(verticalSpeed);
    verticalSpeed=approach(verticalSpeed,targetSpeed,STEP*(slowing?deceleration:8));
    boardLastVertical=command;boardTargeted=explicitTarget!==null;
  }
  function roadsterSpeed(target,acceleration,deceleration,jerk){
    const before=state.speed,error=target-before;
    if(Math.abs(error)<1e-8){state.speed=target;roadsterAcceleration=0;state.acceleration=0;return;}
    const slowing=target*before<0||Math.abs(target)<Math.abs(before),limit=slowing?deceleration:acceleration;
    // Rate-limit thrust, then taper it before reaching the target velocity. The
    // signed target never overshoots, even when changing from forward to reverse.
    const desired=Math.sign(error)*Math.min(limit,Math.sqrt(2*jerk*Math.abs(error)));
    roadsterAcceleration=approach(roadsterAcceleration,desired,jerk*STEP);
    const change=roadsterAcceleration*STEP;
    state.speed=change*error>0&&Math.abs(change)>=Math.abs(error)?target:before+change;
    if(state.speed===target)roadsterAcceleration=0;
    state.acceleration=(state.speed-before)/STEP;
  }
  function roadsterLift(input){return state.flightEnabled&&!input.brake?clamp(Number(input.lift??input.vertical)||0,0,1):0;}
  function roadsterVertical(input){
    // Holding the jet is the only upward force. No target, arm toggle or brake
    // may latch an altitude hold. Release preserves momentum and gravity acts
    // immediately; pressing again first arrests a fall before producing ascent.
    state.altitudeTarget=null;
    verticalSpeed=clamp(verticalSpeed+(roadsterLift(input)*ROADSTER.liftAcceleration-ROADSTER.gravity)*STEP,-ROADSTER.maxDescent,ROADSTER.maxAscent);
  }
  function bodySamples(x,z,yaw,mode,pose=state){
    if(mode!=='hoverboard')return standardBodySamples(x,z,yaw,mode);
    const pitch=state.mode===mode||pose.mode===mode?pose.pitch:0,lean=state.mode===mode||pose.mode===mode?pose.lean:0,cp=Math.cos(pitch),sp=Math.sin(pitch),cl=Math.cos(lean),sl=Math.sin(lean),cy=Math.cos(yaw),sy=Math.sin(yaw);
    function part(lx,ly,lz,radius,below,above){const xx=lx*cl-ly*sl,yy=lx*sl+ly*cl,ry=yy*cp-lz*sp,rz=yy*sp+lz*cp;return{x:x+xx*cy+rz*sy,z:z-xx*sy+rz*cy,radius,minY:ry-below,maxY:ry+above};}
    const rim=.29*Math.hypot(sl*cp,sp),rotors=[[-1.13,-.43],[-1.13,.43],[1.13,-.43],[1.13,.43],...[-.55,0,.55].flatMap(lx=>[[lx,-.73],[lx,.73]])];
    // Low rotor disks/struts and the standing person's tilted capsule have
    // separate vertical intervals; a narrow canopy is not a 2.4m-high wall
    // across the complete rotor span.
    return[...rotors.map(([lx,lz])=>part(lx,.23,lz,.29,.10+rim,.17+rim)),part(0,.27,0,.69,.27,.22),
      part(0,.66,0,.43,.26,.26),part(0,1.14,0,.32,.30,.30),part(0,1.60,0,.43,.27,.27),part(0,1.99,0,.21,.20,.20),
      // The model counters its upper-body lean while its feet stay planted.
      // Also cover the upright torso/head throughout that compensation.
      {x,z,radius:.45,minY:1.0,maxY:1.9},{x,z,radius:.25,minY:1.75,maxY:2.2}];
  }
  function hoverboardContact(x=state.x,z=state.z,yaw=state.yaw,referenceY=state.y){const cy=Math.cos(yaw),sy=Math.sin(yaw),feet=[];for(const lx of[-HOVERBOARD.footX,HOVERBOARD.footX])for(const lz of[-HOVERBOARD.footZ,HOVERBOARD.footZ])feet.push({x:lx,z:lz,h:contactAt(x+lx*cy+lz*sy,z-lx*sy+lz*cy,0,referenceY).height});
    const avg=items=>items.reduce((sum,p)=>sum+p.h,0)/items.length;return{y:avg(feet),pitch:Math.atan2(avg(feet.filter(p=>p.z<0))-avg(feet.filter(p=>p.z>0)),2*HOVERBOARD.footZ),lean:Math.atan2(avg(feet.filter(p=>p.x>0))-avg(feet.filter(p=>p.x<0)),2*HOVERBOARD.footX)};
  }
  function hoverboardLandingFloor(){const cp=Math.cos(state.pitch),sp=Math.sin(state.pitch),cl=Math.cos(state.lean),sl=Math.sin(state.lean),cy=Math.cos(state.yaw),sy=Math.sin(state.yaw);let floor=-Infinity;
    for(const x of[-HOVERBOARD.footX,HOVERBOARD.footX])for(const z of[-HOVERBOARD.footZ,HOVERBOARD.footZ]){const rx=x*cl,ry=x*sl*cp-z*sp,rz=x*sl*sp+z*cp;floor=Math.max(floor,contactAt(state.x+rx*cy+rz*sy,state.z-rx*sy+rz*cy).height-ry);}return floor;
  }
  const hoverboardTiltSupport=()=>Math.max(0,-Math.min(...bodySamples(state.x,state.z,state.yaw,'hoverboard').map(p=>p.minY)));
  function sample(s){s=clamp(s,0,length);let i=1;while(i<points.length-1&&points[i].progress<s)i++;const a=points[i-1],b=points[i],t=clamp((s-a.progress)/Math.max(EPS,b.progress-a.progress),0,1);return{x:a.x+(b.x-a.x)*t,y:(a.y??.16)+((b.y??.16)-(a.y??.16))*t-.02,z:a.z+(b.z-a.z)*t,yaw:Math.atan2(-(b.x-a.x),-(b.z-a.z)),progress:s};}
  function locate(p){if(typeof route.locate==='function')return route.locate(p);let best={distance:Infinity,progress:0,width:7.2};
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=l2?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/l2,0,1):0,x=a.x+t*dx,z=a.z+t*dz,d=Math.hypot(p.x-x,p.z-z);if(d<best.distance){const progress=a.progress+t*(b.progress-a.progress),segment=route.segments?.find(s=>progress>=(s.startProgress??s.s0)&&progress<=(s.endProgress??s.s1));best={x,z,distance:d,progress,width:segment?.width??7.2};}}
    return best;
  }
  function bridgeSupport(x,z,radius,referenceY){
    const candidates=bridgeSurfaceCells.get(`${Math.floor(x/surfaceCell)}/${Math.floor(z/surfaceCell)}`)||[];
    let support;
    for(const surface of candidates){
      if(surface.surfaceY>referenceY+STEP_UP||support&&support.surfaceY>=surface.surfaceY||!inRing({x,z},surface.polygon))continue;
      if(radius&&![[radius,0],[-radius,0],[0,radius],[0,-radius]].every(([dx,dz])=>candidates.some(v=>Math.abs(v.surfaceY-surface.surfaceY)<.15&&inRing({x:x+dx,z:z+dz},v.polygon))))continue;
      support=surface;
    }
    return support;
  }
  // Omitting referenceY is a top-down map query. Movement always supplies the
  // feet/wheel height so an overhead viaduct cannot become its support plane.
  function groundAt(x,z,radius=0,referenceY=Infinity){const near=locate({x,z}),profile=sample(near.progress),width=near.width??7.2,raised=profile.y>BASE_Y+.03;
    const segment=route.segments?.find(s=>near.progress>=(s.startProgress??s.s0)-EPS&&near.progress<=(s.endProgress??s.s1)+EPS);
    // A bridge can be flush with its banks. Its source topology, not a made-up
    // positive elevation, establishes that a road spans the water beneath it.
    const onRouteBridge=(raised||segment?.bridge)&&profile.y<=referenceY+STEP_UP&&near.distance+radius<=width/2;
    const support=bridgeSupport(x,z,radius,referenceY);
    const onBridge=!!(onRouteBridge||support),height=walkHeight(x,z,support?.surfaceY??(onRouteBridge?profile.y:BASE_Y));
    const overWater=water.some(p=>overlapsPolygon({x,z},radius,p));
    return{height,onBridge,raised:height>BASE_Y+.03,progress:near.progress,distance:near.distance,width,overWater,allowed:!overWater||onBridge};
  }
  groundAt.heightAt=(x,z,referenceY=Infinity)=>{
    if(!levelRoute)return groundAt(x,z,0,referenceY).height;
    return walkHeight(x,z,bridgeSupport(x,z,0,referenceY)?.surfaceY??BASE_Y);
  };
  groundAt.solidsInBounds=(minX,minZ,maxX,maxZ)=>indexedIn(bridgeSolidCells,minX,minZ,maxX,maxZ);
  groundAt.obstaclesInBounds=(minX,minZ,maxX,maxZ)=>indexedIn(barrierCells,minX,minZ,maxX,maxZ);
  const contactAt=(x,z,radius=0,referenceY=state.y)=>groundAt(x,z,radius,referenceY);
  groundAt.maxHeightInBounds=(minX,minZ,maxX,maxZ)=>{
    if(!levelRoute)return maximumGroundHeight;
    let height=BASE_Y;
    // Conservative broad phase: include every deck touching any queried grid
    // cell. A higher deck can cause extra checks, never a missed collision.
    for(let x=Math.floor(minX/surfaceCell);x<=Math.floor(maxX/surfaceCell);x++)for(let z=Math.floor(minZ/surfaceCell);z<=Math.floor(maxZ/surfaceCell);z++){
      for(const cells of [bridgeSurfaceCells,walkSurfaceCells])for(const surface of cells.get(`${x}/${z}`)||[])height=Math.max(height,surface.surfaceY??BASE_Y);
    }
    return height;
  };
  // Source water rings keep islands dry. A hull sample needs its whole disk
  // inside one body of water, not merely intersecting the shore polygon.
  function waterAt(x,z,radius=0){
    const point={x,z};
    const record=water.find(p=>x>=p.minX&&x<=p.maxX&&z>=p.minZ&&z<=p.maxZ&&inRing(point,p.rings[0])&&!p.rings.slice(1).some(r=>inRing(point,r))&&(!radius||p.rings.every(r=>r.every((a,i)=>distanceToSegment(point,a,r[(i+1)%r.length])>=radius-EPS))));
    return record?{height:finite(record.surfaceY)?record.surfaceY:.022,id:record.id??null}:null;
  }
  function outside(p){return bounds&&(p.x-p.radius<bounds.minX||p.x+p.radius>bounds.maxX||p.z-p.radius<bounds.minZ||p.z+p.radius>bounds.maxZ);}
  function obstacleAt(x,z,yaw,mode,y=state.y,previous=null,grounded=state.grounded,bodyPose=state){
    const bodies=bodySamples(x,z,yaw,mode,bodyPose),ground=contactAt(x,z,mode==='spider'?.37:mode==='walk'?.26:mode==='scooter'?.42:mode==='roadster'?1.1:mode==='hoverboard'?1.42:0,y);
    if(bodies.some(outside))return'校园边界';
    // Ground contact may raise wheels or feet before the centre crosses a
    // step. Check the resulting support height against overhead structures.
    const barrierY=grounded&&mode!=='helicopter'&&mode!=='boat'?Math.max(y,ground.height,groundContactHeight(x,z,yaw,mode,y)):y;
    if(barriers.length)for(const p of bodies){const hit=barrierAt({...p,y:barrierY},p.radius,p.minY??0,p.maxY??(mode==='helicopter'?3.4:mode==='roadster'?1.7:2));if(hit)return hit.label||'围栏边界';}
    if(bodies.some(p=>buildings.some(b=>barrierY+(p.minY??0)<(b.height??18)+.5&&barrierY+(p.maxY??(mode==='helicopter'?3.4:mode==='roadster'?1.7:2))>(b.minHeight??0)&&overlapsPolygon(p,p.radius,b))))return'建筑边界';
    if(mode==='boat'){
      if(bodies.some(p=>!waterAt(p.x,p.z,p.radius)))return'请在水域内航行';
      if(bodies.some(p=>[[0,0],[p.radius,0],[-p.radius,0],[0,p.radius],[0,-p.radius]].some(([dx,dz])=>{const g=groundAt(p.x+dx,p.z+dz);return g.onBridge&&g.height>y-.4&&g.height<y+2.8;})))return'桥下净空不足';
      return'';
    }
    if(mode==='helicopter'||mode==='roadster'&&!grounded||mode==='hoverboard'&&!grounded){
      const contacts=mode==='roadster'||mode==='hoverboard'?bodies.map(p=>contactAt(p.x,p.z,0,y)): [ground];
      if(mode==='hoverboard'?bodies.some(p=>contactAt(p.x,p.z,0,y).height>y+p.minY+.04):contacts.some(g=>g.height>y+.04))return'桥面边界';
      const waterContact=mode==='roadster'||mode==='hoverboard'?bodies.some(p=>!contactAt(p.x,p.z,p.radius,y).allowed):ground.overWater&&!ground.onBridge;
      if(waterContact&&y<BASE_Y+2.48)return'水面低空边界';return'';
    }
    if(bodies.some(p=>!contactAt(p.x,p.z,p.radius,y).allowed))return'水域边界';
    if(previous){const oldGround=contactAt(previous.x,previous.z,0,previous.y),delta=Math.hypot(x-previous.x,z-previous.z);
      // Contact may vary continuously up a ramp. A sideways crossing of the
      // elevated road edge must not teleport the body onto or off the deck.
      if(Math.abs(ground.height-oldGround.height)>.22+delta*.25)return'桥面边缘';
      // Wheels/feet can cross a deck edge before the body centre does. Reject
      // a discontinuity across the entire footprint before contactPose tilts
      // the vehicle, while still allowing the existing continuous ramps.
      if(bodies.some(p=>Math.abs(contactAt(p.x,p.z,p.radius,y).height-oldGround.height)>STEP_UP+(delta+Math.hypot(p.x-previous.x,p.z-previous.z))*.25))return'桥面边缘';
      if(oldGround.onBridge&&oldGround.height>BASE_Y+.35&&bodies.some(p=>{const g=contactAt(p.x,p.z,p.radius,y);return!g.onBridge&&g.raised;}))return'桥面边缘';
    }
    return'';
  }
  const roadsterTiltSupport=()=>1.07*Math.abs(Math.sin(state.lean))*Math.cos(state.pitch)+2.35*Math.abs(Math.sin(state.pitch));
  function trafficBlocked(x,z,yaw){const actors=typeof traffic==='function'?traffic():traffic;if(!Array.isArray(actors))return false;
    const bodies=bodySamples(x,z,yaw,state.mode),oldBodies=bodySamples(state.x,state.z,state.yaw,state.mode,previousBodyPose??state);
    // The player pose is fixed throughout this query. In a dense morning crowd
    // recomputing all 17 tilted board samples for every distant rider dominated
    // the update even while the board stood still.
    const vehicle=state.mode==='roadster'||state.mode==='hoverboard';
    const tiltSupport=state.mode==='roadster'?roadsterTiltSupport():state.mode==='hoverboard'?hoverboardTiltSupport():0;
    const range=state.mode==='roadster'?3.7:3.4;
    for(const a of actors){if(a.active===false||!finite(a.x)||!finite(a.z)||(a.x-x)**2+(a.z-z)**2>range*range||(vehicle?state.y-tiltSupport>=(a.y??BASE_Y)+1.9||state.y+(state.mode==='roadster'?1.7:2.4)<=(a.y??BASE_Y):Math.abs((a.y??BASE_Y)-state.y)>1.6))continue;
      const kind=a.type??a.kind,radius=kind==='walk'?.27:.43,halfLength=kind==='walk'?0:.48,heading=a.yaw??0,ax=Math.sin(heading)*halfLength,az=Math.cos(heading)*halfLength,front={x:a.x-ax,z:a.z-az},rear={x:a.x+ax,z:a.z+az};
      // Permit retreat from an existing overlap (e.g. an NPC spawned beside the
      // player). This one-way player yielding never freezes the commuter model.
      const oldDistance=Math.min(...oldBodies.map(p=>distanceToSegment(p,front,rear)-p.radius-radius));
      const nextDistance=Math.min(...bodies.map(p=>distanceToSegment(p,front,rear)-p.radius-radius));
      if(nextDistance<.10&&nextDistance<oldDistance-EPS)return true;
    }
    return false;
  }
  function roadsterContact(x=state.x,z=state.z,yaw=state.yaw,referenceY=state.y){const half=ROADSTER.wheelbase/2,f=contactAt(x-Math.sin(yaw)*half,z-Math.cos(yaw)*half,0,referenceY),r=contactAt(x+Math.sin(yaw)*half,z+Math.cos(yaw)*half,0,referenceY);return{y:(f.height+r.height)/2,pitch:Math.atan2(f.height-r.height,ROADSTER.wheelbase)};}
  function scooterContact(x=state.x,z=state.z,yaw=state.yaw,referenceY=state.y,lean=state.lean){
    const f=contactAt(x-Math.sin(yaw)*.59,z-Math.cos(yaw)*.59,0,referenceY),r=contactAt(x+Math.sin(yaw)*.56,z+Math.cos(yaw)*.56,0,referenceY),pitch=Math.atan2(f.height-r.height,1.15),support=.208*Math.cos(lean)+.046;
    return{y:(f.height*.56+r.height*.59)/1.15+(support-.255*Math.cos(lean))/Math.cos(pitch),pitch};
  }
  function groundContactHeight(x,z,yaw,mode,referenceY,lean=state.lean){
    return mode==='roadster'?roadsterContact(x,z,yaw,referenceY).y:mode==='hoverboard'?hoverboardContact(x,z,yaw,referenceY).y:mode==='scooter'?scooterContact(x,z,yaw,referenceY,lean).y:contactAt(x,z,0,referenceY).height;
  }
  function contactPose(){const ground=contactAt(state.x,state.z);state.progress=ground.progress;
    if(state.mode==='boat'){const water=waterAt(state.x,state.z);if(water)state.y=water.height;state.grounded=true;state.verticalSpeed=0;return;}
    if(state.mode==='helicopter'||state.mode==='roadster'&&!state.grounded||state.mode==='hoverboard'&&!state.grounded)return;
    if(state.mode==='hoverboard'){const contact=hoverboardContact();state.y=contact.y;state.pitch=contact.pitch;state.lean=contact.lean;state.grounded=true;return;}
    if(state.mode==='roadster'){const contact=roadsterContact();state.y=contact.y;state.pitch=contact.pitch;state.lean=0;state.grounded=true;return;}
    if(state.mode==='scooter'){const contact=scooterContact();state.pitch=contact.pitch;state.y=contact.y;}
    else{state.pitch=0;state.y=ground.height;}state.grounded=true;
  }
  function roadsterLandingFloor(){let floor=-Infinity;const cy=Math.cos(state.yaw),sy=Math.sin(state.yaw),cp=Math.cos(state.pitch),sp=Math.sin(state.pitch),cl=Math.cos(state.lean),sl=Math.sin(state.lean);
    for(const x of[-ROADSTER.halfTrack,ROADSTER.halfTrack])for(const z of[-ROADSTER.wheelbase/2,ROADSTER.wheelbase/2]){
      const lx=x*cl-ROADSTER.wheelRadius*sl,ly=x*sl+ROADSTER.wheelRadius*cl,ry=ly*cp-z*sp,rz=ly*sp+z*cp;
      const contact=contactAt(state.x+lx*cy+rz*sy,state.z-lx*sy+rz*cy);
      floor=Math.max(floor,contact.height+ROADSTER.wheelRadius-ry);
    }return floor;
  }
  function trafficClear(point,mode,{ignoreTrafficId}={}){if(mode==='helicopter'||mode==='boat')return true;const actors=typeof traffic==='function'?traffic():traffic;if(!Array.isArray(actors))return true;
    const bodies=bodySamples(point.x,point.z,point.yaw,mode,finite(point.pitch)&&finite(point.lean)?point:state);
    for(const actor of actors){if(ignoreTrafficId!==undefined&&actor.id===ignoreTrafficId||actor.active===false||!finite(actor.x)||!finite(actor.z)||(mode==='roadster'||mode==='hoverboard'?point.y>=(actor.y??BASE_Y)+1.9||point.y+(mode==='roadster'?1.7:2.4)<=(actor.y??BASE_Y):Math.abs((actor.y??BASE_Y)-point.y)>1.6)||Math.hypot(actor.x-point.x,actor.z-point.z)>(mode==='roadster'?3.7:3.4))continue;
      const kind=actor.type??actor.kind,radius=kind==='walk'?.27:.43,half=kind==='walk'?0:.48,yaw=actor.yaw??0,ax=Math.sin(yaw)*half,az=Math.cos(yaw)*half,front={x:actor.x-ax,z:actor.z-az},rear={x:actor.x+ax,z:actor.z+az};
      if(bodies.some(p=>distanceToSegment(p,front,rear)<p.radius+radius+.1))return false;
    }return true;
  }
  function reset(progress=0,requestedMode){const before={...state},s=clamp(finite(progress)?progress:0,0,length);
    if(requestedMode!==undefined){if(!MODES.has(requestedMode)){state.blockedReason='未知移动方式';return state;}state.mode=requestedMode;}
    if(state.mode==='roadster')state.flightEnabled=false;
    if(state.mode==='hoverboard'){state.grounded=true;state.pitch=0;state.lean=0;state.rotorPower=0;}
    function candidates(at){const p=sample(at);if(typeof getPoseAt!=='function')return[p];
      const choices=state.mode==='roadster'||state.mode==='hoverboard'?[[1,'scooter'],[0,'scooter'],[2,'scooter'],[1,'walk']]:[[1,state.mode==='walk'||state.mode==='spider'?'walk':'scooter']];
      const supplied=choices.map(([lane,kind])=>getPoseAt(p.progress,lane,kind)).filter(v=>v&&finite(v.x)&&finite(v.z)).map(v=>({...p,x:v.x,z:v.z,yaw:v.yaw??p.yaw}));return[...supplied,p];
    }
    let reason='';const clear=point=>{const contact={...point,y:contactAt(point.x,point.z,0,point.y).height};return !obstacleAt(contact.x,contact.z,contact.yaw,state.mode,contact.y)&&trafficClear(contact,state.mode);};
    let position=candidates(s).find(clear);
    if(!position&&state.mode==='helicopter'){state.mode='walk';reason='该位置没有旋翼净空，已步行返回路线';position=candidates(s).find(clear);}
    // This is an explicit respawn, so use the nearest empty body footprint on
    // the same mapped route instead of placing the player inside an NPC queue.
    if(!position)for(let delta=.5;delta<=10;delta+=.5){position=[...candidates(s-delta),...candidates(s+delta)].find(clear);if(position)break;}
    if(!position){Object.assign(state,before,{blockedReason:'该路段没有足够净空，未改变位置'});return state;}
    Object.assign(state,{x:position.x,y:contactAt(position.x,position.z,0,position.y).height,z:position.z,yaw:position.yaw,speed:0,steeringAngle:0,lean:0,pitch:0,distance:0,grounded:true,rotorPower:0,flightEnabled:false,jetPower:0,blockedReason:reason,progress:position.progress??s,verticalSpeed:0,elapsed:0,braking:false});verticalSpeed=0;accumulator=0;jumpPending=false;zipPending=false;pointPending=false;contactPose();resetRoadsterControls();resetBoardControls();resetGroundControls();spider.reset();return state;
  }
  // Mounting uses the actual entity pose and never moves to a nearby fallback.
  // Invalid or occupied footprints leave both player and vehicle untouched.
  function canPlaceMode(pose,mode='walk',options={}){
    if(!MODES.has(mode))return{ok:false,reason:'未知移动方式'};
    if(!pose||![pose.x,pose.z,pose.yaw].every(finite))return{ok:false,reason:'无效的位置'};
    const ground=contactAt(pose.x,pose.z,0,finite(pose.y)?pose.y:state.y),surface=mode==='boat'?waterAt(pose.x,pose.z):ground;
    if(!surface)return{ok:false,reason:'游艇需要停在水面'};
    const point={x:pose.x,z:pose.z,yaw:pose.yaw,y:surface.height};
    const reason=obstacleAt(point.x,point.z,point.yaw,mode,point.y,null,true,{pitch:0,lean:0});
    if(reason)return{ok:false,reason};
    if(!trafficClear(point,mode,options))return{ok:false,reason:'该位置有人车，请稍后再试'};
    return{ok:true,pose:point};
  }
  function placeMode(pose,mode='walk',options={}){
    const check=canPlaceMode(pose,mode,options);if(!check.ok)return check;
    const point=check.pose,ground=contactAt(point.x,point.z,0,point.y);
    Object.assign(state,{mode,x:point.x,y:point.y,z:point.z,yaw:point.yaw,speed:0,steeringAngle:0,lean:0,pitch:0,distance:0,grounded:true,rotorPower:0,flightEnabled:false,jetPower:0,blockedReason:'',progress:ground.progress,verticalSpeed:0,elapsed:0,braking:false});
    verticalSpeed=0;accumulator=0;jumpPending=false;zipPending=false;pointPending=false;
    contactPose();resetRoadsterControls();resetBoardControls();resetGroundControls();spider.reset();
    return{ok:true};
  }
  // Activity returns restore an actual pose, not a map placement. Validate
  // before touching either public state or private integrator/controller data.
  function canRestorePose(saved,mode=state.mode,options={}){
    if(!MODES.has(mode)||!saved||!['x','y','z','yaw'].every(k=>finite(saved[k])))return{ok:false,reason:'无效的返回位置'};
    for(const key of ['vx','vz','speed','verticalSpeed','pitch','lean','rotorPower'])if(saved[key]!==undefined&&!finite(saved[key]))return{ok:false,reason:'无效的返回运动状态'};
    if(saved.altitudeTarget!==undefined&&saved.altitudeTarget!==null&&!finite(saved.altitudeTarget))return{ok:false,reason:'无效的返回飞行高度'};
    const maximum=mode==='roadster'?ROADSTER.ceiling:mode==='hoverboard'?HOVERBOARD.ceiling:mode==='helicopter'?120:Infinity;
    if(saved.y>BASE_Y+maximum+.01)return{ok:false,reason:'返回位置超出飞行高度范围'};
    const grounded=saved.grounded!==false;
    if(!grounded&&!['spider','roadster','hoverboard','helicopter'].includes(mode))return{ok:false,reason:'该移动方式需要地面落脚点'};
    const pose={x:saved.x,y:saved.y,z:saved.z,yaw:saved.yaw,mode,grounded,
      vx:saved.vx??0,vz:saved.vz??0,speed:saved.speed??0,verticalSpeed:saved.verticalSpeed??0,
      pitch:saved.pitch??0,lean:saved.lean??0,rotorPower:saved.rotorPower??(grounded?0:mode==='hoverboard'?.72:mode==='helicopter'?1:0),
      altitudeTarget:saved.altitudeTarget??null,flightEnabled:mode==='roadster'&&saved.flightEnabled===true};
    if(Math.max(Math.abs(pose.vx),Math.abs(pose.vz),Math.abs(pose.speed),Math.abs(pose.verticalSpeed))>100||Math.abs(pose.pitch)>Math.PI||Math.abs(pose.lean)>Math.PI||pose.rotorPower<0||pose.rotorPower>1)return{ok:false,reason:'返回运动状态超出有效范围'};
    const bodies=bodySamples(pose.x,pose.z,pose.yaw,mode,pose),height=mode==='helicopter'?3.4:mode==='roadster'?1.7:mode==='spider'?2.08:2;
    const ground=contactAt(pose.x,pose.z,0,pose.y),bodyY=grounded&&mode!=='boat'?Math.max(pose.y,ground.height):pose.y;
    if(bodies.some(outside))return{ok:false,reason:'返回位置超出校园边界'};
    for(const body of bodies){
      const minY=body.minY??0,maxY=body.maxY??height;
      if(barrierAt({...body,y:bodyY},body.radius,minY,maxY))return{ok:false,reason:'返回位置被设施占用'};
      if(buildings.some(b=>bodyY+minY<(b.height??18)-.012&&bodyY+maxY>(b.minHeight??0)+.012&&overlapsPolygon(body,body.radius,b)))return{ok:false,reason:'返回位置被建筑占用'};
    }
    if(mode==='boat'){
      const water=waterAt(pose.x,pose.z);
      if(!water||Math.abs(pose.y-water.height)>.05||bodies.some(p=>!waterAt(p.x,p.z,p.radius)))return{ok:false,reason:'返回位置不在可航行水面'};
    }else{
      const support=mode==='spider'?spider.supportAt(pose):{height:groundContactHeight(pose.x,pose.z,pose.yaw,mode,pose.y,pose.lean),allowed:ground.allowed};
      if(pose.y<ground.height-.05||grounded&&(!support.allowed||Math.abs(pose.y-support.height)>.05))return{ok:false,reason:'返回位置的落脚面已改变'};
      if(grounded&&support.roof==null&&bodies.some(p=>!contactAt(p.x,p.z,p.radius,pose.y).allowed))return{ok:false,reason:'返回位置在水域边缘'};
      if(!grounded&&!ground.allowed&&pose.y<ground.height+(mode==='spider'?.1:2.48))return{ok:false,reason:'返回位置过于接近水面'};
    }
    if(!trafficClear(pose,mode,options))return{ok:false,reason:'返回位置有人车，请稍后再试'};
    return{ok:true,pose};
  }
  function restorePose(saved,mode=state.mode,options={}){
    const check=canRestorePose(saved,mode,options);if(!check.ok)return check;
    Object.assign(state,check.pose,{distance:0,elapsed:0,braking:false,blockedReason:'',steeringAngle:0,jetPower:0,forwardJetPower:0});
    accumulator=0;previousBodyPose=null;jumpPending=false;zipPending=false;pointPending=false;
    resetRoadsterControls();resetBoardControls();resetGroundControls();spider.reset();
    // Resets clear transient input and web state. Saved motion is assigned last
    // so the next fixed step starts from the returned velocity, not an old trip.
    Object.assign(state,check.pose);verticalSpeed=check.pose.verticalSpeed;
    state.progress=contactAt(state.x,state.z).progress;state.acceleration=0;state.yawRate=0;
    if(mode==='spider')state.roofIndex=state.grounded?spider.supportAt(state).roof:null;
    state.flightPhase=mode==='boat'?'water':state.grounded?'ground':mode==='roadster'?(verticalSpeed<-.08?'descending':verticalSpeed>.08?'ascending':'coasting'):mode==='hoverboard'?'hover':state.flightPhase;
    return{ok:true};
  }
  function placeWalker(pose){return placeMode(pose,'walk');}
  function setMode(mode){if(!MODES.has(mode))return{ok:false,reason:'未知移动方式'};if(mode===state.mode)return{ok:true};
    if(mode==='boat')return{ok:false,reason:'请靠近岸边游艇按 F 登船'};
    if((state.mode==='helicopter'||state.mode==='roadster'||state.mode==='hoverboard'||state.mode==='spider')&&!state.grounded)return{ok:false,reason:'请先在陆地降落，再切换移动方式'};
    if(state.mode==='spider'&&Math.abs(state.y-contactAt(state.x,state.z).height)>.3)return{ok:false,reason:'请先从屋顶回到地面，再切换移动方式'};
    const reason=obstacleAt(state.x,state.z,state.yaw,mode,state.y);
    if(reason)return{ok:false,reason:mode==='helicopter'?'附近空间不足，请先移动到开阔处':reason};
    if((mode==='roadster'||mode==='hoverboard')&&!trafficClear(state,mode))return{ok:false,reason:mode==='roadster'?'汽车周围有人车，请先移动到开阔处':'旋翼周围有人车，请先移动到开阔处'};
    state.mode=mode;state.speed=0;state.steeringAngle=0;state.lean=0;state.pitch=0;state.rotorPower=0;state.flightEnabled=false;state.jetPower=0;state.blockedReason='';state.braking=false;verticalSpeed=0;state.verticalSpeed=0;accumulator=0;jumpPending=false;zipPending=false;pointPending=false;contactPose();resetRoadsterControls();resetBoardControls();resetGroundControls();spider.reset();return{ok:true};
  }
  function setFlightEnabled(enabled){if(state.mode!=='roadster')return{ok:false,reason:'冷气喷射仅用于 Roadster'};
    const next=!!enabled;if(next===state.flightEnabled)return{ok:true};
    state.flightEnabled=next;state.blockedReason='';resetRoadsterControls();
    if(state.grounded){verticalSpeed=0;state.verticalSpeed=0;contactPose();}
    if(!next)state.jetPower=0;return{ok:true};
  }
  function fixedUpdate(input){const forward=clamp(Number(input.forward)||0,-1,1),turn=clamp(Number(input.turn)||0,-1,1),vertical=clamp(Number(input.vertical)||0,-1,1),brake=!!input.brake;
    state.elapsed+=STEP;state.blockedReason='';state.braking=brake;previousBodyPose={pitch:state.pitch,lean:state.lean};
    if(state.mode==='spider'){spider.step(STEP,input);return;}
    if(state.mode==='boat'){
      const oldSpeed=state.speed;
      groundSpeed(brake?0:forward*(forward<0?2:input.fast?9:6),{acceleration:2.2,deceleration:brake?5:1.5,brake});
      walkYawRate=approach(walkYawRate,turn*.65*(.2+Math.min(1,Math.abs(state.speed)/3))*Math.sign(state.speed||1),STEP*1.3);
      const yaw=state.yaw+walkYawRate*STEP,x=state.x-Math.sin(yaw)*state.speed*STEP,z=state.z-Math.cos(yaw)*state.speed*STEP;
      const reason=obstacleAt(x,z,yaw,'boat',state.y);
      if(reason){state.speed=0;groundAcceleration=0;state.acceleration=0;state.blockedReason=reason;
        if(!obstacleAt(state.x,state.z,yaw,'boat',state.y))state.yaw=yaw;else walkYawRate=0;
      }else{state.distance+=Math.hypot(x-state.x,z-state.z);state.x=x;state.z=z;state.yaw=yaw;}
      state.yaw=Math.atan2(Math.sin(state.yaw),Math.cos(state.yaw));state.yawRate=walkYawRate;state.steeringAngle=turn*.35;
      state.pitch=approach(state.pitch,-Math.min(.025,Math.abs(state.speed)*.003),STEP*.08);
      state.lean=approach(state.lean,clamp(-walkYawRate*Math.abs(state.speed)*.012,-.045,.045),STEP*.16);
      state.acceleration=(state.speed-oldSpeed)/STEP;contactPose();state.flightPhase='water';return;
    }
    let nextYaw=state.yaw;const worldWalking=state.mode==='walk'&&finite(input.moveX)&&finite(input.moveZ);
    if(state.mode==='walk'){
      if(worldWalking)nextYaw=worldWalk(input,brake);
      else{groundSpeed(brake?0:forward*(input.fast?5.2:3.2),{acceleration:8.5,deceleration:brake?12:11,brake});
        walkYawRate=approach(walkYawRate,turn*2.2,STEP*(turn?18:26));nextYaw+=walkYawRate*STEP;}
      state.steeringAngle=0;state.lean=0;
    }else if(state.mode==='scooter'){
      const target=brake?0:forward*(forward<0?1.1:7.5);
      // Faster campus travel retains a short coast and a decisive brake before
      // junctions; reverse remains a slow manoeuvre around parked vehicles.
      groundSpeed(target,{acceleration:3.4,deceleration:brake?10.5:4.8,brake});
      const steering=turn*.5/(1+.065*state.speed*state.speed);state.steeringAngle=approach(state.steeringAngle,steering,STEP*1.8);const yawRate=state.speed*Math.tan(state.steeringAngle)/1.15;nextYaw+=yawRate*STEP;
      state.lean=approach(state.lean,clamp(-yawRate*state.speed*.035,-.18,.18),STEP*.6);
    }else if(state.mode==='roadster'){
      state.rotorPower=0;const lift=roadsterLift(input),airborne=!state.grounded||lift>0;
      if(brake&&roadsterAcceleration*state.speed>0)roadsterAcceleration=0;
      if(airborne){
        const max=forward<0?6:(input.fast?ROADSTER.flightBoostSpeed:ROADSTER.flightSpeed);
        roadsterSpeed(brake?0:forward*max,input.fast?8.5:6.4,brake?12:7.2,brake?72:38);
        const targetRate=brake?0:turn*.88/(1+Math.abs(state.speed)*.028);
        roadsterYawRate=approach(roadsterYawRate,targetRate,STEP*(turn?2:3.2));nextYaw+=roadsterYawRate*STEP;
        const ground=contactAt(state.x,state.z),contact=roadsterContact(),clearance=Math.max(0,state.y-contact.y),tiltLimit=clamp(clearance/2,0,1),grade=ground.allowed?contact.pitch:0;
        state.pitch=approach(state.pitch,grade*(1-tiltLimit)-clamp(state.acceleration*.007,-.045,.055)*tiltLimit,STEP*.18);
        state.lean=approach(state.lean,clamp(-roadsterYawRate*Math.abs(state.speed)*.004,-.055,.055)*tiltLimit,STEP*.20);
        state.steeringAngle=approach(state.steeringAngle,0,STEP*2);
      }else{
        const target=brake?0:forward*(forward<0?ROADSTER.reverseSpeed:input.fast?ROADSTER.boostSpeed:ROADSTER.groundSpeed);
        roadsterSpeed(target,input.fast?5.5:3.8,brake?10:2.8,brake?72:38);
        const steering=turn*.55/(1+.018*state.speed*state.speed);state.steeringAngle=approach(state.steeringAngle,steering,STEP*1.35);roadsterYawRate=state.speed*Math.tan(state.steeringAngle)/ROADSTER.wheelbase;nextYaw+=roadsterYawRate*STEP;state.lean=0;verticalSpeed=0;
      }
      state.jetPower=approach(state.jetPower,lift,STEP*(lift>state.jetPower?8:12));
      // Lift and forward thrust are separate visual channels. Arming the car,
      // coasting, falling and braking never imply a powered vertical jet.
      const propulsionSpeed=airborne?(input.fast?ROADSTER.flightBoostSpeed:ROADSTER.flightSpeed):(input.fast?ROADSTER.boostSpeed:ROADSTER.groundSpeed);
      state.forwardJetPower=(airborne?state.flightEnabled:input.fast)&&forward>0&&!brake&&state.speed>.08?clamp(Math.max(0,state.acceleration)/9+(airborne?.14:.08)*Math.min(1,state.speed/propulsionSpeed),0,1):0;
    }else if(state.mode==='hoverboard'){
      state.flightEnabled=false;state.jetPower=0;state.steeringAngle=0;const lift=brake?0:vertical,wantsFlight=!state.grounded||lift>0||!brake&&finite(input.altitudeTarget)&&input.altitudeTarget>state.y+.001;
      const targetPower=wantsFlight?clamp(.72+Math.max(0,lift)*.16+Math.abs(forward)*.08,.65,1):0;
      state.rotorPower=approach(state.rotorPower,targetPower,STEP*(targetPower>state.rotorPower?.65:.85));
      const flying=!state.grounded;
      boardSpeed(brake||!flying?0:forward*(forward<0?HOVERBOARD.reverseSpeed:input.fast?HOVERBOARD.fastSpeed:HOVERBOARD.cruiseSpeed),!!input.fast,brake);
      const targetRate=flying&&!brake?turn*1.28/(1+Math.abs(state.speed)*.018):0;
      boardYawRate=approach(boardYawRate,targetRate,STEP*(turn&&!brake?4.2:5.5));if(boardYawRate)nextYaw+=boardYawRate*STEP;
      const contact=hoverboardContact(),limit=clamp((state.y-contact.y)/1.5,0,1),basePitch=contact.pitch*(1-limit),baseLean=contact.lean*(1-limit);
      const pitchTarget=basePitch-clamp(state.speed/HOVERBOARD.fastSpeed*.10+state.acceleration*.004,-.10,.16)*limit;
      const leanTarget=baseLean+clamp(boardYawRate*(.07+Math.abs(state.speed)*.007),-.20,.20)*limit;
      state.pitch=clamp(approach(state.pitch,pitchTarget,STEP*.7),basePitch-.16*limit,basePitch+.10*limit);
      state.lean=clamp(approach(state.lean,leanTarget,STEP*.9),baseLean-.20*limit,baseLean+.20*limit);
    }else{
      state.rotorPower=approach(state.rotorPower,1,STEP*.65);
      const flight=state.y>contactAt(state.x,state.z).height+.15||vertical>0&&state.rotorPower>.4;
      state.speed=approach(state.speed,brake||!flight?0:forward*(forward<0?8:18),STEP*(brake?9:5));nextYaw+=turn*.85*STEP*state.rotorPower;
      verticalSpeed=approach(verticalSpeed,vertical*4.8*Math.min(1,state.rotorPower/.7),STEP*4);
      const clearance=Math.max(0,state.y-contactAt(state.x,state.z).height),tiltLimit=Math.min(1,clearance/2);
      state.pitch=clamp(approach(state.pitch,clamp(-state.speed*.012,-.22,.1)*tiltLimit,STEP*.5),-.22*tiltLimit,.1*tiltLimit);state.lean=clamp(approach(state.lean,-turn*Math.abs(state.speed)/18*.14*tiltLimit,STEP*.5),-.14*tiltLimit,.14*tiltLimit);
    }
    const nextX=state.x+(worldWalking?state.vx:-Math.sin(nextYaw)*state.speed)*STEP,nextZ=state.z+(worldWalking?state.vz:-Math.cos(nextYaw)*state.speed)*STEP;
    let reason=obstacleAt(nextX,nextZ,nextYaw,state.mode,state.y,state);
    if(!reason&&state.mode!=='helicopter'&&trafficBlocked(nextX,nextZ,nextYaw))reason='前方人车';
    const beforeYaw=state.yaw;
    if(reason){if(state.mode==='hoverboard'||state.mode==='roadster'){state.pitch=previousBodyPose.pitch;state.lean=previousBodyPose.lean;}state.speed=0;state.blockedReason=reason;
      if(state.mode==='roadster'){roadsterAcceleration=0;state.acceleration=0;state.forwardJetPower=0;}
      if(state.mode==='hoverboard'){boardAcceleration=0;state.acceleration=0;}
      if(state.mode==='walk'||state.mode==='scooter'){groundAcceleration=0;state.acceleration=0;state.vx=0;state.vz=0;}
      // Walking can turn in place beside a wall. A scooter only rotates if its
      // full footprint remains clear; neither collider tunnels through corners.
      if(!obstacleAt(state.x,state.z,nextYaw,state.mode,state.y,state)&&(state.mode==='helicopter'||!trafficBlocked(state.x,state.z,nextYaw)))state.yaw=nextYaw;
    }else{state.distance+=Math.hypot(nextX-state.x,nextZ-state.z);state.x=nextX;state.z=nextZ;state.yaw=nextYaw;}
    if(state.mode==='walk'&&!worldWalking){state.vx=-Math.sin(state.yaw)*state.speed;state.vz=-Math.cos(state.yaw)*state.speed;}
    if(state.mode==='walk'||state.mode==='scooter'){state.yawRate=(state.yaw-beforeYaw)/STEP;if(Math.abs(state.yaw-nextYaw)>EPS)walkYawRate=0;}
    if(state.mode==='roadster'){state.yawRate=(state.yaw-beforeYaw)/STEP;if(Math.abs(state.yaw-nextYaw)>EPS)roadsterYawRate=0;}
    if(state.mode==='hoverboard'){state.yawRate=(state.yaw-beforeYaw)/STEP;if(Math.abs(state.yaw-nextYaw)>EPS)boardYawRate=0;}
    state.yaw=Math.atan2(Math.sin(state.yaw),Math.cos(state.yaw));
    if(state.mode==='helicopter'||state.mode==='roadster'&&(state.flightEnabled||!state.grounded)||state.mode==='hoverboard'){
      const roadster=state.mode==='roadster',hoverboard=state.mode==='hoverboard',height=roadster?1.7:hoverboard?2.4:3.4,maximum=roadster?ROADSTER.ceiling:hoverboard?HOVERBOARD.ceiling:120,effectiveVertical=roadster?roadsterLift(input):hoverboard&&brake?0:vertical;
      const flightBodies=bodySamples(state.x,state.z,state.yaw,state.mode),ground=contactAt(state.x,state.z),waterFloor=roadster||hoverboard?flightBodies.some(p=>!contactAt(p.x,p.z,p.radius).allowed):ground.overWater&&!ground.onBridge;
      let floor=ground.height+(waterFloor?2.5:0),ceiling=BASE_Y+maximum;
      // Rotor clearance determines building collisions in flight. A roof is a
      // hover floor, not a landing pad; switching to a ground mode stays blocked.
      for(const building of buildings){const overlaps=flightBodies.filter(p=>overlapsPolygon(p,p.radius,building));if(!overlaps.length)continue;
        if(hoverboard){for(const p of overlaps){if(state.y+p.maxY<=(building.minHeight??0)+.02)ceiling=Math.min(ceiling,(building.minHeight??0)-p.maxY);else floor=Math.max(floor,(building.height??18)-p.minY+.05);}}
        else if(state.y+height<=(building.minHeight??0)+.02)ceiling=Math.min(ceiling,(building.minHeight??0)-height);
        else floor=Math.max(floor,(building.height??18)+.5);
      }
      let trafficLandingBlocked=false;
      if(roadster||hoverboard){const actors=typeof traffic==='function'?traffic():traffic,bodies=flightBodies;
        for(const actor of Array.isArray(actors)?actors:[]){if(actor.active===false||!finite(actor.x)||!finite(actor.z)||Math.hypot(actor.x-state.x,actor.z-state.z)>3.7)continue;
          const kind=actor.type??actor.kind,radius=kind==='walk'?.27:.43,half=kind==='walk'?0:.48,yaw=actor.yaw??0,ax=Math.sin(yaw)*half,az=Math.cos(yaw)*half,front={x:actor.x-ax,z:actor.z-az},rear={x:actor.x+ax,z:actor.z+az};
          if(bodies.some(p=>distanceToSegment(p,front,rear)<p.radius+radius+.1)){
            trafficLandingBlocked=true;floor=Math.max(floor,Math.min(state.y,(actor.y??BASE_Y)+1.9+(roadster?roadsterTiltSupport():hoverboardTiltSupport())));
          }
        }
      }
      const solidLanding=floor<=ground.height+.02&&!waterFloor&&!trafficLandingBlocked;
      const skidSupport=1.085*Math.abs(Math.sin(state.lean))*Math.cos(state.pitch)+(state.pitch<0?1.97:1.36)*Math.abs(Math.sin(state.pitch));
      if(solidLanding)floor=roadster?Math.max(floor,roadsterLandingFloor()):hoverboard?Math.max(floor,hoverboardLandingFloor()):floor+skidSupport;
      if(roadster)roadsterVertical(input);
      if(hoverboard)boardVertical(input,vertical,Math.min(floor,ceiling),ceiling,clamp((state.rotorPower-.38)/.25,0,1));
      let nextY=clamp(state.y+verticalSpeed*STEP,Math.min(floor,ceiling),ceiling);
      if(barriers.length)for(const p of flightBodies){const contact=barrierVertical({...p,y:state.y},{...p,y:nextY},p.radius,p.minY??0,p.maxY??height);if(contact.reason){nextY=contact.y;verticalSpeed=0;state.blockedReason=contact.reason;}}
      if(nextY===floor&&verticalSpeed<0||nextY===ceiling&&verticalSpeed>0)verticalSpeed=0;
      state.y=nextY;state.grounded=solidLanding&&state.y<=(roadster?roadsterContact().y:hoverboard?hoverboardContact().y:ground.height)+.025&&(roadster||effectiveVertical<=0||hoverboard&&state.rotorPower<=.38)&&verticalSpeed<=0;
      if(state.grounded){if(roadster||hoverboard){contactPose();if(hoverboard){state.speed=0;boardAcceleration=0;boardYawRate=0;state.acceleration=0;state.yawRate=0;}verticalSpeed=0;state.altitudeTarget=roadster?null:state.y;}else{state.pitch=0;state.lean=0;state.y=ground.height;state.speed=0;}}
      const hasTarget=hoverboard&&!brake&&finite(input.altitudeTarget);
      const commandedDown=roadster?effectiveVertical<=0:effectiveVertical<0||hasTarget&&input.altitudeTarget<floor-EPS,commandedUp=effectiveVertical>0||hasTarget&&input.altitudeTarget>ceiling+EPS;
      if(waterFloor&&state.y<=floor+.025&&commandedDown)state.blockedReason=roadster?'已触及水域碰撞边界，请移到陆地':'水面上方悬停，请到陆地降落';
      if(trafficLandingBlocked&&state.y<=floor+.025&&commandedDown)state.blockedReason='下方有人车，请移到空地降落';
      if(state.y>=ceiling-EPS&&commandedUp)state.blockedReason=ceiling<BASE_Y+maximum?'上方建筑净空不足':`已到 ${maximum} 米高度上限`;
      state.verticalSpeed=verticalSpeed;state.progress=ground.progress;
      if(roadster)state.flightPhase=state.grounded?(state.flightEnabled?'armed':'ground'):verticalSpeed<-.08?'descending':verticalSpeed>.08?'ascending':state.y<=floor+EPS||state.y>=ceiling-EPS?'blocked':'coasting';
      else if(hoverboard)state.flightPhase=state.grounded?'ground':verticalSpeed<-.08?'descending':verticalSpeed>.08?'ascending':Math.abs(state.speed)>.15?'cruise':'hover';
    }else contactPose();
  }
  function step(dt,input={}){if(!finite(dt)||dt<0)throw new TypeError('Frame duration must be non-negative seconds.');accumulator+=Math.min(dt,.25);if(state.mode==='spider'){if(input.jump)jumpPending=true;if(input.zip)zipPending=true;if(input.point)pointPending=true;}
    let iterations=0;while(accumulator+1e-10>=STEP&&iterations++<31){fixedUpdate(jumpPending||zipPending||pointPending?{...input,jump:!!input.jump||jumpPending,zip:!!input.zip||zipPending,point:!!input.point||pointPending}:input);jumpPending=false;zipPending=false;pointPending=false;accumulator-=STEP;}return state;
  }
  const spider=createWebSwingMotion({state,world:{buildings,water,bounds,...(barriers.length?{barrierAt,barrierSweep,barrierVertical}:{})},groundAt,traffic,guideAt:sample});
  function clearActionInputs(){jumpPending=false;zipPending=false;pointPending=false;spider.clearActionInputs();}
  function suspend(){state.speed=0;verticalSpeed=0;state.verticalSpeed=0;accumulator=0;jumpPending=false;zipPending=false;pointPending=false;resetRoadsterControls();resetBoardControls();resetGroundControls();if((state.mode==='roadster'||state.mode==='hoverboard')&&!state.grounded){state.altitudeTarget=state.mode==='roadster'?null:state.y;state.pitch=0;state.lean=0;state.flightPhase=state.mode==='roadster'?'coasting':'hover';if(state.mode==='roadster')state.jetPower=0;}spider.suspend();}
  reset();return{state,reset,placeWalker,placeMode,canPlaceMode,canRestorePose,restorePose,setMode,setFlightEnabled,step,suspend,clearActionInputs,groundAt,waterAt};
}
