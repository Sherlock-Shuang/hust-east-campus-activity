// A control page needs live updates only while it is visible and signed in.
// Start the next refresh after the previous one settles; never queue catch-up
// requests after a background tab or BFCache return.
export function createAdminPolling({documentImpl=globalThis.document,windowImpl=globalThis.window,
  canPoll=()=>true,refresh,render=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,
  pollMs=5000,renderMs=1000}={}){
  let disposed=false,pageHidden=false,pollTimer,renderTimer,generation=0,inFlight=false,refreshOnReturn=false;
  const available=()=>!disposed&&!pageHidden&&!documentImpl?.hidden&&canPoll();
  function stop(){generation++;refreshOnReturn=false;clearTimer(pollTimer);clearTimer(renderTimer);pollTimer=renderTimer=undefined;}
  function schedulePoll(version){
    if(version!==generation||!available()||pollTimer!==undefined)return;
    pollTimer=setTimer(()=>{pollTimer=undefined;void runPoll(version);},pollMs);
  }
  async function runPoll(version){
    if(version!==generation||!available())return;
    if(inFlight){refreshOnReturn=true;return;}
    inFlight=true;
    try{await refresh();}catch{/* The page owns its connection/error feedback. */}
    finally{inFlight=false;if(refreshOnReturn&&available()){refreshOnReturn=false;void runPoll(generation);}else schedulePoll(version);}
  }
  function scheduleRender(version){
    if(version!==generation||!available()||renderTimer!==undefined)return;
    renderTimer=setTimer(()=>{renderTimer=undefined;if(version!==generation||!available())return;render();scheduleRender(version);},renderMs);
  }
  function sync({immediate=false}={}){
    stop();if(!available())return;
    const version=generation;render();scheduleRender(version);
    if(immediate)void runPoll(version);else schedulePoll(version);
  }
  const visibility=()=>sync({immediate:!documentImpl?.hidden});
  const hide=()=>{pageHidden=true;sync();};
  const show=()=>{pageHidden=false;sync({immediate:true});};
  documentImpl?.addEventListener('visibilitychange',visibility);
  windowImpl?.addEventListener('pagehide',hide);windowImpl?.addEventListener('pageshow',show);
  sync();
  return {sync,dispose(){if(disposed)return;disposed=true;stop();documentImpl?.removeEventListener('visibilitychange',visibility);windowImpl?.removeEventListener('pagehide',hide);windowImpl?.removeEventListener('pageshow',show);}};
}
