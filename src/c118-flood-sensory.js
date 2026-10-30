import './c118-flood-sensory.css';

const clamp=(v,min=0,max=1)=>Math.min(max,Math.max(min,Number.isFinite(v)?v:0));
const smooth=(a,b,v)=>{const x=clamp((v-a)/(b-a));return x*x*(3-2*x);};

/** A synchronized illustration envelope, not an acoustic/fluid simulation. */
export function sampleC118FloodSensory({active=false,elapsed=-1,waterDepth=0,impact=0,reducedMotion=false}={}){
  const t=Number.isFinite(elapsed)?elapsed:-1;
  if(!active||t<0)return {wash:0,spray:0,rush:0,rumble:0,cutoff:1300,driftX:0,driftY:0,shimmer:0};
  const depth=smooth(-.08,1.1,waterDepth),hit=clamp(impact);
  const arrival=smooth(.25,2.7,t),settle=smooth(9,20,t);
  const flow=arrival*(1-settle*.12)*(.94+.06*Math.sin(t*1.17));
  return {
    wash:depth*.32,
    spray:clamp(hit*.85+flow*.2)*(1-depth*.55),
    rush:(flow*.25+hit*.21)*(1-depth*.62),
    rumble:arrival*.085+hit*.13+depth*.045,
    cutoff:1300*(1-depth)+340*depth,
    driftX:reducedMotion?0:Math.sin(t*.47)*5,
    driftY:reducedMotion?0:Math.sin(t*.31+.6)*3,
    shimmer:reducedMotion?.12:(.15+.08*Math.sin(t*.63))*depth,
  };
}

