// The film is exported without an audio stream. Runtime muting is a second
// safeguard, including on browsers that require it for inline autoplay.
export function mountEntryCoverMotion({cover,video,window=globalThis.window,document=globalThis.document}={}){
  if(!cover||!video)return()=>{};
  const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let disposed=false,loaded=false;
  const active=()=>!disposed&&!document.hidden&&!reduced?.matches&&!cover.hidden;
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
    if(active())play();else video.pause();
    if(reduced?.matches)cover.classList.remove('has-entry-film');
    cover.classList[document.hidden?'add':'remove']('entry-motion-paused');
  }
  video.addEventListener('playing',playing);video.addEventListener('error',failed);
  document.addEventListener('visibilitychange',sync);
  reduced?.addEventListener?.('change',sync);cover.addEventListener('pointerdown',play);
  sync();
  return function dispose(){
    if(disposed)return;disposed=true;
    video.removeEventListener('playing',playing);video.removeEventListener('error',failed);
    document.removeEventListener('visibilitychange',sync);
    reduced?.removeEventListener?.('change',sync);cover.removeEventListener('pointerdown',play);
    video.pause();video.removeAttribute('src');video.load();
    cover.classList.remove('has-entry-film');cover.classList.remove('entry-motion-paused');
  };
}
