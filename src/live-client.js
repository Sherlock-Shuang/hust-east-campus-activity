import {createDefaultLiveState} from './live-state.js';

// Reconnects receive a complete snapshot; the browser never depends on having
// witnessed the original announcement or the moment a portal was opened.
export function createLiveClient({onState=()=>{},onConnection=()=>{},fetchImpl=fetch,EventSourceImpl=globalThis.EventSource,clock=()=>Date.now(),monotonic=()=>performance.now()}={}) {
  let state=createDefaultLiveState(),serverAnchor=clock(),timeAnchor=monotonic(),lastSync=0,syncing=false,source,disposed=false,connected,retry;
  const listeners=[];
  function status(value){if(!disposed&&connected!==value){connected=value;onConnection(value);}}
  function accept(payload,roundTrip){
    if(disposed||!payload?.state||!Number.isSafeInteger(payload.state.revision)||payload.state.revision<0||!Number.isFinite(payload.serverTime))return false;
    if(payload.state.revision<state.revision)return true;
    if(roundTrip!==undefined){serverAnchor=payload.serverTime+roundTrip/2;timeAnchor=monotonic();lastSync=timeAnchor;}
    state=payload.state;onState(state,{serverTime:payload.serverTime,onlineCount:payload.onlineCount});
    return true;
  }
  async function synchronize(){
    if(syncing)return;syncing=true;
    const started=monotonic(),abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),8000);
    try{
      const response=await fetchImpl('/api/live/state',{cache:'no-store',signal:abort.signal});
      if(!response.ok)throw new Error('活动服务尚未连接');
      const payload=await response.json();
      if(!payload?.state||!Number.isFinite(payload.serverTime))throw new Error('活动状态无效');
      if(!disposed)accept(payload,monotonic()-started);
    }finally{clearTimeout(timeout);syncing=false;}
  }
  function reconnect(){
    if(disposed||retry!=null)return;
    retry=setTimeout(()=>{retry=undefined;connect();},10000);
  }
  async function connect(){
    if(disposed)return;
    try {
      await synchronize();if(disposed)return;
      if(!EventSourceImpl)throw new Error('当前浏览器不支持活动连接');
      const current=new EventSourceImpl('/api/live/events');source=current;
      const active=()=>!disposed&&source===current;
      current.addEventListener('snapshot',event=>{if(!active())return;try{status(accept(JSON.parse(event.data)));}catch{status(false);}});
      current.addEventListener('open',()=>{if(active())synchronize().catch(()=>{});});
      current.addEventListener('clock',()=>{if(active()&&monotonic()-lastSync>60000)synchronize().catch(()=>{});});
      current.addEventListener('error',()=>{
        if(!active())return;
        status(false);
        // CONNECTING retries automatically; CLOSED (for example after an HTTP
        // error or invalid content type) needs a new EventSource instance.
        if(current.readyState===2){source=undefined;current.close();reconnect();}
      });
    }catch{if(!disposed){status(false);reconnect();}}
  }
  const resume=()=>{if(globalThis.document?.hidden)return;synchronize().catch(()=>status(false));};
  if(globalThis.document){document.addEventListener('visibilitychange',resume);listeners.push(()=>document.removeEventListener('visibilitychange',resume));}
  connect();
  return {get state(){return state;},get connected(){return !!connected;},now:()=>serverAnchor+monotonic()-timeAnchor,
    dispose(){disposed=true;clearTimeout(retry);source?.close();listeners.forEach(remove=>remove());}};
}