/** Local sensory layer. Audio is created only by an explicit unlock() gesture. */
export function createC118FloodSensory({document=globalThis.document,window=globalThis.window}={}){
  const layer=document.createElement('div');layer.className='c118-flood-sensory';
  layer.setAttribute('aria-hidden','true');layer.hidden=true;
  const wash=document.createElement('div');wash.className='c118-flood-wash';
  const shimmer=document.createElement('div');shimmer.className='c118-flood-shimmer';
  const lens=document.createElement('div');lens.className='c118-flood-lens';
  // Small translucent edge droplets leave the central screen and exits readable.
  const droplets=[
    [3,18,23,1.7,-14],[8,47,12,2.2,7],[2,73,31,1.3,-6],
    [18,5,15,1.65,12],[40,2,8,2.1,20],[71,5,20,1.7,-12],
    [93,15,27,1.9,9],[97,44,13,2.4,-8],[92,75,22,1.4,18],
    [76,96,33,1.3,-18],[49,98,15,1.65,10],[19,94,24,1.45,-8],
  ];
  for(const [x,y,size,stretch,angle] of droplets){
    const drop=document.createElement('i');drop.className='c118-flood-drop';
    drop.style.left=`${x}%`;drop.style.top=`${y}%`;
    drop.style.width=`${size}px`;drop.style.height=`${size*stretch}px`;
    drop.style.transform=`rotate(${angle}deg)`;lens.append(drop);
  }
  layer.append(wash,shimmer,lens);document.body.append(layer);
  let disposed=false,audio=null,resuming=null,lastPaint=-Infinity,visible=false;
  let state={active:false,elapsed:-1,waterDepth:0,impact:0,reducedMotion:false};

  function makeAudio(){
    const Context=window?.AudioContext||window?.webkitAudioContext;
    if(!Context)return null;
    const context=new Context({latencyHint:'interactive'}),sampleRate=context.sampleRate;
    const buffer=context.createBuffer(2,Math.round(sampleRate*3),sampleRate);
    // Deterministic broad-band water noise with a soft low-frequency body.
    // No downloaded samples, voice, oscillator tone or per-frame audio nodes.
    for(let channel=0;channel<2;channel++){
      const data=buffer.getChannelData(channel);let seed=8317+channel*911,brown=0,mean=0,peak=0;
      for(let i=0;i<data.length;i++){
        seed=(Math.imul(seed,1664525)+1013904223)>>>0;
        const white=seed/2147483648-1;brown=(brown+.025*white)/1.025;
        data[i]=white*.23+brown*3.1;mean+=data[i];
      }
      mean/=data.length;
      for(let i=0;i<data.length;i++){data[i]-=mean;peak=Math.max(peak,Math.abs(data[i]));}
      const seam=Math.round(sampleRate*.045);
      for(let i=0;i<seam;i++){
        const blend=i/(seam-1),at=data.length-seam+i;
        data[at]=data[at]*(1-blend)+data[i]*blend;
      }
      for(let i=0;i<data.length;i++)data[i]*=.78/Math.max(.01,peak);
    }
    const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
    const rushFilter=context.createBiquadFilter();rushFilter.type='lowpass';rushFilter.frequency.value=1300;rushFilter.Q.value=.55;
    const rumbleFilter=context.createBiquadFilter();rumbleFilter.type='bandpass';rumbleFilter.frequency.value=68;rumbleFilter.Q.value=.65;
    const rush=context.createGain(),rumble=context.createGain(),master=context.createGain();
    rush.gain.value=0;rumble.gain.value=0;master.gain.value=0;
    const compressor=context.createDynamicsCompressor();
    compressor.threshold.value=-17;compressor.knee.value=13;compressor.ratio.value=3;
    compressor.attack.value=.015;compressor.release.value=.24;
    source.connect(rushFilter);rushFilter.connect(rush);rush.connect(master);
    source.connect(rumbleFilter);rumbleFilter.connect(rumble);rumble.connect(master);
    master.connect(compressor);compressor.connect(context.destination);source.start();
    return {context,source,rushFilter,rumbleFilter,rush,rumble,master,compressor};
  }
  const target=(param,value,time,smoothing=.07)=>{
    param.cancelScheduledValues(time);param.setTargetAtTime(value,time,smoothing);
  };
  function silence(){
    if(!audio||audio.context.state==='closed')return;
    const now=audio.context.currentTime;
    audio.master.gain.cancelScheduledValues(now);audio.master.gain.setValueAtTime(0,now);
  }
  function apply(force=false){
    if(disposed)return;
    const active=Boolean(state.active)&&!document.hidden,frame=sampleC118FloodSensory({...state,active});
    const shown=active&&state.elapsed>=0;
    if(visible!==shown){visible=shown;layer.hidden=!shown;force=true;}
    // Bounded DOM updates; transforms remain tied to shared event time.
    if(force||Math.abs(state.elapsed-lastPaint)>=.05){
      lastPaint=state.elapsed;
      layer.style.setProperty('--flood-wash',String(frame.wash));
      layer.style.setProperty('--flood-spray',String(frame.spray));
      layer.style.setProperty('--flood-shimmer',String(frame.shimmer));
      layer.style.setProperty('--flood-drift-x',`${frame.driftX}px`);
      layer.style.setProperty('--flood-drift-y',`${frame.driftY}px`);
    }
    if(!audio||audio.context.state==='closed')return;
    if(!shown){silence();return;}
    const now=audio.context.currentTime;
    target(audio.master.gain,.56,now,.09);
    target(audio.rush.gain,frame.rush,now);
    target(audio.rumble.gain,frame.rumble,now,.12);
    target(audio.rushFilter.frequency,frame.cutoff,now,.1);
    target(audio.rumbleFilter.frequency,62+Math.sin(state.elapsed*.22)*7,now,.15);
  }
  const visibility=()=>apply(true);
  document.addEventListener('visibilitychange',visibility);
  return {
    unlock(){
      if(disposed)return Promise.resolve(false);
      if(!audio){try{audio=makeAudio();}catch{return Promise.resolve(false);}}
      if(!audio)return Promise.resolve(false);
      if(resuming)return resuming;
      try{
        resuming=Promise.resolve(audio.context.resume()).then(()=>{
          if(disposed)return false;apply(true);return audio.context.state==='running';
        },()=>false).finally(()=>{resuming=null;});
        return resuming;
      }catch{return Promise.resolve(false);}
    },
    update(next){
      if(disposed)return;
      const before=state;state={...state,...next};
      state.elapsed=Number.isFinite(state.elapsed)?state.elapsed:-1;
      state.waterDepth=Number.isFinite(state.waterDepth)?state.waterDepth:0;
      state.impact=clamp(state.impact);
      apply(before.active!==state.active||before.reducedMotion!==state.reducedMotion);
    },
    dispose(){
      if(disposed)return;disposed=true;document.removeEventListener('visibilitychange',visibility);
      silence();layer.remove();
      if(audio){
        try{audio.source.stop();}catch{}
        for(const key of ['source','rushFilter','rumbleFilter','rush','rumble','master','compressor'])audio[key].disconnect();
        Promise.resolve(audio.context.close()).catch(()=>{});
      }
    },
  };
}
