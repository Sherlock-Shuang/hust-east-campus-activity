/* Activity-only Unity canvas/lifecycle budget. No combat, save or victory edits. */
(() => {
  'use strict';
  const win=window,doc=document;
  const scales=[1,.88,.76,.64];
  const requested=new URLSearchParams(win.location.search).get('wanyanResolution');
  const mode=['original','fixed'].includes(requested)?requested:'adaptive';
  let libraryPaused=false,active=null;
  const coarse=()=>win.matchMedia?.('(pointer: coarse)').matches||win.navigator.maxTouchPoints>0||win.innerWidth<=900;
  const constrained=()=>coarse()||(win.navigator.hardwareConcurrency>0&&win.navigator.hardwareConcurrency<=4)||(win.navigator.deviceMemory>0&&win.navigator.deviceMemory<=4);
  const canvas=()=>doc.getElementById('unity-canvas');
  const dimensions=()=>{const c=canvas();return [c?.clientWidth||win.innerWidth||960,c?.clientHeight||win.innerHeight||600,win.devicePixelRatio||1];};
  function chooseRatio(width,height,nativeRatio){
    // Respect physical pixel budgets even on large native screens. Desktop
    // no longer supersamples a small window to 1440p before measuring its GPU.
    const weak=constrained(),pixels=Math.max(1,width)*Math.max(1,height);
    if(mode==='original')return Math.min(Math.max(1,nativeRatio||1),coarse()?1.1:2,Math.max(1,Math.sqrt(2560*1440/pixels)));
    return Math.max(.5,Math.min(Math.max(.5,nativeRatio||1),weak?1:1.5,Math.sqrt((weak?1280*800:1920*1080)/pixels)));
  }
  win.bookrealmChoosePixelRatio=chooseRatio;
  win.bookrealmRenderPixelRatio=()=>chooseRatio(...dimensions());
  win.campusWanyanSetLibrarySuspended=value=>{libraryPaused=!!value;active?.sync();};
  win.bookrealmAttachRenderQuality=instance=>{
    if(!instance?.Module)return null;
    if(active)return active.controller;
    const module=instance.Module,removers=[];
    let hostPaused=false,disposed=false,enginePaused=false,resuming=false;
    let level=0,ratio=0,frame=0,resizeTimer=0,resumeFrame=0,generation=0,quitPromise;
    let last=0,warmUntil=0,windowStart=0,total=0,count=0,slow=0,badWindows=0,goodWindows=0,changes=0;
    const canPause=typeof module.pauseMainLoop==='function'&&typeof module.resumeMainLoop==='function';
    const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);removers.push(()=>target.removeEventListener(type,fn,options));};
    const causes=()=>[hostPaused&&'host',libraryPaused&&'library',doc.hidden&&'hidden'].filter(Boolean);
    function controls(value){
      win.bookrealmControlsSuspended=value;
      doc.documentElement.dataset.controlsSuspended=String(value);
    }
    function resetSamples(now=win.performance.now(),warmup=1800){
      last=0;warmUntil=now+warmup;windowStart=0;total=0;count=0;slow=0;badWindows=0;goodWindows=0;
    }
    function applyRatio(){
      const next=Math.round(Math.max(.5,chooseRatio(...dimensions())*scales[level])*1000)/1000;
      if(Math.abs(next-ratio)<.001)return;
      ratio=next;module.devicePixelRatio=ratio;module.matchWebGLToCanvasSize=true;
      doc.documentElement.dataset.wanyanRenderPixelRatio=ratio.toFixed(3);
      doc.documentElement.dataset.wanyanResolutionLevel=String(level);
    }
    function monitor(now){
      frame=0;if(disposed||enginePaused||resuming)return;
      frame=win.requestAnimationFrame(monitor);
      const state=win.bookrealmNativeControls,dt=last?now-last:0;last=now;
      // Ignore startup compilation, resume, menu/upgrade overlays and a single
      // long interruption. Quality only follows sustained active-game load.
      if(mode!=='adaptive'||now<warmUntil||!state?.started||state.paused||state.choosing||state.ended||dt<=0||dt>250){windowStart=0;total=0;count=0;slow=0;return;}
      if(!windowStart)windowStart=now;
      total+=dt;count++;if(dt>25)slow++;
      if(now-windowStart<2000||count<30)return;
      const average=total/count,slowShare=slow/count;
      badWindows=average>23&&slowShare>.22?badWindows+1:0;
      goodWindows=average<18.4&&slowShare<.06?goodWindows+1:0;
      windowStart=0;total=0;count=0;slow=0;
      let next=level;
      if(badWindows>=2&&level<scales.length-1)next++;
      else if(goodWindows>=10&&level>0)next--;
      if(next!==level){level=next;changes++;applyRatio();resetSamples(now,1800);}
    }
    function startMonitor(){if(!frame&&!disposed&&!enginePaused&&!resuming)frame=win.requestAnimationFrame(monitor);}
    function sync(){
      if(disposed)return;
      const reasons=causes(),suspended=reasons.length>0;
      doc.documentElement.dataset.wanyanSuspendReason=reasons.join(',');
      if(suspended){
        generation++;win.cancelAnimationFrame(resumeFrame);resumeFrame=0;resuming=false;
        controls(true);win.cancelAnimationFrame(frame);frame=0;
        // Module is the real compiled Emscripten main loop, not a CSS hide.
        // Unsupported players retain their original native suspension path.
        if(!enginePaused&&canPause){module.pauseMainLoop();enginePaused=true;}
        doc.documentElement.dataset.wanyanEngineSuspended=String(enginePaused);
      }else if(enginePaused){
        // Unity must consume its existing suspended-input boundary before we
        // release it. Its first post-background delta never moves the player.
        // No timescale, target FPS, cooldown or combat timestep is modified.
        enginePaused=false;resuming=true;controls(true);
        const token=++generation;let observed=win.bookrealmNativeControls,settledFrames=0;module.resumeMainLoop();
        doc.documentElement.dataset.wanyanEngineSuspended='false';
        const settle=()=>{
          resumeFrame=0;if(disposed||token!==generation)return;
          // This immutable object is republished by actual Unity LateUpdate.
          // Counting identities, not rAF callbacks, works at native 30 FPS too.
          const state=win.bookrealmNativeControls;
          if(state&&state!==observed){observed=state;if(state.suspended)settledFrames++;}
          if(settledFrames<2){resumeFrame=win.requestAnimationFrame(settle);return;}
          resuming=false;controls(causes().length>0);resetSamples();startMonitor();
        };
        resumeFrame=win.requestAnimationFrame(settle);
      }else if(!resuming){controls(false);startMonitor();}
    }
    function resize(){
      win.clearTimeout(resizeTimer);
      resizeTimer=win.setTimeout(()=>{resizeTimer=0;if(!disposed){applyRatio();resetSamples();}},160);
    }
    function dispose(){
      if(disposed)return quitPromise;disposed=true;generation++;
      win.cancelAnimationFrame(frame);win.cancelAnimationFrame(resumeFrame);win.clearTimeout(resizeTimer);
      frame=0;resumeFrame=0;resizeTimer=0;removers.splice(0).forEach(remove=>remove());
      controls(true);doc.documentElement.dataset.wanyanPerformanceDisposed='true';
      // Quit is serviced by Unity's loop; resume a frozen loop only to let it
      // release native/WebGL resources. Controls remain suspended throughout.
      if(enginePaused){module.resumeMainLoop();enginePaused=false;}
      try{quitPromise=Promise.resolve(instance.Quit?.());}catch(error){quitPromise=Promise.reject(error);}
      quitPromise.catch(()=>{});return quitPromise;
    }
    const controller={setPaused(value){hostPaused=!!value;sync();},dispose,
      snapshot(){return {mode,ratio,level,changes,enginePaused,resuming,disposed,hostPaused,libraryPaused,hidden:doc.hidden,canPause,monitorScheduled:!!frame};}};
    active={sync,controller};win.campusWanyanPerformance=controller;
    listen(win,'resize',resize,{passive:true});listen(doc,'fullscreenchange',resize);
    listen(doc,'visibilitychange',sync);listen(win,'pagehide',dispose,{once:true});
    applyRatio();resetSamples(win.performance.now(),4000);sync();
    return controller;
  };
})();
