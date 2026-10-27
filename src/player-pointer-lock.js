/** Browser pointer capture is asynchronous; only pointerlockchange confirms it.
 * Support both event-only and Promise implementations without optimistic UI. */
export function createPlayerPointerLock({canvas,document,canLock=()=>true,onChange=()=>{},onError=()=>{}}){
  let pending=false,wanted=false,disposed=false,requestId=0,confirmed=false,awaitingGrant=false;
  const locked=()=>document.pointerLockElement===canvas;
  const supported=()=>typeof canvas.requestPointerLock==='function'&&typeof document.exitPointerLock==='function';
  function cleanup(){document.removeEventListener('pointerlockchange',changed);document.removeEventListener('pointerlockerror',error);}
  function changed(){
    awaitingGrant=false;
    const next=locked();
    if(next&&(disposed||!wanted||!canLock())){document.exitPointerLock();if(disposed)cleanup();return;}
    if(disposed){cleanup();return;}
    pending=false;
    if(!next)wanted=false;
    if(next!==confirmed){confirmed=next;onChange(next);}
  }
  function failed(id){
    if(id!==requestId)return;
    awaitingGrant=false;
    if(disposed){cleanup();return;}
    if(!pending)return;
    pending=false;wanted=false;onError();onChange(false);
  }
  const error=()=>failed(requestId);
  document.addEventListener('pointerlockchange',changed);
  document.addEventListener('pointerlockerror',error);
  function request(){
    if(disposed||!canLock()||pending||awaitingGrant||locked())return;
    if(!supported()){onError();return;}
    pending=true;wanted=true;awaitingGrant=true;const id=++requestId;
    try{
      const result=canvas.requestPointerLock();
      // The success event, not a fulfilled Promise, is the source of truth.
      result?.catch?.(()=>failed(id));
    }catch{failed(id);}
  }
  function release(){
    wanted=false;pending=false;
    if(locked())document.exitPointerLock();
  }
  return{
    get locked(){return locked();},get pending(){return pending;},get supported(){return supported();},
    request,release,toggle(){if(locked()||pending)release();else request();},
    // An in-flight browser request cannot be cancelled. Keep the guard until
    // its terminal event so a late grant after disposal immediately unlocks.
    dispose(){if(disposed)return;disposed=true;release();if(!awaitingGrant)cleanup();},
  };
}
