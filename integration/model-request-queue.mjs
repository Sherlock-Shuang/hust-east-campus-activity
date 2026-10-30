// Per-runtime admission only. Shared database quotas remain authoritative.
// FIFO waiters are bounded and hold no upstream connection or paid reservation.
const failure=code=>Object.assign(new Error(code),{code});
export function createModelRequestQueue({maxConcurrent=8,maxQueued=16,maxQueuedPerKey=1,waitMs=12000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  for(const [name,value,min] of [['maxConcurrent',maxConcurrent,1],['maxQueued',maxQueued,0],['maxQueuedPerKey',maxQueuedPerKey,1],['waitMs',waitMs,1]]){
    if(!Number.isSafeInteger(value)||value<min)throw new RangeError(`Invalid ${name}`);
  }
  let active=0,closed=false;const pending=[],byKey=new Map();
  function remove(waiter){
    const index=pending.indexOf(waiter);if(index<0)return false;
    pending.splice(index,1);clearTimer(waiter.timer);waiter.signal?.removeEventListener('abort',waiter.abort);
    const left=byKey.get(waiter.key)-1;if(left)byKey.set(waiter.key,left);else byKey.delete(waiter.key);
    return true;
  }
  function take(){
    active++;let released=false;
    return ()=>{if(released)return;released=true;active--;drain();};
  }
  function drain(){
    while(!closed&&active<maxConcurrent&&pending.length){
      const waiter=pending[0];remove(waiter);
      if(waiter.signal?.aborted)waiter.reject(failure('REQUEST_CANCELLED'));
      else waiter.resolve(take());
    }
  }
  return {
    acquire({key='',signal}={}){
      if(signal?.aborted)return Promise.reject(failure('REQUEST_CANCELLED'));
      if(closed)return Promise.reject(failure('QUEUE_CLOSED'));
      if(active<maxConcurrent&&pending.length===0)return Promise.resolve(take());
      if(pending.length>=maxQueued||(byKey.get(key)||0)>=maxQueuedPerKey)return Promise.reject(failure('QUEUE_FULL'));
      return new Promise((resolve,reject)=>{
        const waiter={key,signal,resolve,reject,timer:null,abort:null};
        waiter.abort=()=>{if(remove(waiter))reject(failure('REQUEST_CANCELLED'));};
        waiter.timer=setTimer(()=>{if(remove(waiter))reject(failure('QUEUE_TIMEOUT'));},waitMs);
        pending.push(waiter);byKey.set(key,(byKey.get(key)||0)+1);signal?.addEventListener('abort',waiter.abort,{once:true});
        if(signal?.aborted)waiter.abort();
      });
    },
    dispose(){if(closed)return;closed=true;for(const waiter of [...pending]){remove(waiter);waiter.reject(failure('QUEUE_CLOSED'));}},
    get stats(){return {active,waiting:pending.length,waitingKeys:byKey.size,closed};},
  };
}
