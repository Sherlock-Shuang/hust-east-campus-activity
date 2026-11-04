import {walkingAnimationSpeed} from './player-walking-pose.js';
const finite=Number.isFinite;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const profiles={paved:{tone:68,decay:28,noise:.58,smooth:.52},grass:{tone:44,decay:23,noise:.68,smooth:.88},wood:{tone:116,decay:34,noise:.3,smooth:.68},metal:{tone:176,decay:23,noise:.23,smooth:.38}};

// A bounded, dry shoe impact; no music, voices, sustained tones or downloaded
// samples. Fixed seeded variants avoid per-step buffers and random test drift.
export function createFootstepSample(sampleRate,surface='paved',variant=0){
  const profile=profiles[surface]||profiles.paved,length=Math.ceil(sampleRate*.15),samples=new Float32Array(length);
  let seed=1327+variant*7919,filtered=0;
  for(let i=0;i<length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const t=i/sampleRate,noise=seed/2**31-1;filtered=filtered*profile.smooth+noise*(1-profile.smooth);
    const attack=Math.min(1,t/.0025),heel=Math.exp(-t*profile.decay),sole=Math.exp(-t*48);
    const thud=Math.sin(2*Math.PI*profile.tone*(1+variant*.035)*t)*Math.exp(-t*42);
    samples[i]=attack*(filtered*profile.noise*heel+noise*.035*sole+thud*.28)*(1-i/length);
  }
  return samples;
}

export function createWalkingStepTracker(){
  let previous=null,phase=0;
  const reset=()=>{previous=null;phase=0;};
  function tick(state,{dt,phase:visualPhase}={}){
    const moving=state?.mode==='walk'&&state.grounded!==false&&(!state.waterMode||state.waterMode==='dry')&&state.speed>.12&&finite(state.distance);
    if(!moving){reset();return null;}
    const current={distance:state.distance,speed:state.speed,x:state.x,z:state.z,y:state.y,elapsed:state.elapsed};
    const suppliedPhase=finite(visualPhase);
    if(!previous){phase=suppliedPhase?visualPhase:0;previous={...current,phase};return null;}
    const delta=current.distance-previous.distance,elapsed=finite(dt)?dt:finite(current.elapsed)&&finite(previous.elapsed)?current.elapsed-previous.elapsed:1/60;
    const displacement=finite(current.x)&&finite(current.z)&&finite(previous.x)&&finite(previous.z)?Math.hypot(current.x-previous.x,current.z-previous.z):delta;
    const relocated=finite(current.y)&&finite(previous.y)&&Math.abs(current.y-previous.y)>.5;
    if(delta<0||delta>1||displacement>1||Math.abs(displacement-delta)>.3||elapsed>.2||elapsed<0||relocated){reset();return null;}
    const average=(previous.speed+current.speed)/2;
    const nextPhase=suppliedPhase?visualPhase:phase+delta*walkingAnimationSpeed(average)/Math.max(average,.001)*5.2;
    const before=Math.floor((phase-Math.PI/2)/Math.PI),after=Math.floor((nextPhase-Math.PI/2)/Math.PI);
    phase=nextPhase;previous={...current,phase};
    // Never queue missed impacts after a long frame or activity return.
    if(elapsed<=0||delta<=1e-7||after<=before||after-before>1)return null;
    return{foot:after%2===0?'left':'right',speed:current.speed,phase,index:after};
  }
  return{tick,reset};
}

export function createPlayerFootstepAudio({surfaceAt,volume=.11,AudioContext:Context=globalThis.AudioContext||globalThis.webkitAudioContext}={}){
  const tracker=createWalkingStepTracker(),voices=new Set();
  let context=null,master=null,buffers=null,resuming=null,enabled=false,active=false,disposed=false,level=finite(volume)?clamp(volume,0,.35):.11,steps=0;
  function silence(){
    if(master&&context){master.gain.cancelScheduledValues(context.currentTime);master.gain.setValueAtTime(0,context.currentTime);}
    for(const voice of voices){try{voice.source.stop();}catch{}voice.source.disconnect();voice.gain.disconnect();}
    voices.clear();tracker.reset();
  }
  function apply(){if(master&&context){master.gain.cancelScheduledValues(context.currentTime);master.gain.setValueAtTime(enabled&&active?level:0,context.currentTime);}}
  async function unlock(){
    if(disposed||!Context)return false;
    if(resuming)return resuming;
    try{
      if(!context){
        context=new Context();master=context.createGain();master.gain.value=0;master.connect(context.destination);buffers={};
        for(const surface of Object.keys(profiles))buffers[surface]=[0,1].map(variant=>{
          const data=createFootstepSample(context.sampleRate,surface,variant),buffer=context.createBuffer(1,data.length,context.sampleRate);buffer.getChannelData(0).set(data);return buffer;
        });
      }
      resuming=Promise.resolve(context.resume()).then(()=>{if(disposed)return false;apply();return context.state==='running';}).catch(()=>false).finally(()=>{resuming=null;});
      return resuming;
    }catch{
      master?.disconnect();if(context)Promise.resolve(context.close()).catch(()=>{});context=null;master=null;buffers=null;return false;
    }
  }
  function setEnabled(value){const next=!!value;if(next===enabled||disposed)return;enabled=next;if(!enabled)silence();else{tracker.reset();apply();}}
  function setActive(value){const next=!!value;if(next===active||disposed)return;active=next;if(!active)silence();else{tracker.reset();apply();}}
  function tick(state,options={}){
    if(disposed||!enabled||!active||!context||context.state!=='running'){tracker.reset();return null;}
    const step=tracker.tick(state,options);if(!step)return null;
    const requested=options.surface??surfaceAt?.(state),surface=profiles[requested]?requested:'paved';
    const source=context.createBufferSource(),gain=context.createGain(),at=context.currentTime;
    source.buffer=buffers[surface][steps++%2];source.playbackRate.value=step.foot==='left'?.98:1.02;
    gain.gain.value=.58+.32*clamp((step.speed-1)/4.2,0,1);source.connect(gain).connect(master);
    const voice={source,gain};voices.add(voice);source.onended=()=>{source.disconnect();gain.disconnect();voices.delete(voice);};
    source.start(at);source.stop(at+.17);return{...step,surface};
  }
  return{unlock,setEnabled,setActive,tick,reset(){silence();apply();},setVolume(value){if(finite(value)){level=clamp(value,0,.35);apply();}},
    get enabled(){return enabled;},get unlocked(){return !!context&&context.state==='running';},
    dispose(){if(disposed)return;disposed=true;enabled=false;active=false;silence();master?.disconnect();if(context)Promise.resolve(context.close()).catch(()=>{});buffers=null;}};
}
