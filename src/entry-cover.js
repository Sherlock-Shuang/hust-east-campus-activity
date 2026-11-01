// Readiness and permission to enter are separate: preparing the campus in the
// background never dismisses its cover without an explicit visitor gesture.
export function mountEntryCover({document=globalThis.document,window=globalThis.window,mountMotion,transitionMs=900}={}){
  const cover=document?.getElementById('campus-entry-cover');
  const start=document?.getElementById('entry-cover-start');
  const status=document?.getElementById('entry-cover-status');
  if(!cover||!start||!window)return {dispose(){}};
  let ready=document.documentElement?.dataset.campusReady==='true';
  let requested=false,failed=false,entered=false,disposed=false,timer=null,motion=null,blockers=[];
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches===true;
  function stopMotion(){
    if(typeof motion==='function')motion();else motion?.dispose?.();
    motion=null;
  }
  function startMotion(){
    if(motion||!mountMotion||entered||disposed)return;
    try{motion=mountMotion({cover,canvas:document.getElementById('entry-cover-particles')});}
    catch(error){console.warn('Entry cover animation unavailable:',error);}
  }
  function holdCampus(){
    if(blockers.length)return;
    for(const element of [document.querySelector('body > header'),document.getElementById('viewport')].filter(Boolean)){
      // The HTML already holds these roots before JavaScript downloads. Its
      // marker distinguishes our initial inert from an unrelated existing one.
      const owned=element.hasAttribute('data-entry-cover-inert');
      blockers.push({element,inert:owned?false:element.inert===true,owned});
      element.inert=true;
    }
  }
  function releaseCampus(){
    for(const {element,inert,owned} of blockers){
      element.inert=inert;
      if(owned)element.removeAttribute('data-entry-cover-inert');
    }
    blockers=[];
  }
  function message(value){if(status){status.textContent=value;status.hidden=!value;}}
  function showState(state){
    cover.dataset.state=state;
    const busy=state==='waiting'||state==='entering';
    start.disabled=busy||state==='error';
    start.setAttribute('aria-busy',String(busy));
    start.textContent='开始体验';
    if(state==='loading')message('正在准备校园');
    else if(state==='waiting')message('正在准备校园，准备好后即会进入…');
    else if(state!=='error')message('');
  }
  function cancelTransition(){if(timer!==null){window.clearTimeout(timer);timer=null;}cover.classList.remove('is-leaving');}
  function finishEntry(){
    timer=null;if(disposed||failed||entered||!ready||!requested)return;
    entered=true;cover.hidden=true;cover.classList.remove('is-leaving');showState('entered');
    document.body.classList.remove('entry-cover-open');releaseCampus();stopMotion();
    // Listeners synchronously restore the existing nickname/host/graphics
    // gates before the browser can accept a world input event.
    window.dispatchEvent(new window.Event('campus:entry-entered'));
  }
  function enter(){
    if(disposed||entered||failed||!requested||!ready||timer!==null)return;
    showState('entering');cover.classList.add('is-leaving');
    timer=window.setTimeout(finishEntry,reduced()?0:Math.max(0,transitionMs));
  }
  function click(){
    if(disposed||entered||failed||requested)return;
    requested=true;if(ready)enter();else showState('waiting');
  }
  function onReady(){
    if(disposed||entered)return;
    ready=true;failed=false;if(document.documentElement)document.documentElement.dataset.campusReady='true';
    cover.setAttribute('aria-modal','true');
    if(requested)enter();else showState('ready');
  }
  function onError(event){
    if(disposed||entered)return;
    cancelTransition();failed=true;ready=false;requested=false;
    if(document.documentElement)delete document.documentElement.dataset.campusReady;
    showState('error');
    message(typeof event.detail==='string'&&event.detail?event.detail:'校园暂未准备完成，请使用恢复按钮重新载入。');
    // Startup recovery is a sibling of the inert viewport, above the artwork.
    // It must remain reachable rather than looking like a successful entry.
    cover.setAttribute('aria-modal','false');
    const recovery=document.getElementById('campus-startup-help');
    if(recovery&&!recovery.hidden)recovery.querySelector('button')?.focus({preventScroll:true});
  }
  function reset(){
    cancelTransition();entered=false;requested=false;
    ready=document.documentElement?.dataset.campusReady==='true';
    holdCampus();cover.hidden=false;document.body.classList.add('entry-cover-open');
    cover.setAttribute('aria-modal',String(!failed));showState(failed?'error':ready?'ready':'loading');startMotion();
  }
  function pagehide(event){
    if(event.persisted){cancelTransition();stopMotion();}
    else dispose();
  }
  function pageshow(event){if(event.persisted&&!disposed)reset();}
  function dispose(){
    if(disposed)return;disposed=true;cancelTransition();stopMotion();
    start.removeEventListener('click',click);window.removeEventListener('campus:ready',onReady);
    window.removeEventListener('campus:startup-error',onError);
    window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);
    cover.hidden=true;document.body.classList.remove('entry-cover-open');releaseCampus();
  }
  start.addEventListener('click',click);window.addEventListener('campus:ready',onReady);
  window.addEventListener('campus:startup-error',onError);
  window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow);
  reset();
  return {dispose};
}
