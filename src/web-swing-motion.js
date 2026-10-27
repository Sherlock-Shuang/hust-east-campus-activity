/** Metre-scale, fixed-step superhero traversal. Gravity, a unilateral rope
 * constraint and tangential momentum are simulated; pumping/reeling and jump
 * impulses are explicit gameplay assists, not a commercial-game reproduction.
 * Every anchor lies on an input building edge. No invisible sky anchors exist.
 */
const G=9.81,HAND=1.65,R=.37,HEIGHT=2.08,BASE=.14;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const approach=(v,target,amount)=>v<target?Math.min(target,v+amount):Math.max(target,v-amount);
const finite=Number.isFinite;
const pointSegment=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=l2?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/l2,0,1):0;return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);};
function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;}return inside;}
function inside(p,b){return inRing(p,b.rings[0])&&!b.rings.slice(1).some(r=>inRing(p,r));}
function boundaryDistance(p,b){return Math.min(...b.edges.map(e=>pointSegment(p,e.a,e.b)));}
function overlap(p,b,r=R){if(p.x+r<b.minX||p.x-r>b.maxX||p.z+r<b.minZ||p.z-r>b.maxZ)return false;return inside(p,b)||b.edges.some(e=>pointSegment(p,e.a,e.b)<r);}
function compileBuildings(records){return(records||[]).filter(b=>b.rings?.[0]?.length>=3).map((b,index)=>{const outer=b.rings[0],edges=b.rings.flatMap((ring,ringIndex)=>ring.map((a,i)=>({a,b:ring[(i+1)%ring.length],ringIndex})).filter(e=>Math.hypot(e.a.x-e.b.x,e.a.z-e.b.z)>.05));return{...b,index,height:b.height??18,minHeight:b.minHeight??0,minX:Math.min(...outer.map(p=>p.x)),maxX:Math.max(...outer.map(p=>p.x)),minZ:Math.min(...outer.map(p=>p.z)),maxZ:Math.max(...outer.map(p=>p.z)),edges};});}
function cross(ax,az,bx,bz){return ax*bz-az*bx;}
function segmentEntersBuilding(a,b,building){
  if(Math.max(a.x,b.x)<building.minX||Math.min(a.x,b.x)>building.maxX||Math.max(a.z,b.z)<building.minZ||Math.min(a.z,b.z)>building.maxZ||Math.min(a.y,b.y)>building.height+.01||Math.max(a.y,b.y)<building.minHeight-.01)return false;
  const dx=b.x-a.x,dz=b.z-a.z,dy=b.y-a.y,cuts=[0,1];
  for(const e of building.edges){const ex=e.b.x-e.a.x,ez=e.b.z-e.a.z,den=cross(dx,dz,ex,ez);if(Math.abs(den)<1e-10)continue;const ax=e.a.x-a.x,az=e.a.z-a.z,t=cross(ax,az,ex,ez)/den,u=cross(ax,az,dx,dz)/den;if(t>0&&t<1&&u>=0&&u<=1)cuts.push(t);}
  cuts.sort((x,y)=>x-y);
  for(let i=1;i<cuts.length;i++){const lo=cuts[i-1]+1e-6,hi=cuts[i]-1e-6;if(hi<=lo)continue;const mid=(lo+hi)/2,p={x:a.x+dx*mid,z:a.z+dz*mid};if(!inside(p,building)||boundaryDistance(p,building)<.001)continue;const y1=a.y+dy*lo,y2=a.y+dy*hi;if(Math.max(y1,y2)>building.minHeight+.01&&Math.min(y1,y2)<building.height-.01)return true;}
  return false;
}

