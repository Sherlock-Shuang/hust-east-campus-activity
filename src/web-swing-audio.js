// Small original procedural effects. Audio is opt-in, created by the sound
// button's user gesture, and stops whenever traversal is paused or exited.
export function createWebSwingAudio(){
  let context=null,enabled=false,active=false,noise=null,wind=null,windGain=null,lastCount=0,lastZip=0,lastPoint=0,lastLaunch=0,lastTrick=0,lastPhase='',disposed=false;
  function initialize(){
    const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return false;
    context=new Audio();noise=context.createBuffer(1,context.sampleRate*2,context.sampleRate);
    const data=noise.getChannelData(0);let previous=0;
    for(let i=0;i<data.length;i++){previous=(previous+Math.random()*.04-.02)/1.02;data[i]=previous*3.5;}
    wind=context.createBufferSource();wind.buffer=noise;wind.loop=true;
    const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1700;
    windGain=context.createGain();windGain.gain.value=0;wind.connect(filter).connect(windGain).connect(context.destination);wind.start();return true;
  }
  function burst(frequency,duration,level){
    if(!context||!enabled||!active)return;
    const at=context.currentTime,source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    source.buffer=noise;filter.type='bandpass';filter.frequency.setValueAtTime(frequency,at);filter.frequency.exponentialRampToValueAtTime(Math.max(100,frequency*.4),at+duration);filter.Q.value=.9;
    gain.gain.setValueAtTime(.001,at);gain.gain.exponentialRampToValueAtTime(level,at+.012);gain.gain.exponentialRampToValueAtTime(.001,at+duration);
    source.connect(filter).connect(gain).connect(context.destination);source.start(at);source.stop(at+duration+.02);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  async function setEnabled(value){
    if(disposed)return false;
    if(value&&!context&&!initialize())return false;
    enabled=!!value;
    if(enabled)try{await context.resume();}catch{enabled=false;}
    if(!enabled&&windGain)windGain.gain.setTargetAtTime(0,context.currentTime,.04);
    return enabled;
  }
  function setActive(value){active=!!value;if(!active&&windGain)windGain.gain.setTargetAtTime(0,context.currentTime,.04);}
  function tick(state){
    if(enabled&&active&&context){
      const strength=Math.min(1,Math.hypot(state.vx||0,state.vz||0,state.verticalSpeed||0)/32);
      windGain.gain.setTargetAtTime(state.grounded?.005:strength*strength*.10,context.currentTime,.18);
      if(state.swingCount>lastCount)burst(2100,.13,.16);
      if(state.zipCount>lastZip){burst(2600,.10,.15);burst(950,.25,.12);}
      if(state.pointCount>lastPoint)burst(2400,.18,.13);
      if(state.pointLaunchCount>lastLaunch){burst(220,.13,.10);burst(1000,.28,.12);}
      if(state.trickCount>lastTrick)burst(1800,.13,.045);
      if(state.traversalPhase==='release'&&lastPhase!=='release')burst(650,.25,.10);
      if(state.traversalPhase==='landing'&&lastPhase!=='landing')burst(170,.19,.12);
    }
    lastCount=state.swingCount||0;lastZip=state.zipCount||0;lastPoint=state.pointCount||0;lastLaunch=state.pointLaunchCount||0;lastTrick=state.trickCount||0;lastPhase=state.traversalPhase;
  }
  return {setEnabled,setActive,tick,get enabled(){return enabled;},dispose(){disposed=true;enabled=false;wind?.stop();wind?.disconnect();windGain?.disconnect();context?.close();}};
}
