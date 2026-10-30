/* Runs before the unchanged story application in the activity build only. */
(() => {
  const declaredOrigins=__CAMPUS_ALLOWED_ORIGINS__;
  const params=new URLSearchParams(location.search);
  const embedded=parent!==window;
  let context=null;
  try {
    const saved=JSON.parse(sessionStorage.getItem('campus:tasay:context')||'null');
    const origin=params.get('campusParentOrigin')||saved?.origin;
    const attemptId=params.get('campusAttempt')||saved?.attemptId;
    if(embedded&&(origin===location.origin||declaredOrigins.includes(origin))&&/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId||'')){
      context={origin,attemptId};sessionStorage.setItem('campus:tasay:context',JSON.stringify(context));
    }
  } catch {}
  const send=(type,extra={})=>{if(context)parent.postMessage({type,workId:'tasay',attemptId:context.attemptId,...extra},context.origin);};
  if(!context)return;
  let paused=false,disposed=false,token=-1,ready=false;
  const timers=new Map(),frames=new Map(),audioContexts=new Set(),playingMedia=new Set();
  const native={setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window),setInterval:window.setInterval.bind(window),clearInterval:window.clearInterval.bind(window),raf:window.requestAnimationFrame.bind(window),caf:window.cancelAnimationFrame.bind(window)};
  const arm=(id,timer)=>{
    timer.due=performance.now()+timer.remaining;
    timer.native=native.setTimeout(()=>{
      if(paused||disposed)return;
      if(!timer.interval)timers.delete(id);
      try{timer.fn(...timer.args);}finally{if(timer.interval&&timers.has(id)){timer.remaining=timer.delay;arm(id,timer);}}
    },timer.remaining);
  };
  const schedule=(fn,delay,args,interval)=>{
    if(disposed)return token--;
    if(typeof fn!=='function')return interval?native.setInterval(fn,delay,...args):native.setTimeout(fn,delay,...args);
    const id=token--,duration=Math.max(interval?1:0,Number(delay)||0),timer={fn,args,delay:duration,remaining:duration,interval,native:null,due:0};
    timers.set(id,timer);if(!paused&&!disposed)arm(id,timer);return id;
  };
  window.setTimeout=(fn,delay,...args)=>schedule(fn,delay,args,false);
  window.setInterval=(fn,delay,...args)=>schedule(fn,delay,args,true);
  const cancel=id=>{const timer=timers.get(id);if(timer){native.clearTimeout(timer.native);timers.delete(id);}else{native.clearTimeout(id);native.clearInterval(id);}};
  window.clearTimeout=cancel;window.clearInterval=cancel;
  const armFrame=(id,frame)=>{frame.native=native.raf(time=>{frames.delete(id);if(!paused&&!disposed)frame.fn(time);});};
  window.requestAnimationFrame=fn=>{if(disposed)return token--;const id=token--,frame={fn,native:null};frames.set(id,frame);if(!paused&&!disposed)armFrame(id,frame);return id;};
  window.cancelAnimationFrame=id=>{const frame=frames.get(id);if(frame){native.caf(frame.native);frames.delete(id);}else native.caf(id);};
  for(const key of ['AudioContext','webkitAudioContext']){const Original=window[key];if(Original)window[key]=class extends Original{constructor(...args){super(...args);audioContexts.add(this);if(paused)this.suspend().catch(()=>{});}};}
  const style=document.createElement('style');style.textContent='html[data-campus-paused="true"] *,html[data-campus-paused="true"] *::before,html[data-campus-paused="true"] *::after{animation-play-state:paused!important;transition:none!important;}';document.head.append(style);
  function pause(value){
    if(paused===value)return;paused=value;
    document.documentElement.dataset.campusPaused=String(value);
    const app=document.getElementById('root');if(app)app.inert=value;
    if(value){
      document.exitPointerLock?.();document.activeElement?.blur?.();
      for(const timer of timers.values()){native.clearTimeout(timer.native);timer.remaining=Math.max(0,timer.due-performance.now());}
      for(const frame of frames.values())native.caf(frame.native);
      document.querySelectorAll('audio,video').forEach(media=>{if(!media.paused){playingMedia.add(media);media.pause();}});
      for(const audio of audioContexts)if(audio.state==='running')audio.suspend().catch(()=>{});
      window.speechSynthesis?.pause();
    }else{
      for(const [id,timer] of timers)arm(id,timer);for(const [id,frame] of frames)armFrame(id,frame);
      for(const media of playingMedia)if(media.isConnected)media.play().catch(()=>{});playingMedia.clear();
      for(const audio of audioContexts)if(audio.state==='suspended')audio.resume().catch(()=>{});
      window.speechSynthesis?.resume();
    }
  }
  function dispose(){
    if(disposed)return;
    pause(true);disposed=true;document.documentElement.dataset.campusDisposed='true';
    // Removing an iframe does not unmount React. Parent visualViewport/resize
    // listeners from useChatViewport otherwise retain the entire child document.
    window.dispatchEvent(new Event('campus:dispose'));
    for(const timer of timers.values())native.clearTimeout(timer.native);
    for(const frame of frames.values())native.caf(frame.native);
    timers.clear();frames.clear();observer.disconnect();
    native.clearInterval(handshake);native.clearTimeout(handshakeEnd);
    for(const audio of audioContexts)audio.close?.().catch(()=>{});
    audioContexts.clear();playingMedia.clear();window.speechSynthesis?.cancel();
    window.removeEventListener('message',onMessage);
  }
  function onMessage(event){
    if(disposed||event.source!==parent||event.origin!==context.origin||event.data?.attemptId!==context.attemptId)return;
    if(event.data?.type==='campus:activity'&&typeof event.data.paused==='boolean')pause(event.data.paused);
    if(event.data?.type==='campus:dispose')dispose();
  }
  window.addEventListener('message',onMessage);
  const reportReady=()=>{
    if(!disposed&&!ready&&document.querySelector('#root main')){ready=true;observer.disconnect();send('campus:ready',{level:'page_opened'});}
  };
  const observer=new MutationObserver(reportReady);observer.observe(document.documentElement,{childList:true,subtree:true});reportReady();
  // Only the React page is confirmed. No success/ending signal is manufactured.
  const handshake=native.setInterval(()=>{if(ready)send('campus:ready',{level:'page_opened'});},5000);
  const handshakeEnd=native.setTimeout(()=>native.clearInterval(handshake),30000);
  window.addEventListener('pagehide',dispose,{once:true});
  // BFCache restores the same JS realm after pagehide. Recreate the unmounted
  // activity with its existing storage/context instead of showing an empty root.
  window.addEventListener('pageshow',event=>{if(event.persisted&&disposed)location.reload();});
})();
