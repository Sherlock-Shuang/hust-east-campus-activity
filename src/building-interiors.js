// Building exploration is independent of hosted works and never emits a game
// opening/completion event. It is still subject to the host's shared pause.
const onFoot=state=>state&&['walk','spider'].includes(state.mode)&&['x','y','z'].every(k=>Number.isFinite(state[k]))&&state.grounded!==false;
const portal=entry=>({...entry,kind:'building-interior',workId:'opto-c118',url:/^\.\/c118\.html(?:\?view=(?:westEntry|eastEntry|rearEntry|c1Lobby|c2Lobby))?$/.test(entry.url||'')?entry.url:'./c118.html'});
function gatePosition(gate,state){
  if(!gate||!['x','z'].every(k=>Number.isFinite(gate.center?.[k])&&Number.isFinite(gate.normal?.[k])))return null;
  const length=Math.hypot(gate.normal.x,gate.normal.z);
  if(length<.99||length>1.01||!['halfWidth','frontDepth','backDepth'].every(k=>Number.isFinite(gate[k])&&gate[k]>0))return null;
  const x=state.x-gate.center.x,z=state.z-gate.center.z;
  return {depth:x*gate.normal.x+z*gate.normal.z,side:x*-gate.normal.z+z*gate.normal.x};
}
export function nearbyInterior(entries,state){
  if(!onFoot(state))return null;
  let selected=null,best=Infinity;
  for(const entry of entries||[]){
    if(!entry||!['x','z'].every(k=>Number.isFinite(entry[k])))continue;
    const distance=Math.hypot(state.x-entry.x,state.z-entry.z);
    if(entry.doorGate){
      const p=gatePosition(entry.doorGate,state);
      if(!p||Math.abs(p.side)>entry.doorGate.halfWidth||p.depth>entry.doorGate.frontDepth||p.depth< -entry.doorGate.backDepth||Math.abs(state.y-(entry.y??.14))>.4)continue;
    }else if(distance>Math.min(12,entry.radius||6)||Math.abs(state.y-(entry.y??.14))>=2.2)continue;
    if(distance<best){selected=portal(entry);best=distance;}
  }
  return selected;
}

/** Only a real outside-to-inside crossing opens a room. Initial placement,
 * turning, walking past a side wall, flying over it, or returning never do. */
export function crossedInteriorDoor(entries,previous,current){
  if(!onFoot(previous)||!onFoot(current)||previous.mode!==current.mode)return null;
  for(const entry of entries||[]){
    const a=gatePosition(entry.doorGate,previous),b=gatePosition(entry.doorGate,current);
    if(!a||!b||a.depth<=0||b.depth>0||a.depth>entry.doorGate.frontDepth+1||Math.hypot(current.x-previous.x,current.z-previous.z)>6)continue;
    if(Math.abs(previous.y-entry.y)>.4||Math.abs(current.y-entry.y)>.4)continue;
    const t=a.depth/(a.depth-b.depth),side=a.side+(b.side-a.side)*t;
    if(Math.abs(side)>entry.doorGate.halfWidth-.18)continue;
    return portal(entry);
  }
  return null;
}

/** Keep the selected character/view, but stop its momentum outside the door. */
export function interiorReturnSnapshot(saved,entry){
  const pose=entry?.returnPose;
  if(!saved||!pose||!['x','y','z'].every(k=>Number.isFinite(pose[k])))return saved;
  const facing=['opto-c1','opto-c2'].includes(entry.id)&&Number.isFinite(pose.yaw)?{lookHeading:pose.yaw,yawOffset:0,pitch:0,manualPitch:true}:{};
  return {...saved,...facing,state:{...saved.state,...('lookHeading' in facing?{yaw:pose.yaw}:{}),x:pose.x,y:pose.y,z:pose.z,vx:0,vz:0,speed:0,verticalSpeed:0,grounded:true}};
}

/** Exit identities are resolved against host-owned doors, never iframe coordinates. */
export function interiorExitEntry(opened,entries,returnEntryId){
  if(opened?.kind!=='building-interior'||opened.workId!=='opto-c118'||!['opto-c1','opto-c2'].includes(returnEntryId))return opened;
  return entries?.find(entry=>entry.id===returnEntryId&&entry.workId==='opto-c118')||opened;
}
