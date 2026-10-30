// A browser may stop RAF completely while a page is hidden. Observe the actual
// visibility event, not a hypothetical hidden frame, to avoid advancing physics
// by a capped 100 ms on the first frame after a long background pause.
export function createVisibilityFrameClock({document,now=()=>performance.now(),maxDelta=.1}={}) {
  let previous=now(),boundary=!!document?.hidden;
  const changed=()=>{boundary=true;};
  document?.addEventListener('visibilitychange',changed);
  return {
    sample(timestamp){
      const hidden=!!document?.hidden,resumed=!hidden&&boundary;
      const elapsed=hidden||boundary?0:Math.max(0,timestamp-previous);
      previous=timestamp;boundary=hidden;
      return {hidden,resumed,elapsed,dt:Math.min(elapsed/1000,maxDelta)};
    },
    reset(){previous=now();boundary=true;},
    dispose(){document?.removeEventListener('visibilitychange',changed);},
  };
}
