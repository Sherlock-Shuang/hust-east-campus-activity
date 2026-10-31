// Stream at most two small AAC tracks. Music never joins the scene/model load
// barrier, decodes a whole soundtrack into RAM, or creates a campus connection.
export const MUSIC_STORAGE_KEY='east-campus-music-v1';
export const CAMPUS_TRACKS=Object.freeze({
  campus:{title:'Forrest Gump Suite',url:'/audio/forrest-gump-v1.m4a'},
  opto:{title:'Cornfield Chase',url:'/audio/cornfield-chase-v1.m4a'},
  vehicle:{title:'Sunflower (Guy Arthur Flip)',url:'/audio/sunflower-guy-arthur-flip-v1.m4a',source:'https://guyarthur.com/sunflower-remix-download'},
  spider:{title:'Scared of the Dark',url:null,source:'https://www.youtube.com/watch?v=KCp_I6ZlfE4'},
  evening:{title:'Another Day of Sun',url:'/audio/another-day-of-sun-v1.m4a'},
  tasay:{title:'只要为你活一天',url:'/audio/live-for-you-v1.m4a'},
});
export function campusBackground({atmosphere}={}){return atmosphere==='sunset'||atmosphere==='night'?'evening':'campus';}
export function selectCampusTrack(scene={}){
  if(scene.experience==='tasay')return 'tasay';
  if(scene.experience==='opto-c118')return 'opto';
  // Other works retain their own soundtrack and sound effects.
  if(scene.experience)return null;
  if(scene.mode==='spider')return 'spider';
  if(scene.mode==='roadster')return 'vehicle';
  return campusBackground(scene);
}
function defaultStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function readMusicPreference(storage=defaultStorage()){
  try{
    const value=JSON.parse(storage?.getItem(MUSIC_STORAGE_KEY)||'null');
    return {muted:value?.muted===true,volume:typeof value?.volume==='number'&&Number.isFinite(value.volume)?Math.max(0,Math.min(1,value.volume)):.36};
  }catch{return {muted:false,volume:.36};}
}
// A 16 ms, 8 kHz silent WAV primes both reusable media elements during the
// actual gesture, even when campus data or the nickname screen is still loading.
const SILENCE='data:audio/wav;base64,UklGRqQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YYAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

