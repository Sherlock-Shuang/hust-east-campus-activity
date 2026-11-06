import {createClientId} from './browser-compat.js';

// The cookie is the credential. Storage is only a durable delivery queue, never
// the host's audience database or permission to select another audience ID.
export function createAudienceClient({onIdentity=()=>{},onError=()=>{},fetchImpl=fetch,documentImpl=globalThis.document,windowImpl=globalThis.window,navigatorImpl=globalThis.navigator,storageImpl,setTimer=setTimeout,clearTimer=clearTimeout,random=Math.random}={}){
  // Storage access itself can throw in restricted WebViews/private contexts.
  if(storageImpl===undefined)try{storageImpl=globalThis.localStorage;}catch{}
  const tabId=createClientId(),prefix='campus-event-v1:',memory=new Map();
  let audience=null,csrfToken='',disposed=false,draining=false,sequence=0,queue=Promise.resolve();
  async function request(path,body,keepalive=false){
    const controller=new AbortController(),timeout=setTimer(()=>controller.abort(),12000);
    try{
      const response=await fetchImpl(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',keepalive,signal:controller.signal,headers:body?{'Content-Type':'application/json','X-CSRF-Token':csrfToken}:{},...(body?{body:JSON.stringify(body)}:{})});
      const data=await response.json().catch(()=>{throw new Error('活动服务暂未连接，请检查网络后重试');});if(!response.ok)throw Object.assign(new Error(data.error||'活动记录暂未同步'),{status:response.status});return data;
    }catch(error){if(error?.name==='AbortError')throw new Error('活动服务连接超时，请检查网络后再次进入');throw error;}
    finally{clearTimer(timeout);}
  }
  function accept(data){audience=data.audience;csrfToken=data.csrfToken||'';if(!disposed)onIdentity(audience);return audience;}
  const ready=request('/api/audience/me').then(accept).catch(e=>{if(!disposed){onIdentity(null);onError(e.message);}return null;});
  async function join(nickname){
    // Finish the initial identity lookup before a join can replace its result.
    await ready;
    const run=async()=>{await request('/api/audience/me').then(accept);if(audience)return audience;return accept(await request('/api/audience/join',{nickname,tabId}));};
    const result=await (navigatorImpl?.locks?navigatorImpl.locks.request('campus-audience-join',run):run());
    reconcile(true);return result;
  }
  function save(entry){memory.set(entry.event.eventId,entry);try{storageImpl.setItem(prefix+entry.event.eventId,JSON.stringify(entry));}catch{/* The in-memory queue still preserves order. */}}
  function remove(id){memory.delete(id);try{storageImpl.removeItem(prefix+id);}catch{}}
  function entries(){
    const found=new Map(memory);
    try{for(let i=0;i<storageImpl.length;i++){const key=storageImpl.key(i);if(!key?.startsWith(prefix))continue;try{const entry=JSON.parse(storageImpl.getItem(key));if(entry?.event?.eventId)found.set(entry.event.eventId,entry);}catch{}}}catch{}
    return [...found.values()].filter(entry=>entry.audienceId===audience?.id);
  }
  const legacyOrder={visit:0,opening:1,opened:2,open_failed:3,returned:4};
  function nextPending(){
    const tabs=new Map();
    for(const entry of entries()){
      if(entry.status&&entry.status!=='pending')continue;
      const list=tabs.get(entry.event.tabId)||[];list.push(entry);tabs.set(entry.event.tabId,list);
    }
    const heads=[...tabs.values()].map(list=>list.sort((a,b)=>{
      if(Number.isSafeInteger(a.sequence)&&Number.isSafeInteger(b.sequence))return a.sequence-b.sequence;
      return (a.queuedAt||0)-(b.queuedAt||0)||(legacyOrder[a.event.type]??9)-(legacyOrder[b.event.type]??9);
    })[0]);
    return heads.sort((a,b)=>(a.queuedAt||0)-(b.queuedAt||0))[0];
  }
  function retryable(e){return !e.status||e.status>=500||[401,408,429].includes(e.status)||(e.status===409&&/其他窗口正在更新/.test(e.message))||(e.status===403&&/令牌/.test(e.message));}
  async function flush({background=false}={}){
    if(!audience)return;
    for(let count=0;count<200;count++){
      if(background&&!canRun())return;
      const entry=nextPending();if(!entry)return;
      try{
        const result=await request('/api/audience/events',entry.event,true);
        // A receipt allows another tab to drain safely without hiding a rejected
        // required opening from the tab that is waiting for its acknowledgement.
        save({...entry,status:'sent',finishedAt:Date.now(),result:{duplicate:!!result.duplicate}});
      }catch(e){
        if(retryable(e))throw e;
        save({...entry,status:'failed',finishedAt:Date.now(),error:{message:e.message,status:e.status}});
      }
    }
    if((!background||canRun())&&nextPending())throw new Error('活动记录正在补报，请稍后重试');
  }
  function schedule(operation){
    const run=async()=>navigatorImpl?.locks&&audience?navigatorImpl.locks.request(`campus-events:${audience.id}`,operation):operation();
    const task=queue.then(run);queue=task.catch(()=>{});return task;
  }
  async function event(type,data={},options={}){
    if(!audience)throw new Error('请先填写昵称参与活动');
    const payload={eventId:createClientId(),tabId,type,...data};
    // Required opening/visit events need exactly the same durable replay as
    // opened/returned: a lost HTTP response does not mean the write failed.
    const entry={audienceId:audience.id,event:payload,sequence:++sequence,queuedAt:Date.now(),status:'pending'};save(entry);
    try{
      let deliveryError;await schedule(async()=>{try{await flush();}catch(e){deliveryError=e;}});
      const receipt=entries().find(item=>item.event.eventId===payload.eventId);
      if(receipt?.status==='sent'){remove(payload.eventId);return receipt.result;}
      if(receipt?.status==='failed'){remove(payload.eventId);throw Object.assign(new Error(receipt.error.message),{status:receipt.error.status});}
      throw deliveryError||new Error('活动记录尚未同步，将在恢复连接后补报');
    }catch(e){if(options.required)throw e;onError(e.message);return null;}
  }
  async function drain({background=false}={}){
    if(!audience||disposed||(background&&draining))return;
    if(background)draining=true;
    try{
      // A background retry may have waited for another tab's delivery lock.
      // Explicit flush/event calls still deliver during a page transition.
      await schedule(()=>flush({background}));
      // Leave recent receipts for the originating tab's pending promise.
      for(const entry of entries())if(entry.finishedAt&&Date.now()-entry.finishedAt>60000)remove(entry.event.eventId);
    }catch(e){if(!disposed)onError(e.message);}finally{if(background)draining=false;}
  }
  let beating=false;
  async function heartbeat(){if(audience&&canRun()&&!beating){beating=true;try{await request('/api/audience/heartbeat',{tabId});}catch(e){if(!disposed)onError(e.message);}finally{beating=false;}}}
  // 22.5–27.5 s keeps >2 attempts within the 65 s presence TTL and avoids
  // hundreds of simultaneous writes after an audience-wide start/resume.
  let interval=null,running=false,pageHidden=false;
  const canRun=()=>!disposed&&!pageHidden&&!documentImpl?.hidden&&navigatorImpl?.onLine!==false;
  function stop(){running=false;clearTimer(interval);interval=null;}
  function scheduleHeartbeat(){interval=setTimer(()=>{interval=null;if(!canRun()){stop();return;}heartbeat();drain({background:true});scheduleHeartbeat();},22500+random()*5000);}
  function reconcile(refresh=false){
    if(!canRun()){stop();return;}
    if(running&&!refresh)return;
    if(!running){running=true;scheduleHeartbeat();}
    heartbeat();drain({background:true});
  }
  const resume=()=>reconcile(),hide=()=>{pageHidden=true;stop();},show=()=>{pageHidden=false;reconcile();};
  documentImpl?.addEventListener('visibilitychange',resume);
  windowImpl?.addEventListener('online',resume);windowImpl?.addEventListener('offline',resume);
  windowImpl?.addEventListener('pagehide',hide);windowImpl?.addEventListener('pageshow',show);
  ready.then(()=>reconcile(true));
  return {ready,join,event,gomoku:body=>request('/api/audience/gomoku',body),learningRequests:()=>request('/api/audience/learning-requests'),flush:drain,get identity(){return audience;},get tabId(){return tabId;},dispose(){disposed=true;stop();documentImpl?.removeEventListener('visibilitychange',resume);windowImpl?.removeEventListener('online',resume);windowImpl?.removeEventListener('offline',resume);windowImpl?.removeEventListener('pagehide',hide);windowImpl?.removeEventListener('pageshow',show);}};
}
