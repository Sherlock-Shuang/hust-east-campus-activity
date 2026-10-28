const MODES = new Set(['auto', 'smooth', 'balanced', 'clear']);
const LEVELS = [
  {name:'流畅', ratio:.85, pixels:800000, shadowEnabled:false, shadowMapSize:512, shadowIntervalMs:200, reflectionEnabled:false, reflectionIntervalMs:500, detailDistanceScale:.45, trafficHz:15},
  {name:'均衡', ratio:1, pixels:1500000, shadowEnabled:true, shadowMapSize:1024, shadowIntervalMs:100, reflectionEnabled:false, reflectionIntervalMs:350, detailDistanceScale:.7, trafficHz:24},
  {name:'清晰', ratio:1.5, pixels:2800000, shadowEnabled:true, shadowMapSize:2048, shadowIntervalMs:65, reflectionEnabled:true, reflectionIntervalMs:200, detailDistanceScale:1, trafficHz:30},
];
const modeLevel = {smooth:0, balanced:1, clear:2};
const positive = value => Number.isFinite(value) && value > 0;
const safeMode = mode => MODES.has(mode) ? mode : 'auto';

/** A render budget, not a simulation clock. In auto, actual visible rendered
 * frames determine quality even when the player is standing still. Hardware
 * hints only choose a cautious starting point; they do not claim GPU speed.
 * Pass active:false while an activity/iframe owns the screen, and rendered:false
 * for intentional on-demand idle frames. targetFrameMs describes any deliberate
 * render cap, so a 30 Hz cap is not mistaken for a slow 60 Hz renderer. */
