import test from 'node:test';
import assert from 'node:assert/strict';
import {createC118VideoScreen,C118_VIDEO_URL,C118_POSTER_URL} from '../src/c118-video-screen.js';
import {getC118Media} from '../src/c118-media-catalog.js';

const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const namedError=name=>Object.assign(new Error(name),{name});

const makePoster=()=>({disposals:0,dispose(){this.disposals++;}});
function fixture(options={}){
  const states=[],loads=[],textures=[],listeners=new Map();
  const video={paused:true,readyState:0,currentTime:0,duration:NaN,loadCalls:0,pauseCalls:0,removed:false,srcWrites:[],attempts:[],
    set src(value){this._src=value;this.srcWrites.push(value);},get src(){return this._src;},
    setAttribute(){},removeAttribute(key){if(key==='src')this._src=undefined;},
    load(){this.loadCalls++;this.readyState=0;this.duration=NaN;},pause(){this.pauseCalls++;this.paused=true;this.dispatch('pause');},remove(){this.removed=true;},
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    dispatch(type){for(const fn of [...(listeners.get(type)||[])])fn();},
    play(){
      this.paused=false;
      let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
      const attempt={resolve:()=>resolve(),reject:error=>{if(this.attempts.at(-1)===attempt)this.paused=true;reject(error);}};
      this.attempts.push(attempt);return promise;
    },
  };
  const THREE={SRGBColorSpace:'srgb',LinearFilter:'linear',
    TextureLoader:class{load(url,ready,progress,error){loads.push({url,ready,error});}},
    VideoTexture:class{constructor(media){this.media=media;this.disposals=0;textures.push(this);}dispose(){this.disposals++;}},
  };
  const screen={material:{map:null,needsUpdate:false},visible:false,...options.screen};
  const document={body:{append(v){assert.equal(v,video);}},createElement(tag){assert.equal(tag,'video');return video;}};
  options.beforeCreate?.({video,listeners,loads,screen});
  const player=createC118VideoScreen(THREE,{...options,screen,document,onState:s=>{states.push(s);options.onState?.(s);}});
  const poster=makePoster();
  return {player,video,screen,states,textures,poster,listeners,loads,
    readyPoster(index=0,texture=poster){loads[index].ready(texture);return texture;},state:()=>states.at(-1),
    visible(){player.update({active:true,visible:true});},
  };
}

test('initialization callback failure removes media and listeners before the owner is returned',()=>{
  let resources;
  assert.throws(()=>fixture({beforeCreate:value=>{resources=value;},onState(){throw new Error('injected initial UI failure');}}),/injected initial UI failure/);
  assert.equal(resources.video.removed,true);assert.equal(resources.video.paused,true);
  assert.ok([...resources.listeners.values()].every(listeners=>listeners.size===0));
  const late=makePoster();resources.loads[0].ready(late);assert.equal(late.disposals,1);assert.equal(resources.screen.material.map,null);
});

test('campus/invisible hall does not assign video src or load; visible active hall starts once',async()=>{
  const f=fixture();assert.equal(f.video.preload,'none');assert.equal(f.video.muted,true);assert.equal(f.video.playsInline,true);
  f.readyPoster();assert.equal(f.screen.material.map,f.poster);
  f.player.update({active:false,visible:true});f.player.update({active:true,visible:false});
  assert.deepEqual(f.video.srcWrites,[]);assert.equal(f.video.loadCalls,0);assert.equal(f.video.attempts.length,0);
  f.visible();f.visible();assert.deepEqual(f.video.srcWrites,[C118_VIDEO_URL]);assert.equal(f.video.loadCalls,1);assert.equal(f.video.attempts.length,1);
  f.video.readyState=2;f.video.dispatch('loadeddata');assert.equal(f.textures.length,1);assert.equal(f.screen.material.map,f.textures[0]);
  f.video.attempts[0].resolve();await flush();assert.equal(f.state().playing,true);
  f.player.dispose();assert.equal(f.poster.disposals,1);assert.equal(f.textures[0].disposals,1);
});

test('autoplay rejection does not retry on visibility churn; explicit click starts playback',async()=>{
  const f=fixture();f.visible();f.video.attempts[0].reject(namedError('NotAllowedError'));await flush();
  assert.equal(f.state().blocked,true);
  for(let i=0;i<3;i++){f.player.update({active:true,visible:false});f.visible();}
  assert.equal(f.video.attempts.length,1);
  f.player.togglePlayback();assert.equal(f.state().blocked,false);assert.equal(f.video.attempts.length,2);
  f.video.attempts[1].resolve();await flush();assert.equal(f.state().playing,true);f.player.dispose();
});

