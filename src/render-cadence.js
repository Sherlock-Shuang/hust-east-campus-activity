// Admit draws without changing input, physics, animation or event clocks.
// Keep fractional phase on 90/120/144 Hz displays; never catch up missed draws.
export function createRenderCadence() {
  let due=NaN,last=NaN,rate=0;
  return {
    reset(){due=last=NaN;rate=0;},
    shouldRender(nowMs,fps=60){
      if(!Number.isFinite(nowMs))return false;
      const next=Math.max(1,Math.min(240,Number(fps)||60)),interval=1000/next;
      // RAF timestamps jitter around the display deadline. A sub-millisecond
      // early callback must not turn a 60 Hz display into alternating skipped
      // frames. Retain the deadline phase rather than accelerating the clock.
      const tolerance=Math.min(1,interval*.06);
      if(next!==rate||!Number.isFinite(due)||nowMs<last||nowMs-last>1000){rate=next;due=nowMs;}
      last=nowMs;
      if(nowMs+tolerance<due)return false;
      due+=interval*Math.max(1,Math.floor((nowMs-due)/interval)+1);
      return true;
    },
  };
}
