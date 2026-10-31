import {planResidentialTrafficRoute,sampleResidentialTrafficPath} from './residential-traffic-route.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wrap=(n,length)=>((n%length)+length)%length;
const radius=a=>a.kind==='scooter'?.96:.28;

/** Small source-backed ground flow. It shares the existing commuter render
 * batches, player collision checks and F-key scooter leasing adapter. */
export function createResidentialTraffic(options={}){
  const plan=planResidentialTrafficRoute(options),all=[],paths=new Map();
  let active=[],elapsedSeconds=0,accumulator=0,disposed=false;
  for(const path of plan.paths){
    paths.set(path.id,path);
    for(let i=0;i<path.count;i++){
      const distance=path.length*(i+.24)/path.count,p=sampleResidentialTrafficPath(path,distance,{}),kind=path.kind;
      const a={id:-100001-all.length,type:kind,kind,originalKind:kind,contactMode:'independent',
        active:true,phase:'moving',pathId:path.id,pathDistance:distance,progress:distance,
        x:p.x,y:p.y+(kind==='scooter'?.021:0),z:p.z,yaw:p.yaw,speed:p.speed??path.speed,
        groundSpeed:p.speed??path.speed,groundPitch:p.groundPitch??0,radius:kind==='scooter'?.43:.25,
        halfLength:kind==='scooter'?.9:.24,steeringAngle:0,lean:0,footDown:0,braking:false,
        colorIndex:all.length%8,waiting:false,waitingTime:0,direction:1,sample:{}};
      all.push(a);
    }
  }
  active=[...all];
  const borrowed=new Map(),obstacles=[];
  const bounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};
  for(const path of plan.paths)for(const p of path.points){bounds.minX=Math.min(bounds.minX,p.x-5);bounds.maxX=Math.max(bounds.maxX,p.x+5);bounds.minZ=Math.min(bounds.minZ,p.z-5);bounds.maxZ=Math.max(bounds.maxZ,p.z+5);}
  function collectObstacles(player,parked){
    obstacles.length=0;
    if(player&&Number.isFinite(player.x)&&Number.isFinite(player.z)&&Number.isFinite(player.y)){
      const r={walk:.35,spider:.65,scooter:1.1,roadster:2.65,helicopter:5,hoverboard:2.3,boat:3.5}[player.mode]??.35;
      // A tilted flying craft can project below its origin. This conservative
      // interval keeps low passes clear without stopping for high overflights.
      const low=player.y-(player.mode==='roadster'||player.mode==='hoverboard'?1.5:.2);
      if(low<2.2)obstacles.push({x:player.x,z:player.z,y:low,radius:r});
    }
    for(const p of parked||[])if(p.active!==false&&p.x>=bounds.minX&&p.x<=bounds.maxX&&p.z>=bounds.minZ&&p.z<=bounds.maxZ)obstacles.push({x:p.x,z:p.z,y:p.y??.14,radius:1});
  }
  function integrate(h){
    elapsedSeconds+=h;
    for(const a of active){
      const path=paths.get(a.pathId),p=sampleResidentialTrafficPath(path,a.pathDistance,a.sample);
      let target=p.speed??path.speed,advanceLimit=Infinity;
      for(const b of active)if(a!==b&&b.pathId===a.pathId){
        const gap=wrap(b.pathDistance-a.pathDistance,path.length)-radius(a)-radius(b)-.35;
        advanceLimit=Math.min(advanceLimit,Math.max(0,gap));
        target=Math.min(target,Math.max(0,gap)/.9);
      }
      const fx=-Math.sin(a.yaw),fz=-Math.cos(a.yaw),ar=radius(a);
      for(const b of obstacles){
        if(Math.abs(b.y-a.y)>2.2)continue;
        const dx=b.x-a.x,dz=b.z-a.z,ahead=dx*fx+dz*fz,side=Math.abs(dx*fz-dz*fx),r=ar+b.radius+.18;
        if(ahead>=0&&side<r){const gap=Math.max(0,ahead-Math.sqrt(r*r-side*side));target=Math.min(target,Math.sqrt(2*2.5*gap));advanceLimit=Math.min(advanceLimit,gap);}
      }
      const oldSpeed=a.speed,desired=a.speed+clamp(target-a.speed,-3.2*h,1.7*h);
      let advance=Math.min(Math.max(0,desired)*h,advanceLimit);
      const safe=t=>{
        const next=sampleResidentialTrafficPath(path,a.pathDistance+t,a.sample);
        for(const b of obstacles){
          if(Math.abs(b.y-a.y)>2.2)continue;
          const r=ar+b.radius+.12,previous=Math.hypot(a.x-b.x,a.z-b.z),after=Math.hypot(next.x-b.x,next.z-b.z);
          if(after<r&&after<previous-1e-7)return false;
        }
        return true;
      };
      if(!safe(advance)){let lo=0,hi=advance;for(let n=0;n<8;n++){const mid=(lo+hi)/2;if(safe(mid))lo=mid;else hi=mid;}advance=lo;}
      const oldYaw=a.yaw;
      a.pathDistance=wrap(a.pathDistance+advance,path.length);a.progress+=advance;
      sampleResidentialTrafficPath(path,a.pathDistance,a.sample);
      a.x=a.sample.x;a.z=a.sample.z;a.y=a.sample.y+(a.kind==='scooter'?.021:0);a.yaw=a.sample.yaw;a.groundPitch=a.sample.groundPitch??0;
      a.speed=a.groundSpeed=advance/h;
      const turn=Math.atan2(Math.sin(a.yaw-oldYaw),Math.cos(a.yaw-oldYaw))/h;
      a.steeringAngle=a.kind==='scooter'?clamp(Math.atan(1.12*turn/Math.max(.65,a.speed)),-.5,.5):0;
      a.lean=a.kind==='scooter'?clamp(Math.atan(a.speed*turn/9.81),-.16,.16):0;
      a.footDown+=clamp((a.speed<.15?1:0)-a.footDown,-h*3,h*2.5);
      a.braking=a.kind==='scooter'&&(a.speed<oldSpeed-.02||a.speed<.15);
      a.waiting=a.speed<.15;a.phase=a.waiting?'waiting':'moving';if(a.waiting)a.waitingTime+=h;
    }
  }
  return {
    plan,
    get agents(){return active;},
    tick(dt,player,parked=[]){
      if(disposed||!active.length||!Number.isFinite(dt)||dt<=0)return false;
      accumulator+=Math.min(dt,.1);if(accumulator<1/30-1e-9)return false;
      collectObstacles(player,typeof parked==='function'?parked():parked);let changed=false;
      while(accumulator>=1/30-1e-9){integrate(1/30);accumulator-=1/30;changed=true;}
      return changed&&active.length>0;
    },
    takeScooter(a){
      if(disposed||!active.includes(a)||a.kind!=='scooter')return{ok:false};
      const lease={ok:true,agent:a,phase:a.phase};a.active=false;a.phase='borrowed';borrowed.set(a,lease);active=active.filter(b=>b!==a);return lease;
    },
    restoreScooter(lease){
      const a=lease?.agent;if(disposed||!a||borrowed.get(a)!==lease||a.phase!=='borrowed')return{ok:false};
      borrowed.delete(a);a.active=true;a.phase=lease.phase;active=[...active,a];return{ok:true};
    },
    getDiagnostics(){return{total:all.length,activeCount:active.length,elapsedSeconds,counts:{walk:active.filter(a=>a.kind==='walk').length,scooter:active.filter(a=>a.kind==='scooter').length},agents:active.map(({sample,...a})=>({...a})),disposed};},
    dispose(){disposed=true;active=[];borrowed.clear();obstacles.length=0;},
  };
}

/** Reuse the original actor renderer, collision input and pickup UI without
 * merging a side street into the surveyed main commute or altering its stats. */
export function combineTrafficSources(primary,residential){
  let main=null,branch=null,mainLength=-1,combined=[];
  const leases=new WeakSet();
  return {
    get agents(){const a=primary.agents,b=residential.agents;if(a!==main||b!==branch||a.length!==mainLength){main=a;branch=b;mainLength=a.length;combined=a.concat(b);}return combined;},
    get signals(){return primary.signals;},get state(){return primary.state;},get stats(){return primary.stats;},
    getPoseAt(...args){return primary.getPoseAt(...args);},
    getAgent(id){return residential.agents.find(a=>a.id===id)||primary.getAgent?.(id)||null;},
    takeScooter(a){if(residential.agents.includes(a)){const lease=residential.takeScooter(a);if(lease.ok)leases.add(lease);return lease;}return primary.takeScooter(a);},
    restoreScooter(lease){return leases.has(lease)?residential.restoreScooter(lease):primary.restoreScooter(lease);},
  };
}
