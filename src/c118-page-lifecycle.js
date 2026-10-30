// A BFCache entry retains its renderer, position and activity identity. Only a
// real unload disposes the room; restored pages resume the existing runtime.
export function createC118PageLifecycle({window,onSuspend=()=>{},onResume=()=>{},onDispose=()=>{}}){
  let disposed=false,suspended=false;
  const hide=event=>{
    if(disposed)return;
    if(!event.persisted){onDispose();return;}
    if(suspended)return;suspended=true;onSuspend();
  };
  const show=event=>{
    if(disposed||!event.persisted||!suspended)return;
    suspended=false;onResume();
  };
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  return {get suspended(){return suspended;},dispose(){if(disposed)return;disposed=true;window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);}};
}
