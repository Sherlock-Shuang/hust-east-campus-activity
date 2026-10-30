import {createLiveClient} from './live-client.js';

// Embedded rooms share the campus connection; direct room URLs subscribe once.
// Both clocks continue from a server anchor, never from a player's wall clock.
export function createC118ActivitySync({embedded,bridge,onState,monotonic=()=>performance.now(),liveClientFactory=createLiveClient}){
  let disposed=false,anchor=0,anchorAt=monotonic(),live=null,unsubscribe=()=>{};
  const accept=state=>{
    if(disposed)return;
    if(Number.isFinite(state.serverTime)){anchor=state.serverTime;anchorAt=monotonic();}
    onState(state);
  };
  if(embedded){
    unsubscribe=bridge?.subscribe(accept)||(()=>{});
  }else{
    live=liveClientFactory({onState:(state,info)=>accept({...state,disposed:false,serverTime:live?.now()??info.serverTime})});
  }
  return {
    now:()=>live?live.now():anchor+monotonic()-anchorAt,
    dispose(){if(disposed)return;disposed=true;unsubscribe();live?.dispose();},
  };
}