export function createWebSwingMotion({state,world={},groundAt,traffic=()=>[],guideAt}={}){
  if(!state||typeof groundAt!=='function')throw new TypeError('Swing motion needs shared player state and ground sampling.');
  const buildings=compileBuildings(world.buildings),bounds=world.bounds;
  let candidateClock=0,attachedAge=0,releaseDelay=0,lastAnchor=null,jumpHeld=false,swingHeld=false,autoWas=false,lastSafe=null,landingCooldown=0,ropeRate=0,jumpBuffer=0,coyote=0,wallAge=0,wallBudget=1.1,wallGrace=0,chainHeld=false;
  let zipHeld=false,zipBuffer=0,zipAge=0,zipImpulse=0,zipBoostTime=0,zipDirection=null;
  let pointHeld=false,pointBuffer=0,pointPath=null,pointDistance=0,pointSpeed=0,pointPerchTime=0,pointBoostTime=0,pointAimYaw=null,pointFeedback='',pointFeedbackTime=0;
  let trickAge=0;
  const hand=p=>({x:p.x,y:p.y+HAND,z:p.z});
  const lineClear=(a,b)=>!buildings.some(building=>segmentEntersBuilding(a,b,building));
  function clearBody(p){if(bounds&&(p.x-R<bounds.minX||p.x+R>bounds.maxX||p.z-R<bounds.minZ||p.z+R>bounds.maxZ))return false;
    return !world.barrierAt?.(p,R,0,HEIGHT)&&!buildings.some(b=>p.y<b.height-.012&&p.y+HEIGHT>b.minHeight+.012&&overlap(p,b));
  }
  function roofAt(x,z,y){let roof=null;for(const b of buildings)if(b.height+.016<=y+.2&&inside({x,z},b)&&boundaryDistance({x,z},b)>.015&&(!roof||b.height>roof.height))roof=b;return roof;}
  function supportAt(p){const ground=groundAt(p.x,p.z,R),roof=roofAt(p.x,p.z,p.y);if(roof&&roof.height+.016>ground.height)return{height:roof.height+.016,allowed:true,roof:roof.index};return{height:ground.height,allowed:ground.allowed!==false,roof:null};}
  function actorHit(p,old=null){const actors=typeof traffic==='function'?traffic():traffic;if(!Array.isArray(actors))return null;for(const a of actors){if(a.active===false||!finite(a.x)||!finite(a.z)||p.y>=(a.y??BASE)+1.9||p.y+HEIGHT<=(a.y??BASE)||Math.hypot(a.x-p.x,a.z-p.z)>2.4)continue;const kind=a.type??a.kind,rad=kind==='walk'?.27:.43,half=kind==='walk'?0:.48,yaw=a.yaw??0,dx=Math.sin(yaw)*half,dz=Math.cos(yaw)*half,front={x:a.x-dx,z:a.z-dz},rear={x:a.x+dx,z:a.z+dz},d=pointSegment(p,front,rear);const oldVertical=old&&old.y<(a.y??BASE)+1.9&&old.y+HEIGHT>(a.y??BASE);if(d<R+rad+.08&&(!oldVertical||d<pointSegment(old,front,rear)-1e-8))return a;}return null;}
  function clearSweep(from,to){if(world.barrierSweep?.(from,to,R,0,HEIGHT))return false;const dx=to.x-from.x,dz=to.z-from.z;
    for(const b of buildings){if(Math.min(from.y,to.y)>=b.height-.012||Math.max(from.y,to.y)+HEIGHT<=b.minHeight+.012||Math.min(from.x,to.x)-R>b.maxX||Math.max(from.x,to.x)+R<b.minX||Math.min(from.z,to.z)-R>b.maxZ||Math.max(from.z,to.z)+R<b.minZ)continue;
      for(const e of b.edges){const ex=e.b.x-e.a.x,ez=e.b.z-e.a.z,den=cross(dx,dz,ex,ez),ax=e.a.x-from.x,az=e.a.z-from.z;
        if(Math.abs(den)>1e-10){const t=cross(ax,az,ex,ez)/den,u=cross(ax,az,dx,dz)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return false;}
        if(Math.min(pointSegment(from,e.a,e.b),pointSegment(to,e.a,e.b),pointSegment(e.a,from,to),pointSegment(e.b,from,to))<R-1e-8)return false;
      }
    }return true;
  }
  function clearEscape(from,to){if(!clearSweep(from,to))return false;const count=Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.1);let previous=from;
    // A clear destination does not imply a clear route: the complete body
    // must stay outside thin walls while retreating out of the landing overlap.
    for(let i=1;i<=count;i++){const t=i/count,p={x:from.x+(to.x-from.x)*t,y:from.y,z:from.z+(to.z-from.z)*t};if(!clearBody(p)||!groundAt(p.x,p.z,R).allowed||actorHit(p,previous))return false;previous=p;}return!actorHit(to);
  }
  function anchorCandidates(exclude=lastAnchor,zip=false,heading=state.yaw){const origin=hand(state),fx=-Math.sin(heading),fz=-Math.cos(heading),candidates=[];
    for(const b of buildings){const bx=clamp(origin.x,b.minX,b.maxX),bz=clamp(origin.z,b.minZ,b.maxZ);if(Math.hypot(origin.x-bx,origin.z-bz)>72||b.height<origin.y-7)continue;
      for(let edgeIndex=0;edgeIndex<b.edges.length;edgeIndex++){const edge=b.edges[edgeIndex],dx=edge.b.x-edge.a.x,dz=edge.b.z-edge.a.z,l2=dx*dx+dz*dz,projection=clamp(((origin.x+fx*24-edge.a.x)*dx+(origin.z+fz*24-edge.a.z)*dz)/l2,.02,.98);
        for(const t of[.08,projection,.5,.92]){const x=edge.a.x+dx*t,z=edge.a.z+dz*t,horizontal=Math.hypot(x-origin.x,z-origin.z),ahead=(x-origin.x)*fx+(z-origin.z)*fz;if(horizontal<(zip?8:4)||horizontal>(zip?55:72)||ahead<(zip?.3:-.10)*horizontal)continue;
          const y=b.height<=origin.y+42?b.height:Math.min(b.height-.25,origin.y+24),rise=y-origin.y,distance=Math.hypot(horizontal,rise);if(rise<(state.grounded&&state.roofIndex===null?2:-7)||distance>82||rise>42)continue;
          const repeated=exclude&&Math.hypot(x-exclude.x,y-exclude.y,z-exclude.z)<9;if(repeated)continue;
          const radial=((origin.x-x)*(state.vx??0)+(origin.z-z)*(state.vz??0))/Math.max(1,horizontal);
          const score=Math.abs(horizontal-28)*.22+(1-ahead/horizontal)*18+Math.abs(rise-15)*.10+Math.max(0,radial)*.7+(b.index===exclude?.buildingIndex?5:0);
          candidates.push({x,y,z,buildingIndex:b.index,edgeIndex,kind:y===b.height?'roof-edge':'facade',score});
        }
      }
    }
    return candidates.sort((a,b)=>a.score-b.score);
  }
  function approachPenalty(anchor){
    // A short ballistic body probe is a preference, not a fabricated clear
    // route. The real swept collision remains authoritative during movement.
    const dx=anchor.x-state.x,dz=anchor.z-state.z,length=Math.hypot(dx,dz)||1;
    for(const t of[.22,.45]){
      const p={x:state.x+(state.vx??0)*t+dx/length*3*t*t,y:state.y+(state.verticalSpeed??0)*t-.5*G*t*t,z:state.z+(state.vz??0)*t+dz/length*3*t*t};
      if(!clearBody(p))return 7;
      if(!lineClear(hand(p),anchor))return 4;
    }
    return 0;
  }
  function findAnchor(exclude=lastAnchor){const origin=hand(state),visible=[];
    for(const c of anchorCandidates(exclude).slice(0,32))if(lineClear(origin,c)){
      const previous=state.candidateAnchor&&Math.hypot(c.x-state.candidateAnchor.x,c.y-state.candidateAnchor.y,c.z-state.candidateAnchor.z)<2;
      visible.push({...c,score:c.score+approachPenalty(c)-(previous?.7:0)});if(visible.length===10)break;
    }
    visible.sort((a,b)=>a.score-b.score);if(!visible.length)return null;const {score,...anchor}=visible[0];return anchor;
  }
  function zipVector(anchors){
    const target=anchors.reduce((p,a)=>({x:p.x+a.x/anchors.length,y:p.y+a.y/anchors.length,z:p.z+a.z/anchors.length}),{x:0,y:0,z:0});
    const dx=target.x-state.x,dz=target.z-state.z,length=Math.hypot(dx,dz)||1;
    return{x:dx/length,z:dz/length,lift:clamp((target.y-state.y-HAND)/length*2,-1.5,1.5)};
  }
  function zipPathClear(anchors){if(!anchors.length||!anchors.every(a=>lineClear(hand(state),a)))return false;
    const direction=zipVector(anchors),speed=Math.hypot(state.vx,state.vz),horizon=clamp(4/(speed+7.5),.22,.45),steps=Math.max(4,Math.ceil((speed+7.5)*horizon/.20));
    let previous=state;
    for(let i=1;i<=steps;i++){const t=horizon*i/steps,thrustTime=Math.min(t,.15),boostTravel=25*thrustTime*thrustTime+7.5*Math.max(0,t-.15),p={x:state.x+state.vx*t+direction.x*boostTravel,y:state.y+state.verticalSpeed*t-.5*G*t*t+direction.lift*boostTravel/7.5,z:state.z+state.vz*t+direction.z*boostTravel};
      if(!clearBody(p)||!clearSweep(previous,p)||actorHit(p)||p.y<supportAt(p).height+.05)return false;previous=p;
    }return true;
  }
  function findZipAnchors(){if(state.grounded)return[];
    const fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw),origin=hand(state),visible=[];
    for(const c of anchorCandidates(null,true).slice(0,40))if(lineClear(origin,c)){const {score,...anchor}=c;visible.push(anchor);if(visible.length===12)break;}
    const left=visible.filter(a=>(a.x-state.x)*fz-(a.z-state.z)*fx>1),right=visible.filter(a=>(a.x-state.x)*fz-(a.z-state.z)*fx< -1);
    for(const a of left.slice(0,3))for(const b of right.slice(0,3))if(zipPathClear([a,b]))return[a,b];
    for(const a of visible)if(zipPathClear([a]))return[a];return[];
  }
  function stopZip(){state.zipActive=false;state.zipAnchors=[];state.zipProgress=0;state.zipStrength=0;zipAge=0;zipImpulse=0;zipDirection=null;}
  function startZip(){
    if(state.grounded||state.diving||state.zipActive||state.zipCooldown>0)return false;
    const anchors=state.zipCandidateAnchors;
    if(!zipPathClear(anchors))return false;
    detach();state.zipAnchors=anchors.map(a=>({...a}));state.zipActive=true;state.zipProgress=0;state.zipStrength=0;
    state.zipCooldown=1.35;state.zipCount++;zipAge=0;zipImpulse=7.5;zipBoostTime=.85;zipDirection=zipVector(anchors);releaseDelay=.32;return true;
  }
  function pointPlan(target){
    const building=buildings[target.buildingIndex],edge=building?.edges[target.edgeIndex];if(!edge||Math.abs(target.y-building.height)>.01)return null;
    const dx=edge.b.x-edge.a.x,dz=edge.b.z-edge.a.z,length=Math.hypot(dx,dz)||1;
    let ix=-dz/length,iz=dx/length;
    if(!inside({x:target.x+ix*.2,z:target.z+iz*.2},building)){ix=-ix;iz=-iz;}
    const perch={x:target.x+ix*.82,y:building.height+.016,z:target.z+iz*.82};
    if(!inside(perch,building)||boundaryDistance(perch,building)<R+.10||!clearBody(perch)||actorHit(perch))return null;
    const outside={x:target.x-ix*1.15,y:building.height+1.2,z:target.z-iz*1.15},over={...perch,y:building.height+.75};
    const controls=[{x:state.x,y:state.y,z:state.z},outside,over,perch],points=[controls[0]];
    // Round the two approach corners while retaining clearance above the roof.
    // These points form a game-assisted pull path, not an invisible anchor.
    for(let i=1;i<controls.length-1;i++){
      const a=controls[i-1],b=controls[i],c=controls[i+1],ab=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),bc=Math.hypot(c.x-b.x,c.y-b.y,c.z-b.z),cut=Math.min(.42,ab*.2,bc*.2);
      const u={x:b.x+(a.x-b.x)*cut/ab,y:b.y+(a.y-b.y)*cut/ab,z:b.z+(a.z-b.z)*cut/ab},v={x:b.x+(c.x-b.x)*cut/bc,y:b.y+(c.y-b.y)*cut/bc,z:b.z+(c.z-b.z)*cut/bc};points.push(u);
      for(let n=1;n<=6;n++){const t=n/6,q=1-t;points.push({x:q*q*u.x+2*q*t*b.x+t*t*v.x,y:q*q*u.y+2*q*t*b.y+t*t*v.y,z:q*q*u.z+2*q*t*b.z+t*t*v.z});}
    }
    points.push(perch);let total=0;const lengths=[0];
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],distance=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),steps=Math.max(1,Math.ceil(distance/.35));let previous=a;
      for(let n=1;n<=steps;n++){const t=n/steps,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};if(!clearBody(p)||!clearSweep(previous,p)||actorHit(p))return null;previous=p;}
      total+=distance;lengths.push(total);
    }
    return{points,lengths,total,target:{...target,normal:{x:-ix,z:-iz},perch}};
  }
  function findPoint(){
    if(state.pointPhase==='approach'||state.pointPhase==='perch')return state.pointTarget;
    for(const c of anchorCandidates(null,false,pointAimYaw??state.yaw).filter(a=>a.kind==='roof-edge').slice(0,24)){
      if(Math.hypot(c.x-state.x,c.y-state.y,c.z-state.z)<6||!lineClear(hand(state),c))continue;
      const {score,...target}=c,plan=pointPlan(target);if(plan)return plan.target;
    }return null;
  }
  function stopPoint(){state.pointPhase='idle';state.pointTarget=null;state.pointProgress=0;state.pointLaunchWindow=0;state.pointLaunchReady=false;state.pointTimeToArrival=null;pointPath=null;pointDistance=0;pointSpeed=0;pointPerchTime=0;}
  function pointFailure(reason){pointFeedback=reason;pointFeedbackTime=.8;state.pointReady=false;state.pointUnavailableReason=reason;state.blockedReason=reason;}
  function startPoint(){
    if(state.pointPhase==='approach'||state.pointPhase==='perch')return false;
    if(!state.candidatePoint){pointFailure('前方暂无安全屋沿，调整视角后重试');return false;}
    if(!lineClear(hand(state),state.candidatePoint)){pointFailure('定点蛛丝被建筑挡住，调整视角后重试');return false;}
    const plan=pointPlan(state.candidatePoint);if(!plan){pointFailure('定点路径被遮挡或落点拥挤，请重新选点');return false;}
    pointFeedback='';pointFeedbackTime=0;
    detach();stopZip();stopTrick();state.diving=false;state.diveBlend=0;pointBoostTime=0;zipBoostTime=0;pointPath=plan;pointDistance=0;pointSpeed=Math.min(22,Math.hypot(state.vx,state.vz,state.verticalSpeed));pointPerchTime=0;
    state.pointTarget=plan.target;state.pointPhase='approach';state.pointProgress=0;state.pointLaunchWindow=0;state.pointLaunchQuality=0;state.pointLaunchTime=0;state.pointLaunchProgress=0;state.pointCount++;state.grounded=false;state.roofIndex=null;state.wallContact=null;wallGrace=0;return true;
  }
  function launchPoint(intent){
    const quality=clamp(state.pointLaunchWindow/.25,0,1),dx=intent.magnitude>.05?intent.x:-Math.sin(state.yaw),dz=intent.magnitude>.05?intent.z:-Math.cos(state.yaw),length=Math.hypot(dx,dz)||1;
    state.vx=dx/length*(20+8*quality);state.vz=dz/length*(20+8*quality);state.verticalSpeed=8+4*quality;state.grounded=false;state.roofIndex=null;
    state.pointPhase='launch';state.pointLaunchQuality=quality;state.pointLaunchCount++;state.pointLaunchTime=0;state.pointLaunchProgress=0;state.pointLaunchReady=false;state.pointLaunchWindow=0;state.pointTimeToArrival=0;pointBoostTime=1.0;pointPath=null;jumpBuffer=0;coyote=0;releaseDelay=.22;landingCooldown=.3;state.traversalPhase='point-launch';
  }
  function updatePoint(dt,intent){
    if(state.pointPhase==='perch'){
      const support=supportAt(state);if(!support.allowed||support.roof!==state.pointTarget.buildingIndex||!clearBody(state)||actorHit(state)){stopPoint();pointFailure('屋沿落点被占用，请重新选点');state.grounded=false;return false;}
      pointPerchTime+=dt;state.pointLaunchWindow=Math.max(0,.25-pointPerchTime);state.pointLaunchReady=state.pointLaunchWindow>0;state.pointTimeToArrival=0;
      state.vx=state.vz=state.verticalSpeed=state.speed=0;state.grounded=true;state.y=support.height;state.roofIndex=support.roof;state.traversalPhase='point-perch';state.pitch=state.lean=0;
      if(jumpBuffer>0){launchPoint(intent);return false;}return true;
    }
    if(state.pointPhase!=='approach'||!pointPath)return false;
    if(!lineClear(hand(state),state.pointTarget)){stopPoint();pointFailure('定点蛛丝被建筑挡住');return false;}
    const remaining=pointPath.total-pointDistance,targetSpeed=Math.min(26,Math.sqrt(80*remaining));pointSpeed=approach(pointSpeed,targetSpeed,45*dt);
    const nextDistance=Math.min(pointPath.total,pointDistance+Math.max(.5,pointSpeed)*dt);let segment=1;while(segment<pointPath.lengths.length-1&&pointPath.lengths[segment]<nextDistance)segment++;
    const a=pointPath.points[segment-1],b=pointPath.points[segment],t=clamp((nextDistance-pointPath.lengths[segment-1])/(pointPath.lengths[segment]-pointPath.lengths[segment-1]||1),0,1),next={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
    if(!clearBody(next)||!clearSweep(state,next)||actorHit(next)){stopPoint();pointFailure('定点路径被障碍挡住');return false;}
    state.vx=(next.x-state.x)/dt;state.vz=(next.z-state.z)/dt;state.verticalSpeed=(next.y-state.y)/dt;
    if(!move(next,dt))return true;
    if(Math.hypot(state.x-next.x,state.y-next.y,state.z-next.z)>.04){stopPoint();pointFailure('定点路径净空不足');return false;}
    pointDistance=nextDistance;state.pointProgress=pointDistance/pointPath.total;state.speed=Math.hypot(state.vx,state.vz);state.progress=groundAt(state.x,state.z).progress??state.progress;
    const left=pointPath.total-pointDistance,brakeDistance=pointSpeed*pointSpeed/80;state.pointTimeToArrival=left<=brakeDistance?Math.sqrt(2*left/40):(left-brakeDistance)/Math.max(pointSpeed,8)+pointSpeed/40;
    state.pointLaunchReady=state.pointTimeToArrival<=.18;state.traversalPhase='point-approach';state.pitch=approach(state.pitch,-.25,dt*2);state.lean=approach(state.lean,0,dt*2);
    if(left<1e-8){state.pointPhase='perch';state.pointProgress=1;state.pointLaunchWindow=.25;state.pointLaunchReady=true;state.pointTimeToArrival=0;pointPerchTime=0;state.grounded=true;state.roofIndex=state.pointTarget.buildingIndex;state.vx=state.vz=state.verticalSpeed=state.speed=0;state.traversalPhase='point-perch';lastSafe={x:state.x,y:state.y,z:state.z,yaw:state.yaw};if(jumpBuffer>0){launchPoint(intent);return false;}}
    return true;
  }
  function stopTrick(immediate=false){
    if(immediate){state.trickActive=false;state.trickPhase='idle';state.trickBlend=0;state.trickProgress=0;state.trickRotation={x:0,y:0,z:0};trickAge=0;return;}
    if(state.trickPhase==='perform'){state.trickActive=false;state.trickPhase='recover';state.trickRotation=Object.fromEntries(Object.entries(state.trickRotation).map(([key,angle])=>[key,Math.atan2(Math.sin(angle),Math.cos(angle))]));}
  }
  function trickClear(){
    for(const t of[0,.22]){const p={x:state.x+state.vx*t,y:state.y+state.verticalSpeed*t-.5*G*t*t,z:state.z+state.vz*t},support=supportAt(p);
      if(p.y<support.height+(t?1.8:2.4)||bounds&&(p.x-1.05<bounds.minX||p.x+1.05>bounds.maxX||p.z-1.05<bounds.minZ||p.z+1.05>bounds.maxZ))return false;
      if(world.barrierAt?.(p,1.05,-.15,2.2)||buildings.some(b=>p.y-.15<b.height&&p.y+2.2>b.minHeight&&overlap(p,b,1.05)))return false;
    }return true;
  }
  function updateTrick(dt,input){
    const eligible=!!input.trick&&!state.grounded&&!state.anchor&&!state.zipActive&&!state.diving&&state.pointPhase==='idle'&&!state.wallContact&&!state.blockedReason&&!input.swing&&!input.autoSwing&&!input.zip&&!input.point&&!input.dive&&trickClear();
    if(!eligible)stopTrick();
    if(eligible&&state.trickPhase!=='perform'&&state.trickBlend<.05){trickAge=0;state.trickActive=true;state.trickPhase='perform';state.trickType=Math.abs(input.trickX??0)>Math.abs(input.trickY??0)?input.trickX>0?'rightroll':'leftroll':input.trickY<0?'backflip':'frontflip';}
    if(state.trickPhase==='perform'){
      trickAge+=dt;state.trickProgress=clamp(trickAge/.75,0,1);state.trickBlend=approach(state.trickBlend,1,dt*9);
      const angle=2*Math.PI*state.trickProgress;state.trickRotation={x:state.trickType==='frontflip'?-angle:state.trickType==='backflip'?angle:0,y:0,z:state.trickType==='leftroll'?angle:state.trickType==='rightroll'?-angle:0};
      if(trickAge>=.75-1e-9){state.trickCount++;state.trickCombo++;trickAge=0;state.trickProgress=0;state.trickRotation={x:0,y:0,z:0};state.trickType=Math.abs(input.trickX??0)>Math.abs(input.trickY??0)?input.trickX>0?'rightroll':'leftroll':input.trickY<0?'backflip':'frontflip';}
    }else if(state.trickPhase==='recover'){
      const old=state.trickBlend;state.trickBlend=approach(old,0,dt/.12);const scale=old?state.trickBlend/old:0;for(const key of['x','y','z'])state.trickRotation[key]*=scale;
      if(state.trickBlend===0)stopTrick(true);
    }
    if(state.grounded)state.trickCombo=0;
    if(state.trickActive)state.traversalPhase='trick';
  }
  function clearActionInputs(){jumpHeld=false;swingHeld=false;zipHeld=false;pointHeld=false;autoWas=false;jumpBuffer=0;zipBuffer=0;pointBuffer=0;chainHeld=false;stopTrick();}
  function detach(reason=''){if(state.anchor)lastAnchor={...state.anchor};state.anchor=null;state.swingPivot=null;state.ropeLength=0;state.webTension=0;attachedAge=0;ropeRate=0;releaseDelay=.18;state.releaseTime=0;state.candidateAnchor=null;candidateClock=0;if(reason)state.blockedReason=reason;}
  function attach(anchor){if(!anchor||!lineClear(hand(state),anchor))return false;
    state.anchor={...anchor};const fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw),dx=state.x-anchor.x,dz=state.z-anchor.z,along=dx*fx+dz*fz,lx=dx-fx*along,lz=dz-fz*along,lateral=Math.hypot(lx,lz)||1,shift=Math.min(5,lateral*.55),lift=clamp(28+groundAt(state.x,state.z).height-anchor.y,0,12);
    // The visible endpoint and occlusion use the real building. A disclosed
    // gameplay pivot shifts low-roof pendulums into the street and raises their
    // clearance, following the separation used in action-game traversal.
    state.swingPivot={x:anchor.x+lx/lateral*shift,y:anchor.y+lift,z:anchor.z+lz/lateral*shift};const p=state.swingPivot;
    state.ropeLength=Math.hypot(p.x-state.x,p.y-state.y-HAND,p.z-state.z)+.15;ropeRate=0;state.swingHand=state.swingCount%2?-1:1;state.swingCount++;attachedAge=0;state.webTension=0;wallBudget=Math.min(1.1,wallBudget+.35);return true;
  }
  function reset(){Object.assign(state,{anchor:null,swingPivot:null,candidateAnchor:null,ropeLength:0,vx:0,vz:0,verticalSpeed:0,swingCount:0,airTime:0,webTension:0,swingHand:1,roofIndex:null,traversalPhase:'ground',wallContact:null,releaseTime:0,landingImpact:0,inputBuffered:false,attachAge:0,swingPhase:'entry',bottomKick:0,zipActive:false,zipAnchors:[],zipCandidateAnchors:[],zipProgress:0,zipCooldown:0,zipCount:0,zipStrength:0,zipAvailable:false,zipReady:false,zipUnavailableReason:'请先起跳',diving:false,diveBlend:0,
    pointPhase:'idle',pointTarget:null,candidatePoint:null,pointProgress:0,pointLaunchWindow:0,pointLaunchQuality:0,pointLaunchReady:false,pointTimeToArrival:null,pointLaunchTime:0,pointLaunchProgress:0,pointCount:0,pointLaunchCount:0,pointReady:false,pointUnavailableReason:'前方没有安全屋顶落点',
    trickActive:false,trickType:'frontflip',trickProgress:0,trickPhase:'idle',trickBlend:0,trickRotation:{x:0,y:0,z:0},trickCount:0,trickCombo:0});
    candidateClock=0;attachedAge=0;releaseDelay=0;lastAnchor=null;jumpHeld=false;swingHeld=false;autoWas=false;landingCooldown=0;ropeRate=0;jumpBuffer=0;coyote=0;wallAge=0;wallBudget=1.1;wallGrace=0;chainHeld=false;zipHeld=false;zipBuffer=0;zipAge=0;zipImpulse=0;zipBoostTime=0;zipDirection=null;pointHeld=false;pointBuffer=0;pointPath=null;pointDistance=0;pointSpeed=0;pointPerchTime=0;pointBoostTime=0;pointAimYaw=null;pointFeedback='';pointFeedbackTime=0;trickAge=0;lastSafe={x:state.x,y:state.y,z:state.z,yaw:state.yaw};
    if(state.mode==='spider'){state.candidateAnchor=findAnchor(null);state.candidatePoint=findPoint();state.pointReady=!!state.candidatePoint;}
  }
  function suspend(){detach();stopZip();stopPoint();stopTrick(true);clearActionInputs();state.vx=0;state.vz=0;state.verticalSpeed=0;state.speed=0;candidateClock=0;releaseDelay=0;lastAnchor=null;coyote=0;wallGrace=0;state.wallContact=null;zipBoostTime=0;pointBoostTime=0;pointFeedback='';pointFeedbackTime=0;state.diving=false;state.diveBlend=0;state.zipCandidateAnchors=[];state.zipAvailable=false;state.zipReady=false;state.candidatePoint=null;state.pointReady=false;}
  function respawn(reason){detach();stopZip();stopPoint();stopTrick(true);pointBoostTime=0;zipBoostTime=0;pointFeedback='';pointFeedbackTime=0;state.diving=false;state.diveBlend=0;state.zipCandidateAnchors=[];state.zipAvailable=false;state.zipReady=false;state.zipUnavailableReason='请先起跳';state.candidatePoint=null;state.pointReady=false;if(lastSafe)Object.assign(state,lastSafe);Object.assign(state,{vx:0,vz:0,verticalSpeed:0,speed:0,grounded:true,airTime:0,pitch:0,lean:0,blockedReason:reason});landingCooldown=.8;candidateClock=0;}
  function contactNormal(p){let best=null;
    for(const b of buildings){if(p.y>=b.height+.02||p.y+HEIGHT<=b.minHeight||!overlap(p,b,R+.35))continue;
      for(const e of b.edges){const dx=e.b.x-e.a.x,dz=e.b.z-e.a.z,l2=dx*dx+dz*dz,t=clamp(((p.x-e.a.x)*dx+(p.z-e.a.z)*dz)/l2,0,1),qx=e.a.x+t*dx,qz=e.a.z+t*dz,d=Math.hypot(p.x-qx,p.z-qz);if(d>R+.4||best&&d>=best.distance)continue;const nx=(p.x-qx)/(d||1),nz=(p.z-qz)/(d||1);best={nx,nz,buildingIndex:b.index,distance:d};}
    }return best;
  }
  function desiredDirection(input,automatic,dt){
    const worldIntent=finite(input.moveX)||finite(input.moveZ);let x=0,z=0,magnitude=0;
    if(worldIntent){x=Number(input.moveX)||0;z=Number(input.moveZ)||0;magnitude=Math.hypot(x,z);if(magnitude>1){x/=magnitude;z/=magnitude;magnitude=1;}}
    else{const turn=clamp(Number(input.turn)||0,-1,1);state.yaw+=turn*(state.grounded?2.7:2.1)*dt;const f=clamp(Number(input.forward)||0,-1,1);x=-Math.sin(state.yaw)*f;z=-Math.cos(state.yaw)*f;magnitude=Math.abs(f);}
    if(automatic&&magnitude<.05&&typeof guideAt==='function'){
      const near=groundAt(state.x,state.z),lookAhead=clamp(12+state.speed*.35,14,23),point=guideAt((near.progress??0)+lookAhead);x=point.x-state.x;z=point.z-state.z;const d=Math.hypot(x,z)||1;x/=d;z/=d;magnitude=1;
      // Probe complete bodies along several short headings, choosing a visible
      // route around a facade instead of repeatedly pushing into the same wall.
      const base=Math.atan2(x,z),probe=clamp(2+state.speed*.25,3,7);let best=null;
      for(const angle of[0,.35,-.35,.7,-.7,1.1,-1.1,1.55,-1.55,2,-2]){const tx=Math.sin(base+angle),tz=Math.cos(base+angle);let clearance=0;for(let d=.5;d<=probe;d+=.5){if(!clearBody({x:state.x+tx*d,y:state.y,z:state.z+tz*d}))break;clearance=d;}const score=clearance/probe*3-Math.abs(angle)*.35;if(!best||score>best.score)best={x:tx,z:tz,score};}if(best){x=best.x;z=best.z;}
    }
    if(magnitude<.05&&Math.hypot(state.vx,state.vz)>2&&!(Math.abs(Number(input.turn)||0)>.01&&!worldIntent)){const target=Math.atan2(-state.vx,-state.vz),error=Math.atan2(Math.sin(target-state.yaw),Math.cos(target-state.yaw));state.yaw+=clamp(error,-2.8*dt,2.8*dt);}
    if(magnitude>.05){const target=Math.atan2(-x,-z),error=Math.atan2(Math.sin(target-state.yaw),Math.cos(target-state.yaw));state.yaw+=clamp(error,-3.5*dt,3.5*dt);}
    state.yaw=Math.atan2(Math.sin(state.yaw),Math.cos(state.yaw));
    return{x,z,magnitude};
  }
  function move(next,dt){const from={x:state.x,y:state.y,z:state.z},dx=next.x-from.x,dy=next.y-from.y,dz=next.z-from.z,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy,dz)/.12));let p={...from},roofIndex=null;
    for(let i=1;i<=steps;i++){
      const target={x:p.x+dx/steps,y:p.y+dy/steps,z:p.z+dz/steps};
      if(bounds){const bx=clamp(target.x,bounds.minX+R,bounds.maxX-R),bz=clamp(target.z,bounds.minZ+R,bounds.maxZ-R);if(bx!==target.x){state.vx=0;state.blockedReason='校园边界';}if(bz!==target.z){state.vz=0;state.blockedReason='校园边界';}target.x=bx;target.z=bz;}
      const ground=groundAt(target.x,target.z,R),wasGround=groundAt(p.x,p.z,R);
      if(!ground.allowed&&target.y<=ground.height+.10){if(state.grounded){state.vx=state.vz=0;state.blockedReason='水域边界';target.x=p.x;target.z=p.z;}else{respawn('落水后返回最近落脚处');return false;}}
      if(ground.height>target.y+.25&&wasGround.height<ground.height-.35||state.grounded&&wasGround.onBridge&&wasGround.height>BASE+.35&&ground.height<wasGround.height-.35){target.x=p.x;target.z=p.z;state.vx=state.vz=0;state.blockedReason='桥面边界';}
      const support=supportAt({...target,y:Math.max(p.y,target.y)});
      if(support.allowed&&target.y<=support.height&&p.y>=support.height-.25&&state.verticalSpeed<=0){target.y=support.height;state.landingImpact=Math.max(state.landingImpact,-state.verticalSpeed);state.verticalSpeed=0;roofIndex=support.roof;}
      const barrierContact=world.barrierVertical?.(p,target,R,0,HEIGHT);if(barrierContact?.reason){target.y=barrierContact.y;state.verticalSpeed=0;state.blockedReason=barrierContact.reason;}
      for(const b of buildings)if(overlap(target,b)&&p.y+HEIGHT<=b.minHeight+.025&&target.y+HEIGHT>b.minHeight){target.y=b.minHeight-HEIGHT-.016;state.verticalSpeed=0;state.blockedReason='上方建筑净空不足';}
      if(!clearBody(target)){
        const barrier=world.barrierAt?.(target,R,0,HEIGHT),contact=barrier?null:contactNormal(p),incoming=Math.hypot(state.vx,state.vz);
        if(contact){const normalMove=(target.x-p.x)*contact.nx+(target.z-p.z)*contact.nz,slide={x:target.x-Math.min(0,normalMove)*contact.nx,y:target.y,z:target.z-Math.min(0,normalMove)*contact.nz};
          if(clearBody(slide)){target.x=slide.x;target.z=slide.z;}else{target.x=p.x;target.z=p.z;}
          const into=state.vx*contact.nx+state.vz*contact.nz;if(into<0){state.vx-=into*contact.nx;state.vz-=into*contact.nz;}
          state.wallContact={nx:contact.nx,nz:contact.nz,buildingIndex:contact.buildingIndex};wallGrace=.16;
          if(chainHeld&&!state.grounded&&incoming>3&&wallBudget>0){wallAge+=dt/steps;wallBudget=Math.max(0,wallBudget-dt/steps);state.traversalPhase='wallrun';state.verticalSpeed=Math.max(state.verticalSpeed,-1.4);}
        }else{target.x=p.x;target.z=p.z;state.vx=state.vz=0;}
        if(!clearBody(target)){target.y=p.y;state.verticalSpeed=Math.min(0,state.verticalSpeed);}
        state.blockedReason=barrier?(barrier.label||'围栏边界'):chainHeld&&wallBudget>0?'沿立面滑行':'建筑边界';
      }
      const hit=actorHit(target,p);
      if(hit){
        if(!state.grounded&&state.verticalSpeed<=0&&p.y>(hit.y??BASE)+1.5){let escape=null;for(let n=0;n<12;n++){const angle=n*Math.PI/6,q={x:target.x+Math.cos(angle)*1.25,y:target.y,z:target.z+Math.sin(angle)*1.25};if(clearEscape(p,q)){escape=q;break;}}if(escape){const ex=escape.x-p.x,ez=escape.z-p.z,length=Math.hypot(ex,ez)||1;target.x=p.x+ex/length*.10;target.z=p.z+ez/length*.10;}
          else{target.x=p.x;target.z=p.z;state.blockedReason='落点拥挤，滑行寻找空隙';}
          target.y=Math.max(target.y,(hit.y??BASE)+1.94);state.verticalSpeed=Math.max(0,state.verticalSpeed);if(!clearBody(target)){target.x=p.x;target.y=p.y;target.z=p.z;state.vx=state.vz=state.verticalSpeed=0;state.blockedReason='落点净空不足';}}
        else{target.x=p.x;target.z=p.z;state.vx=state.vz=0;state.blockedReason='前方人车';}
      }
      p=target;
    }
    state.distance+=Math.hypot(p.x-state.x,p.z-state.z);state.x=p.x;state.y=p.y;state.z=p.z;
    const support=supportAt(state);state.grounded=support.allowed&&Math.abs(state.y-support.height)<.035&&state.verticalSpeed<=0;
    state.roofIndex=state.grounded?(roofIndex??support.roof):null;
    if(state.grounded){state.y=support.height;state.verticalSpeed=0;state.airTime=0;lastSafe={x:state.x,y:state.y,z:state.z,yaw:state.yaw};}else state.airTime+=dt;
    return true;
  }
  function step(dt,input={}){
    state.rotorPower=0;state.jetPower=0;state.flightEnabled=false;state.steeringAngle=0;state.blockedReason='';
    releaseDelay=Math.max(0,releaseDelay-dt);landingCooldown=Math.max(0,landingCooldown-dt);candidateClock-=dt;wallGrace=Math.max(0,wallGrace-dt);state.releaseTime+=dt;state.landingImpact*=Math.exp(-5*dt);state.bottomKick*=Math.exp(-10*dt);
    state.zipCooldown=Math.max(0,state.zipCooldown-dt);zipBoostTime=Math.max(0,zipBoostTime-dt);pointBoostTime=Math.max(0,pointBoostTime-dt);
    pointFeedbackTime=Math.max(0,pointFeedbackTime-dt);
    const zip=!!input.zip,zipEdge=zip&&!zipHeld;zipHeld=zip;zipBuffer=zipEdge?.12:Math.max(0,zipBuffer-dt);
    const point=!!input.point,pointEdge=point&&!pointHeld,swingEdge=!!input.swing&&!swingHeld;pointHeld=point;pointBuffer=pointEdge?.18:Math.max(0,pointBuffer-dt);
    pointAimYaw=finite(input.aimYaw)?input.aimYaw:null;if(pointEdge)candidateClock=0;
    if(state.pointPhase==='launch'){state.pointLaunchTime+=dt;state.pointLaunchProgress=clamp(state.pointLaunchTime/.55,0,1);if(state.pointLaunchTime>=.55)stopPoint();}
    if((state.pointPhase==='approach'||state.pointPhase==='perch')&&(input.dive||zipEdge||swingEdge&&!pointEdge))stopPoint();
    state.diving=!!input.dive&&!state.grounded&&!state.zipActive;state.diveBlend=approach(state.diveBlend,state.diving?1:0,dt*4);
    if(state.diving&&state.anchor)detach();
    if(!wallGrace){state.wallContact=null;wallAge=0;}
    const automatic=!!input.autoSwing,wantsWeb=(!!input.swing||automatic)&&!input.dive,jump=!!input.jump,jumpEdge=jump&&!jumpHeld;jumpHeld=jump;swingHeld=!!input.swing;chainHeld=wantsWeb;
    if(jumpEdge)jumpBuffer=state.pointPhase==='approach'||state.pointPhase==='perch'?.18:.16;else jumpBuffer=Math.max(0,jumpBuffer-dt);
    if(state.grounded)coyote=.12;else coyote=Math.max(0,coyote-dt);
    if(automatic&&!autoWas){candidateClock=0;lastAnchor=null;releaseDelay=0;}autoWas=automatic;
    const intent=desiredDirection(input,automatic,dt),fx=-Math.sin(state.yaw),fz=-Math.cos(state.yaw);
    if(candidateClock<=0){state.candidateAnchor=findAnchor();if(!state.candidateAnchor&&state.grounded)state.candidateAnchor=findAnchor(null);state.zipCandidateAnchors=findZipAnchors();state.candidatePoint=findPoint();candidateClock=.10;}
    if(pointBuffer>0&&!input.dive&&startPoint()){pointBuffer=0;zipBuffer=0;}
    state.pointReady=!!state.candidatePoint&&state.pointPhase!=='approach'&&state.pointPhase!=='perch'&&!state.diving&&pointFeedbackTime===0;
    state.pointUnavailableReason=state.pointPhase==='approach'?'正在吸向屋沿':state.pointPhase==='perch'?'空格弹射或重新按 E 接丝':state.diving?'松开俯冲后再选点':pointFeedbackTime>0?pointFeedback:!state.candidatePoint?'前方没有安全屋顶落点':'';
    if(updatePoint(dt,intent)){state.zipReady=false;state.zipAvailable=false;state.zipUnavailableReason='正在定点移动';updateTrick(dt,input);return;}
    if(state.anchor&&!lineClear(hand(state),state.anchor))detach('蛛丝被建筑挡住');
    if(state.anchor&&!wantsWeb)detach();
    if(state.grounded){
      wallBudget=1.1;const moving=intent.magnitude>.05,along=state.vx*fx+state.vz*fz,chainSpeed=wantsWeb?Math.max(9,Math.min(along,18)):0,desired=moving?(input.fast?9:6):chainSpeed;
      const dx=moving?intent.x:fx,dz=moving?intent.z:fz,response=input.brake?24:wantsWeb?10:18;
      state.vx=approach(state.vx,input.brake?0:dx*desired,response*dt);state.vz=approach(state.vz,input.brake?0:dz*desired,response*dt);
      const near=groundAt(state.x,state.z),bridgeTarget=typeof guideAt==='function'?guideAt(near.progress??0):null;
      const canVault=moving&&bridgeTarget&&bridgeTarget.y-state.y>.8&&bridgeTarget.y-state.y<8&&Math.hypot(bridgeTarget.x-state.x,bridgeTarget.z-state.z)<30;
      // Check the whole short approach, not only its far endpoint. A person
      // beside the player's leading shoulder can block the next 10 cm while
      // the old 1.4 m probe has already passed them, deadlocking held-web travel.
      const canVaultActor=moving&&[.35,.7,1.05,1.4].some(ahead=>actorHit({x:state.x+dx*ahead,y:state.y,z:state.z+dz*ahead}))&&groundAt(state.x+dx*5,state.z+dz*5,R).allowed;
      const canChain=state.candidateAnchor||state.roofIndex!==null||canVault||canVaultActor;
      if((jumpBuffer>0||wantsWeb&&canChain&&landingCooldown===0)&&!input.brake){
        state.verticalSpeed=state.roofIndex===null?(wantsWeb?(canVaultActor&&!state.candidateAnchor&&!canVault?8:12.8):10):wantsWeb?7.5:10;state.grounded=false;jumpBuffer=0;coyote=0;landingCooldown=.55;
        if(wantsWeb&&Math.hypot(state.vx,state.vz)<8){state.vx=dx*8;state.vz=dz*8;}state.traversalPhase='launch';
      }
    }else if(jumpBuffer>0&&(state.anchor||state.wallContact||coyote>0)){
      if(state.wallContact){const n=state.wallContact;state.vx+=n.nx*6;state.vz+=n.nz*6;state.verticalSpeed=Math.max(state.verticalSpeed,8);wallBudget=0;wallGrace=0;state.wallContact=null;}
      else if(state.anchor){const speed=Math.hypot(state.vx,state.vz)||1;state.vx+=state.vx/speed*3;state.vz+=state.vz/speed*3;state.verticalSpeed=Math.min(15,Math.max(state.verticalSpeed,0)+4);detach();releaseDelay=.32;}
      else state.verticalSpeed=10;
      jumpBuffer=0;coyote=0;state.traversalPhase='launch';
    }
    if(state.anchor){attachedAge+=dt;const a=state.anchor,dx=a.x-state.x,dz=a.z-state.z,ahead=dx*fx+dz*fz,near=Math.hypot(dx,dz),turnAway=(state.vx*dx+state.vz*dz)<-10;
      const rising=state.verticalSpeed>.6||state.y>groundAt(state.x,state.z).height+12;
      if(wantsWeb&&attachedAge>.55&&(ahead<-1.5||(near<4.5||turnAway)&&rising||attachedAge>3.0)){detach();releaseDelay=.12;}
    }
    if(zipBuffer>0&&startZip())zipBuffer=0;
    if(!state.anchor&&!state.grounded&&!state.zipActive&&releaseDelay<=0&&wantsWeb&&state.candidateAnchor)attach(state.candidateAnchor);
    if(state.zipActive){
      if(!state.zipAnchors.every(a=>lineClear(hand(state),a))||state.grounded){stopZip();state.blockedReason='前冲蛛丝被障碍挡住';}
      else{zipAge+=dt;state.zipProgress=clamp(zipAge/.28,0,1);state.zipStrength=Math.sin(state.zipProgress*Math.PI);
        const impulse=Math.min(zipImpulse,50*dt);zipImpulse-=impulse;state.vx+=zipDirection.x*impulse;state.vz+=zipDirection.z*impulse;state.verticalSpeed+=zipDirection.lift*impulse/7.5;
        if(zipAge>=.28)stopZip();
      }
    }
    if(!state.grounded){
      state.verticalSpeed-=(G+(state.diving?18:0))*dt;
      const speed=Math.hypot(state.vx,state.vz),direction=intent.magnitude>.05?intent:{x:speed>2?state.vx/speed:fx,z:speed>2?state.vz/speed:fz,magnitude:wantsWeb?1:0};
      // Direction input changes acceleration rather than overwriting velocity.
      // Coasting without input preserves tangential momentum after releasing.
      if(direction.magnitude>.05){const along=state.vx*direction.x+state.vz*direction.z,target=state.zipActive?Math.max(speed,26):input.fast?25:wantsWeb?21:17,drive=clamp((target-along)*2.2,-18,wantsWeb?18:12),lateral=state.vx*direction.z-state.vz*direction.x,side=clamp(-lateral*4,-30,30);
        let ax=direction.x*drive+direction.z*side,az=direction.z*drive-direction.x*side,ay=0;
        if(state.anchor){const h=hand(state),pivot=state.swingPivot??state.anchor,nx=h.x-pivot.x,ny=h.y-pivot.y,nz=h.z-pivot.z,l2=nx*nx+ny*ny+nz*nz,dot=(ax*nx+az*nz)/(l2||1);ax-=dot*nx;az-=dot*nz; /* Pumping never adds a downward pull. */}
        state.vx+=ax*dt;state.vz+=az*dt;state.verticalSpeed+=ay*dt;
      }
      if(state.diving&&speed>1){const gain=clamp(-state.verticalSpeed*.25,0,4)*dt;state.vx+=state.vx/speed*gain;state.vz+=state.vz/speed*gain;}
      if(state.wallContact&&wantsWeb&&wallBudget>0){const n=state.wallContact,along=state.vx*n.nx+state.vz*n.nz;if(along<0){state.vx-=along*n.nx;state.vz-=along*n.nz;}if(wallAge>.35&&Math.hypot(state.vx,state.vz)<3){state.vx+=n.nx*4;state.vz+=n.nz*4;state.verticalSpeed=Math.max(state.verticalSpeed,7);wallBudget=0;wallGrace=0;state.wallContact=null;}}
      const drag=Math.exp(-(input.brake?2.5:.015)*dt);state.vx*=drag;state.vz*=drag;
    }
    const speed=Math.hypot(state.vx,state.vz),limit=Math.max(input.fast?30:26,26+6*Math.max(state.diveBlend,clamp(zipBoostTime/.45,0,1),clamp(pointBoostTime/.45,0,1)));if(speed>limit){state.vx*=limit/speed;state.vz*=limit/speed;}state.verticalSpeed=clamp(state.verticalSpeed,-42,18);
    const next={x:state.x+state.vx*dt,y:state.y+state.verticalSpeed*dt,z:state.z+state.vz*dt};let tension=0;
    if(state.anchor){
      const a=state.swingPivot??state.anchor,h=hand(next),nx=h.x-a.x,ny=h.y-a.y,nz=h.z-a.z,distance=Math.hypot(nx,ny,nz)||1,ux=nx/distance,uy=ny/distance,uz=nz/distance;
      const terrain=groundAt(state.x,state.z).height,target=Math.max(6,a.y-terrain-HAND-3),predictedFeet=state.y+state.verticalSpeed*.65-.5*G*.65*.65,needsLift=state.ropeLength>target&&predictedFeet<terrain+3.5;
      const request=input.reel?(input.fast?10:7):needsLift?clamp((terrain+3.5-predictedFeet)*2,0,7):0;
      ropeRate=approach(ropeRate,-request,16*dt);state.ropeLength=Math.min(state.ropeLength,distance+.15);const oldLength=state.ropeLength;state.ropeLength=Math.max(6,state.ropeLength+ropeRate*dt);
      let radial=state.vx*ux+state.verticalSpeed*uy+state.vz*uz;
      // A new web pays out briefly while its catch engages. This prevents an
      // abrupt velocity cut when changing sides and never moves the player.
      if((attachedAge<.30||attachedAge<.85&&radial>.5)&&radial>0){const catchStep=40*dt*clamp(attachedAge/.30,0,1),removed=Math.min(radial,catchStep);state.vx-=ux*removed;state.verticalSpeed-=uy*removed;state.vz-=uz*removed;state.ropeLength=Math.max(state.ropeLength,distance);}
      else if(distance>state.ropeLength){const excess=distance-state.ropeLength;next.x-=ux*excess;next.y-=uy*excess;next.z-=uz*excess;const lengthRate=(state.ropeLength-oldLength)/dt;if(radial>lengthRate){state.vx-=ux*(radial-lengthRate);state.verticalSpeed-=uy*(radial-lengthRate);state.vz-=uz*(radial-lengthRate);}tension=clamp((state.speed**2/state.ropeLength+G*Math.abs(uy))/40,.08,1);}
    }else ropeRate=0;
    state.webTension=approach(state.webTension,tension,dt*5);
    const wasGrounded=state.grounded;if(!move(next,dt))return;
    if(state.anchor){const d=Math.hypot(state.x-(state.swingPivot??state.anchor).x,state.y+HAND-(state.swingPivot??state.anchor).y,state.z-(state.swingPivot??state.anchor).z);if(d>state.ropeLength+.12||!lineClear(hand(state),state.anchor))detach('蛛丝被障碍挡住');}
    if(!wasGrounded&&state.grounded){if(state.anchor)detach();stopZip();state.diving=false;landingCooldown=.16;}
    const phase=attachedAge<.3?'entry':state.verticalSpeed<-.8?'downswing':state.verticalSpeed>.8?'upswing':'bottom';if(state.anchor&&state.swingPhase==='downswing'&&phase!=='downswing')state.bottomKick=1;state.swingPhase=phase;state.attachAge=state.anchor?attachedAge:0;
    state.speed=Math.hypot(state.vx,state.vz);state.progress=groundAt(state.x,state.z).progress??state.progress;state.inputBuffered=jumpBuffer>0;
    state.zipAvailable=!state.grounded&&state.zipCandidateAnchors.length>0;
    state.zipReady=state.zipAvailable&&state.zipCooldown<=0&&!state.zipActive&&!state.diving;
    state.zipUnavailableReason=state.grounded?'请先起跳':state.diving?'松开俯冲后再前冲':state.zipActive?'正在前冲':state.zipCooldown>0?'前冲冷却中':!state.zipAvailable?'前方没有可用建筑挂点或净空':'';
    state.traversalPhase=state.grounded?(state.landingImpact>2?'landing':'ground'):state.zipActive?'zip':state.diving?'dive':state.wallContact&&wallBudget>0?'wallrun':state.anchor?'swing':state.pointPhase==='launch'?'point-launch':state.verticalSpeed>1?'launch':state.releaseTime<.5?'release':'fall';
    state.pitch=approach(state.pitch,state.grounded?0:clamp(-state.speed*.012,-.30,.1),dt*1.6);const bend=intent.x*state.vz-intent.z*state.vx;state.lean=approach(state.lean,state.grounded?0:clamp(bend*.025,-.28,.28),dt*1.8);
    // Keep a rejected tap visible across multiple fixed updates in one render.
    if(!state.blockedReason&&pointFeedbackTime>0)state.blockedReason=pointFeedback;
    updateTrick(dt,input);
  }
  reset();return{step,reset,suspend,clearActionInputs,lineClear,findAnchor,findPoint,supportAt};
}
