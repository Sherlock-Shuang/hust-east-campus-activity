import {C118_DEFAULT_MEDIA_ID,getC118Media} from './c118-media-catalog.js';

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
  const defaultMedia={...getC118Media(C118_DEFAULT_MEDIA_ID),src,poster};
  let media=defaultMedia,revision=0,generation=0,posterGeneration=0;
  let disposed=false,active=false,visible=false,userPaused=false,blocked=false,failed=false,changing=false;
  let assigned=false,pending=null,waiting=false,posterTexture=null,videoTexture=null,lastState='',hasFrame=false;
  const baseScale=screen.scale?{x:screen.scale.x,y:screen.scale.y,z:screen.scale.z}:null;
  const listeners=[];
  const on=(type,fn)=>{video.addEventListener(type,fn);listeners.push(()=>video.removeEventListener(type,fn));};
  const wanted=()=>!disposed&&active&&visible&&!userPaused&&!blocked&&!failed;
  const currentSource=()=>assigned&&(!video.currentSrc||video.currentSrc===video.src);
  function emit(){
    if(disposed||changing)return;
    const state={mediaId:media.id,title:media.title,muted:video.muted,userPaused,blocked,failed,active,visible,
      loading:assigned&&(waiting||video.readyState<2),playing:assigned&&!video.paused,
      time:assigned?Math.floor(video.currentTime||0):0,
      duration:assigned&&Number.isFinite(video.duration)&&video.duration>0?video.duration:media.duration};
    const signature=JSON.stringify(state);if(signature===lastState)return;lastState=signature;onState(state);
  }
  function show(texture){if(disposed)return;screen.material.map=texture;screen.material.needsUpdate=true;screen.visible=true;}
  function pause(){if(pending)pending.interrupted=true;video.pause();}
  function fitVideo(){
    const p=screen.geometry?.parameters;
    if(!baseScale||!p?.width||!p?.height||!currentSource()||!(video.videoWidth>0&&video.videoHeight>0))return;
    const available=p.width*Math.abs(baseScale.x)/(p.height*Math.abs(baseScale.y));
    if(!(available>0))return;
    const aspect=video.videoWidth/video.videoHeight;
    screen.scale.set(baseScale.x*Math.min(1,aspect/available),baseScale.y*Math.min(1,available/aspect),baseScale.z);
  }
  function loadPoster(){
    const version=++posterGeneration;
    new THREE.TextureLoader().load(media.poster,texture=>{
      if(disposed||version!==posterGeneration){texture.dispose();return;}
      posterTexture=texture;texture.colorSpace=THREE.SRGBColorSpace;
      texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
      if(!hasFrame||failed)show(texture);
    },undefined,()=>{/* The model's original stage graphic remains available. */});
  }
  function fail(){
    if(disposed||!currentSource())return;failed=true;waiting=false;pause();
    if(posterTexture)show(posterTexture);else screen.visible=false;
    emit();
  }
  function sync(){
    if(disposed)return;
    if(!wanted()){if(pending||!video.paused)pause();emit();return;}
    if(!assigned){assigned=true;waiting=true;video.src=media.src;video.load();}
    if(!pending&&video.paused){
      const attempt={interrupted:false,generation};pending=attempt;
      let request;try{request=video.play();}catch(error){request=Promise.reject(error);}
      Promise.resolve(request).then(()=>{
        if(disposed){video.pause();return;}
        // Replacing a source or host command invalidates the old promise. It
        // must never pause the new film or clear its pending play request.
        if(attempt.generation!==generation||pending!==attempt)return;
        pending=null;
        if(!wanted())video.pause();
        else if(attempt.interrupted&&video.paused){sync();return;}
        emit();
      },()=>{
        if(disposed||attempt.generation!==generation||pending!==attempt)return;
        pending=null;
        // A pause/load can reject after the viewer has already returned. Wait
        // for that old attempt to settle, then obey the latest desired state.
        if(attempt.interrupted){sync();return;}
        if(!wanted()){emit();return;}
        blocked=true;waiting=false;emit();
      });
    }
    emit();
  }
  function clearSource(){
    const hadSource=assigned;assigned=false;waiting=false;hasFrame=false;
    if(hadSource){video.removeAttribute('src');video.load();}
  }
  loadPoster();
  on('loadedmetadata',()=>{if(disposed)return;fitVideo();emit();});
  on('loadeddata',()=>{
    if(disposed||failed||!currentSource()||video.readyState<2)return;
    if(!videoTexture){videoTexture=new THREE.VideoTexture(video);videoTexture.colorSpace=THREE.SRGBColorSpace;}
    hasFrame=true;fitVideo();show(videoTexture);waiting=false;emit();
  });
  on('waiting',()=>{if(currentSource()){waiting=true;emit();}});
  on('playing',()=>{if(currentSource()){waiting=false;emit();}});
  for(const type of ['pause','timeupdate','durationchange','volumechange'])on(type,emit);
  on('error',fail);
  emit();
  return {
    video,
    selectMedia(next){
      if(disposed||!next||!Number.isSafeInteger(next.revision)||next.revision<0)return false;
      const selected=getC118Media(next.mediaId);
      if(!selected||(selected.id===media.id&&next.revision===revision))return false;
      const different=selected.id!==media.id,retry=failed;
      changing=true;generation++;pending=null;
      media=selected.id===C118_DEFAULT_MEDIA_ID?defaultMedia:selected;revision=next.revision;
      video.pause();userPaused=false;blocked=false;failed=false;
      if(different||retry)clearSource();
      try{video.currentTime=0;}catch{}
      if(different){
        screen.material.map=null;screen.material.needsUpdate=true;screen.visible=false;
        posterTexture?.dispose();posterTexture=null;videoTexture?.dispose();videoTexture=null;
        loadPoster();
      }
      changing=false;sync();return true;
    },
    update(next){
      if(disposed)return;
      const a=Boolean(next.active),v=Boolean(next.visible);
      if(a===active&&v===visible)return;
      active=a;visible=v;sync();
    },
    togglePlayback(){
      if(disposed)return;
      if(failed){pause();failed=false;blocked=false;userPaused=false;clearSource();}
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
      if(baseScale)screen.scale.set(baseScale.x,baseScale.y,baseScale.z);
      posterTexture?.dispose();videoTexture?.dispose();
    },
  };
}