export function createCampusMusic({tracks=CAMPUS_TRACKS,storage=defaultStorage(),
  createAudio=()=>new Audio(),createContext=()=>{const C=globalThis.AudioContext||globalThis.webkitAudioContext;return C?new C():null;},
  now=()=>performance.now(),schedule=(fn,ms)=>setTimeout(fn,ms),cancel=id=>clearTimeout(id),fadeMs=850,onState=()=>{}}={}){
  const preference=readMusicPreference(storage),positions=new Map(),failed=new Set();
  const decks=[0,1].map(()=>{const audio=createAudio();audio.preload='none';audio.loop=true;audio.playsInline=true;audio.setAttribute?.('playsinline','');return {audio,key:null,gain:0,attempt:0,pending:false,seek:0,node:null,source:null,primed:false};});
  let scene={ready:false,registered:false,mode:'walk',atmosphere:'day',experience:null,paused:false,hidden:false,foregroundAudio:false};
  let muted=preference.muted,volume=preference.volume,unlocked=false,blocked=false,disposed=false,context=null,contextTried=false;
  let active=null,timer=null,fade=null,revision=0,lastState='';
  const listeners=new Set();
  function requested(){return selectCampusTrack(scene);}
  function target(){const key=requested();if(!key)return null;if(tracks[key]?.url&&!failed.has(key))return key;const fallback=campusBackground(scene);return tracks[fallback]?.url&&!failed.has(fallback)?fallback:null;}
  function allowed(){return scene.ready&&scene.registered&&!scene.paused&&!scene.hidden&&!scene.foregroundAudio&&!muted&&volume>0;}
  function snapshot(){const key=target(),playing=active?.key===key&&!active?.audio.paused&&allowed();return {muted,volume,unlocked,blocked,trackId:key,requestedTrackId:requested(),title:tracks[key]?.title||'',playing,
    status:!scene.ready||!scene.registered?'waiting':muted||volume===0?'muted':!unlocked?'locked':blocked?'blocked':!allowed()||!key?'paused':playing?'playing':'loading'};}
  function emit(){const state=snapshot(),signature=JSON.stringify(state);if(signature===lastState)return;lastState=signature;onState(state);for(const listener of listeners)listener(state);}
  function persist(){try{storage?.setItem(MUSIC_STORAGE_KEY,JSON.stringify({muted,volume}));}catch{}}
  function gain(deck,value){deck.gain=value;if(deck.node)deck.node.gain.setValueAtTime(value*volume,context.currentTime);else deck.audio.volume=value*volume;}
  function cancelFade(){if(timer!==null)cancel(timer);timer=null;fade=null;}
  function silence(){revision++;cancelFade();active=null;for(const deck of decks){deck.attempt++;deck.pending=false;gain(deck,0);deck.audio.pause();}emit();}
  function ramp(next){
    cancelFade();const started=now(),from=decks.map(d=>d.gain);active=next;
    const tick=()=>{
      if(disposed)return;
      const t=fadeMs<=0?1:Math.min(1,(now()-started)/fadeMs),u=t*t*(3-2*t);
      decks.forEach((deck,i)=>gain(deck,from[i]+((deck===next?1:0)-from[i])*u));
      if(t<1)timer=schedule(tick,40);
      else{timer=null;fade=null;for(const deck of decks)if(deck!==next){deck.attempt++;deck.pending=false;deck.audio.pause();}emit();}
    };
    fade={next};tick();emit();
  }
  for(const deck of decks){
    deck.metadata=()=>{if(!deck.seek)return;try{deck.audio.currentTime=deck.seek<deck.audio.duration-1?deck.seek:0;}catch{}deck.seek=0;};
    deck.error=()=>{
      if(disposed||!deck.key||deck.audio.src!==new URL(tracks[deck.key].url,globalThis.location?.href||'https://campus.invalid/').href)return;
      failed.add(deck.key);deck.pending=false;deck.attempt++;deck.audio.pause();gain(deck,0);if(active===deck)active=null;
      reconcile();
    };
    deck.audio.addEventListener?.('loadedmetadata',deck.metadata);deck.audio.addEventListener?.('error',deck.error);
  }
  function reconcile(){
    if(disposed)return;
    const key=target();
    if(!allowed()||!unlocked||blocked||!key){silence();return;}
    if(context?.state==='suspended')try{context.resume()?.catch?.(()=>{});}catch{}
    if(active?.key===key&&!active.audio.paused){emit();return;}
    let deck=decks.find(d=>d.key===key);
    if(deck?.pending){emit();return;}
    if(!deck)deck=decks.find(d=>d!==active&&!d.pending)||decks.find(d=>d!==active)||decks[0];
    if(deck.key!==key){
      deck.attempt++;deck.pending=false;deck.audio.pause();gain(deck,0);
      if(deck.key)positions.set(deck.key,deck.audio.currentTime||0);
      deck.key=key;deck.seek=positions.get(key)||0;deck.audio.src=tracks[key].url;
    }
    // Keep the currently audible deck until the next one can actually play.
    const attempt=++deck.attempt,version=++revision;deck.pending=true;
    let promise;try{promise=deck.audio.play();}catch(error){promise=Promise.reject(error);}
    Promise.resolve(promise).then(()=>{
      if(disposed||deck.attempt!==attempt)return;
      deck.pending=false;
      if(version!==revision||!allowed()||target()!==key){gain(deck,0);deck.audio.pause();return;}
      blocked=false;ramp(deck);
    },error=>{
      if(disposed||deck.attempt!==attempt)return;
      deck.pending=false;
      if(version!==revision||target()!==key)return;
      if(error?.name==='NotAllowedError'){blocked=true;silence();}
      else if(error?.name!=='AbortError'){failed.add(key);gain(deck,0);deck.audio.pause();if(active===deck)active=null;reconcile();}
      emit();
    });emit();
  }
  function unlock(){
    if(disposed)return;
    unlocked=true;blocked=false;
    if(!contextTried){
      contextTried=true;
      try{
        context=createContext();
        if(context)for(const deck of decks){deck.source=context.createMediaElementSource(deck.audio);deck.node=context.createGain();deck.node.gain.value=0;deck.source.connect(deck.node);deck.node.connect(context.destination);deck.audio.volume=1;}
      }catch{for(const deck of decks){deck.source?.disconnect();deck.node?.disconnect();deck.node=null;deck.source=null;}try{context?.close()?.catch?.(()=>{});}catch{}context=null;}
    }
    try{context?.resume()?.catch?.(()=>{});}catch{}
    for(const deck of decks)if(!deck.key&&!deck.primed){
      deck.primed=true;deck.audio.src=SILENCE;gain(deck,0);const attempt=++deck.attempt;
      try{Promise.resolve(deck.audio.play()).then(()=>{if(!disposed&&deck.attempt===attempt)deck.audio.pause();},()=>{});}catch{}
    }
    reconcile();
  }
  function update(next){
    if(disposed||!Object.entries(next).some(([key,value])=>scene[key]!==value))return;
    scene={...scene,...next};reconcile();
  }
  emit();
  return {update,unlock,get state(){return snapshot();},
    setMuted(value){muted=!!value;persist();reconcile();},
    setVolume(value){if(!Number.isFinite(value))return;volume=Math.max(0,Math.min(1,value));persist();for(const deck of decks)gain(deck,deck.gain);reconcile();},
    subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},
    dispose(){if(disposed)return;silence();disposed=true;listeners.clear();for(const deck of decks){deck.audio.removeEventListener?.('loadedmetadata',deck.metadata);deck.audio.removeEventListener?.('error',deck.error);deck.source?.disconnect();deck.node?.disconnect();deck.audio.removeAttribute('src');deck.audio.load();}try{context?.close()?.catch?.(()=>{});}catch{}}
  };
}