test('hide then return while play is pending recovers after its delayed AbortError',async()=>{
  const f=fixture();f.visible();
  f.player.update({active:false,visible:true});assert.equal(f.video.paused,true);
  f.visible();assert.equal(f.video.attempts.length,1,'do not overlap pending play requests');
  f.video.attempts[0].reject(namedError('AbortError'));await flush();
  assert.equal(f.video.attempts.length,2);assert.equal(f.state().blocked,false);
  f.video.attempts[1].resolve();await flush();assert.equal(f.state().playing,true);f.player.dispose();
});

test('user pause/resume during pending play follows latest intent even if old play resolves',async()=>{
  const f=fixture();f.visible();f.player.togglePlayback();
  assert.equal(f.state().userPaused,true);assert.equal(f.video.paused,true);
  f.player.togglePlayback();assert.equal(f.state().userPaused,false);assert.equal(f.video.attempts.length,1);
  f.video.attempts[0].resolve();await flush();assert.equal(f.video.attempts.length,2);
  f.video.attempts[1].resolve();await flush();
  f.player.togglePlayback();f.player.update({active:true,visible:false});f.visible();
  assert.equal(f.video.attempts.length,2,'explicit user pause survives looking away and back');f.player.dispose();
});

test('leaving before a pending play settles cannot restart or reassign the source',async()=>{
  const f=fixture();f.visible();f.player.update({active:true,visible:false});
  f.video.attempts[0].reject(namedError('AbortError'));await flush();
  assert.equal(f.video.attempts.length,1);assert.equal(f.video.paused,true);
  assert.equal(f.video.srcWrites.length,1);f.player.dispose();
});

test('media error shows poster, and retry ignores the old failed play outcome',async()=>{
  const f=fixture();f.readyPoster();f.visible();f.video.readyState=2;f.video.dispatch('loadeddata');
  f.video.dispatch('error');assert.equal(f.state().failed,true);assert.equal(f.video.paused,true);assert.equal(f.screen.material.map,f.poster);
  f.player.togglePlayback();assert.equal(f.state().failed,false);assert.equal(f.video.srcWrites.length,2);
  f.video.attempts[0].reject(namedError('NotAllowedError'));await flush();
  assert.equal(f.state().blocked,false);assert.equal(f.video.attempts.length,2);
  f.video.readyState=2;f.video.dispatch('loadeddata');f.video.attempts[1].resolve();await flush();
  assert.equal(f.textures.length,1,'retry reuses the video element and its texture');assert.equal(f.screen.material.map,f.textures[0]);f.player.dispose();
});

test('failure before poster arrives keeps the original stage visible, then displays poster',()=>{
  const f=fixture();f.visible();f.video.dispatch('error');assert.equal(f.screen.visible,false);
  f.readyPoster();assert.equal(f.screen.visible,true);assert.equal(f.screen.material.map,f.poster);f.player.dispose();
});

test('dispose releases textures, source and listeners; late poster/play completion stays inert',async()=>{
  const f=fixture();f.visible();f.video.readyState=2;f.video.dispatch('loadeddata');
  f.player.dispose();f.player.dispose();const stateCount=f.states.length;
  assert.equal(f.video.src,undefined);assert.equal(f.video.removed,true);assert.equal(f.screen.material.map,null);assert.equal(f.screen.visible,false);
  assert.equal(f.textures[0].disposals,1);assert.ok([...f.listeners.values()].every(set=>set.size===0));
  f.readyPoster();assert.equal(f.poster.disposals,1);assert.equal(f.screen.material.map,null);
  f.video.attempts[0].resolve();await flush();assert.equal(f.video.paused,true);assert.equal(f.states.length,stateCount);
  f.visible();f.player.toggleSound();f.player.restart();assert.equal(f.video.attempts.length,1);
});

test('sound and restart use the same player without fetching the video again',async()=>{
  const f=fixture();f.visible();f.video.attempts[0].resolve();await flush();
  f.player.toggleSound();assert.equal(f.state().muted,false);
  f.video.currentTime=77;f.player.togglePlayback();f.player.restart();
  assert.equal(f.video.currentTime,0);assert.equal(f.state().userPaused,false);assert.equal(f.video.attempts.length,2);
  assert.equal(f.video.srcWrites.length,1);f.player.dispose();
});

test('playlist accepts only trusted IDs and nonnegative integer revisions, with an inert initial snapshot',()=>{
  const f=fixture();
  assert.equal(f.loads[0].url,C118_POSTER_URL);
  assert.equal(f.state().mediaId,'vibe-coding');assert.equal(f.state().duration,112);
  for(const next of [null,{},
    {mediaId:'https://untrusted.example/video.mp4',revision:1},
    {mediaId:'club-promo',revision:-1},{mediaId:'club-promo',revision:1.5},
    {mediaId:'club-promo',revision:Infinity},{mediaId:'club-promo',revision:'1'},
    {mediaId:'vibe-coding',revision:0}])assert.equal(f.player.selectMedia(next),false);
  assert.equal(f.loads.length,1);assert.equal(f.video.loadCalls,0);assert.deepEqual(f.video.srcWrites,[]);
  f.player.dispose();
});

