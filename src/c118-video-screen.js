// C118-only media: never imported or awaited by the campus loading path.
export const C118_VIDEO_URL='./media/c118-vibe-coding-720p-v1.mp4';
export const C118_POSTER_URL='./media/c118-vibe-coding-poster-v1.jpg';

export function createC118VideoScreen(THREE,{screen,document=globalThis.document,
  src=C118_VIDEO_URL,poster=C118_POSTER_URL,onState=()=>{}}){
  const video=document.createElement('video');
  video.id='c118-screen-video';video.hidden=true;video.preload='none';
  video.loop=true;video.muted=true;video.playsInline=true;video.volume=.7;
  video.setAttribute('playsinline','');video.setAttribute('aria-hidden','true');
  document.body.append(video);
  let disposed=false,active=false,visible=false,userPaused=false,blocked=false,failed=false;
  let assigned=false,pending=null,waiting=false,posterTexture=null,videoTexture=null,lastState='';
  const listeners=[];
  const on=(type,fn)=>{video.addEventListener(type,fn);listeners.push(()=>video.removeEventListener(type,fn));};
  const wanted=()=>!disposed&&active&&visible&&!userPaused&&!blocked&&!failed;
  function emit(){
    if(disposed)return;
    const state={muted:video.muted,userPaused,blocked,failed,active,visible,
      loading:assigned&&(waiting||video.readyState<2),playing:!video.paused,
      time:Math.floor(video.currentTime||0),duration:Number.isFinite(video.duration)?Math.floor(video.duration):112};
    const signature=JSON.stringify(state);if(signature===lastState)return;lastState=signature;onState(state);
  }
  function show(texture){if(disposed)return;screen.material.map=texture;screen.material.needsUpdate=true;screen.visible=true;}
  function pause(){if(pending)pending.interrupted=true;video.pause();}
  function fail(){
    if(disposed)return;failed=true;waiting=false;pause();
    if(posterTexture)show(posterTexture);else screen.visible=false;
    emit();
  }
  function sync(){
    if(disposed)return;
    if(!wanted()){if(pending||!video.paused)pause();emit();return;}
    if(!assigned){assigned=true;waiting=true;video.src=src;video.load();}
    if(!pending&&video.paused){
      const attempt={interrupted:false};pending=attempt;
      let request;try{request=video.play();}catch(error){request=Promise.reject(error);}
      Promise.resolve(request).then(()=>{
        pending=null;
        if(disposed||!wanted())video.pause();
        else if(attempt.interrupted&&video.paused){sync();return;}
        emit();
      },error=>{
        pending=null;if(disposed)return;
        // A pause/load can reject after the viewer has already returned. Wait
        // for that old attempt to settle, then obey the latest desired state.
        if(attempt.interrupted){sync();return;}
        if(!wanted()){emit();return;}
        blocked=true;waiting=false;emit();
      });
    }
    emit();
  }
  new THREE.TextureLoader().load(poster,texture=>{
    if(disposed){texture.dispose();return;}
    posterTexture=texture;texture.colorSpace=THREE.SRGBColorSpace;
    texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
    if(!videoTexture||failed)show(texture);
  },undefined,()=>{/* The model's original stage graphic remains available. */});
  on('loadeddata',()=>{
    if(disposed||failed)return;
    if(!videoTexture){videoTexture=new THREE.VideoTexture(video);videoTexture.colorSpace=THREE.SRGBColorSpace;}
    show(videoTexture);waiting=false;emit();
  });
  on('waiting',()=>{waiting=true;emit();});
  on('playing',()=>{waiting=false;emit();});
  for(const type of ['pause','timeupdate','durationchange','volumechange'])on(type,emit);
  on('error',fail);
  emit();
  return {
    video,
    update(next){
      if(disposed)return;
      const a=Boolean(next.active),v=Boolean(next.visible);
      if(a===active&&v===visible)return;
      active=a;visible=v;sync();
    },
    togglePlayback(){
      if(disposed)return;
      if(failed){pause();failed=false;blocked=false;userPaused=false;assigned=false;video.removeAttribute('src');video.load();}
      else if(blocked){blocked=false;userPaused=false;}
      else userPaused=!userPaused;
      sync();
    },
    toggleSound(){if(disposed)return;video.muted=!video.muted;blocked=false;sync();},
    restart(){if(disposed)return;try{video.currentTime=0;}catch{}userPaused=false;blocked=false;sync();},
    dispose(){
      if(disposed)return;disposed=true;listeners.forEach(fn=>fn());video.pause();
      video.removeAttribute('src');video.load();video.remove();
      screen.material.map=null;screen.material.needsUpdate=true;screen.visible=false;
      posterTexture?.dispose();videoTexture?.dispose();
    },
  };
}
