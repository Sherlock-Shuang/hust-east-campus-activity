import {createDefaultLiveState} from './live-state.js';

// Every new stream receives a full snapshot. Own reconnection rather than using
// EventSource's common fixed delay: a whole room can lose Wi-Fi at once.
export function createLiveClient({onState=()=>{},onConnection=()=>{},fetchImpl=fetch,EventSourceImpl=globalThis.EventSource,
  clock=()=>Date.now(),monotonic=()=>performance.now(),random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout,
  documentImpl=globalThis.document,windowImpl=globalThis.window}={}) {
  let state=createDefaultLiveState(),serverAnchor=clock(),timeAnchor=monotonic(),lastSync=0,hasSynced=false,nextSyncAt=0;
  let shownTime=serverAnchor,shownAt=timeAnchor,wallObserved=clock(),monoObserved=timeAnchor,clockEpoch=0,clockGap=false;
  let source,disposed=false,connected,connecting=false,retryTimer,syncTimer,inflight,failures=0,offline=false;
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
    if(disposed||offline)return Promise.resolve(false);
    if(inflight)return inflight.promise;
    const started=monotonic(),abort=new AbortController(),request={abort,clockEpoch};
    request.timeout=setTimer(()=>abort.abort(),8000);inflight=request;
    request.promise=(async()=>{
      try{
        const response=await fetchImpl('/api/live/state',{cache:'no-store',signal:abort.signal});
        if(!response.ok)throw new Error('活动服务尚未连接');
        const payload=await response.json();
        if(disposed||abort.signal.aborted||request.clockEpoch!==clockEpoch)return false;
        if(!accept(payload,monotonic()-started))throw new Error('活动状态无效');
        hasSynced=true;nextSyncAt=monotonic()+55000+jitter()*10000;
        return true;
      }finally{
        clearTimer(request.timeout);if(inflight===request)inflight=null;
        if(request.clockEpoch!==clockEpoch)scheduleSync();
      }
    })();
    return request.promise;
  }
  function closeSource(){const old=source;source=null;old?.close();}
  function scheduleSync(){
    if(disposed||offline||syncTimer!==undefined||inflight)return;
    // Clock messages and foreground transitions from hundreds of browsers must
    // not all issue the extra RTT calibration GET in the same instant.
    syncTimer=setTimer(()=>{syncTimer=undefined;synchronize().catch(()=>{});},100+jitter()*900);
  }
  function scheduleReconnect({fresh=false}={}){
    if(disposed||offline||source||connecting)return;
    if(retryTimer!==undefined){if(!fresh)return;clearTimer(retryTimer);}
    if(fresh)failures=0;
    const ceiling=Math.min(30000,1000*2**Math.min(failures++,5));
    retryTimer=setTimer(()=>{retryTimer=undefined;void connect();},ceiling*(.5+.5*jitter()));
  }
  async function connect(){
    if(disposed||offline||source||connecting)return;
    connecting=true;
    try{
      // Initial RTT calibration is useful. Repeating it on every SSE open adds
      // two COUNT queries per participant without improving the full snapshot.
      if(!hasSynced)await synchronize();
      if(disposed||offline)return;
      if(!EventSourceImpl)throw new Error('当前浏览器不支持活动连接');
      const current=new EventSourceImpl('/api/live/events');source=current;
      const active=()=>!disposed&&source===current;
      current.addEventListener('snapshot',event=>{
        if(!active())return;
        try{
          const valid=accept(JSON.parse(event.data));status(valid);
          if(valid){failures=0;if(monotonic()>=nextSyncAt)scheduleSync();}
        }catch{status(false);}
      });
      current.addEventListener('clock',()=>{if(active()){observeClockGap();if(clockGap||monotonic()>=nextSyncAt)scheduleSync();}});
      current.addEventListener('error',()=>{
        if(!active())return;
        closeSource();status(false);scheduleReconnect();
      });
    }catch{if(!disposed)status(false);}
    finally{connecting=false;if(!disposed&&!offline&&!source)scheduleReconnect();}
  }
  const resume=()=>{
    observeClockGap();
    if(disposed||offline||documentImpl?.hidden)return;
    if(!source){scheduleReconnect({fresh:true});return;}
    if(clockGap||!hasSynced||monotonic()-lastSync>=15000)scheduleSync();
  };
  const online=()=>{observeClockGap();offline=false;if(!source)scheduleReconnect({fresh:true});else resume();};
  const lostNetwork=()=>{
    offline=true;clearTimer(retryTimer);retryTimer=undefined;clearTimer(syncTimer);syncTimer=undefined;
    closeSource();inflight?.abort.abort();status(false);
  };
  for(const [target,event,handler] of [[documentImpl,'visibilitychange',resume],[windowImpl,'online',online],[windowImpl,'offline',lostNetwork]]){
    target?.addEventListener(event,handler);if(target)listeners.push(()=>target.removeEventListener(event,handler));
  }
  void connect();
  return {get state(){return state;},get connected(){return !!connected;},now:serverNow,
    dispose(){
      disposed=true;inflight?.abort.abort();if(inflight)clearTimer(inflight.timeout);inflight=null;
      clearTimer(retryTimer);clearTimer(syncTimer);closeSource();listeners.forEach(remove=>remove());
    }};
}