test('inactive selections load only their poster; entering downloads only the latest selected film',()=>{
  const f=fixture(),promo=getC118Media('club-promo');
  assert.equal(f.player.selectMedia({mediaId:'club-promo',revision:1}),true);
  assert.equal(f.state().mediaId,'club-promo');assert.equal(f.state().title,'AI 俱乐部宣传片');
  assert.equal(f.state().duration,promo.duration);assert.equal(f.state().time,0);
  assert.deepEqual(f.video.srcWrites,[]);assert.equal(f.video.loadCalls,0);assert.equal(f.video.attempts.length,0);
  assert.equal(f.loads.at(-1).url,promo.poster);
  f.player.update({active:true,visible:false});assert.equal(f.video.loadCalls,0);
  f.visible();assert.deepEqual(f.video.srcWrites,[promo.src]);assert.equal(f.video.loadCalls,1);
  f.player.dispose();
});

test('host switches reuse the video, retain sound choices and reset a local pause; repeated snapshots do nothing',async()=>{
  const f=fixture(),identity=f.player.video;f.visible();f.video.attempts[0].resolve();await flush();
  f.player.toggleSound();f.video.volume=.35;f.video.currentTime=64;f.player.togglePlayback();
  assert.equal(f.state().userPaused,true);
  assert.equal(f.player.selectMedia({mediaId:'club-promo',revision:7}),true);
  assert.equal(f.player.video,identity);assert.equal(f.state().userPaused,false);assert.equal(f.state().muted,false);
  assert.equal(f.video.volume,.35);assert.equal(f.video.currentTime,0);assert.equal(f.video.attempts.length,2);
  assert.equal(f.state().duration,getC118Media('club-promo').duration);
  f.video.currentTime=18;const loadCount=f.video.loadCalls,posterCount=f.loads.length;
  assert.equal(f.player.selectMedia({mediaId:'club-promo',revision:7}),false);
  assert.equal(f.video.currentTime,18);assert.equal(f.video.loadCalls,loadCount);assert.equal(f.loads.length,posterCount);
  assert.equal(f.video.attempts.length,2);
  f.video.attempts[1].resolve();await flush();f.player.dispose();
});

test('a new revision replays the same film without downloading it or its poster again',async()=>{
  const f=fixture();f.visible();f.video.attempts[0].resolve();await flush();
  f.video.currentTime=81;f.player.togglePlayback();
  assert.equal(f.player.selectMedia({mediaId:'vibe-coding',revision:1}),true);
  assert.equal(f.video.currentTime,0);assert.equal(f.state().userPaused,false);
  assert.equal(f.video.loadCalls,1);assert.equal(f.video.srcWrites.length,1);assert.equal(f.loads.length,1);
  assert.equal(f.video.attempts.length,2);f.readyPoster();assert.equal(f.screen.material.map,f.poster);
  f.video.attempts[1].resolve();await flush();f.player.dispose();
});

test('a switch during an inactive hall or tsunami pause waits for reactivation and ignores old media events',async()=>{
  const f=fixture();f.visible();f.video.attempts[0].resolve();await flush();
  f.video.readyState=2;f.video.dispatch('loadeddata');f.video.currentTime=40;
  f.player.update({active:false,visible:true});
  assert.equal(f.player.selectMedia({mediaId:'club-promo',revision:2}),true);
  assert.equal(f.video.src,undefined);assert.equal(f.video.loadCalls,2,'the only load aborts the removed old source');
  assert.deepEqual(f.video.srcWrites,[C118_VIDEO_URL]);assert.equal(f.video.attempts.length,1);
  f.video.dispatch('error');f.video.readyState=2;f.video.dispatch('loadeddata');
  assert.equal(f.state().failed,false);assert.equal(f.screen.material.map,null);
  f.visible();assert.equal(f.video.src,getC118Media('club-promo').src);assert.equal(f.video.attempts.length,2);
  f.video.attempts[1].resolve();await flush();f.player.dispose();
});

