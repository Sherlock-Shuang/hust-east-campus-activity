/** Lock ownership comes from the browser's element, never from a request alone.
 * Older embedded browsers use prefixed APIs or omit one of the terminal events. */
export function createPlayerPointerLock({canvas,document,canLock=()=>true,onChange=()=>{},onError=()=>{},onPendingChange=()=>{},requestTimeoutMs=3000,timers=globalThis}){
  let pending=false,wanted=false,disposed=false,requestId=0,confirmed=false,observedOwned=false,releasing=false,lastError=null,current=null,lastAttempt=null;
  // Browser requests cannot be cancelled. These guards outlive the UI request
  // so cancellation/timeout/disposal can still release a delayed browser grant.
  const awaiting=new Map(),changes=['pointerlockchange','mozpointerlockchange','webkitpointerlockchange'],errors=['pointerlockerror','mozpointerlockerror','webkitpointerlockerror'];
  const timeout=Number.isFinite(requestTimeoutMs)&&requestTimeoutMs>0?requestTimeoutMs:3000;
  const method=(owner,names)=>names.map(name=>owner[name]).find(value=>typeof value==='function');
  const requestMethod=()=>method(canvas,['requestPointerLock','mozRequestPointerLock','webkitRequestPointerLock']);
  const exitMethod=()=>method(document,['exitPointerLock','mozExitPointerLock','webkitExitPointerLock']);
  const locked=()=>(document.pointerLockElement||document.mozPointerLockElement||document.webkitPointerLockElement)===canvas;
  const supported=()=>!!requestMethod()&&!!exitMethod();
  const browserWindow=document.defaultView;
  function cleanup(){for(const name of changes)document.removeEventListener(name,changed);for(const name of errors)document.removeEventListener(name,error);document.removeEventListener('visibilitychange',visibilityChanged);browserWindow?.removeEventListener('blur',release);}
  function cleanupIfDone(){if(disposed&&!awaiting.size&&!locked())cleanup();}
  function setPending(value){if(value===pending)return;pending=value;if(!disposed)onPendingChange(value);}
  function clearCurrent(){if(current?.timer!==undefined)timers.clearTimeout(current.timer);current=null;setPending(false);}
  function normalizeError(reason,name='PointerLockError',message='The browser did not allow pointer lock.'){
    if(reason instanceof Error)return reason;
    const result=new Error(typeof reason?.message==='string'?reason.message:typeof reason==='string'?reason:message);
    result.name=typeof reason?.name==='string'&&reason.name?reason.name:name;return result;
  }
  function report(reason){lastError=reason;if(!disposed){onError(reason);if(!locked())onChange(false);}}
  function exitLock(){try{exitMethod()?.call(document);if(!locked())changed();}catch(reason){report(normalizeError(reason));}}
  function changed(request){
    const next=locked();
    if(next){
      if(!observedOwned){
        observedOwned=true;
        // A change event has no request ID. It can settle at most one legacy
        // request; Promise requests retain their own settlement guard.
        const granted=typeof request==='number'?awaiting.get(request):[...awaiting.values()].find(attempt=>!attempt.grantSeen);
        if(granted){granted.grantSeen=true;if(granted.kind==='event'||granted.fulfilled)awaiting.delete(granted.id);}
      }
      if(disposed||!wanted||!canLock()||document.hidden){wanted=false;releasing=true;exitLock();clearCurrent();cleanupIfDone();return false;}
      clearCurrent();
      lastError=null;
      if(!confirmed){confirmed=true;onChange(true);}
      return true;
    }
    observedOwned=false;
    if(confirmed||releasing){confirmed=false;releasing=false;wanted=false;clearCurrent();if(!disposed)onChange(false);}
    cleanupIfDone();return false;
  }
  function failed(id,reason,terminal=true){
    if(terminal)awaiting.delete(id);
    if(current?.id!==id){
      if(terminal&&id===requestId&&wanted&&!disposed&&!current){
        if(locked())changed();else{wanted=false;report(normalizeError(reason));}
      }
      cleanupIfDone();return;
    }
    if(locked()){changed();return;}
    // A deadline means "not yet confirmed", not a denied permission. Preserve
    // the user's intent if an actual permission prompt is still being answered.
    if(terminal)wanted=false;
    lastError=normalizeError(reason);clearCurrent();
    report(lastError);cleanupIfDone();
  }
  function error(event){
    // A Promise rejection identifies its request; its companion error event
    // does not. A delayed event from the last rejection must not cancel retry.
    const attempt=current||lastAttempt;
    if(attempt?.kind==='promise')return;
    if(current?.kind==='calling'){current.earlyError={reason:event?.error};return;}
    const failedLegacy=[...awaiting.values()].find(value=>value.kind==='event'&&!value.grantSeen);
    if(failedLegacy)failed(failedLegacy.id,event?.error);
    cleanupIfDone();
  }
  function visibilityChanged(){if(document.hidden)release();}
  for(const name of changes)document.addEventListener(name,changed);
  for(const name of errors)document.addEventListener(name,error);
  document.addEventListener('visibilitychange',visibilityChanged);browserWindow?.addEventListener('blur',release);
  function request(){
    if(disposed||!canLock()||document.hidden||pending)return false;
    if(locked()){wanted=true;changed();return true;}
    if(!supported()){report(normalizeError(null,'NotSupportedError','This browser does not expose pointer lock.'));return false;}
    lastError=null;wanted=true;
    const attempt={id:++requestId,kind:'calling',timer:undefined,earlyError:null,grantSeen:false,fulfilled:false};current=lastAttempt=attempt;awaiting.set(attempt.id,attempt);setPending(true);
    try{
      const result=requestMethod().call(canvas);
      attempt.kind=typeof result?.then==='function'?'promise':'event';
      if(attempt.kind==='promise')Promise.resolve(result).then(()=>{
        // Some embedded browsers resolve without dispatching change. Confirm
        // only if the real browser element agrees; otherwise keep the deadline.
        attempt.fulfilled=true;changed(attempt.id);if(locked()||attempt.grantSeen)awaiting.delete(attempt.id);cleanupIfDone();
      },reason=>failed(attempt.id,reason));
      else if(attempt.earlyError)failed(attempt.id,attempt.earlyError.reason);
      else if(attempt.grantSeen){awaiting.delete(attempt.id);cleanupIfDone();}
      if(current===attempt){
        changed();
        if(current===attempt)attempt.timer=timers.setTimeout(()=>{
          if(current!==attempt)return;
          if(!changed())failed(attempt.id,normalizeError(null,'PointerLockTimeoutError','The browser did not confirm pointer lock. Try again from the game view.'),false);
        },timeout);
      }
      return true;
    }catch(reason){failed(attempt.id,reason);return false;}
  }
  function release(){wanted=false;clearCurrent();if(locked())exitLock();cleanupIfDone();}
  return{
    get locked(){return locked();},get pending(){return pending;},get supported(){return supported();},get error(){return lastError;},
    request,release,toggle(){if(locked()||pending)release();else request();},
    dispose(){if(disposed)return;disposed=true;release();cleanupIfDone();},
  };
}
