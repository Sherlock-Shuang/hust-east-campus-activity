import {createTrafficCorridor,createPedestrianPathMapper,createPedestrianCrossings} from './commute-corridor.js';
/** Deterministic longitudinal and lateral commute simulation; no renderer dependency.
 * Distances are metres, speeds m/s, clockMinutes minutes after midnight.
 * Flow, mode share, vehicle dynamics and signal timing are scenario parameters,
 * not campus traffic measurements. Only route-supplied signal locations exist.
 * Queues use ordered following on a route, including advance single-file merges;
 * lane changes reserve both corridors and require front/rear gaps. Individual
 * queue offsets, startup response and corner speeds are scenario assumptions.
 */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const EPS=1e-8;
const MIN_WALK_SPEED=1.15,WALK_ADMISSION_SECONDS=4,WALK_CLEARANCE_MARGIN=3;
export const COMMUTE_DEMAND_PROFILE=Object.freeze([[445,.08],[455,.16],[462,.33],[470,.68],[475,.90],[478,1],[480,.80],[485,.28],[495,.07]]);
export function commuteDemand(minutes){
  if(!finite(minutes))throw new TypeError('Time must be minutes after midnight.');
  if(minutes<=COMMUTE_DEMAND_PROFILE[0][0])return COMMUTE_DEMAND_PROFILE[0][1];
  for(let i=1;i<COMMUTE_DEMAND_PROFILE.length;i++){
    const[a,x]=COMMUTE_DEMAND_PROFILE[i-1],[b,y]=COMMUTE_DEMAND_PROFILE[i];
    if(minutes<=b)return x+(y-x)*(minutes-a)/(b-a);
  }
  return .06;
}
export function commuteRandom(seed=943108){let s=seed>>>0;return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export function commuteFollowingAcceleration(speed,desired,gap=Infinity,leaderSpeed=speed,kind='scooter'){
  const acceleration=kind==='walk'?1.0:1.55,braking=kind==='walk'?2.1:3.3;
  const timeGap=kind==='walk'?.48:.68,standstill=kind==='walk'?.22:.45;
  const desiredGap=standstill+Math.max(0,speed*timeGap+speed*(speed-leaderSpeed)/(2*Math.sqrt(acceleration*braking)));
  const interaction=finite(gap)?(desiredGap/Math.max(.05,gap))**2:0;
  return clamp(acceleration*(1-(speed/Math.max(.1,desired))**4-interaction),-braking,acceleration);
}

export function createCommuteSimulation(route,options={}){
  if(!Array.isArray(route?.points)||route.points.length<2)throw new TypeError('A route needs at least two metre-coordinate points.');
  const points=route.points.map(p=>{if(!finite(p.x)||!finite(p.z))throw new TypeError('Route x/z must be finite metres.');return{x:p.x,y:finite(p.y)?p.y:0,z:p.z};})
    .filter((p,i,all)=>!i||Math.hypot(p.x-all[i-1].x,p.z-all[i-1].z)>EPS);
  if(points.length<2)throw new RangeError('Route length must be positive.');
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].z-points[i-1].z));
  // Join neighbouring offset road segments at one shared point. Offsetting a
  // sharp vertex using a rotating normal creates a loop on the inside of a
  // corner (the source signal junction turns about 126 degrees).
  const offsetNormals=points.map((point,i)=>{
    const prev=points[Math.max(0,i-1)],next=points[Math.min(points.length-1,i+1)];
    let ax=point.x-prev.x,az=point.z-prev.z,bx=next.x-point.x,bz=next.z-point.z;
    if(i===0){ax=bx;az=bz;}if(i===points.length-1){bx=ax;bz=az;}
    const al=Math.hypot(ax,az),bl=Math.hypot(bx,bz);ax/=al;az/=al;bx/=bl;bz/=bl;
    const denominator=Math.max(.06,1+ax*bx+az*bz);let x=-(az+bz)/denominator,z=(ax+bx)/denominator;
    const magnitude=Math.hypot(x,z);if(magnitude>3.3){x*=3.3/magnitude;z*=3.3/magnitude;}return{x,z};
  });
  const length=distances.at(-1),vehicleLanes=clamp(Math.round(options.vehicleLanes??3),1,3),maxAgents=clamp(Math.round(options.maxAgents??600),0,1200);
  const fixedStep=.05,seed=options.seed??943108;
  let startMinutes=finite(options.startMinutes)?options.startMinutes:478,random,accumulator=0,ticks=0,nextId=1,spawnBudget=0,arrivalTimes=[],completedAgents=new Map(),originBudgets=new Map(),originPending=new Map();
  let playerObstacle=null;
  const settings={density:clamp(options.density??1,0,2.5),scooterShare:clamp(options.scooterShare??.86,0,1),signals:options.signals!==false,laneChanging:options.laneChanging!==false,
    bidirectional:options.bidirectional??route.bidirectional??false,opposingShare:clamp(options.opposingShare??.14,0,.5)};
  const segments=[];let runningS=0;
  for(const segment of route.segments||[]){
    const start=finite(segment.startProgress)?segment.startProgress:finite(segment.s0)?segment.s0:runningS;
    const end=finite(segment.endProgress)?segment.endProgress:finite(segment.s1)?segment.s1:start+(segment.length||0);
    if(end>start){segments.push({...segment,startProgress:clamp(start,0,length),endProgress:clamp(end,0,length)});runningS=end;}
  }
  if(!segments.length)segments.push({startProgress:0,endProgress:length,width:finite(options.defaultWidth)?options.defaultWidth:7.2,mode:'ride',widthStatus:'scenario-estimate'});
  const state={clockMinutes:startMinutes,elapsed:0,agents:[],signals:[],stats:{},settings,routeLength:length,
    provenance:{demand:'scenario estimate',scooterShare:'user-informed scenario estimate; not measured',dynamics:'simplified IDM; gap-accepted lane changes; individual startup response and curvature speed limits',signalLocations:'only route-supplied source locations',signalTiming:'scenario estimate; not observed timing'},arrivals:0,departures:0,dismountedTotal:0,laneChangesTotal:0};
  // Geometry may contain dozens of short source edges. Traffic only needs the
  // intervals where road width or allowed mode changes; coalescing avoids
  // repeatedly searching every vertex for each nearby leader.
  const sections=[];
  for(const segment of segments){const previous=sections.at(-1);
    if(previous&&previous.width===segment.width&&previous.mode===segment.mode&&previous.highway===segment.highway&&Math.abs(previous.endProgress-segment.startProgress)<.001)previous.endProgress=segment.endProgress;
    else sections.push({...segment});
  }
  function segmentAt(s){let lo=0,hi=sections.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(s>=sections[mid].endProgress-EPS)lo=mid+1;else hi=mid;}return sections[lo];}
  function crossSection(s){
    const segment=segmentAt(clamp(s,0,length));if(segment.crossSection)return segment.crossSection;const defaultWidth=segment.mode==='walk'||['footway','path','steps'].includes(segment.highway)?2.4:7.2;
    const width=Math.max(1.2,finite(segment.width)?segment.width:defaultWidth);
    const reserveMotorCenter=settings.bidirectional&&(segment.reserveMotorCenter===true||width>=12);
    const cycleBandWidth=finite(segment.cycleBandWidth)?clamp(segment.cycleBandWidth,1.1,width/2):2.6;
    const lanes=segment.mode==='walk'?1:clamp(Math.floor(settings.bidirectional?(reserveMotorCenter?cycleBandWidth:width/2-.7)/1.25:(width-1.3)/1.6),1,vehicleLanes);
    const walkOffset=finite(segment.walkOffset)?segment.walkOffset:reserveMotorCenter?width/2+(width>=12?1.5:.75):Math.max(.3,width/2-.34);
    const shared=width<4.2||segment.mode==='walk',walkingLanes=shared&&segment.mode==='walk'?clamp(Math.floor((width-.3)/.8),1,2):1;
    return segment.crossSection={width,lanes,walkingLanes,shared,segment,reserveMotorCenter,cycleBandWidth,walkOffset};
  }
  function nominalKind(agent,s){return(agent.originalKind==='walk'||s>=dismountProgress)?'walk':'scooter';}
  const segmentDismount=segments.filter(s=>s.mode==='walk'||s.highway==='steps').map(s=>s.startProgress);
  const suppliedDismount=finite(route.dismountProgress)?clamp(route.dismountProgress,0,length):(segmentDismount.length?Math.min(...segmentDismount):Infinity);
  const dismountProgress=suppliedDismount<length-EPS?suppliedDismount:Infinity;
  const oppositeStart=Math.max(0,Math.min(length,dismountProgress)-2);
  const trafficOrigins=(route.trafficOrigins||[]).filter(o=>finite(o.progress)&&o.progress>=0&&o.progress<=length&&o.weight!==0).map((o,i)=>({...o,id:String(o.id??`source-junction-${i}`),direction:o.direction===-1?-1:1,weight:Math.max(.01,o.weight??1)}));
  if(!trafficOrigins.some(o=>o.direction===1&&o.progress<.01))trafficOrigins.unshift({id:'route-start',progress:0,direction:1,weight:1,sourceId:route.start?.sourceId??null});
  if(settings.bidirectional&&!trafficOrigins.some(o=>o.direction===-1))trafficOrigins.push({id:'opposing-public-road',progress:oppositeStart,direction:-1,weight:1,sourceId:null});
  state.trafficOrigins=trafficOrigins;
  state.provenance.directions='right-side circulation; opposing share and junction inflow weights are adjustable scenario assumptions, not observed counts';
  state.provenance.origins='route-supplied public road junctions; no fabricated dormitory doorway paths';
  const narrowSections=settings.bidirectional?sections.filter(s=>s.mode!=='walk'&&crossSection((s.startProgress+s.endProgress)/2).width<3.6).map(s=>({start:s.startProgress,end:s.endProgress,margin:12,kind:'narrow',owner:0,lastOwner:-1,since:0,accepting:true})):[];
  const junctionReservations=[];
  const conflictSections=[...narrowSections,...junctionReservations];
  state.narrowSections=narrowSections;
  state.junctionReservations=junctionReservations;
  function directionOf(agent){return agent.direction===-1?-1:1;}
  function stopLineFor(signal,agent){return directionOf(agent)===-1?signal.reverseStopLineProgress:signal.stopLineProgress;}
  function chooseOrigin(direction){const available=trafficOrigins.filter(o=>o.direction===direction),sum=available.reduce((n,o)=>n+o.weight,0);let sample=random()*sum;for(const origin of available){sample-=origin.weight;if(sample<=0)return origin;}return available.at(-1)||trafficOrigins[0];}
  function channelAt(agent,s,lane=agent.lane){const cross=crossSection(s);return nominalKind(agent,s)==='walk'?(cross.shared?lane%cross.walkingLanes:cross.lanes):lane%cross.lanes;}
  function occupiesChannel(agent,channel,s){return channelAt(agent,s)===channel||(agent.laneChange&&channelAt(agent,s,agent.laneChange.to)===channel);}
  function sharesChannelAt(a,b,s){return occupiesChannel(b,channelAt(a,s),s)||(a.laneChange&&occupiesChannel(b,channelAt(a,s,a.laneChange.to),s));}
  function unconstrainedOffset(agent,s){
    const cross=crossSection(s),kind=nominalKind(agent,s),chosenLane=agent.laneChange?.to??agent.lane;
    const preparingDismount=kind==='walk'&&agent.kind==='scooter'&&agent.progress<dismountProgress;
    const bias=(agent.queueOffset??0)*(kind==='walk'?.25:1);
    if(settings.bidirectional){
      const direction=directionOf(agent);
      // The road normal points to the traveller's right for increasing route
      // progress. Two directions therefore keep opposite signs, including
      // pedestrians at the outside edge; lane counts describe EACH half-road.
      if(kind==='walk')return direction*cross.walkOffset+bias;
      if(cross.width<3.6)return bias; // one shared corridor, reserved by direction
      if(cross.reserveMotorCenter){const inner=cross.width/2-cross.cycleBandWidth,spacing=cross.lanes>1?(cross.cycleBandWidth-1.35)/(cross.lanes-1):0;return direction*(inner+(cross.lanes>1?.6:cross.cycleBandWidth/2)+(chosenLane%cross.lanes)*spacing)+bias;}
      const usable=cross.width/2-.72,lane=chosenLane%cross.lanes;
      return direction*(.66+(cross.lanes>1?lane*Math.max(1.12,(usable-.66)/(cross.lanes-1)):Math.max(0,(usable-.66)*.5)))+bias;
    }
    // Scooters remain wider than pedestrians until they actually park. Do not
    // squeeze two intact scooters into the future .8 m pedestrian centres.
    if(preparingDismount&&cross.shared){const count=cross.walkingLanes,spacing=Math.min(1.25,Math.max(0,cross.width-.95));return(chosenLane%count-(count-1)/2)*spacing+bias;}
    if(cross.shared&&kind==='walk')return(chosenLane%cross.walkingLanes-(cross.walkingLanes-1)/2)*Math.min(.8,(cross.width-.6)/cross.walkingLanes)+bias;
    if(kind==='walk')return cross.width/2-.42+bias;
    const lane=chosenLane%cross.lanes,spacing=Math.min(1.8,Math.max(1.05,(cross.width-(cross.shared?.4:1.5))/cross.lanes));
    return(lane-(cross.lanes-1)/2)*spacing-(cross.shared?0:.45)+bias;
  }
  function desiredOffset(agent,s){const offset=unconstrainedOffset(agent,s);return settings.bidirectional&&nominalKind(agent,s)==='scooter'?pavementCorridor.limit(s,offset):offset;}
  function centerPose(progress){
    const s=clamp(progress,0,length);let low=1,high=distances.length-1;while(low<high){const middle=(low+high)>>1;if(distances[middle]<s)low=middle+1;else high=middle;}const index=low;
    const a=points[index-1],b=points[index],segmentLength=distances[index]-distances[index-1],t=(s-distances[index-1])/segmentLength;
    let dx=(b.x-a.x)/segmentLength,dz=(b.z-a.z)/segmentLength;
    const blend=Math.min(5,segmentLength*.25);
    if(index<points.length-1&&segmentLength*(1-t)<blend){const c=points[index+1],nextLength=Math.hypot(c.x-b.x,c.z-b.z),weight=.5*(1-segmentLength*(1-t)/blend);dx=dx*(1-weight)+(c.x-b.x)/nextLength*weight;dz=dz*(1-weight)+(c.z-b.z)/nextLength*weight;}
    else if(index>1&&segmentLength*t<blend){const before=points[index-2],previousLength=Math.hypot(a.x-before.x,a.z-before.z),weight=.5*(1-segmentLength*t/blend);dx=dx*(1-weight)+(a.x-before.x)/previousLength*weight;dz=dz*(1-weight)+(a.z-before.z)/previousLength*weight;}
    const norm=Math.hypot(dx,dz)||1;dx/=norm;dz/=norm;
    const normalA=offsetNormals[index-1],normalB=offsetNormals[index],rawDx=(b.x-a.x)/segmentLength,rawDz=(b.z-a.z)/segmentLength;
    return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t,dx,dz,offsetX:normalA.x+(normalB.x-normalA.x)*t,offsetZ:normalA.z+(normalB.z-normalA.z)*t,normalDx:(normalB.x-normalA.x)/segmentLength,normalDz:(normalB.z-normalA.z)/segmentLength,rawDx,rawDz,yaw:Math.atan2(-dx,-dz),progress:s};
  }
  function poseWithOffset(progress,offset){
    // centerPose returns a fresh sample; enrich it in place instead of making
    // a second object for every collision sweep and lane-clearance probe.
    const p=centerPose(progress);p.x+=p.offsetX*offset;p.z+=p.offsetZ*offset;
    p.pathDx=p.rawDx+p.normalDx*offset;p.pathDz=p.rawDz+p.normalDz*offset;
    p.pathScale=Math.hypot(p.pathDx,p.pathDz);p.offsetAlong=p.offsetX*p.rawDx+p.offsetZ*p.rawDz;return p;
  }
  const pavementCorridor=createTrafficCorridor(route.roadSurfaces,centerPose,length);
  const mapPedestrianPath=createPedestrianPathMapper(route.pedestrianPaths,(progress,direction,sideShift)=>{const agent={originalKind:'walk',lane:1,direction};return poseWithOffset(progress,unconstrainedOffset(agent,progress)+sideShift);});
  function poseForAgent(agent,progress,lateral){const base=poseWithOffset(progress,lateral);return nominalKind(agent,progress)==='walk'?mapPedestrianPath(progress,base,directionOf(agent),lateral-unconstrainedOffset(agent,progress)):base;}
  function getPoseAt(progress,lane=0,kind='scooter',direction=1){
    if(!finite(progress))throw new TypeError('Camera progress must be finite metres.');
    const agent={lane:Math.max(0,Math.floor(lane)),originalKind:kind,direction};const pose=poseForAgent(agent,progress,desiredOffset(agent,progress));if(kind==='walk')pose.y=pavementCorridor.walkHeight(pose.x,pose.z,pose.y);if(direction===-1)pose.yaw+=Math.PI;return pose;
  }
  const pedestrianCrossings=createPedestrianCrossings(route.pedestrianPaths,getPoseAt,length);
  state.pedestrianCrossings=pedestrianCrossings;
  function crossingWindow(crossing,agent){
    // The opposite roadside footpath follows the through roadway and is
    // crossed by this mapped branch near its exit. It shares the through
    // phase with parallel riders, so two walkers cannot lock the crosswalk.
    if(nominalKind(agent,agent.progress)==='scooter'||directionOf(agent)!==crossing.direction)return{group:'scooter',start:crossing.rideStart,end:crossing.rideEnd};
    return{group:'walk',start:crossing.walkStart,end:crossing.walkEnd};
  }
  function withinCrossing(agent,window){
    if(!window)return false;
    // Passing the entry stop commits to this phase. The 35 cm space before
    // the physical overlap is not an empty zone in which ownership may flip.
    return directionOf(agent)===1?agent.progress+agent.halfLength>window.start-.35+1e-6&&agent.progress-agent.halfLength<window.end:agent.progress-agent.halfLength<window.end+.35-1e-6&&agent.progress+agent.halfLength>window.start;
  }
  function crossingSignal(crossing){return state.signals.find(signal=>signal.enabled&&signal.progress>=crossing.rideStart&&signal.progress<=crossing.rideEnd);}
  function permittedCrossingGroup(crossing){const signal=crossingSignal(crossing);return signal?(signal.state==='green'?'scooter':signal.state==='red'?'walk':'closed'):null;}
  function walkingAdmissionFits(crossing,agent){
    const window=crossingWindow(crossing,agent),signal=crossingSignal(crossing);
    if(nominalKind(agent,agent.progress)!=='walk'||!signal||signal.state!==(window.group==='walk'?'red':'green'))return true;
    // A late pedestrian must fit the remaining permitted phase, whether
    // crossing on vehicle red or following the road on green. Actors already
    // committed still clear normally even if their estimate was exceeded.
    const distance=directionOf(agent)===1?window.end-agent.progress+agent.halfLength:agent.progress-window.start+agent.halfLength;
    return signal.remaining>=Math.max(0,distance)/Math.max(.1,agent.desiredSpeed)+WALK_CLEARANCE_MARGIN;
  }
  function updateCrossingReservations(){for(const crossing of pedestrianCrossings){
    const inside=state.agents.filter(a=>a.active&&withinCrossing(a,crossingWindow(crossing,a)));
    const approaching=group=>state.agents.some(a=>{const w=crossingWindow(crossing,a);if(!a.active||w?.group!==group)return false;const d=directionOf(a)===1?w.start-a.progress:a.progress-w.end;return d>0&&d<22;});
    const walkers=approaching('walk'),riders=approaching('scooter');
    const permitted=permittedCrossingGroup(crossing);
    if(inside.length){
      if(!finite(crossing.firstOccupiedAt))crossing.firstOccupiedAt=crossing.hadOccupants?crossing.since:state.elapsed;
      crossing.hadOccupants=true;if(!crossing.owner){crossing.owner=crossingWindow(crossing,inside[0]).group;crossing.since=state.elapsed;}
      // A controlled footway crosses during the scenario vehicle-red phase.
      // A short walking admission batch leaves time for its last walker to
      // clear; through traffic uses the full available green after clearance.
      crossing.accepting=permitted?permitted===crossing.owner&&(crossing.owner!=='walk'||state.elapsed-crossing.firstOccupiedAt<WALK_ADMISSION_SECONDS):!(state.elapsed-crossing.firstOccupiedAt>8&&(crossing.owner==='walk'?riders:walkers));
    }else if(permitted){
      const next=permitted==='walk'&&walkers?'walk':permitted==='scooter'&&riders?'scooter':null;
      if(next!==crossing.owner||crossing.hadOccupants){if(crossing.owner)crossing.lastOwner=crossing.owner;crossing.owner=next;crossing.since=state.elapsed;crossing.hadOccupants=false;crossing.firstOccupiedAt=null;}
      crossing.accepting=!!next;
    }else if(!crossing.owner||crossing.hadOccupants||!(crossing.owner==='walk'?walkers:riders)||state.elapsed-crossing.since>=8&&(crossing.owner==='walk'?riders:walkers)){
      if(crossing.owner)crossing.lastOwner=crossing.owner;
      crossing.owner=walkers&&riders?(crossing.lastOwner==='walk'?'scooter':'walk'):walkers?'walk':riders?'scooter':null;
      crossing.since=state.elapsed;crossing.accepting=true;crossing.hadOccupants=false;crossing.firstOccupiedAt=null;
    }
  }}
  function crossingEntryLimit(agent){let gap=Infinity;const direction=directionOf(agent);for(const crossing of pedestrianCrossings){
    const window=crossingWindow(crossing,agent);if(!window)continue;
    const stop=direction===1?window.start-agent.halfLength-.35:window.end+agent.halfLength+.35,remaining=(stop-agent.progress)*direction;
    if(remaining< -1e-6||remaining>45)continue;
    if(crossing.owner!==window.group||!crossing.accepting||!walkingAdmissionFits(crossing,agent))gap=Math.min(gap,Math.max(0,remaining));
  }return gap;}
  function signalCrossing(signal,agent){return pedestrianCrossings.find(c=>{const w=crossingWindow(c,agent),stop=stopLineFor(signal,agent);return w&&stop>=w.start&&stop<=w.end;});}
  function signalPermitsEntry(signal,agent){const crossing=signalCrossing(signal,agent);return crossing&&crossingWindow(crossing,agent).group==='walk'?signal.state==='red':signal.state==='green';}
  function effectiveStopLine(signal,agent){if(agent.kind!=='walk')return stopLineFor(signal,agent);const crossing=signalCrossing(signal,agent);if(!crossing)return stopLineFor(signal,agent);const window=crossingWindow(crossing,agent);return directionOf(agent)===1?Math.min(stopLineFor(signal,agent),window.start-.35):Math.max(stopLineFor(signal,agent),window.end+.35);}
  function clearingCrossing(signal,agent){if(agent.kind!=='walk')return false;const crossing=signalCrossing(signal,agent);return crossing&&agent.crossingPermissions?.[crossing.id]&&withinCrossing(agent,crossingWindow(crossing,agent));}
  function projectProgress(point){let best={distance:Infinity,progress:0};for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=clamp(((point.x-a.x)*dx+(point.z-a.z)*dz)/l2,0,1);
    const d=Math.hypot(point.x-a.x-t*dx,point.z-a.z-t*dz);if(d<best.distance)best={distance:d,progress:distances[i-1]+t*Math.sqrt(l2)};
  }return best.progress;}
  // The player is an optional local obstacle, kept outside the seeded commuter
  // population. Copying the snapshot avoids mutating the interactive controller.
  function setPlayerObstacle(player){
    if(!player||!finite(player.x)||!finite(player.z)||!finite(player.y)||!['helicopter','roadster','hoverboard','spider'].includes(player.mode)&&player.grounded===false){playerObstacle=null;return;}
    const mode=player.mode||'walk',yaw=finite(player.yaw)?player.yaw:0;
    const span=mode==='roadster'?1.25:mode==='scooter'?.50:0;
    let radius=mode==='roadster'?1.03:mode==='helicopter'?3.95:mode==='scooter'?.44:mode==='spider'?.6:.29;
    const pitch=finite(player.pitch)?player.pitch:0,lean=finite(player.lean)?player.lean:0;
    let minY=player.y,maxY=player.y+(mode==='helicopter'?3.2:mode==='roadster'?1.3:1.7);
    if(mode==='spider'){minY=player.y-.18;maxY=player.y+2.1;}
    if(mode==='roadster'||mode==='hoverboard'){
      // Match the model's YXZ rotation. The contact origin is not the lowest
      // point once a flying vehicle pitches or banks. Bound the whole box
      // before clearing traffic underneath: Roadster 4.64 × 2.2 × 1.3 m;
      // hoverboard 2.9 m wide × 2.1 m deep × 2.4 m tall, including the rider.
      const halfWidth=mode==='hoverboard'?1.45:1.1,halfDepth=mode==='hoverboard'?1.05:2.32,halfHeight=mode==='hoverboard'?1.2:.65;
      const cp=Math.cos(pitch),sp=Math.sin(pitch),cl=Math.cos(lean),sl=Math.sin(lean);
      const centreY=player.y+halfHeight*cp*cl;
      const extentY=halfWidth*Math.abs(cp*sl)+halfHeight*Math.abs(cp*cl)+halfDepth*Math.abs(sp);
      minY=centreY-extentY;maxY=centreY+extentY;
      if(mode==='hoverboard'){
        // A circle around all projected corners also covers the transverse
        // wing during yaw changes. Banking projects the standing rider
        // sideways, so keep that extra reach instead of a fixed body radius.
        radius=0;
        for(const x of[-halfWidth,halfWidth])for(const y of[0,2*halfHeight])for(const z of[-halfDepth,halfDepth]){
          const rx=x*cl-y*sl,rz=(x*sl+y*cl)*sp+z*cp;
          radius=Math.max(radius,Math.hypot(rx,rz));
        }
      }
    }
    playerObstacle={x:player.x,z:player.z,y:player.y,mode,radius,span,progress:projectProgress(player),
      pitch,lean,minY,maxY,
      a:{x:player.x-Math.sin(yaw)*span,z:player.z-Math.cos(yaw)*span},
      b:{x:player.x+Math.sin(yaw)*span,z:player.z+Math.cos(yaw)*span}};
  }
  function pointSegmentDistance(p,a,b){const dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz,t=l2>EPS?clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/l2,0,1):0;return Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz);}
  function segmentDistance(a,b,c,d){
    const ux=b.x-a.x,uz=b.z-a.z,vx=d.x-c.x,vz=d.z-c.z,den=ux*vz-uz*vx;
    if(Math.abs(den)>EPS){const cx=c.x-a.x,cz=c.z-a.z,t=(cx*vz-cz*vx)/den,u=(cx*uz-cz*ux)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return 0;}
    return Math.min(pointSegmentDistance(a,c,d),pointSegmentDistance(b,c,d),pointSegmentDistance(c,a,b),pointSegmentDistance(d,a,b));
  }
  function worldClearance(agent,pose,yaw,other){
    if(Math.abs((pose.y??0)-(other.y??0))>2)return Infinity;
    const bound=agent.halfLength+other.halfLength+.2;
    if(Math.abs(pose.x-other.x)>bound||Math.abs(pose.z-other.z)>bound)return Infinity;
    const span=Math.max(0,agent.halfLength-agent.radius),otherSpan=Math.max(0,other.halfLength-other.radius);
    const dx=-Math.sin(yaw)*span,dz=-Math.cos(yaw)*span,ox=-Math.sin(other.yaw)*otherSpan,oz=-Math.cos(other.yaw)*otherSpan;
    return segmentDistance({x:pose.x-dx,z:pose.z-dz},{x:pose.x+dx,z:pose.z+dz},{x:other.x-ox,z:other.z-oz},{x:other.x+ox,z:other.z+oz})-agent.radius-other.radius;
  }
  function playerClearance(agent,progress=agent.progress,lateral=agent.lateral){
    if(!playerObstacle)return Infinity;
    const p=poseForAgent(agent,progress,lateral),obstacle=playerObstacle;
    // Helicopter y is its skid contact plane. Above head height it can pass
    // over commuters; the broad rotor envelope is conservative near ground.
    if(p.y+1.76<obstacle.minY||obstacle.maxY<p.y)return Infinity;
    const broad=agent.halfLength+obstacle.radius+obstacle.span+.11;
    if(Math.abs(p.x-obstacle.x)>broad+2||Math.abs(p.z-obstacle.z)>broad+2)return Math.hypot(p.x-obstacle.x,p.z-obstacle.z)-broad;
    const span=Math.max(0,agent.halfLength-agent.radius),scale=Math.max(.01,p.pathScale),dx=(p.rawDx+p.normalDx*lateral)/scale,dz=(p.rawDz+p.normalDz*lateral)/scale;
    const a={x:p.x+dx*span,z:p.z+dz*span},b={x:p.x-dx*span,z:p.z-dz*span};
    return segmentDistance(a,b,obstacle.a,obstacle.b)-agent.radius-obstacle.radius-.10;
  }
  function playerAheadGap(agent,lateral=agent.lateral){
    const obstacle=playerObstacle;if(!obstacle)return Infinity;
    const direction=directionOf(agent);
    const reach=agent.halfLength+obstacle.radius+obstacle.span+3;
    const signedDelta=(obstacle.progress-agent.progress)*direction;
    if(signedDelta+reach<0||signedDelta>40||Math.hypot(obstacle.x-agent.x,obstacle.z-agent.z)>45+reach)return Infinity;
    const begin=Math.max(0,signedDelta-reach),end=Math.min(direction===1?length-agent.progress:agent.progress,signedDelta+reach);
    let previous=begin;
    for(let probe=begin;probe<=end+.25;probe+=.25){
      const distance=Math.min(end,probe),s=agent.progress+direction*distance;
      if(playerClearance(agent,s,lateral)<=0){
        let lo=previous,hi=distance;
        for(let i=0;i<8;i++){const mid=(lo+hi)/2;if(playerClearance(agent,agent.progress+direction*mid,lateral)<=0)hi=mid;else lo=mid;}
        return Math.max(0,lo);
      }
      previous=distance;if(distance===end)break;
    }
    return Infinity;
  }
  function playerSweepFraction(agent,fromProgress,fromLateral,toProgress,toLateral){
    if(!playerObstacle)return 1;
    const a=poseForAgent(agent,fromProgress,fromLateral),b=poseForAgent(agent,toProgress,toLateral),o=playerObstacle;
    const radius=o.radius+o.span+agent.halfLength+.11;
    if(o.x<Math.min(a.x,b.x)-radius||o.x>Math.max(a.x,b.x)+radius||o.z<Math.min(a.z,b.z)-radius||o.z>Math.max(a.z,b.z)+radius)return 1;
    const initial=playerClearance(agent,fromProgress,fromLateral),travel=Math.hypot(b.x-a.x,b.z-a.z),steps=Math.max(1,Math.ceil(travel/.10));
    const at=t=>playerClearance(agent,fromProgress+(toProgress-fromProgress)*t,fromLateral+(toLateral-fromLateral)*t);
    // A mode switch can enlarge a stationary player around an existing rider.
    // Never push that rider away; let only improving separation escape the overlap.
    if(initial<0)return at(1)>initial+1e-7?1:0;
    let previous=0;
    for(let i=1;i<=steps;i++){
      const fraction=i/steps;
      if(at(fraction)<0){let lo=previous,hi=fraction;for(let n=0;n<10;n++){const mid=(lo+hi)/2;if(at(mid)<0)hi=mid;else lo=mid;}return lo;}
      previous=fraction;
    }
    return 1;
  }
  function makeSignals(){
    return(route.trafficSignals||[]).map((source,index)=>{
      const progress=finite(source.progress)?source.progress:finite(source.distanceAlongRoute)?source.distanceAlongRoute:finite(source.x)&&finite(source.z)?projectProgress(source):null;
      if(!finite(progress)||progress<0||progress>length)return null;
      const timing={...options.signalTiming,...source.scenarioTiming};
      const crossing=pedestrianCrossings.find(c=>progress>=c.rideStart&&progress<=c.rideEnd);
      // The joined footway conflict region must actually fit a slow walking
      // batch. These defaults follow model geometry, not observed campus
      // timings. Explicit user/fixture timings remain authoritative.
      const walkingClearance=crossing?Math.ceil((crossing.walkEnd-crossing.walkStart+.5)/MIN_WALK_SPEED+WALK_ADMISSION_SECONDS+WALK_CLEARANCE_MARGIN):28;
      const throughClearance=crossing?Math.ceil((crossing.rideEnd-crossing.rideStart+.5)/MIN_WALK_SPEED+WALK_CLEARANCE_MARGIN):0;
      const greenSeconds=Math.max(2,timing.greenSeconds??Math.max(42,throughClearance+30)),amberSeconds=Math.max(0,timing.amberSeconds??4),redSeconds=Math.max(2,timing.redSeconds??Math.max(28,walkingClearance));
      const stopLineProgress=clamp(finite(source.stopLineProgress)?source.stopLineProgress:progress,0,length);
      const reverseStopLineProgress=clamp(finite(source.reverseStopLineProgress)?source.reverseStopLineProgress:progress+Math.max(2.1,progress-stopLineProgress),0,length);
      return{id:String(source.id??source.sourceId??`route-signal-${index}`),...centerPose(progress),progress,stopLineProgress,reverseStopLineProgress,
        stopLineStatus:source.stopLineStatus??'scenario-estimate',stopLineEvidence:source.stopLine?.evidence??'route-supplied stop line or junction position',
        enabled:settings.signals,state:'red',remaining:0,greenSeconds,amberSeconds,redSeconds,cycleSeconds:greenSeconds+amberSeconds+redSeconds,
        phaseOffset:finite(source.phaseOffset)?source.phaseOffset:index*17,
        sourceId:source.sourceId??source.id??null,source:source.source??source.sourceUrl??null,
        locationStatus:source.locationStatus??'route-source',timingStatus:'scenario-estimate',scenarioTiming:true,
        note:'位置来自路线提供的数据；灯相和配时为可关闭情景模拟，并非校园实测控制方案。'};
    }).filter(Boolean).sort((a,b)=>a.progress-b.progress);
  }
  function updateSignals(){for(const signal of state.signals){
    signal.enabled=settings.signals;if(!signal.enabled){signal.state='off';signal.remaining=0;continue;}
    const phase=((state.clockMinutes*60+signal.phaseOffset)%signal.cycleSeconds+signal.cycleSeconds)%signal.cycleSeconds;
    if(phase<signal.greenSeconds){signal.state='green';signal.remaining=signal.greenSeconds-phase;}
    else if(phase<signal.greenSeconds+signal.amberSeconds){signal.state='amber';signal.remaining=signal.greenSeconds+signal.amberSeconds-phase;}
    else{signal.state='red';signal.remaining=signal.cycleSeconds-phase;}
  }}
  const channelBoundaries=[...new Set([...sections.map(s=>s.startProgress),dismountProgress])].filter(finite).sort((a,b)=>a-b);
  function spatialPath(agent,progress=agent.progress){return nominalKind(agent,progress)==='walk'?(route.pedestrianPaths||[]).find(path=>(path.direction===undefined||path.direction===directionOf(agent))&&progress>=path.startProgress&&progress<=path.endProgress)?.id??null:null;}
  function sameSpatialPath(a,b,progress=a.progress){return spatialPath(a,progress)===spatialPath(b,progress);}
  function sharesPath(a,b,lookAhead=0){
    if(directionOf(a)!==directionOf(b)||!sameSpatialPath(a,b))return false;
    if(a.originalKind===b.originalKind&&a.lane===b.lane)return true;
    // Judge a merge from the follower's braking horizon, not from the leader's
    // farther position: otherwise parallel lanes serialize tens of metres early.
    const from=a.progress,to=clamp(a.progress+directionOf(a)*lookAhead,0,length);
    if(sharesChannelAt(a,b,from)||sharesChannelAt(a,b,to))return true;
    for(const boundary of channelBoundaries)if(boundary>Math.min(from,to)&&boundary<Math.max(from,to)&&sharesChannelAt(a,b,boundary+directionOf(a)*.001))return true;
    return false;
  }
  function makeAgent(kind,progress,lane,direction=1,origin=null){
    const agent={id:nextId++,originalKind:kind,type:kind,kind,lane,progress,direction,originId:origin?.id??'route-start',originProgress:origin?.progress??0,active:true,phase:'moving',speed:0,waiting:false,
      desiredSpeed:kind==='scooter'?4.2+random()*1.8:MIN_WALK_SPEED+random()*.4,halfLength:kind==='scooter'?.90:.24,
      radius:kind==='scooter'?.43:.25,passedSignals:{},crossingPermissions:{},waitingTime:0,dismounted:false,lateral:0,colorIndex:Math.floor(random()*8),queueOffset:(random()-.5)*.28,
      reactionTime:.32+random()*.62,accelerationScale:.84+random()*.3,standstillGap:.34+random()*.24,
      stoppedTime:0,restartArmed:false,releaseDelay:0,nextDecisionAt:.5+random()*1.8,laneChange:null,laneChanges:0,
      steeringAngle:0,lean:0,footDown:0,lateralSpeed:0,turnSpeedLimit:6,acceleration:0,braking:false};
    if(kind==='walk'&&!crossSection(progress).shared)agent.lane=1;
    if(kind==='scooter'&&progress>=dismountProgress){agent.kind=agent.type='walk';agent.dismounted=true;agent.desiredSpeed=1.3;agent.halfLength=.3;agent.radius=.25;}
    agent.lateral=desiredOffset(agent,progress);Object.assign(agent,poseForAgent(agent,progress,agent.lateral));agent.progress=progress;
    if(agent.kind==='walk')agent.y=pavementCorridor.walkHeight(agent.x,agent.z,agent.y);
    if(direction===-1)agent.yaw+=Math.PI;
    agent.speed=agent.desiredSpeed*(.55+random()*.25);
    for(const crossing of pedestrianCrossings)if(withinCrossing(agent,crossingWindow(crossing,agent)))agent.crossingPermissions[crossing.id]=true;
    for(const signal of state.signals)if(direction*(progress-stopLineFor(signal,agent))+agent.halfLength>=0)agent.passedSignals[signal.id]=true;
    return agent;
  }
  function hasSpawnSpace(candidate,merging=false){if(merging&&pedestrianCrossings.some(c=>{const w=crossingWindow(c,candidate);const permitted=permittedCrossingGroup(c);return withinCrossing(candidate,w)&&(permitted&&permitted!==w.group||c.owner&&(c.owner!==w.group||!c.accepting)||!walkingAdmissionFits(c,candidate));}))return false;if(playerObstacle&&playerClearance(candidate)<0)return false;return state.agents.every(other=>{
    if(settings.bidirectional&&worldClearance(candidate,candidate,candidate.yaw,other)<.08)return false;
    if(pedestrianCrossings.some(c=>{const a=crossingWindow(c,candidate),b=crossingWindow(c,other);return a&&b&&a.group!==b.group&&withinCrossing(candidate,a)&&withinCrossing(other,b);}))return false;
    if(directionOf(other)!==directionOf(candidate)&&conflictSections.some(s=>candidate.progress+candidate.halfLength>s.start-s.margin&&candidate.progress-candidate.halfLength<s.end+s.margin&&other.progress+other.halfLength>s.start-s.margin&&other.progress-other.halfLength<s.end+s.margin))return false;
    const rear=directionOf(candidate)*(other.progress-candidate.progress)<0;
    // A side-road rider starts from rest. A tiny space opened by the main
    // queue is not an accepted merge: preserve time for the approaching rear
    // rider to react and for the newcomer to accelerate into the stream.
    const approachSpeed=Math.max(other.speed,other.desiredSpeed);
    const mergeGap=merging&&directionOf(other)===directionOf(candidate)&&rear?Math.max(3.2,approachSpeed*2.2+Math.max(0,approachSpeed-candidate.speed)**2/5):.6;
    if(Math.abs(other.progress-candidate.progress)>other.halfLength+candidate.halfLength+mergeGap)return true;
    if(sameSpatialPath(candidate,other)&&Math.abs(candidate.lateral-other.lateral)<candidate.radius+other.radius+.08)return false;
    return!sharesPath(candidate,other,0);
  });}
  function peakCount(){return Math.min(maxAgents,Math.round((options.peakAgents??420)*clamp(length/1000,.45,1.35)*settings.density));}
  function inflowRate(){return 1.7*settings.density*commuteDemand(state.clockMinutes)*(options.flowScale??1);}
  function refreshStats(){
    arrivalTimes=arrivalTimes.filter(t=>state.elapsed-t<=60);
    const agents=state.agents,waiting=agents.filter(a=>a.waiting),scooters=agents.filter(a=>a.kind==='scooter');
    const signalQueues=state.signals.map(signal=>({id:signal.id,waiting:agents.filter(a=>a.waiting&&a.progress<signal.progress&&signal.progress-a.progress<100).length}));
    state.stats={activeCount:agents.length,scooterCount:scooters.length,walkingCount:agents.length-scooters.length,pedestrianCount:agents.length-scooters.length,
      queuedCount:waiting.length,waitingCount:waiting.length,meanSpeed:agents.length?agents.reduce((sum,a)=>sum+a.speed,0)/agents.length:0,
      congestion:agents.length?waiting.length/agents.length:0,arrivals:state.arrivals,arrivedTotal:state.arrivals,
      originalScooterCount:agents.filter(a=>a.originalKind==='scooter').length,scenarioScooterShare:settings.scooterShare,
      throughputPerMinute:arrivalTimes.length,inflowPerMinute:inflowRate()*60,demandFactor:commuteDemand(state.clockMinutes),
      targetCount:Math.round(peakCount()*commuteDemand(state.clockMinutes)),maxAgents,queueSeconds:agents.reduce((sum,a)=>sum+a.waitingTime,0),signalQueues,
      dismountedTotal:state.dismountedTotal,laneChangesTotal:state.laneChangesTotal,laneChangingCount:agents.filter(a=>a.laneChange).length,estimated:true};
    state.stats.forwardCount=agents.filter(a=>directionOf(a)===1).length;state.stats.opposingCount=agents.length-state.stats.forwardCount;
    state.stats.departures=state.departures;
    state.stats.yieldingCount=agents.filter(a=>a.waitReason==='oncoming').length;
    state.stats.originCounts=Object.fromEntries(trafficOrigins.map(o=>[o.id,agents.filter(a=>a.originId===o.id).length]));
  }
  function reset(){
    random=commuteRandom(seed);accumulator=0;ticks=0;nextId=1;spawnBudget=0;arrivalTimes=[];originBudgets=new Map(trafficOrigins.map(o=>[o.id,0]));originPending=new Map();
    for(const section of conflictSections){section.owner=0;section.lastOwner=-1;section.since=0;section.accepting=true;section.hadOccupants=false;}
    for(const crossing of pedestrianCrossings){crossing.owner=null;crossing.lastOwner='walk';crossing.since=0;crossing.accepting=true;crossing.hadOccupants=false;crossing.firstOccupiedAt=null;}
    state.elapsed=0;state.clockMinutes=startMinutes;state.agents=[];state.arrivals=0;state.departures=0;state.dismountedTotal=0;state.laneChangesTotal=0;completedAgents.clear();
    state.signals=makeSignals();updateSignals();
    const count=Math.round(peakCount()*commuteDemand(startMinutes));
    const scooterCount=Math.round(count*settings.scooterShare);
    for(let i=0;i<count;i++){
      const kind=i<scooterCount?'scooter':'walk',direction=settings.bidirectional&&random()<settings.opposingShare?-1:1;
      const origin=settings.bidirectional||trafficOrigins.length>1?chooseOrigin(direction):trafficOrigins[0];let agent;
      for(let attempt=0;attempt<100;attempt++){
        const lo=direction===1?origin.progress:0,hi=direction===1?length:origin.progress;
        const progress=Math.min(hi,lo+2+random()*Math.max(1,hi-lo-5)),cross=crossSection(progress);
        const laneCount=kind==='walk'||progress>=dismountProgress?(cross.shared?cross.walkingLanes:2):cross.lanes;
        const candidate=makeAgent(kind,progress,Math.floor(random()*laneCount),direction,origin);
        if(hasSpawnSpace(candidate)){agent=candidate;break;}
      }
      if(agent)state.agents.push(agent);
    }
    refreshStats();return state;
  }
  function setTime(minutes){if(!finite(minutes)||minutes<0||minutes>=1440)throw new RangeError('Time must be minutes after midnight in [0,1440).');startMinutes=minutes;return reset();}
  function setDensity(density){if(!finite(density))throw new TypeError('Density must be finite.');settings.density=clamp(density,0,2.5);startMinutes=state.clockMinutes;return reset();}
  function setScooterShare(share){if(!finite(share))throw new TypeError('Scooter share must be finite.');settings.scooterShare=clamp(share,0,1);startMinutes=state.clockMinutes;return reset();}
  function setSignals(enabled){settings.signals=!!enabled;updateSignals();return state.signals;}
  // Small source angles are not treated as corners; sharp junctions have a
  // kinematic speed limit and a braking envelope upstream of the vertex.
  const corners=[];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],ax=b.x-a.x,az=b.z-a.z,bx=c.x-b.x,bz=c.z-b.z;
    const angle=Math.abs(Math.atan2(ax*bz-az*bx,ax*bx+az*bz));if(angle<.16)continue;
    const radius=Math.max(1.5,Math.min(6,Math.hypot(ax,az)/3,Math.hypot(bx,bz)/3)/angle);
    corners.push({progress:distances[i],speed:clamp(Math.sqrt(1.5*radius),1.5,5.7),angle});
  }
  function cornerSpeedAt(progress,direction=1){
    if(direction===-1){let limit=6;for(const corner of corners){const distance=progress-corner.progress;if(distance< -2||distance>30)continue;limit=Math.min(limit,Math.sqrt(corner.speed*corner.speed+2*1.5*Math.max(0,distance)));}return limit;}
    let low=0,high=corners.length;while(low<high){const middle=(low+high)>>1;if(corners[middle].progress<progress-2)low=middle+1;else high=middle;}
    let limit=6;for(let i=low;i<corners.length&&corners[i].progress<progress+30;i++){
      const corner=corners[i],distance=Math.max(0,corner.progress-progress);
      limit=Math.min(limit,Math.sqrt(corner.speed*corner.speed+2*1.5*distance));
    }return limit;
  }
  function laneGaps(agent,index,lane){
    let front=Infinity,back=Infinity,rearSpeed=0;
    const direction=directionOf(agent);
    const targetOffset=desiredOffset({...agent,lane,laneChange:null},agent.progress),occupiesTarget=other=>sameSpatialPath(agent,other)&&((directionOf(other)===direction&&occupiesChannel(other,channelAt(agent,agent.progress,lane),agent.progress))||Math.abs(other.lateral-targetOffset)<agent.radius+other.radius+.16);
    for(let j=index-direction;j>=0&&j<state.agents.length;j-=direction){const other=state.agents[j],delta=(other.progress-agent.progress)*direction;if(delta>45)break;
      if(other.active&&occupiesTarget(other)){front=Math.min(front,delta-agent.halfLength-other.halfLength);}
    }
    for(let j=index+direction;j>=0&&j<state.agents.length;j+=direction){const other=state.agents[j],delta=(agent.progress-other.progress)*direction;if(delta>30)break;
      if(other.active&&occupiesTarget(other)&&delta-agent.halfLength-other.halfLength<back){back=delta-agent.halfLength-other.halfLength;rearSpeed=other.speed;}
    }
    for(const signal of state.signals)if(signal.enabled&&!signalPermitsEntry(signal,agent)&&!agent.passedSignals[signal.id]&&!clearingCrossing(signal,agent))front=Math.min(front,(effectiveStopLine(signal,agent)-agent.progress)*direction-agent.halfLength-.2);
    if(playerObstacle)front=Math.min(front,playerAheadGap(agent,targetOffset));
    return{front,back,rearSpeed};
  }
  function considerLaneChange(agent,index){
    if(!settings.laneChanging||agent.kind!=='scooter'||agent.laneChange||state.elapsed<agent.nextDecisionAt)return;
    agent.nextDecisionAt=state.elapsed+.8+random()*.8;
    const direction=directionOf(agent),cross=crossSection(agent.progress),ahead=crossSection(clamp(agent.progress+direction*22,0,length));
    if(cross.lanes<2||ahead.lanes!==cross.lanes||cross.width<4.3||(direction===1&&dismountProgress-agent.progress<28)||agent.speed<.6||cornerSpeedAt(agent.progress+direction*8,direction)<3.4)return;
    if(state.signals.some(signal=>signal.enabled&&!agent.passedSignals[signal.id]&&(stopLineFor(signal,agent)-agent.progress)*direction<8))return;
    const current=laneGaps(agent,index,agent.lane);
    if(current.front>Math.max(10,agent.speed*2.7)||agent.speed>agent.desiredSpeed*.94)return;
    let best=null;
    for(const target of [agent.lane-1,agent.lane+1]){
      if(target<0||target>=cross.lanes)continue;
      const gaps=laneGaps(agent,index,target),frontNeed=Math.max(2.8,agent.speed*.85),backNeed=Math.max(2.8,gaps.rearSpeed*.9+Math.max(0,gaps.rearSpeed-agent.speed)*1.1);
      const gain=Math.min(30,gaps.front)-Math.min(30,current.front);
      if(gaps.front<frontNeed||gaps.back<backNeed||gain<3.2)continue;
      if(!best||gain>best.gain)best={to:target,gain};
    }
    if(best){agent.laneChange={from:agent.lane,to:best.to,progress:0,startLateral:agent.lateral,startedAt:state.elapsed};agent.nextDecisionAt=state.elapsed+6+random()*6;}
  }
  function safeLateral(agent,target,index){
    // The whole lateral sweep is constrained, including the rear neighbour;
    // longitudinal following alone cannot protect a rider moving sideways.
    let safe=target;
    for(const direction of [-1,1])for(let j=index+direction;j>=0&&j<state.agents.length;j+=direction){
      const other=state.agents[j];if(Math.abs(other.progress-agent.progress)>4)break;if(!other.active||!sameSpatialPath(agent,other))continue;
      if(Math.abs(other.progress-agent.progress)>=agent.halfLength+other.halfLength+.18)continue;
      const clearance=agent.radius+other.radius+.08;
      if(agent.lateral<=other.lateral&&safe>other.lateral-clearance)safe=Math.min(safe,other.lateral-clearance);
      else if(agent.lateral>other.lateral&&safe<other.lateral+clearance)safe=Math.max(safe,other.lateral+clearance);
    }
    // A constraint may block a move but never pushes a rider sideways into a
    // third person. The following step opens space before retrying the move.
    safe=target>=agent.lateral?clamp(safe,agent.lateral,target):clamp(safe,target,agent.lateral);
    if(playerObstacle)safe=agent.lateral+(safe-agent.lateral)*playerSweepFraction(agent,agent.progress,agent.lateral,agent.progress,safe);
    return safe;
  }
  function updateNarrowReservations(){
    for(const section of conflictSections){
      // Reserve the merge/exit funnels as well as the narrow deck; a rider
      // waiting at the deck mouth would otherwise block the outgoing group.
      const applies=a=>section.kind!=='junction'||a.kind==='scooter';
      const inside=state.agents.filter(a=>a.active&&applies(a)&&a.progress+a.halfLength>section.start-section.margin&&a.progress-a.halfLength<section.end+section.margin);
      const approaching=direction=>state.agents.some(a=>directionOf(a)===direction&&a.active&&applies(a)&&(direction===1?section.start-section.margin-a.progress:a.progress-section.end-section.margin)>0&&(direction===1?section.start-section.margin-a.progress:a.progress-section.end-section.margin)<20);
      const forward=approaching(1),reverse=approaching(-1);
      if(inside.length){section.hadOccupants=true;if(!section.owner){section.owner=directionOf(inside[0]);section.since=state.elapsed;}section.accepting=!(state.elapsed-section.since>8&&(section.owner===1?reverse:forward));}
      else if(!section.owner||section.hadOccupants||!(section.owner===1?forward:reverse)){
        if(section.owner)section.lastOwner=section.owner;
        section.owner=forward&&reverse?-section.lastOwner:forward?1:reverse?-1:0;
        section.since=state.elapsed;section.accepting=true;section.hadOccupants=false;
      }
    }
  }
  function narrowEntryLimit(agent){
    const direction=directionOf(agent);let distance=Infinity;
    for(const section of conflictSections){
      if(section.kind==='junction'&&agent.kind!=='scooter')continue;
      const stop=direction===1?section.start-section.margin-agent.halfLength-.25:section.end+section.margin+agent.halfLength+.25;
      const remaining=(stop-agent.progress)*direction;
      if(remaining<-.01||remaining>45)continue;
      if(section.owner!==direction||!section.accepting)distance=Math.min(distance,Math.max(0,remaining));
    }return distance;
  }
  function integrate(){
    ticks++;state.elapsed=ticks*fixedStep;state.clockMinutes=startMinutes+state.elapsed/60;updateSignals();
    state.agents.sort((a,b)=>b.progress-a.progress||a.id-b.id);
    const agents=state.agents;
    updateNarrowReservations();updateCrossingReservations();
    const buckets=new Map(),bucketKey=a=>`${Math.floor(a.x/4)},${Math.floor(a.z/4)}`;
    if(settings.bidirectional)for(const a of agents){const key=bucketKey(a);if(!buckets.has(key))buckets.set(key,new Set());buckets.get(key).add(a);}
    // Process the leader before its followers in EACH direction while retaining
    // the shared route-sorted array used for local lateral gap checks.
    const order=settings.bidirectional?[...agents.map((a,i)=>directionOf(a)===1?i:-1).filter(i=>i>=0),...agents.map((a,i)=>directionOf(a)===-1?i:-1).filter(i=>i>=0).reverse()]:agents.map((a,i)=>i);
    for(const i of order){
      const agent=agents[i];if(!agent.active)continue;const direction=directionOf(agent);
      if(agent.originalKind==='scooter'&&!agent.dismounted&&agent.progress>=dismountProgress){agent.dismounted=true;agent.kind=agent.type='walk';agent.desiredSpeed=1.3;agent.halfLength=.3;agent.radius=.25;state.dismountedTotal++;}
      considerLaneChange(agent,i);
      let gap=Infinity,leaderSpeed=agent.speed,hardLimit=direction===1?length+2:-2,signalBlocked=false,playerBlocked=false,oncomingBlocked=false;
      agent.leaderId=null;agent.motionConstraint=null;
      for(let j=i-direction;j>=0&&j<agents.length;j-=direction){const leader=agents[j],delta=(leader.progress-agent.progress)*direction;if(delta>45||delta>gap+agent.halfLength+.90+.4)break;if(!leader.active)continue;
        if(sameSpatialPath(agent,leader)&&(Math.abs(agent.lateral-leader.lateral)<agent.radius+leader.radius+.16||sharesPath(agent,leader,Math.min(25,Math.max(12,agent.speed*agent.speed/5+8))))){
          if(settings.bidirectional&&directionOf(leader)===direction&&delta<4){
            // At a tight offset turn, route-progress order can invert the
            // actual spatial order. Do not make the real leading body wait
            // for someone behind it when its safe forward path opens space.
            const probe=poseForAgent(agent,clamp(agent.progress+direction*.1,0,length),agent.lateral),dx=probe.x-agent.x,dz=probe.z-agent.z,travel=Math.hypot(dx,dz);
            const projected=travel?((leader.x-agent.x)*dx+(leader.z-agent.z)*dz)/travel:0;
            if(projected<-.1&&worldClearance(agent,probe,agent.yaw,leader)>worldClearance(agent,agent,agent.yaw,leader)+.01)continue;
          }
          const bodies=agent.halfLength+leader.halfLength;
          // Offset paths compress on the inside of sharp corners. Convert the
          // body envelope to route metres and allow for different queue offsets,
          // otherwise safe route-coordinate gaps can overlap in world space.
          const scale=Math.max(.4,Math.min(agent.pathScale??1,leader.pathScale??1));
          const bendAllowance=Math.max(0,(bodies+.35)*(1/scale-1))+Math.abs(agent.lateral-leader.lateral)*Math.max(Math.abs(agent.offsetAlong??0),Math.abs(leader.offsetAlong??0));
          const candidate=delta-bodies-bendAllowance;
          if(candidate<gap){gap=candidate;leaderSpeed=leader.speed*directionOf(leader)*direction;agent.leaderId=leader.id;}
          hardLimit=agent.progress+direction*Math.min((hardLimit-agent.progress)*direction,delta-bodies-bendAllowance-.24);
        }
      }
      for(const signal of state.signals){
        if(!signal.enabled||signalPermitsEntry(signal,agent)||agent.passedSignals[signal.id]||clearingCrossing(signal,agent))continue;
        const signalGap=(effectiveStopLine(signal,agent)-agent.progress)*direction-agent.halfLength;
        if(signalGap>=-.01){
          if(signalGap<gap){gap=signalGap-.20;leaderSpeed=0;signalBlocked=true;}
          hardLimit=agent.progress+direction*Math.min((hardLimit-agent.progress)*direction,signalGap-.20);
        }
      }
      const yieldGap=Math.min(narrowEntryLimit(agent),crossingEntryLimit(agent));if(yieldGap<gap){gap=yieldGap;leaderSpeed=0;oncomingBlocked=true;signalBlocked=false;}
      hardLimit=agent.progress+direction*Math.min((hardLimit-agent.progress)*direction,yieldGap);
      if(playerObstacle){const playerGap=playerAheadGap(agent);if(playerGap<gap){gap=playerGap;leaderSpeed=0;playerBlocked=true;signalBlocked=false;oncomingBlocked=false;}hardLimit=agent.progress+direction*Math.min((hardLimit-agent.progress)*direction,playerGap);}
      agent.turnSpeedLimit=cornerSpeedAt(agent.progress,direction);
      let desired=Math.min(agent.desiredSpeed,agent.kind==='scooter'?agent.turnSpeedLimit:agent.desiredSpeed);
      if(direction===1&&agent.originalKind==='scooter'&&dismountProgress-agent.progress<12&&dismountProgress>=agent.progress)desired=Math.min(desired,1.3+Math.max(0,dismountProgress-agent.progress)*.3);
      let acceleration=commuteFollowingAcceleration(agent.speed,desired,gap+.45-agent.standstillGap,leaderSpeed,agent.kind)*agent.accelerationScale;
      if(agent.speed<.12){
        agent.stoppedTime+=fixedStep;
        if(acceleration<=0&&agent.stoppedTime>.25){agent.restartArmed=true;agent.releaseDelay=0;}
        if(acceleration>.05&&agent.restartArmed){agent.releaseDelay=agent.reactionTime;agent.restartArmed=false;}
        if(agent.releaseDelay>0){agent.releaseDelay=Math.max(0,agent.releaseDelay-fixedStep);acceleration=0;}
      }else agent.stoppedTime=0;
      const previousSpeed=agent.speed;
      agent.speed=clamp(agent.speed+acceleration*fixedStep,0,desired);
      const proposed=agent.progress+direction*Math.max(0,Math.min(agent.speed*fixedStep,(hardLimit-agent.progress)*direction,direction===1?length-agent.progress:agent.progress));
      agent.speed=direction*(proposed-agent.progress)/fixedStep;
      agent.acceleration=(agent.speed-previousSpeed)/fixedStep;
      agent.braking=agent.kind==='scooter'&&(agent.acceleration<-.35||agent.speed<.15&&agent.stoppedTime>.25);
      const previousX=agent.x,previousZ=agent.z,previousYaw=agent.yaw,previousLateral=agent.lateral,previousProgress=agent.progress,previousBucket=settings.bidirectional?bucketKey(agent):null;agent.progress=proposed;
      if(agent.originalKind==='scooter'&&!agent.dismounted&&agent.progress>=dismountProgress){agent.dismounted=true;agent.kind=agent.type='walk';agent.desiredSpeed=1.3;agent.halfLength=.3;agent.radius=.25;state.dismountedTotal++;}
      const mergeLookAhead=Math.max(settings.bidirectional?32:16,agent.speed*3),aheadWidth=crossSection(clamp(agent.progress+direction*mergeLookAhead,0,length)),hereWidth=crossSection(agent.progress);
      const offsetProbe=aheadWidth.width<hereWidth.width?clamp(agent.progress+direction*mergeLookAhead,0,length):agent.progress;
      let targetOffset=desiredOffset(agent,agent.progress);
      if(offsetProbe!==agent.progress){
        const boundary=direction===1?aheadWidth.segment.startProgress:aheadWidth.segment.endProgress;
        const blend=clamp((mergeLookAhead-direction*(boundary-agent.progress))/mergeLookAhead,0,1),ease=blend*blend*(3-2*blend);
        targetOffset+=(desiredOffset(agent,offsetProbe)-targetOffset)*ease;
      }
      if(narrowSections.some(s=>(direction===1?agent.progress<s.start:agent.progress>s.end)&&(direction===1?s.start-agent.progress:agent.progress-s.end)<mergeLookAhead&&(s.owner!==direction||!s.accepting)))targetOffset=desiredOffset(agent,agent.progress);
      if(settings.bidirectional&&agent.kind==='scooter'&&route.roadSurfaces?.length){
        for(let distance=4;distance<=48;distance+=4){const future=clamp(agent.progress+direction*distance,0,length),limit=Math.abs(pavementCorridor.limit(future,targetOffset))+distance*.25;if(Math.abs(targetOffset)>limit)targetOffset=Math.sign(targetOffset)*limit;}
      }
      if(state.elapsed<(agent.yieldSideUntil??0)||finite(agent.yieldSideStartProgress)&&direction*(agent.progress-agent.yieldSideStartProgress)<2.4)targetOffset=agent.lateral>0?Math.min(targetOffset,agent.yieldSideOffset):Math.max(targetOffset,agent.yieldSideOffset);
      const lateralRate=agent.kind==='scooter'?Math.min(.85,Math.max(settings.bidirectional?.2:0,agent.speed*.65)):.65;
      const wanted=agent.lateral+clamp(targetOffset-agent.lateral,-lateralRate*fixedStep,lateralRate*fixedStep);
      agent.lateral=safeLateral(agent,wanted,i);
      const roadLimit=settings.bidirectional&&agent.kind==='walk'?hereWidth.walkOffset+.08:Math.max(0,hereWidth.width/2-agent.radius-.05);
      agent.lateral=clamp(agent.lateral,-roadLimit,roadLimit);
      if(settings.bidirectional&&agent.kind==='scooter'&&route.roadSurfaces?.length){
        const within=(progress,lateral)=>Math.abs(pavementCorridor.limit(progress,lateral)-lateral)<.002;
        if(!within(agent.progress,agent.lateral)&&within(previousProgress,previousLateral)){
          agent.motionConstraint='road-envelope';
          // Stop before a bend's narrowing envelope while continuing the safe
          // lateral shuffle; never snap a scooter across a kerb to fit it.
          let lo=0,hi=1;for(let n=0;n<10;n++){const t=(lo+hi)/2;if(within(previousProgress+(agent.progress-previousProgress)*t,agent.lateral))lo=t;else hi=t;}
          agent.progress=previousProgress+(agent.progress-previousProgress)*lo;agent.speed=direction*(agent.progress-previousProgress)/fixedStep;agent.acceleration=(agent.speed-previousSpeed)/fixedStep;
        }
      }
      if(playerObstacle){
        const fraction=playerSweepFraction(agent,previousProgress,previousLateral,agent.progress,agent.lateral);
        if(fraction<1){agent.progress=previousProgress+(agent.progress-previousProgress)*fraction;agent.lateral=previousLateral+(agent.lateral-previousLateral)*fraction;
          agent.speed=direction*(agent.progress-previousProgress)/fixedStep;agent.acceleration=(agent.speed-previousSpeed)/fixedStep;playerBlocked=true;
          agent.braking=agent.kind==='scooter'&&(agent.acceleration<-.35||agent.speed<.15);
        }
      }
      agent.lateralSpeed=(agent.lateral-previousLateral)/fixedStep;
      if(agent.laneChange){
        const total=Math.abs(targetOffset-agent.laneChange.startLateral);
        agent.laneChange.progress=total<.01?1:clamp(Math.abs(agent.lateral-agent.laneChange.startLateral)/total,0,1);
        if(Math.abs(targetOffset-agent.lateral)<.025){agent.lane=agent.laneChange.to;agent.laneChange=null;agent.laneChanges++;state.laneChangesTotal++;}
      }
      const pose=poseForAgent(agent,agent.progress,agent.lateral);agent.x=pose.x;agent.y=pose.y;agent.z=pose.z;agent.pathScale=pose.pathScale;agent.offsetAlong=pose.offsetAlong;agent.groundSpeed=Math.hypot(agent.x-previousX,agent.z-previousZ)/fixedStep;
      if(Math.hypot(agent.x-previousX,agent.z-previousZ)>.002){const targetYaw=Math.atan2(-(agent.x-previousX),-(agent.z-previousZ));agent.yaw+=Math.atan2(Math.sin(targetYaw-agent.yaw),Math.cos(targetYaw-agent.yaw))*Math.min(1,fixedStep*9);}
      if(settings.bidirectional){
        const nearby=new Set(),gx=Math.floor(agent.x/4),gz=Math.floor(agent.z/4);
        for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const other of buckets.get(`${gx+dx},${gz+dz}`)||[])if(other!==agent&&other.active)nearby.add(other);
        const wantedProgress=agent.progress,wantedLateral=agent.lateral,yawDelta=Math.atan2(Math.sin(agent.yaw-previousYaw),Math.cos(agent.yaw-previousYaw));
        const at=t=>poseForAgent(agent,previousProgress+(wantedProgress-previousProgress)*t,previousLateral+(wantedLateral-previousLateral)*t);
        let fraction=1;
        // Resolve translation before rotation. Coupling both can deadlock a
        // stopped front rider: turning its rear corner needs space that its
        // forward movement would create. The body may retain its old heading
        // briefly while advancing, then rotate once the rear has cleared.
        for(const other of nearby){
          const initialGap=worldClearance(agent,at(0),previousYaw,other);let previous=0;
          for(let n=1;n<=4;n++){
            const t=n/4,gap=worldClearance(agent,at(t),previousYaw,other);
            if(gap<.025&&gap<initialGap-1e-7){let lo=previous,hi=t;for(let k=0;k<9;k++){const mid=(lo+hi)/2;if(worldClearance(agent,at(mid),previousYaw,other)<Math.min(.025,initialGap))hi=mid;else lo=mid;}fraction=Math.min(fraction,lo);break;}
            previous=t;
          }
        }
        let resolvedProgress=previousProgress+(wantedProgress-previousProgress)*fraction,resolvedLateral=previousLateral+(wantedLateral-previousLateral)*fraction;
        if(fraction<1){
          // A blocked sideways move must not suppress a clear forward escape.
          // In particular, an outer walker behind a widening-road rider may
          // wait for that rider; keeping the current lateral position lets the
          // rider advance first instead of both waiting for each other forever.
          const safeFraction=(sample,roadCheck)=>{let result=1;for(const other of nearby){const initial=sample(0),initialGap=worldClearance(agent,initial,previousYaw,other);let previous=0;for(let n=1;n<=4;n++){const t=n/4,p=sample(t),gap=worldClearance(agent,p,previousYaw,other);if(gap<.025&&gap<initialGap-1e-7||roadCheck&&!roadCheck(t)){let lo=previous,hi=t;for(let k=0;k<9;k++){const m=(lo+hi)/2;if(worldClearance(agent,sample(m),previousYaw,other)<Math.min(.025,initialGap)||roadCheck&&!roadCheck(m))hi=m;else lo=m;}result=Math.min(result,lo);break;}previous=t;}}return result;};
          const longitudinal=t=>poseForAgent(agent,previousProgress+(wantedProgress-previousProgress)*t,previousLateral);
          const fitsRoad=t=>agent.kind!=='scooter'||Math.abs(pavementCorridor.limit(previousProgress+(wantedProgress-previousProgress)*t,previousLateral)-previousLateral)<.002;
          const along=Math.min(safeFraction(longitudinal,fitsRoad),playerSweepFraction(agent,previousProgress,previousLateral,wantedProgress,previousLateral));
          if(along>fraction+.001){
            resolvedProgress=previousProgress+(wantedProgress-previousProgress)*along;
            const lateral=t=>poseForAgent(agent,resolvedProgress,previousLateral+(wantedLateral-previousLateral)*t);
            const side=Math.min(safeFraction(lateral,t=>agent.kind!=='scooter'||Math.abs(pavementCorridor.limit(resolvedProgress,previousLateral+(wantedLateral-previousLateral)*t)-(previousLateral+(wantedLateral-previousLateral)*t))<.002),playerSweepFraction(agent,resolvedProgress,previousLateral,resolvedProgress,wantedLateral));
            resolvedLateral=previousLateral+(wantedLateral-previousLateral)*side;fraction=along;
          }
        }
        if(fraction<.15&&previousSpeed<.3&&!agent.leaderId&&Math.abs(resolvedLateral)>.6){
          // A stopped rider may be corner-to-corner with someone behind it:
          // even straight progress closes their tiny gap, while the preferred
          // outer lane target also moves toward them. Try a foot-supported
          // 1 cm inward shuffle, only if every swept envelope remains safe.
          const sign=Math.sign(resolvedLateral),escapeLateral=resolvedLateral-sign*.2*fixedStep;
          const initial=poseForAgent(agent,resolvedProgress,resolvedLateral),escape=poseForAgent(agent,resolvedProgress,escapeLateral);
          const staysInCorridor=agent.kind==='scooter'?Math.abs(pavementCorridor.limit(resolvedProgress,escapeLateral)-escapeLateral)<.002:Math.abs(escapeLateral-(agent.yieldSideStartLateral??resolvedLateral))<.6&&pavementCorridor.walkFits(escape.x,escape.z,escape.y,agent.radius+.025);
          let safe=staysInCorridor&&playerSweepFraction(agent,resolvedProgress,resolvedLateral,resolvedProgress,escapeLateral)>=1,nearestBefore=Infinity,nearestAfter=Infinity;
          for(const other of nearby){const before=worldClearance(agent,initial,previousYaw,other),after=worldClearance(agent,escape,previousYaw,other);nearestBefore=Math.min(nearestBefore,before);nearestAfter=Math.min(nearestAfter,after);
            if(after<Math.min(.025,before)-1e-7||before<.1&&after<before-1e-7)safe=false;
          }
          if(safe&&nearestAfter>nearestBefore+.001){if(!finite(agent.yieldSideStartLateral)||direction*(resolvedProgress-(agent.yieldSideStartProgress??resolvedProgress))>=2.4)agent.yieldSideStartLateral=resolvedLateral;resolvedLateral=escapeLateral;agent.yieldSideOffset=sign*Math.max(.55,Math.abs(escapeLateral)-.24);agent.yieldSideUntil=state.elapsed+1.25;agent.yieldSideStartProgress=resolvedProgress;agent.motionConstraint='yield-side';}
        }
        const resolved=poseForAgent(agent,resolvedProgress,resolvedLateral);agent.progress=resolvedProgress;agent.lateral=resolvedLateral;
        Object.assign(agent,{x:resolved.x,y:resolved.y,z:resolved.z,pathScale:resolved.pathScale,offsetAlong:resolved.offsetAlong});
        let turnFraction=1;
        for(const other of nearby){const initialGap=worldClearance(agent,resolved,previousYaw,other),targetGap=worldClearance(agent,resolved,previousYaw+yawDelta,other);if(targetGap<.025&&targetGap<initialGap-1e-7){let lo=0,hi=1;for(let k=0;k<9;k++){const mid=(lo+hi)/2;if(worldClearance(agent,resolved,previousYaw+yawDelta*mid,other)<Math.min(.025,initialGap))hi=mid;else lo=mid;}turnFraction=Math.min(turnFraction,lo);}}
        agent.yaw=previousYaw+yawDelta*turnFraction;
        if(fraction<1){if(agent.motionConstraint!=='yield-side')agent.motionConstraint='body-sweep';agent.speed=direction*(agent.progress-previousProgress)/fixedStep;agent.acceleration=(agent.speed-previousSpeed)/fixedStep;agent.groundSpeed=Math.hypot(agent.x-previousX,agent.z-previousZ)/fixedStep;agent.lateralSpeed=(agent.lateral-previousLateral)/fixedStep;agent.braking=agent.kind==='scooter'&&agent.acceleration<-.35;}
        buckets.get(previousBucket)?.delete(agent);const key=bucketKey(agent);if(!buckets.has(key))buckets.set(key,new Set());buckets.get(key).add(agent);
      }
      const turnRate=Math.atan2(Math.sin(agent.yaw-previousYaw),Math.cos(agent.yaw-previousYaw))/fixedStep;
      if(agent.kind==='walk')agent.y=pavementCorridor.walkHeight(agent.x,agent.z,agent.y);
      const steeringTarget=agent.kind==='scooter'?clamp(Math.atan(1.12*turnRate/Math.max(.65,agent.groundSpeed)),-.55,.55):0;
      const leanTarget=agent.kind==='scooter'?clamp(Math.atan(agent.groundSpeed*turnRate/9.81),-.22,.22):0;
      agent.steeringAngle+=(steeringTarget-agent.steeringAngle)*.22;agent.lean+=(leanTarget-agent.lean)*.2;
      const footTarget=agent.kind==='scooter'&&agent.speed<.14&&agent.stoppedTime>.28?1:0;
      agent.footDown+=clamp(footTarget-agent.footDown,-fixedStep*3,fixedStep*2.5);
      agent.waiting=agent.speed<.35;agent.phase=agent.waiting?'waiting':'moving';agent.channel=channelAt(agent,agent.progress);
      agent.waitReason=agent.waiting?(playerBlocked?'player':signalBlocked?'signal':oncomingBlocked?'oncoming':'queue'):null;if(agent.waiting)agent.waitingTime+=fixedStep;
      for(const crossing of pedestrianCrossings)if(withinCrossing(agent,crossingWindow(crossing,agent)))agent.crossingPermissions[crossing.id]=true;
      for(const signal of state.signals)if(direction*(agent.progress-stopLineFor(signal,agent))+agent.halfLength>=0&&(signalPermitsEntry(signal,agent)||!signal.enabled||clearingCrossing(signal,agent)))agent.passedSignals[signal.id]=true;
      if(direction===1?agent.progress>=length-EPS:agent.progress<=EPS){agent.active=false;agent.phase='arrived';agent.speed=0;agent.waiting=false;agent.lean=0;agent.steeringAngle=0;agent.footDown=0;agent.laneChange=null;agent.arrivedAt=state.elapsed;if(direction===1){state.arrivals++;arrivalTimes.push(state.elapsed);}else state.departures++;
        // Follow cameras can see an explicit arrival after active meshes disappear.
        completedAgents.set(agent.id,agent);if(completedAgents.size>128)completedAgents.delete(completedAgents.keys().next().value);
      }
    }
    state.agents=agents.filter(a=>a.active);
    if(settings.bidirectional||trafficOrigins.length>1){
      const rate=inflowRate(),targetCap=Math.min(maxAgents,peakCount());
      for(const origin of trafficOrigins){
        if(origin.direction===-1&&!settings.bidirectional)continue;
        const weightSum=trafficOrigins.filter(o=>o.direction===origin.direction).reduce((n,o)=>n+o.weight,0);
        const directionShare=settings.bidirectional?(origin.direction===-1?settings.opposingShare:1-settings.opposingShare):1;
        originBudgets.set(origin.id,Math.min(3,originBudgets.get(origin.id)+rate*directionShare*origin.weight/weightSum*fixedStep));
      }
      // Independent source queues avoid one blocked junction suppressing every
      // other inlet. Rotation removes a permanent first-source capacity bias.
      for(let n=0;n<trafficOrigins.length;n++){
        const origin=trafficOrigins[(ticks+n)%trafficOrigins.length];if((originBudgets.get(origin.id)||0)<1)continue;
        while(originBudgets.get(origin.id)>=1&&state.agents.length<targetCap){
          const cross=crossSection(origin.progress);
          // Preserve the queued person's mode while a source is blocked.
          // Re-rolling every tick would turn congestion into an artificial
          // preference for walking, since pedestrians fit into smaller gaps.
          if(!originPending.has(origin.id)){const kind=random()<settings.scooterShare?'scooter':'walk';originPending.set(origin.id,{kind,firstLane:Math.floor(random()*(kind==='walk'?1:cross.lanes))});}
          const {kind,firstLane}=originPending.get(origin.id),laneCount=kind==='walk'?1:cross.lanes;let inserted=false;
          for(let attempt=0;attempt<laneCount;attempt++){
            const candidate=makeAgent(kind,origin.progress,(firstLane+attempt)%laneCount,origin.direction,origin);candidate.speed=0;
            if(state.signals.some(signal=>signal.enabled&&!signalPermitsEntry(signal,candidate)&&Math.abs(origin.progress-signal.progress)<15)||narrowEntryLimit(candidate)<.1||!hasSpawnSpace(candidate,origin.progress>2&&origin.progress<length-2))continue;
            state.agents.push(candidate);originBudgets.set(origin.id,originBudgets.get(origin.id)-1);originPending.delete(origin.id);inserted=true;break;
          }
          if(!inserted)break;
        }
      }
      return;
    }
    spawnBudget=Math.min(5,spawnBudget+inflowRate()*fixedStep);
    const targetCap=Math.max(0,peakCount());
    while(spawnBudget>=1&&state.agents.length<targetCap&&state.agents.length<maxAgents){
      let inserted=false;
      const kind=random()<settings.scooterShare?'scooter':'walk',cross=crossSection(0);
      const laneCount=kind==='walk'?(cross.shared?cross.walkingLanes:2):cross.lanes,firstLane=Math.floor(random()*laneCount);
      for(let laneAttempt=0;laneAttempt<laneCount;laneAttempt++){
        const candidate=makeAgent(kind,0,(firstLane+laneAttempt)%laneCount);candidate.speed=0;
        if(hasSpawnSpace(candidate)){state.agents.push(candidate);spawnBudget--;inserted=true;break;}
      }
      if(!inserted)break;
    }
  }
  function takeScooter(agent){
    if(!state.agents.includes(agent)||!agent.active||agent.kind!=='scooter')return{ok:false};
    const lease={ok:true,agent,phase:agent.phase};
    agent.active=false;agent.phase='borrowed';state.agents=state.agents.filter(a=>a!==agent);refreshStats();
    return lease;
  }
  function restoreScooter(lease){
    const agent=lease?.agent;
    if(!agent||agent.phase!=='borrowed'||state.agents.some(a=>a.id===agent.id))return{ok:false};
    agent.active=true;agent.phase=lease.phase;state.agents.push(agent);refreshStats();return{ok:true};
  }
  function step(dt){if(!finite(dt)||dt<=0)return state;accumulator+=dt;let updated=false;while(accumulator>=fixedStep-EPS){integrate();accumulator-=fixedStep;updated=true;}if(updated)refreshStats();return state;}
  reset();return{state,setTime,setDensity,setScooterShare,setSignals,setPlayerObstacle,step,reset,takeScooter,restoreScooter,getPoseAt,getAgent:id=>state.agents.find(a=>a.id===id)||completedAgents.get(id)||null,
    get agents(){return state.agents;},get stats(){return state.stats;},get signals(){return state.signals;},get routeLength(){return length;}};
}