for(const outcome of ['resolve','reject'])test(`the old film's delayed play ${outcome} cannot affect the new film or its pending request`,async()=>{
  const f=fixture();f.visible();const old=f.video.attempts[0];
  f.player.selectMedia({mediaId:'club-promo',revision:1});assert.equal(f.video.attempts.length,2);
  const pauses=f.video.pauseCalls;
  if(outcome==='resolve')old.resolve();else old.reject(namedError('NotAllowedError'));
  await flush();assert.equal(f.video.pauseCalls,pauses);assert.equal(f.state().blocked,false);assert.equal(f.video.paused,false);
  f.player.update({active:true,visible:false});f.visible();
  assert.equal(f.video.attempts.length,2,'the new play request remains pending after the old one settles');
  f.video.attempts[1].reject(namedError('AbortError'));await flush();
  assert.equal(f.video.attempts.length,3);assert.equal(f.state().blocked,false);
  f.video.attempts[2].resolve();await flush();f.player.dispose();
});

test('a host replay invalidates the old pending play promise even when the media ID is unchanged',async()=>{
  const f=fixture();f.visible();
  f.player.selectMedia({mediaId:'vibe-coding',revision:1});assert.equal(f.video.attempts.length,2);
  f.video.attempts[0].reject(namedError('NotAllowedError'));await flush();
  assert.equal(f.state().blocked,false);assert.equal(f.video.paused,false);assert.equal(f.video.loadCalls,1);
  f.video.attempts[1].resolve();await flush();f.player.dispose();
});

test('late posters cannot cover a newer poster or decoded frame, and replaced textures are released',()=>{
  const f=fixture();f.player.selectMedia({mediaId:'club-promo',revision:1});
  const promoPoster=f.readyPoster(1,makePoster());f.readyPoster();
  assert.equal(f.poster.disposals,1);assert.equal(f.screen.material.map,promoPoster);
  f.visible();f.video.readyState=2;f.video.dispatch('loadeddata');const promoTexture=f.textures[0];
  f.player.selectMedia({mediaId:'vibe-coding',revision:2});
  assert.equal(promoPoster.disposals,1);assert.equal(promoTexture.disposals,1);
  f.video.readyState=2;f.video.dispatch('loadeddata');const currentTexture=f.textures[1];
  const currentPoster=f.readyPoster(2,makePoster());assert.equal(f.screen.material.map,currentTexture);
  f.player.dispose();assert.equal(currentTexture.disposals,1);assert.equal(currentPoster.disposals,1);
});

test('legacy source and poster options remain effective when returning to the default film',()=>{
  const f=fixture({src:'./custom.mp4',poster:'./custom.jpg'});
  assert.equal(f.loads[0].url,'./custom.jpg');f.visible();assert.equal(f.video.src,'./custom.mp4');
  f.player.selectMedia({mediaId:'club-promo',revision:1});
  f.player.selectMedia({mediaId:'vibe-coding',revision:2});
  assert.equal(f.video.src,'./custom.mp4');assert.equal(f.loads.at(-1).url,'./custom.jpg');f.player.dispose();
});

test('metadata fits the video inside the original screen bounds without cumulative scaling',()=>{
  const scale={x:2,y:2,z:1,set(x,y,z){Object.assign(this,{x,y,z});}};
  const f=fixture({screen:{geometry:{parameters:{width:9.8,height:6}},scale}});f.visible();
  Object.assign(f.video,{videoWidth:1280,videoHeight:720,duration:97.533333});f.video.dispatch('loadedmetadata');
  assert.equal(scale.x,2);assert.ok(Math.abs(scale.y-1.8375)<1e-10);assert.equal(scale.z,1);
  assert.equal(f.state().duration,97.533333);
  f.video.dispatch('loadedmetadata');assert.ok(Math.abs(scale.y-1.8375)<1e-10);
  Object.assign(f.video,{videoWidth:720,videoHeight:1280});f.video.dispatch('loadedmetadata');
  assert.equal(scale.y,2);assert.ok(scale.x<2);
  f.player.dispose();assert.deepEqual({x:scale.x,y:scale.y,z:scale.z},{x:2,y:2,z:1});
});

test('dispose after a switch prevents both generations of async work from touching the screen',async()=>{
  const f=fixture();f.visible();f.player.selectMedia({mediaId:'club-promo',revision:1});
  f.player.dispose();const count=f.states.length;
  const oldPoster=f.readyPoster(0,makePoster()),newPoster=f.readyPoster(1,makePoster());
  assert.equal(oldPoster.disposals,1);assert.equal(newPoster.disposals,1);
  f.video.attempts[0].reject(namedError('AbortError'));f.video.attempts[1].resolve();await flush();
  assert.equal(f.screen.material.map,null);assert.equal(f.screen.visible,false);assert.equal(f.video.paused,true);
  assert.equal(f.video.src,undefined);assert.equal(f.states.length,count);
  assert.ok([...f.listeners.values()].every(set=>set.size===0));
  assert.equal(f.player.selectMedia({mediaId:'vibe-coding',revision:2}),false);
});
