import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMPUS_TRACKS,MUSIC_STORAGE_KEY,createCampusMusic,selectCampusTrack,readMusicPreference} from '../src/campus-music.js';

const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function setup({deferred=false,tracks={...CAMPUS_TRACKS,vehicle:{title:'Sunflower',url:'/audio/sunflower-v1.m4a'},spider:{title:'Scared of the Dark',url:'/audio/scared-of-the-dark-v1.m4a'}},storage}={}){
  const audios=[],events=[];let time=0,id=0;const timers=new Map();
  class FakeAudio{
    paused=true;currentTime=0;duration=300;volume=1;requests=[];handlers=new Map();_src='';assignments=[];
    set src(value){this._src=new URL(value,'https://campus.example/').href;this.currentTime=0;this.assignments.push(value);}
    get src(){return this._src;}
    setAttribute(){}removeAttribute(){this._src='';}load(){this.loads=(this.loads||0)+1;}
    addEventListener(type,fn){this.handlers.set(type,fn);}removeEventListener(type){this.handlers.delete(type);}
    pause(){this.paused=true;}
    play(){this.plays=(this.plays||0)+1;this.paused=false;if(!deferred||this.src.startsWith('data:'))return Promise.resolve();return new Promise((resolve,reject)=>this.requests.push({resolve:()=>{this.paused=false;resolve();},reject}));}
  }
  const music=createCampusMusic({tracks,storage,createAudio:()=>{const a=new FakeAudio();audios.push(a);return a;},createContext:()=>null,
    now:()=>time,schedule:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id;},cancel:id=>timers.delete(id),onState:s=>events.push(s)});
  function advance(ms){const end=time+ms;for(let i=0;i<1000;i++){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;}
  async function start(){music.update({ready:true,registered:true});music.unlock();await flush();if(deferred){for(const a of audios)for(const r of a.requests.splice(0))r.resolve();await flush();}advance(900);}
  return{music,audios,events,advance,start,timers,playing:()=>audios.filter(a=>!a.paused&&a.volume>0),forTrack:key=>audios.find(a=>a.src.endsWith(tracks[key].url))};
}
test('scene priorities select all six requested songs, with indoor/game precedence',()=>{
  for(const atmosphere of ['day','sunset','night']){
    assert.equal(selectCampusTrack({atmosphere}),atmosphere==='day'?'campus':'evening');
    assert.equal(selectCampusTrack({atmosphere,mode:'roadster'}),'vehicle');
    for(const mode of ['walk','scooter','hoverboard','helicopter','boat'])assert.equal(selectCampusTrack({atmosphere,mode}),atmosphere==='day'?'campus':'evening');
    assert.equal(selectCampusTrack({atmosphere,mode:'spider'}),'spider');
    assert.equal(selectCampusTrack({atmosphere,mode:'roadster',experience:'opto-c118'}),'opto');
    assert.equal(selectCampusTrack({atmosphere,mode:'spider',experience:'tasay'}),'tasay');
    for(const experience of ['library','wanyan','she-love-me'])assert.equal(selectCampusTrack({experience,mode:'spider'}),null);
  }
});
test('nothing loads or plays before consent, world readiness and nickname registration',async()=>{
  const f=setup();f.music.update({ready:true});await flush();assert.ok(f.audios.every(a=>a.assignments.length===0));
  f.music.update({registered:true});await flush();assert.ok(f.audios.every(a=>a.assignments.length===0));
  f.music.unlock();await flush();f.advance(900);assert.equal(f.music.state.trackId,'campus');assert.equal(f.playing().length,1);assert.equal(f.music.state.playing,true);f.music.dispose();
  const early=setup();early.music.unlock();await flush();assert.ok(early.audios.every(a=>a.assignments.every(s=>s.startsWith('data:'))));
  early.music.update({registered:true});await flush();assert.ok(early.audios.every(a=>a.assignments.every(s=>s.startsWith('data:'))));
  early.music.update({ready:true});await flush();early.advance(900);assert.equal(early.playing().length,1);early.music.dispose();
});
test('entering and leaving each scene fades once and restores the right background',async()=>{
  const f=setup();await f.start();
  for(const [scene,key]of [[{experience:'opto-c118'},'opto'],[{experience:null},'campus'],[{mode:'roadster'},'vehicle'],[{mode:'hoverboard'},'campus'],[{mode:'helicopter'},'campus'],[{mode:'spider'},'spider'],[{mode:'walk',atmosphere:'sunset'},'evening'],[{atmosphere:'night'},'evening'],[{experience:'tasay'},'tasay'],[{experience:null},'evening'],[{atmosphere:'day'},'campus']]){
    f.music.update(scene);await flush();f.advance(900);assert.equal(f.music.state.trackId,key);assert.equal(f.playing().length,1);assert.equal(f.playing()[0],f.forTrack(key));
    const assignments=f.audios.map(a=>a.assignments.length);f.music.update(scene);await flush();assert.deepEqual(f.audios.map(a=>a.assignments.length),assignments,'same scene must not reload');
  }
  f.music.dispose();assert.equal(f.timers.size,0);
});
test('campus music position survives a room visit and source reuse',async()=>{
  const f=setup();await f.start();f.forTrack('campus').currentTime=42;
  f.music.update({experience:'opto-c118'});await flush();f.advance(900);
  f.music.update({experience:'tasay'});await flush();f.advance(900);
  f.music.update({experience:null});await flush();f.forTrack('campus').handlers.get('loadedmetadata')();f.advance(900);
  assert.equal(f.forTrack('campus').currentTime,42);f.music.dispose();
});
test('hidden pages, host pause and room video yield immediately and resume without restarting',async()=>{
  const f=setup();await f.start();
  for(const property of ['hidden','paused','foregroundAudio']){
    const a=f.playing()[0];a.currentTime=29;f.music.update({[property]:true});assert.ok(f.audios.every(a=>a.paused&&a.volume===0));
    f.music.update({[property]:false});await flush();f.advance(900);assert.equal(f.playing().length,1);assert.equal(f.playing()[0].currentTime,29);
  }
  f.music.update({experience:'wanyan'});assert.ok(f.audios.every(a=>a.paused));f.music.update({experience:null});await flush();f.advance(900);assert.equal(f.playing().length,1);f.music.dispose();
});
test('muting persists and changing scenery while muted causes no downloads',async()=>{
  const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
  const f=setup({storage});await f.start();f.music.setMuted(true);const counts=f.audios.map(a=>a.assignments.length);
  f.music.update({experience:'tasay'});assert.deepEqual(f.audios.map(a=>a.assignments.length),counts);assert.ok(f.audios.every(a=>a.paused));
  f.music.setVolume(.2);assert.deepEqual(JSON.parse(saved.get(MUSIC_STORAGE_KEY)),{muted:true,volume:.2});
  f.music.setMuted(false);await flush();f.advance(900);assert.equal(f.playing()[0].volume,.2);assert.equal(f.music.state.trackId,'tasay');
  f.music.setVolume(0);assert.ok(f.audios.every(a=>a.paused));f.music.dispose();
  assert.deepEqual(readMusicPreference({getItem:()=>'{broken'}),{muted:false,volume:.36});assert.deepEqual(readMusicPreference({getItem:()=>'{"volume":2,"muted":true}'}),{muted:true,volume:1});
});
test('an obsolete play promise cannot restart audio after a pause, return or dispose',async()=>{
  const f=setup({deferred:true});await f.start();
  f.music.update({experience:'opto-c118'});const room=f.forTrack('opto'),pending=room.requests.shift();
  f.music.update({experience:null});pending.resolve();await flush();f.advance(900);assert.equal(f.playing().length,1);assert.equal(f.playing()[0],f.forTrack('campus'));
  f.music.update({experience:'tasay'});const last=f.forTrack('tasay'),tail=last.requests.shift();f.music.update({hidden:true});tail.resolve();await flush();assert.ok(f.audios.every(a=>a.paused||a.volume===0));
  f.music.update({hidden:false});const after=last.requests.shift();f.music.dispose();after.resolve();await flush();assert.ok(f.audios.every(a=>a.volume===0));assert.equal(f.timers.size,0);
});
test('rapid room/game switches keep only the latest requested song',async()=>{
  const f=setup({deferred:true});await f.start();f.music.update({experience:'opto-c118'});const deck=f.forTrack('opto'),old=deck.requests.shift();
  f.music.update({experience:'tasay'});const latest=f.forTrack('tasay').requests.shift();old.resolve();await flush();latest.resolve();await flush();f.advance(900);
  assert.equal(f.music.state.trackId,'tasay');assert.equal(f.playing().length,1);assert.equal(f.playing()[0],f.forTrack('tasay'));f.music.dispose();
});
test('autoplay denial is recoverable by a user gesture without retry loops',async()=>{
  const f=setup({deferred:true});await f.start();f.music.update({experience:'opto-c118'});const a=f.forTrack('opto');a.requests.shift().reject(Object.assign(Error('gesture needed'),{name:'NotAllowedError'}));await flush();
  assert.equal(f.music.state.blocked,true);assert.equal(f.music.state.status,'blocked');assert.ok(f.audios.every(a=>a.paused));
  const plays=a.plays;f.music.update({mode:'walk'});assert.equal(a.plays,plays);f.music.unlock();a.requests.shift().resolve();await flush();f.advance(900);assert.equal(f.music.state.blocked,false);assert.equal(f.playing().length,1);f.music.dispose();
});
test('an unavailable file falls back once, with no infinite failed requests',async()=>{
  const f=setup({deferred:true});await f.start();f.music.update({experience:'opto-c118'});const a=f.forTrack('opto');a.requests.shift().reject(Object.assign(Error('decode failed'),{name:'NotSupportedError'}));await flush();
  assert.equal(f.music.state.trackId,'campus');assert.equal(f.playing().length,1);const count=a.plays;f.music.update({atmosphere:'day'});await flush();assert.equal(a.plays,count);f.music.dispose();
});
test('missing vehicle and suit assets retain the selected campus background',async()=>{
  const f=setup({tracks:CAMPUS_TRACKS});await f.start();f.music.update({mode:'spider'});assert.equal(f.music.state.trackId,CAMPUS_TRACKS.spider.url?'spider':'campus');
  f.music.update({mode:'roadster',atmosphere:'night'});await flush();f.advance(900);assert.equal(f.music.state.trackId,CAMPUS_TRACKS.vehicle.url?'vehicle':'evening');f.music.dispose();
});
