import { waterFootprint } from './water-details.js';
import { getBuildingProfile } from './building-profiles.js';
import { getReconstructionBuildings } from './campus-feature-selection.js';

// Small, decorative activity flights, not claims about real campus traffic.
// Planning reads the surveyed map once. Sampling never queries the map and
// never participates in player collision, pickup or commuting signal logic.
const TAU = Math.PI * 2;
const finite = Number.isFinite;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wrap = n => ((n % 1) + 1) % 1;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function ringContains(x, z, ring) {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

function polygonFootprint(record) {
  const rings = record.rings || (record.polygon ? [record.polygon] : []);
  if (!rings.length || rings.some(r => r.length < 3 || r.some(p => !finite(p.x) || !finite(p.z)))) return null;
  const points = rings.flat();
  return {
    bounds: {minX:Math.min(...points.map(p => p.x)),maxX:Math.max(...points.map(p => p.x)),minZ:Math.min(...points.map(p => p.z)),maxZ:Math.max(...points.map(p => p.z))},
    contains(x,z) { return ringContains(x,z,rings[0]) && !rings.slice(1).some(r => ringContains(x,z,r)); },
    distance(x,z) {
      let best = Infinity;
      for (const ring of rings) for (let i=0;i<ring.length;i++) {
        const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z;
        const t=clamp(((x-a.x)*dx+(z-a.z)*dz)/Math.max(1e-9,dx*dx+dz*dz),0,1);
        best=Math.min(best,Math.hypot(x-a.x-t*dx,z-a.z-t*dz));
      }
      return best;
    },
  };
}

function ellipsePoint(plan, angle, out={}) {
  const x=plan.radiusX*Math.cos(angle),z=plan.radiusZ*Math.sin(angle);
  const c=Math.cos(plan.rotation),s=Math.sin(plan.rotation);
  out.x=plan.center.x+c*x-s*z;out.z=plan.center.z+s*x+c*z;
  return out;
}

function sealRoute(plan) {
  // Arc-length lookup keeps elongated lawn loops at an even cruising speed.
  // This fixed table is built once, shared by every frame and binary searched.
  const arc=[0],steps=256,p=ellipsePoint(plan,0),q={};let length=0;
  for(let i=1;i<=steps;i++) {ellipsePoint(plan,i/steps*TAU,q);length+=distance(p,q);arc.push(length);p.x=q.x;p.z=q.z;}
  return Object.freeze({...plan,center:Object.freeze({...plan.center}),length,periodSeconds:length/plan.speed,arc:Object.freeze(arc)});
}

function pathFits(plan, footprint, margin) {
  // Adjacent samples are <= .5 m apart along the true ellipse. Adding .5 m
  // to hull clearance covers the entire swept curve between samples too.
  const steps=Math.ceil(TAU*Math.max(plan.radiusX,plan.radiusZ)/.5),p={};
  for(let i=0;i<steps;i++) {ellipsePoint(plan,i/steps*TAU,p);if(!footprint.contains(p.x,p.z)||footprint.distance(p.x,p.z)<margin+.5)return false;}
  return true;
}

function buildingObstacles(model) {
  const obstacles=[];
  for(const record of getReconstructionBuildings(model)) {
    const footprint=waterFootprint(record),profile=getBuildingProfile(record.feature);
    if(footprint&&finite(profile.height))obstacles.push({footprint,height:profile.height+.065});
  }
  for(const infrastructure of [model.architectureInfrastructure,model.sportsInfrastructure,model.bridgeInfrastructure]) {
    for(const record of [...(infrastructure?.buildings||[]),...(infrastructure?.barriers||[])]) {
      const footprint=polygonFootprint(record),height=record.height??record.maxY??record.top;
      if(footprint&&finite(height))obstacles.push({footprint,height});
    }
  }
  return obstacles;
}

function roofSafeHeight(plan, obstacles) {
  let height=plan.height;
  const extent=Math.max(plan.radiusX,plan.radiusZ)+plan.radius+1;
  const local=obstacles.filter(({footprint:{bounds:b}})=>b.minX<=plan.center.x+extent&&b.maxX>=plan.center.x-extent&&b.minZ<=plan.center.z+extent&&b.maxZ>=plan.center.z-extent);
  const steps=Math.ceil(TAU*Math.max(plan.radiusX,plan.radiusZ)/.5),p={};
  for(let i=0;i<steps;i++) {
    ellipsePoint(plan,i/steps*TAU,p);
    for(const obstacle of local)if(obstacle.footprint.contains(p.x,p.z)||obstacle.footprint.distance(p.x,p.z)<plan.radius+.5)height=Math.max(height,obstacle.height+plan.verticalClearance);
  }
  return height;
}

function openLawnLoop(lawn) {
  const b=lawn.bounds,center={x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2};
  // Longest lawn boundary gives its north/south axis; the source lawn tilts
  // slightly, so an axis-aligned circle can clip its narrow planted edges.
  let edge=null,length=0;
  for(const rings of lawn.polygons)for(let i=0;i<rings[0].length;i++) {const a=rings[0][i],c=rings[0][(i+1)%rings[0].length],d=distance(a,c);if(d>length){length=d;edge={x:c.x-a.x,z:c.z-a.z};}}
  const rotation=edge?Math.atan2(-edge.x,edge.z):0;
  for(const radiusZ of [28,24,18,12])for(const radiusX of [8,6]) {
    const plan={center,radiusX,radiusZ,rotation};
    if(pathFits(plan,lawn,2.5))return plan;
  }
  return null;
}

function lakeLoop(water, target) {
  const b=water.bounds,candidates=[];
  // One 36 m diameter cruising loop. A containing water disk is conservative:
  // its shoreline clearance also excludes every source island hole.
  // Existing playable boats are moored <= 2.1 m from the source shore.
  // Keep both hull envelopes clear (3.8 + 3.8 + 2.1 m, plus margin), without
  // invoking the expensive pickup planner or changing any player placement.
  const radius=18,shoreClearance=10.5;
  for(let x=b.minX+radius+shoreClearance;x<b.maxX-radius-shoreClearance;x+=6)for(let z=b.minZ+radius+shoreClearance;z<b.maxZ-radius-shoreClearance;z+=6) {
    if(water.contains(x,z)&&water.distance(x,z)>=radius+shoreClearance)candidates.push({x,z,score:Math.hypot(x-target.x,z-target.z)});
  }
  candidates.sort((a,b)=>a.score-b.score||a.x-b.x||a.z-b.z);
  const candidate=candidates[0];
  return candidate?{center:{x:candidate.x,z:candidate.z},radiusX:radius,radiusZ:radius,rotation:0}:null;
}

/** A maximum of five ambient NPCs; no mutation of source/physics geometry. */
export function planNpcTransportRoutes({model,route}={}) {
  if(!model||!route?.points?.length)return [];
  const result=[],obstacles=buildingObstacles(model);
  const lawnRecord=model.records?.find(r=>r.id==='way/98867860'),lawn=lawnRecord&&waterFootprint(lawnRecord),lawnLoop=lawn&&openLawnLoop(lawn);
  const addAir=(plan)=>{
    plan.height=roofSafeHeight(plan,obstacles);
    // A later map update must not turn a nearby ambience loop into an
    // invisible flight far above campus. Omit an unsafe path instead.
    if(plan.height<=plan.maxHeight)result.push(sealRoute(plan));
  };
  if(lawnLoop) {
    const common={sourceId:lawnRecord.id,region:'韵苑食堂与草坪',direction:1};
    addAir({...common,...lawnLoop,id:'npc-hoverboard-yunyuan',mode:'hoverboard',height:11,maxHeight:16,verticalClearance:3,radius:2,speed:5.2,phase:.75});
    addAir({...common,center:{...lawnLoop.center,z:lawnLoop.center.z-28},radiusX:47,radiusZ:63,rotation:lawnLoop.rotation,id:'npc-roadster-yunyuan',mode:'roadster',height:28,maxHeight:38,verticalClearance:5,radius:2.7,speed:11,phase:.63,direction:-1});
    addAir({...common,center:{...lawnLoop.center,z:lawnLoop.center.z-22},radiusX:65,radiusZ:90,rotation:lawnLoop.rotation,id:'npc-helicopter-yunyuan',mode:'helicopter',height:45,maxHeight:60,verticalClearance:8,radius:5.2,speed:12,phase:.75});
  }
  const lake=model.water?.find(r=>r.id==='relation/13705236'),water=lake&&waterFootprint(lake);
  const target=route.points.at(-1);
  const cruise=water&&lakeLoop(water,target);
  if(cruise) {
    const common={...cruise,sourceId:lake.id,region:'东九湖西侧',direction:1};
    result.push(sealRoute({...common,id:'npc-boat-east-nine',mode:'boat',height:lake.mesh?.position.y??.022,verticalClearance:0,radius:3.8,speed:2.5,phase:.35}));
    addAir({...common,id:'npc-hoverboard-east-nine',mode:'hoverboard',height:13,maxHeight:18,verticalClearance:3,radius:2,speed:6.3,phase:.9,direction:-1});
  }
  return result;
}

/** Allocation-free sampling. Passing an output object is recommended. */
export function sampleNpcTransportRoute(plan, elapsedSeconds, out={}) {
  const elapsed=finite(elapsedSeconds)?elapsedSeconds:0;
  const fraction=wrap((plan.phase||0)+elapsed/plan.periodSeconds*(plan.direction||1)),target=fraction*plan.length,arc=plan.arc;
  let lo=0,hi=arc.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(arc[mid]<=target)lo=mid;else hi=mid;}
  const mix=(target-arc[lo])/Math.max(1e-12,arc[hi]-arc[lo]),angle=(lo+mix)/(arc.length-1)*TAU;
  ellipsePoint(plan,angle,out);
  const direction=plan.direction||1,dx=-plan.radiusX*Math.sin(angle)*direction,dz=plan.radiusZ*Math.cos(angle)*direction,c=Math.cos(plan.rotation),s=Math.sin(plan.rotation);
  out.y=plan.height;out.yaw=Math.atan2(-(c*dx-s*dz),-(s*dx+c*dz));out.speed=plan.speed;
  const curvature=plan.radiusX*plan.radiusZ/Math.pow(Math.hypot(plan.radiusX*Math.sin(angle),plan.radiusZ*Math.cos(angle)),3);
  out.roll=plan.mode==='boat'?0:clamp(-direction*Math.atan(plan.speed*plan.speed*curvature/9.81),-.20,.20);
  out.pitch=plan.mode==='boat'?0:plan.mode==='helicopter'?-.035:-.025;
  return out;
}
