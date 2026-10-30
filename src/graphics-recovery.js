// Application state stays alive while Three.js restores its WebGL context.
// The fallback is an explicit user action; never reload in a recovery loop.
export function createGraphicsRecovery({canvas,onLost=()=>{},onRestored=()=>{},onStatus=()=>{},
  setTimer=setTimeout,clearTimer=clearTimeout,timeoutMs=12000}={}) {
  let lost=false,disposed=false,timer,losses=0;
  const cancel=()=>{if(timer!==undefined)clearTimer(timer);timer=undefined;};
  const lose=event=>{
    event.preventDefault?.();if(disposed||lost)return;
    lost=true;losses++;onLost();onStatus('restoring');cancel();
    timer=setTimer(()=>{timer=undefined;if(lost&&!disposed)onStatus('reload-available');},timeoutMs);
  };
  const restore=()=>{
    if(disposed||!lost)return;cancel();
    try{onRestored();lost=false;onStatus('ready');}
    catch{onStatus('reload-available');}
  };
  canvas.addEventListener('webglcontextlost',lose);
  canvas.addEventListener('webglcontextrestored',restore);
  return {get suspended(){return lost;},get lossCount(){return losses;},
    dispose(){if(disposed)return;disposed=true;cancel();canvas.removeEventListener('webglcontextlost',lose);canvas.removeEventListener('webglcontextrestored',restore);}};
}
