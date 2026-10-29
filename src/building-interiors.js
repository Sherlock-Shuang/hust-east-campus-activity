// Building exploration is independent of hosted works and never emits a game
// opening/completion event. It is still subject to the host's shared pause.
export function nearbyInterior(entries,state){
  if(!state||!['walk','spider'].includes(state.mode)||!Number.isFinite(state.y))return null;
  let selected=null,best=Infinity;
  for(const entry of entries||[]){
    if(!entry||!['x','z'].every(k=>Number.isFinite(entry[k])))continue;
    const distance=Math.hypot(state.x-entry.x,state.z-entry.z);
    if(distance<=Math.min(12,entry.radius||6)&&Math.abs(state.y-(entry.y??.14))<2.2&&distance<best){selected={...entry,kind:'building-interior',workId:'opto-c118',url:'./c118.html'};best=distance;}
  }
  return selected;
}
