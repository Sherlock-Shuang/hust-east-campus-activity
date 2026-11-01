// The film is exported without an audio stream. Runtime muting is a second
// safeguard, including on browsers that require it for inline autoplay.
export function mountEntryCoverMotion({cover,video,window=globalThis.window,document=globalThis.document,startDelayMs=750}={}){
  if(!cover||!video)return()=>{};
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const connection=window.navigator?.connection;
  let disposed=false,loaded=false,timer=null,ready=document.documentElement?.dataset.campusReady==='true';
  // The still artwork and its type remain immediate. The optional 8 MB film
  // must not compete with the map/scene on a cold connection. A visitor who
  // enters promptly never needs to fetch or decode it at all.
  const constrained=()=>connection?.saveData||/^(slow-2g|2g|3g)$/.test(connection?.effectiveType||'');
  const active=()=>ready&&!disposed&&!document.hidden&&!reduced?.matches&&!cover.hidden&&!cover.classList.contains('is-leaving')&&!constrained();
  const cancel=()=>{if(timer!==null){window.clearTimeout(timer);timer=null;}};
  video.muted=true;video.defaultMuted=true;video.volume=0;
  function play(){
    if(!active())return;
    if(!loaded){
      const source=video.dataset.src;if(!source)return;
      video.src=source;loaded=true;video.load();
    }
    // A blocked autoplay leaves the still artwork intact. A visitor's next
    // pointer gesture can retry without blocking entry to the campus.
    try{video.play()?.catch(()=>{});}catch{}
  }
  function playing(){
    if(!active()){video.pause();return;}
    cover.classList.add('has-entry-film');
  }
  function failed(){cover.classList.remove('has-entry-film');}
  function sync(){
    cancel();
    if(active()){
      if(loaded)play();else timer=window.setTimeout(()=>{timer=null;play();},startDelayMs);
    }else video.pause();
    if(reduced?.matches||constrained())cover.classList.remove('has-entry-film');
    cover.classList[document.hidden?'add':'remove']('entry-motion-paused');
  }
  function onReady(){ready=true;sync();}
  function retry(){if(loaded)play();}
  video.addEventListener('playing',playing);video.addEventListener('error',failed);
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('campus:ready',onReady);
  connection?.addEventListener?.('change',sync);
  reduced?.addEventListener?.('change',sync);cover.addEventListener('pointerdown',retry);
  sync();
  return function dispose(){
    if(disposed)return;disposed=true;cancel();
    video.removeEventListener('playing',playing);video.removeEventListener('error',failed);
    document.removeEventListener('visibilitychange',sync);
    window.removeEventListener('campus:ready',onReady);connection?.removeEventListener?.('change',sync);
    reduced?.removeEventListener?.('change',sync);cover.removeEventListener('pointerdown',retry);
    video.pause();video.removeAttribute('src');video.load();
    cover.classList.remove('has-entry-film');cover.classList.remove('entry-motion-paused');
  };
}