export function mountCampusMusic({document=globalThis.document,window=globalThis.window,...options}={}){
  const root=document.createElement('section');root.id='campus-music';root.hidden=true;root.setAttribute('aria-label','校园配乐');
  root.innerHTML='<button type="button" class="music-toggle" aria-label="开启配乐" aria-pressed="false"><span aria-hidden="true">♫</span><span class="music-label">配乐</span></button><details><summary aria-label="配乐音量设置">⌄</summary><div class="music-panel"><span class="music-now">校园配乐</span><label>音量<input type="range" min="0" max="100" step="1" aria-label="配乐音量"></label><small class="music-status"></small></div></details>';
  document.body.append(root);
  const button=root.querySelector('.music-toggle'),label=root.querySelector('.music-label'),input=root.querySelector('input'),title=root.querySelector('.music-now'),status=root.querySelector('.music-status');
  function paint(state){
    root.hidden=state.status==='waiting';root.dataset.state=state.status;root.dataset.track=state.trackId||'';
    const enable=state.muted||!state.unlocked||state.blocked||state.volume===0;
    button.setAttribute('aria-pressed',String(!enable));
    button.setAttribute('aria-label',enable?'开启配乐':'静音配乐');button.title=enable?'点击开启校园配乐':`静音 · ${state.title||'校园配乐'}`;
    label.textContent=enable?'开启配乐':'配乐';input.value=String(Math.round(state.volume*100));title.textContent=state.title||'作品独立声音';
    status.textContent=state.status==='locked'||state.status==='blocked'?'点击开启配乐':state.status==='muted'?'已静音':state.status==='paused'?'配乐已暂停':state.status==='loading'?'正在加载配乐':'随场景自动切换';
  }
  const music=createCampusMusic({...options,onState:paint});
  const toggle=()=>{const state=music.state;if(state.muted||!state.unlocked||state.blocked||state.volume===0){if(state.volume===0)music.setVolume(.36);music.setMuted(false);music.unlock();}else music.setMuted(true);};
  const change=()=>{music.unlock();music.setVolume(Number(input.value)/100);if(Number(input.value)>0)music.setMuted(false);};
  const gesture=event=>{if(event.isTrusted===false||root.contains(event.target))return;if(!music.state.unlocked||music.state.blocked)music.unlock();};
  const stop=event=>event.stopPropagation();
  const visibility=()=>{music.update({hidden:document.hidden});};
  const pagehide=()=>music.update({hidden:true});
  const pageshow=()=>music.update({hidden:document.hidden});
  button.addEventListener('click',toggle);input.addEventListener('input',change);
  for(const type of ['keydown','keyup','pointerdown','pointerup','click','wheel'])root.addEventListener(type,stop);
  for(const type of ['pointerdown','keydown','click'])window.addEventListener(type,gesture,{capture:true});
  document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);window.addEventListener('pageshow',pageshow);visibility();
  return {...music,root,get state(){return music.state;},dispose(){music.dispose();button.removeEventListener('click',toggle);input.removeEventListener('input',change);for(const type of ['pointerdown','keydown','click'])window.removeEventListener(type,gesture,{capture:true});document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);window.removeEventListener('pageshow',pageshow);root.remove();}};
}
