/* Campus edition only. Does not grant victories or change a game's save. */
(() => {
  const script=document.currentScript,workId=script?.dataset.work||'library';
  const params=new URLSearchParams(location.search),attemptId=params.get('campusAttempt')||'';
  const parentOrigin=location.origin;
  // This deployment is same-origin. A query string cannot grant a new site
  // authority to pause, dispose or receive this work's activity messages.
  try { const own=new URL(parentOrigin),supplied=params.get('campusParentOrigin');if(!['http:','https:'].includes(own.protocol)||(supplied&&supplied!==parentOrigin))return; } catch { return; }
  if(attemptId&&!/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId))return;
  let controller=null,stateKnown=false,paused=false,disposed=false;
  const sent=new Set();
  function send(type,extra={}){
    if(parent===window)return;
    parent.postMessage({type,workId,attemptId,...extra},parentOrigin);
  }
  function apply(){
    document.documentElement.dataset.campusPaused=String(paused);
    if(paused){document.exitPointerLock?.();document.activeElement?.blur?.();}
    if(controller&&stateKnown)controller.setPaused?.(paused);
  }
  window.campusWorkAdapter={
    get paused(){return paused;},
    register(value){controller=value;apply();},
    ready(level){if(disposed||!['page_opened','runtime_ready'].includes(level)||sent.has(level))return;sent.add(level);document.documentElement.dataset.campusWorkStatus=level;send('campus:ready',{level});},
    fail(message){if(disposed)return;document.documentElement.dataset.campusWorkStatus='failed';send('campus:error',{message:String(message).slice(0,240)});},
    exit(){send('campus:exit');if(parent===window)location.assign(parentOrigin+'/');},
  };
  addEventListener('message',event=>{
    if(disposed)return;
    if(event.source!==parent||event.origin!==parentOrigin||parent===window)return;
    if(event.data?.attemptId!==attemptId)return;
    if(event.data?.type==='campus:activity'&&typeof event.data.paused==='boolean'){
      stateKnown=true;paused=event.data.paused;apply();
    }else if(event.data?.type==='campus:dispose'){
      disposed=true;stateKnown=true;paused=true;apply();controller?.dispose?.();
    }
  });
  // Do not bind Escape/Space/Enter: each original game owns its existing keys.
  // Releases must reach the original runtime even while paused, so held keys
  // and pointers cannot remain stuck when the host resumes the activity.
  for(const type of ['keydown','pointerdown','click','wheel'])addEventListener(type,event=>{
    if(paused){event.preventDefault();event.stopImmediatePropagation();}
  },{capture:true,passive:false});
  addEventListener('DOMContentLoaded',()=>{
    window.campusWorkAdapter.ready('page_opened');
    if(parent===window){
      const back=document.createElement('a');back.textContent='返回校园';back.href=parentOrigin+'/';
      back.style.cssText='position:fixed;right:16px;top:12px;z-index:2147483646;padding:9px 14px;border-radius:10px;border:1px solid #ffffff77;background:#173d36dd;color:#fff;font:13px/1.5 sans-serif;text-decoration:none';
      document.body.append(back);
    }
  },{once:true});
})();
