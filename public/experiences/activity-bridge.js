/* Same-origin SDK for optional activity works. No game-completion events. */
(() => {
  const parentOrigin=location.origin,script=document.currentScript;
  const params=new URLSearchParams(location.search),attemptId=params.get('campusAttempt')||'';
  const workId=script?.dataset.work||'';
  try {
    const own=new URL(parentOrigin),supplied=params.get('campusParentOrigin'),configured=script?.dataset.parentOrigin;
    if(!['http:','https:'].includes(own.protocol)||(supplied&&supplied!==parentOrigin)||(configured&&configured!==parentOrigin))return;
  } catch { return; }
  if((attemptId&&!/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId))||(workId&&!/^[a-zA-Z0-9_-]{1,128}$/.test(workId)))return;
  let current={paused:false,disposed:false,announcement:null,c118Flood:null,c118Screen:null,serverTime:Date.now()};
  const listeners=new Set(),sent=new Set();
  function send(type,extra={}){
    if(current.disposed||window.parent===window)return false;
    window.parent.postMessage({type,attemptId,...(workId?{workId}:{}),...extra},parentOrigin);return true;
  }
  function notify(){
    if(current.paused){document.exitPointerLock?.();document.activeElement?.blur?.();}
    document.documentElement.dataset.campusPaused=String(current.paused);
    const state={...current};
    for(const fn of listeners){try{fn({...state});}catch(error){console.error('Activity subscriber failed',error);}}
    window.dispatchEvent(new CustomEvent('campus:activity',{detail:state}));
    if(current.disposed){window.dispatchEvent(new CustomEvent('campus:dispose',{detail:{...state}}));listeners.clear();}
  }
  window.campusActivity={
    get paused(){return current.paused;},
    get state(){return {...current};},
    subscribe(fn){if(typeof fn!=='function')throw new TypeError('A state listener is required');if(!current.disposed)listeners.add(fn);fn({...current});return()=>listeners.delete(fn);},
    ready(level='runtime_ready'){
      if(current.disposed||!['page_opened','runtime_ready'].includes(level)||sent.has(level))return false;
      sent.add(level);document.documentElement.dataset.campusWorkStatus=level;return send('campus:ready',{level});
    },
    fail(message){if(current.disposed)return false;document.documentElement.dataset.campusWorkStatus='failed';return send('campus:error',{message:String(message).slice(0,240)});},
    exit(returnEntryId){if(current.paused||current.disposed)return false;return send('campus:exit',workId==='opto-c118'&&['opto-c1','opto-c2'].includes(returnEntryId)?{returnEntryId}:{});},
  };
  function message(event){
    if(current.disposed||window.parent===window||event.source!==window.parent||event.origin!==parentOrigin||event.data?.attemptId!==attemptId)return;
    if(event.data.type==='campus:dispose'){
      current={...current,paused:true,disposed:true};window.removeEventListener('message',message);
    }else if(event.data.type==='campus:activity'&&typeof event.data.paused==='boolean'){
      current={paused:event.data.paused,disposed:false,announcement:event.data.announcement||null,c118Flood:workId==='opto-c118'?event.data.c118Flood??null:null,c118Screen:workId==='opto-c118'?event.data.c118Screen??null:null,serverTime:Number.isFinite(event.data.serverTime)?event.data.serverTime:Date.now()};
    }else return;
    notify();
  }
  window.addEventListener('message',message);
  // Existing games keep their own keys. Use a visible return button to call
  // exit(); release keys/pointers are never swallowed by the bridge.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>window.campusActivity.ready('page_opened'),{once:true});
  else window.campusActivity.ready('page_opened');
})();