export function createPerformanceQuality({
  deviceRatio=1, handheld=false, hardwareConcurrency, deviceMemory,
  width=0, height=0, mode='auto',
}={}) {
  const nativeRatio=positive(deviceRatio)?deviceRatio:1;
  const limited=!!handheld||(positive(hardwareConcurrency)&&hardwareConcurrency<=4)||(positive(deviceMemory)&&deviceMemory<=4);
  const autoCeiling=limited?1:2, initialLevel=limited?0:1;
  let selected=safeMode(mode),level=selected==='auto'?initialLevel:modeLevel[selected];
  let pixelStep=0, viewportWidth=positive(width)?width:0, viewportHeight=positive(height)?height:0;
  let bucketMs=0,samples=0,cpuTotal=0,cpuSamples=0,slowSamples=0,healthyMs=0,warmupMs=0,severeFrames=0;
  let revision=0,lastAverageMs=0,lastCpuMs=0,lastReason='initial',budget;

  function clearWindow(){bucketMs=samples=cpuTotal=cpuSamples=slowSamples=0;}
  function clearEvidence(){clearWindow();healthyMs=0;severeFrames=0;}
  function refresh(){
    const preset=LEVELS[level],pixelCap=viewportWidth&&viewportHeight?Math.sqrt(preset.pixels/(viewportWidth*viewportHeight)):Infinity;
    // Each step is a small fraction of the tier's pixel budget. A 4K monitor can
    // go below 0.5 DPR because a hard minimum would defeat the pixel cap there.
    const base=Math.min(nativeRatio,handheld?1.25:1.5,preset.ratio,pixelCap);
    const pixelRatio=Number(Math.max(Math.min(nativeRatio,.25,base),base*(1-pixelStep*.125)).toFixed(3));
    const next={mode:selected,level,name:preset.name,pixelRatio,
      shadowEnabled:preset.shadowEnabled,shadowMapSize:preset.shadowMapSize,shadowIntervalMs:preset.shadowIntervalMs,
      reflectionEnabled:preset.reflectionEnabled&&!handheld,reflectionIntervalMs:preset.reflectionIntervalMs,
      detailDistanceScale:preset.detailDistanceScale,trafficHz:preset.trafficHz};
    if(!budget||Object.keys(next).some(key=>next[key]!==budget[key]))budget=Object.freeze({...next,revision:++revision});
    return budget;
  }
  refresh();
  return {
    get budget(){return budget;},
    get state(){return {mode:selected,level,pixelStep,averageMs:lastAverageMs,cpuMs:lastCpuMs,healthyMs,reason:lastReason};},
    setMode(value){
      const next=safeMode(value);if(next===selected)return budget;
      selected=next;level=selected==='auto'?initialLevel:modeLevel[selected];pixelStep=0;warmupMs=0;
      clearEvidence();lastReason='selection';return refresh();
    },
    setViewport(nextWidth,nextHeight){
      if(!positive(nextWidth)||!positive(nextHeight))return budget;
      if(viewportWidth===nextWidth&&viewportHeight===nextHeight)return budget;
      viewportWidth=nextWidth;viewportHeight=nextHeight;clearEvidence();lastReason='viewport';return refresh();
    },
    resetSamples(){clearEvidence();warmupMs=0;},
    update({elapsedMs,cpuMs,visible=true,active=true,rendered=true,targetFrameMs=1000/60}={}){
      if(!visible||!active||!rendered){clearEvidence();return budget;}
      // A single loading gap is ignored. Several consecutive visible draws at
      // 0.5–4 fps are real pressure too; weak GPUs must not get stuck forever.
      if(!positive(elapsedMs)||elapsedMs>2000){clearEvidence();return budget;}
      if(selected!=='auto')return budget;
      if(elapsedMs>250){
        clearWindow();healthyMs=0;
        if(++severeFrames>=3){
          if(level>0){level--;pixelStep=0;}else pixelStep=Math.min(4,pixelStep+1);
          severeFrames=0;lastReason='sustained-stall';return refresh();
        }
        return budget;
      }
      severeFrames=0;
      warmupMs+=elapsedMs;if(warmupMs<800)return budget;
      const target=positive(targetFrameMs)?Math.max(8,Math.min(50,targetFrameMs)):1000/60;
      bucketMs+=elapsedMs;samples++;
      if(Number.isFinite(cpuMs)&&cpuMs>=0){cpuTotal+=Math.min(cpuMs,250);cpuSamples++;}
      if(elapsedMs>Math.max(27,target*1.65))slowSamples++;
      if(bucketMs<1000||samples<5)return budget;
      const average=bucketMs/samples,cpuAverage=cpuSamples?cpuTotal/cpuSamples:0;
      const pressure=average>Math.max(24,target*1.45)||slowSamples/samples>=.35;
      const healthy=average<Math.max(18,target*1.08)&&(!cpuSamples||cpuAverage<target*.85);
      lastAverageMs=average;lastCpuMs=cpuAverage;
      if(pressure){
        healthyMs=0;
        if(level>0){level--;pixelStep=0;lastReason=cpuAverage>target?'main-thread-pressure':'frame-pressure';}
        else if(pixelStep<4){pixelStep++;lastReason='pixel-pressure';}
      }else if(healthy){
        healthyMs+=bucketMs;
        if(healthyMs>=20000){
          if(pixelStep>0){pixelStep--;lastReason='pixel-recovery';}
          else if(level<autoCeiling){level++;lastReason='quality-recovery';}
          healthyMs=0;
        }
      }else healthyMs=0;
      clearWindow();return refresh();
    },
  };
}

/** Reduce visual-only work without starving input/physics. It returns the time
 * since the last admitted visual update, never a catch-up loop. Stop this clock
 * with active:false while hidden/frozen; the first resumed frame starts clean. */
export function createWorkCadence({hz=30,maxDeltaMs=150}={}){
  let elapsed=0,phase=0;
  return {
    reset(){elapsed=phase=0;},
    step({elapsedMs,hz:nextHz=hz,active=true,force=false}={}){
      if(!active||!Number.isFinite(elapsedMs)||elapsedMs<0||elapsedMs>250){elapsed=phase=0;return 0;}
      const rate=positive(nextHz)?Math.min(120,nextHz):30;
      elapsed+=elapsedMs;phase+=elapsedMs;
      const interval=1000/rate;
      if(!force&&phase+1e-6<interval)return 0;
      const admitted=Math.min(elapsed,positive(maxDeltaMs)?maxDeltaMs:150);
      // Keep fractional timing phase (24 Hz on a 60 Hz display), but return only
      // real time since this work last ran. Never replay one dt twice.
      phase=force?0:Math.max(0,phase-interval*Math.max(1,Math.floor((phase+1e-6)/interval)));
      elapsed=0;return admitted/1000;
    },
  };
}
