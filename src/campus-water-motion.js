import {sampleCampusFloodwater} from './campus-floodwater.js';
import {CAMPUS_TSUNAMI_PLACEMENT as WAVE,campusTsunamiFront} from './campus-tsunami-timeline.js';

export const CAMPUS_SURF={window:2,duration:5,boardSpeed:16,fastBoardSpeed:24,spacing:26};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const approach=(a,b,k)=>a+(b-a)*(1-Math.exp(-k));
// Identical cell IDs/positions for physics and rendering, independent of camera
// motion, frame rate and join time. No downloaded models or global board pool.
export function campusSurfboardCell(ix,iz){
  const seed=Math.sin(ix*127.1+iz*311.7)*43758.5453,h=seed-Math.floor(seed);
  return {id:`${ix}:${iz}`,x:ix*CAMPUS_SURF.spacing+5+h*13,z:iz*CAMPUS_SURF.spacing+5+(1-h)*13,yaw:h*Math.PI*2};
}
export function createCampusWaterMotion({state,groundAt,canOccupy=()=>true}={}){
  let flood=null,boardId=null,ride=null,window=null,seen=new Set();
  const floorAt=(p=state)=>groundAt(p.x,p.z,0,p.y).height;
  const sample=(p=state)=>sampleCampusFloodwater(p,{active:!!flood,elapsed:flood?.elapsed??0,front:flood?campusTsunamiFront(flood.elapsed):Infinity,reducedMotion:!!flood?.reducedMotion});
  function reset(){if(state.waterMode&&state.waterMode!=='dry')Object.assign(state,{vx:0,vz:0,speed:0,verticalSpeed:0,pitch:0,lean:0});boardId=null;ride=null;window=null;seen.clear();Object.assign(state,{waterMode:'dry',waterY:null,surfRemaining:0,surfWindowRemaining:0});}
  function setFlood(next){
    const valid=next&&Number.isFinite(next.elapsed)&&next.id;
    if((valid?next.id:null)!==(flood?.id??null))reset();
    flood=valid?next:null;
    if(!flood&&state.waterMode!=='dry')reset();
  }
  function boardAt(ix,iz){
    const b=campusSurfboardCell(ix,iz),water=sample(b);b.y=water.waterY+.12;
    return water.wet&&water.waterY-floorAt(b)>1.1&&canOccupy(b,.7)&&b.id!==boardId?b:null;
  }
  function nearbyBoard(){
    if(!flood||state.mode!=='walk'||state.waterMode==='dry')return null;
    let nearest=null,distance=4;
    const ix=Math.floor(state.x/CAMPUS_SURF.spacing),iz=Math.floor(state.z/CAMPUS_SURF.spacing);
    for(let x=ix-1;x<=ix+1;x++)for(let z=iz-1;z<=iz+1;z++){const b=boardAt(x,z);if(!b)continue;const d=Math.hypot(b.x-state.x,b.z-state.z);if(d<distance){distance=d;nearest=b;}}
    return nearest;
  }
  function toggleBoard(){
    if(!flood||flood.paused||state.mode!=='walk')return false;
    if(boardId){boardId=null;ride=null;state.waterMode='swim';state.surfRemaining=0;return true;}
    const b=nearbyBoard();if(!b||Math.abs(state.y-sample().waterY)>1.8)return false;
    boardId=b.id;state.waterMode='board';return true;
  }
  function updateWindow(){
    if(!flood||state.mode!=='walk')return;
    if(window&&flood.elapsed>=window.until)window=null;
    const u=(state.x-WAVE.x)/(WAVE.width/2),arc=u*u*WAVE.arcDepth;
    for(const w of flood.waves??[]){
      const id=`${w.slot}:${w.cycle}`,d=state.z-w.front-arc;
      if(!w.visible||seen.has(id))continue;
      // The first flood becomes swimmable behind the leading whitewater. Each
      // later crest offers the same two-second local catch opportunity.
      if(d>180+WAVE.speed*CAMPUS_SURF.window){seen.add(id);continue;}
      if(d>=180&&state.waterMode!=='dry'&&Math.abs(state.y-sample().waterY)<1.9){
        seen.add(id);if(!ride)window={id,until:flood.elapsed+clamp((180+WAVE.speed*2-d)/WAVE.speed,0,2)};
      }
    }
    state.surfWindowRemaining=window?Math.max(0,window.until-flood.elapsed):0;
  }
  function surf(){
    updateWindow();if(!flood||flood.paused||!window||state.surfWindowRemaining<=0||ride||state.mode!=='walk')return false;
    ride={start:flood.elapsed,end:flood.elapsed+CAMPUS_SURF.duration};window=null;boardId??='caught-wave';
    state.waterMode='surf';state.surfWindowRemaining=0;state.surfRemaining=5;state.yaw=0;return true;
  }
  function move(to,radius){
    const from={x:state.x,y:state.y,z:state.z},n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z)/.1));
    let blocked=false;
    for(let i=1;i<=n;i++){
      const p={x:from.x+(to.x-from.x)*i/n,y:from.y+(to.y-from.y)*i/n,z:from.z+(to.z-from.z)*i/n};
      if(!canOccupy(p,radius)){blocked=true;break;}
      state.x=p.x;state.y=p.y;state.z=p.z;
    }
    state.distance+=Math.hypot(state.x-from.x,state.z-from.z);
    if(blocked)state.blockedReason='前方障碍';return blocked;
  }
  function step(dt,input={}){
    if(!flood||state.mode!=='walk'){
      if(state.waterMode!=='dry')reset();return false;
    }
    const water=sample(),floor=floorAt(),deep=water.wet&&water.waterY>floor+.85;
    // Walking on a roof/bridge above the flood remains ordinary walking.
    if(!deep||state.y>water.waterY+1.5){
      if(state.waterMode!=='dry'){boardId=null;ride=null;window=null;state.vx=0;state.vz=0;state.speed=0;state.pitch=0;state.lean=0;}
      state.waterMode='dry';state.waterY=water.waterY;state.surfRemaining=0;state.surfWindowRemaining=0;return false;
    }
    if(flood.paused)return true;
    if(state.waterMode==='dry')state.waterMode='swim';
    if(ride&&flood.elapsed>=ride.end){ride=null;state.waterMode='board';state.surfRemaining=0;}
    if(input.swimVertical<0&&boardId){boardId=null;ride=null;state.waterMode='swim';}
    updateWindow();
    const surfing=!!ride,onBoard=!!boardId;
    const max=onBoard?(input.fast?CAMPUS_SURF.fastBoardSpeed:CAMPUS_SURF.boardSpeed):(input.fast?5:3.1);
    const mx=clamp(Number(input.moveX)||0,-1,1),mz=clamp(Number(input.moveZ)||0,-1,1);
    // The wave carries the board forward (-Z) in world space, regardless of
    // camera heading. Steering only trims laterally, never spins in place.
    const vx=surfing?mx*5:mx*max+.32*Math.sin(flood.elapsed*1.9+state.z*.03);
    const vz=surfing?-WAVE.speed:mz*max-.65;
    state.vx=surfing?vx:approach(state.vx||0,vx,dt*4);
    state.vz=surfing?vz:approach(state.vz||0,vz,dt*4);
    const target={x:state.x+state.vx*dt,z:state.z+state.vz*dt,y:state.y};
    const nextWater=sample(target),nextFloor=floorAt(target),vertical=clamp(Number(input.swimVertical)||0,-1,1);
    const surface=nextWater.waterY+(onBoard?.16:-1.15);
    const targetY=Math.max(nextFloor,onBoard?surface:vertical?state.y+vertical*3.6*dt:approach(state.y,surface,dt*2.8));
    target.y=onBoard?approach(state.y,targetY,dt*12):Math.min(nextWater.waterY-.65,targetY);
    target.y=Math.max(nextFloor,target.y);
    const oldY=state.y,blocked=move(target,onBoard?.7:.27);
    if(blocked){state.vx=0;state.vz=0;if(ride){ride=null;state.waterMode='board';}}
    state.waterMode=ride?'surf':onBoard?'board':'swim';state.waterY=sample().waterY;
    state.surfRemaining=ride?Math.max(0,ride.end-flood.elapsed):0;
    state.speed=Math.hypot(state.vx,state.vz);state.verticalSpeed=(state.y-oldY)/dt;state.grounded=false;
    if(state.speed>.1)state.yaw=Math.atan2(-state.vx,-state.vz);
    state.pitch=onBoard?-.025*Math.sin(flood.elapsed*2.4):0;state.lean=onBoard?clamp(-state.vx*.018,-.12,.12):0;
    state.flightPhase=state.waterMode;state.braking=false;return true;
  }
  reset();
  return {setFlood,step,sample,boardAt,nearbyBoard,toggleBoard,surf,reset,get active(){return !!flood;},get elapsed(){return flood?.elapsed??0;},get boardId(){return boardId;}};
}
