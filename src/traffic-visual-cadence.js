// The traffic simulation and player inputs continue at their own fixed rates.
// Only rebuilding visible commuter instances is bounded by this cadence.
export function createTrafficVisualCadence(hz=60){
  let interval=1/60,elapsed=0;
  function setHz(value){const next=1/Math.max(1,Math.min(60,Number.isFinite(value)?value:60));if(next===interval)return false;interval=next;elapsed=interval;return true;}
  setHz(hz);elapsed=interval;
  return {
    setHz,
    invalidate(){elapsed=interval;},
    advance(dt){if(Number.isFinite(dt)&&dt>0)elapsed=Math.min(interval*2,elapsed+dt);},
    take(){if(elapsed+1e-9<interval)return false;elapsed=Math.max(0,elapsed%interval);return true;},
  };
}
