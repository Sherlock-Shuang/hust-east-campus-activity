import {createDefaultLiveState} from './live-state.js';

// Every new stream receives a full snapshot. Own reconnection rather than using
// EventSource's common fixed delay: a whole room can lose Wi-Fi at once.
export function createLiveClient({onState=()=>{},onConnection=()=>{},fetchImpl=fetch,EventSourceImpl=globalThis.EventSource,
  clock=()=>Date.now(),monotonic=()=>performance.now(),random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout,
  documentImpl=globalThis.document,windowImpl=globalThis.window}={}) {
  let state=createDefaultLiveState(),serverAnchor=clock(),timeAnchor=monotonic(),lastSync=0,hasSynced=false,nextSyncAt=0;
  let shownTime=serverAnchor,shownAt=timeAnchor,wallObserved=clock(),monoObserved=timeAnchor,clockEpoch=0,clockGap=false;
  let source,disposed=false,connected,connectionAttempt=null,retryTimer,syncTimer,inflight,failures=0,offline=false,pageHidden=false,needsSync=true,generation=0;
  const unavailable=()=>disposed||offline||pageHidden||documentImpl?.hidden===true;
  const listeners=[];
  const jitter=()=>Math.max(0,Math.min(1,Number(random())||0));
  function status(value){if(!disposed&&connected!==value){connected=value;onConnection(value);}}
  function serverNow(){
    const mono=monotonic(),elapsed=Math.max(0,mono-shownAt),ordinary=shownTime+elapsed,target=serverAnchor+mono-timeAnchor;
    // RTT estimates can move backwards when a slow response is followed by a
    // fast one. Slew at 0.9–1.1x instead of rewinding or freezing the timeline.
    shownTime=ordinary+Math.max(-elapsed*.1,Math.min(elapsed*.1,target-ordinary));shownAt=Math.max(shownAt,mono);
    return shownTime;
  }
  function observeClockGap(){
    const wall=clock(),mono=monotonic(),gap=(wall-wallObserved)-(mono-monoObserved);
    wallObserved=wall;monoObserved=mono;
    // performance.now can stop while the OS sleeps on some platforms. Wall
    // time is only a wake-up hint; it never becomes the authoritative clock.
    if(Math.abs(gap)>2000){clockGap=true;clockEpoch++;}
  }
  function calibrate(serverTime,roundTrip){
    const shown=serverNow(),mono=monotonic();serverAnchor=serverTime+roundTrip/2;timeAnchor=mono;lastSync=mono;
    // The first correction may replace an inaccurate device clock. After an
    // observed sleep, catch up forwards to trusted server time immediately;
    // a backwards correction always slews and never rewinds an active event.
    if(!hasSynced||(clockGap&&serverAnchor>shown)){shownTime=serverAnchor;shownAt=mono;}
    clockGap=false;wallObserved=clock();monoObserved=mono;
  }
  function accept(payload,roundTrip){
    if(disposed||!payload?.state||!Number.isSafeInteger(payload.state.revision)||payload.state.revision<0||!Number.isFinite(payload.serverTime))return false;
    if(roundTrip!==undefined)calibrate(payload.serverTime,roundTrip);
    if(payload.state.revision<state.revision)return true;
    state=payload.state;onState(state,{serverTime:payload.serverTime,onlineCount:payload.onlineCount});
    return true;
  }
  function synchronize(){
    if(unavailable())return Promise.resolve(false);
    if(inflight)return inflight.promise;
    const started=monotonic(),abort=new AbortController(),request={abort,clockEpoch,generation};
    request.timeout=setTimer(()=>abort.abort(),8000);inflight=request;
    request.promise=(async()=>{
      try{
        const response=await fetchImpl('/api/live/state',{cache:'no-store',signal:abort.signal});
        if(!response.ok)throw new Error('活动服务尚未连接');
        const payload=await response.json();
        if(unavailable()||abort.signal.aborted||inflight!==request||request.generation!==generation||request.clockEpoch!==clockEpoch)return false;
        if(!accept(payload,monotonic()-started))throw new Error('活动状态无效');
        hasSynced=true;
        if(unavailable()||request.generation!==generation)return false;
        needsSync=false;nextSyncAt=monotonic()+55000+jitter()*10000;
        return true;
      }finally{
        clearTimer(request.timeout);if(inflight===request)inflight=null;
        if(request.generation===generation&&request.clockEpoch!==clockEpoch)scheduleSync();
      }
    })();
    return request.promise;
  }
  function closeSource(){const old=source;source=null;old?.close();}
  function scheduleSync(){
    if(unavailable()||syncTimer!==undefined||inflight)return;
    // Clock messages and foreground transitions from hundreds of browsers must
    // not all issue the extra RTT calibration GET in the same instant.
    syncTimer=setTimer(()=>{syncTimer=undefined;synchronize().catch(()=>{});},100+jitter()*900);
  }
  function scheduleReconnect({fresh=false,foreground=false}={}){
    if(unavailable()||source||connectionAttempt)return;
    if(retryTimer!==undefined){if(!fresh)return;clearTimer(retryTimer);}
    if(fresh)failures=0;
    const ceiling=Math.min(30000,1000*2**Math.min(failures++,5));
    const delay=foreground?100+jitter()*900:ceiling*(.5+.5*jitter());
    retryTimer=setTimer(()=>{retryTimer=undefined;void connect();},delay);
  }
  async function connect(){
    if(unavailable()||source||connectionAttempt)return;
    const attempt={generation};connectionAttempt=attempt;
    try{
      // Initial/foreground calibration gives a trusted current clock and state.
      // Ordinary SSE reconnects already include a snapshot and need no extra GET.
      if((needsSync||!hasSynced)&&!await synchronize())return;
      if(unavailable()||connectionAttempt!==attempt||attempt.generation!==generation)return;
      if(!EventSourceImpl)throw new Error('当前浏览器不支持活动连接');
      const current=new EventSourceImpl('/api/live/events');source=current;
      const active=()=>!unavailable()&&source===current&&attempt.generation===generation;
      current.addEventListener('snapshot',event=>{
        if(!active())return;
        try{
          const valid=accept(JSON.parse(event.data));if(!active())return;status(valid);
          if(valid){failures=0;if(monotonic()>=nextSyncAt)scheduleSync();}
        }catch{if(active())status(false);}
      });
      current.addEventListener('clock',()=>{if(active()){observeClockGap();if(clockGap||monotonic()>=nextSyncAt)scheduleSync();}});
      current.addEventListener('error',()=>{
        if(!active())return;
        closeSource();status(false);scheduleReconnect();
      });
    }catch{if(!unavailable()&&connectionAttempt===attempt)status(false);}
    finally{if(connectionAttempt===attempt){connectionAttempt=null;if(!unavailable()&&!source)scheduleReconnect();}}
  }
  // Hidden pages release the serverless stream, not only the renderer. Keep
  // the last state/clock for a seamless return, then fetch a fresh authoritative
  // snapshot before reconnecting. Epochs reject adapters that resolve after abort.
  function suspend(){
    generation++;needsSync=true;connectionAttempt=null;
    clearTimer(retryTimer);retryTimer=undefined;clearTimer(syncTimer);syncTimer=undefined;
    const pending=inflight;inflight=null;
    if(pending){clearTimer(pending.timeout);pending.abort.abort();}
    closeSource();status(false);
  }
  const resume=()=>{
    if(unavailable())return;
    if(!source){scheduleReconnect({fresh:true,foreground:true});return;}
    if(clockGap||!hasSynced||monotonic()-lastSync>=15000)scheduleSync();
  };
  const visibility=()=>{observeClockGap();if(documentImpl?.hidden)suspend();else resume();};
  const online=()=>{observeClockGap();offline=false;if(unavailable())return;if(!source)scheduleReconnect({fresh:true});else resume();};
  const lostNetwork=()=>{offline=true;suspend();};
  const pagehide=()=>{pageHidden=true;suspend();};
  const pageshow=()=>{pageHidden=false;observeClockGap();resume();};
  for(const [target,event,handler] of [[documentImpl,'visibilitychange',visibility],[windowImpl,'online',online],[windowImpl,'offline',lostNetwork],[windowImpl,'pagehide',pagehide],[windowImpl,'pageshow',pageshow]]){
    target?.addEventListener(event,handler);if(target)listeners.push(()=>target.removeEventListener(event,handler));
  }
  void connect();
  return {get state(){return state;},get connected(){return !!connected;},now:serverNow,
    dispose(){
      if(disposed)return;disposed=true;connected=false;suspend();listeners.forEach(remove=>remove());
    }};
}
