import test from 'node:test';
import assert from 'node:assert/strict';
import {createC118VideoScreen,C118_VIDEO_URL} from '../src/c118-video-screen.js';

const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const namedError=name=>Object.assign(new Error(name),{name});

function fixture(){
  const states=[],loads=[],textures=[],listeners=new Map();
  const video={paused:true,readyState:0,currentTime:0,duration:NaN,loadCalls:0,pauseCalls:0,removed:false,srcWrites:[],attempts:[],
    set src(value){this._src=value;this.srcWrites.push(value);},get src(){return this._src;},
    setAttribute(){},removeAttribute(key){if(key==='src')this._src=undefined;},
    load(){this.loadCalls++;},pause(){this.pauseCalls++;this.paused=true;this.dispatch('pause');},remove(){this.removed=true;},
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
    dispatch(type){for(const fn of [...(listeners.get(type)||[])])fn();},
    play(){
      this.paused=false;
      let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
      this.attempts.push({resolve:()=>resolve(),reject:error=>{this.paused=true;reject(error);}});return promise;
    },
  };
  const THREE={SRGBColorSpace:'srgb',LinearFilter:'linear',
    TextureLoader:class{load(url,ready,progress,error){loads.push({url,ready,error});}},
    VideoTexture:class{constructor(media){this.media=media;this.disposals=0;textures.push(this);}dispose(){this.disposals++;}},
  };
  const screen={material:{map:null,needsUpdate:false},visible:false};
  const document={body:{append(v){assert.equal(v,video);}},createElement(tag){assert.equal(tag,'video');return video;}};
  const player=createC118VideoScreen(THREE,{screen,document,onState:s=>states.push(s)});
  const poster={disposals:0,dispose(){this.disposals++;}};
  return {player,video,screen,states,textures,poster,listeners,
    readyPoster(){loads[0].ready(poster);},state:()=>states.at(-1),
    visible(){player.update({active:true,visible:true});},
  };
}

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
  f.video.dispatch('loadeddata');f.video.attempts[1].resolve();await flush();
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
