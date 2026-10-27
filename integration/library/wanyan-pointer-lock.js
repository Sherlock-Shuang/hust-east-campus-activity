/* Activity copy only: unsupported pointer lock is not a Unity resource error. */
(() => {
  const refusals=new Set(['WrongDocumentError','NotAllowedError','SecurityError','NotSupportedError','InvalidStateError','AbortError']);
  const wrapped=new WeakSet();let fallback=false;
  // This is called only inside the native requestPointerLock catch boundary.
  // Chromium can reject with DOMException UnknownError; it still means that
  // this optional browser capability failed, not that the game failed.
  function nativeRefusal(error){return !!error&&(refusals.has(error.name)||(typeof DOMException==='function'&&error instanceof DOMException));}
  function runtimeRefusal(error){
    const text=String(error?.message||error||'');
    return /pointer\s*lock|requestPointerLock/i.test(text)&&/WrongDocumentError|NotAllowedError|SecurityError|NotSupportedError|InvalidStateError|AbortError/.test(text);
  }
  function enableFallback(){
    if(fallback)return;fallback=true;
    document.documentElement.dataset.campusPointerLock='unavailable';
    document.getElementById('unity-canvas')?.focus?.({preventScroll:true});
    console.info('Pointer lock is unavailable in this browser. Ordinary mouse and keyboard input remain active.');
  }
  function install(target){
    if(!target||wrapped.has(target))return;wrapped.add(target);
    const native=target.requestPointerLock;
    if(typeof native!=='function'){enableFallback();return;}
    target.requestPointerLock=function(...args){
      if(fallback)return;
      try{
        const pending=native.apply(this,args);
        if(pending&&typeof pending.then==='function')return pending.catch(error=>{
          if(nativeRefusal(error)){enableFallback();return;}
          throw error;
        });
        return pending;
      }catch(error){
        if(nativeRefusal(error)){enableFallback();return;}
        throw error;
      }
    };
  }
  window.campusPointerLock={install,handleRuntimeError(error){
    if(!runtimeRefusal(error))return false;
    enableFallback();return true;
  }};
})();
