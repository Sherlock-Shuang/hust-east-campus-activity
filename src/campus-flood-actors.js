import {sampleCampusFloodwater} from './campus-floodwater.js';
import {CAMPUS_TSUNAMI_PLACEMENT as WAVE,campusTsunamiFront} from './campus-tsunami-timeline.js';

// Project each actor onto the same authoritative water field as the player.
// Source route/parking poses stay intact, so reset restores ordinary traffic.
export function sampleFloodActorPose(actor,flood,kind=actor.mode||actor.kind||actor.type){
  if(!flood?.id||!Number.isFinite(flood.elapsed)||kind==='spider')return actor;
  const water=sampleCampusFloodwater(actor,{active:true,elapsed:flood.elapsed,front:campusTsunamiFront(flood.elapsed),reducedMotion:!!flood.reducedMotion});
  const depth=water.waterY-(actor.y??0),person=kind==='walk',threshold=person?.65:.4;
  if(!water.wet||depth<=threshold)return actor;
  let hash=0;for(const c of String(actor.id??actor.colorIndex??0))hash=(hash*31+c.charCodeAt(0))>>>0;
  const phase=(hash%628)/100,t=flood.reducedMotion?0:flood.elapsed;
  const lift=Math.min(1,(depth-threshold)/1.1),u=(actor.x-WAVE.x)/(WAVE.width/2);
  const age=Math.max(0,(actor.z-u*u*WAVE.arcDepth-campusTsunamiFront(flood.elapsed))/WAVE.speed-4);
  const drift=flood.reducedMotion?0:Math.min(18,age*.65)*lift;
  const x=actor.x+Math.sin(phase)*drift*.3,z=actor.z-drift;
  const surface=sampleCampusFloodwater({x,z},{active:true,elapsed:flood.elapsed,front:campusTsunamiFront(flood.elapsed),reducedMotion:!!flood.reducedMotion});
  const dive=person&&hash%4===0&&!flood.reducedMotion?.7*(.5+.5*Math.sin(t*.65+phase)):0;
  return {...actor,x,z,y:Math.max(actor.y??0,surface.waterY-(person?.48:.26)-dive),
    yaw:(actor.yaw??0)+lift*(Math.sin(t*.43+phase)*.32),
    pitch:lift*(person?-1.02+.12*Math.sin(t*2+phase):.12*Math.sin(t*1.4+phase)),
    roll:lift*(person?.13*Math.sin(t*1.7+phase):.32*Math.sin(t*1.1+phase)),
    flooded:true,swimming:person,swimPhase:t*3.3+phase};
}
