import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEntryCoverMotion} from '../src/entry-cover-motion.js';

function fixture({reduced=false,hidden=false,blocked=false,ready=true,saveData=false,effectiveType='4g'}={}){
  const cover=new EventTarget(),video=new EventTarget(),document=new EventTarget(),preference=new EventTarget();
  const classes=new Set();cover.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
  cover.hidden=false;document.hidden=hidden;preference.matches=reduced;
  let plays=0,pauses=0,loads=0;
  video.dataset={src:'/media/entry-cover/east-campus-sunset-v2.mp4'};
  video.play=()=>{plays++;return blocked?Promise.reject(new Error('autoplay blocked')):Promise.resolve();};
  video.pause=()=>pauses++;video.load=()=>loads++;video.removeAttribute=name=>delete video[name];
  document.documentElement={dataset:ready?{campusReady:'true'}:{}};
  const timers=new Map();let next=0;const connection=new EventTarget();Object.assign(connection,{saveData,effectiveType});
  const window=Object.assign(new EventTarget(),{matchMedia:()=>preference,navigator:{connection},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id)});
  const flush=()=>{const jobs=[...timers.values()];timers.clear();for(const fn of jobs)fn();};
  const dispose=mountEntryCoverMotion({cover,video,document,window});
  const visible=value=>{document.hidden=!value;document.dispatchEvent(new Event('visibilitychange'));flush();};
  const reduce=value=>{preference.matches=value;preference.dispatchEvent(new Event('change'));flush();};
  flush();
  return {cover,video,dispose,visible,reduce,flush,window,connection,timers,get plays(){return plays;},get pauses(){return pauses;},get loads(){return loads;}};
}

test('silent inline film only replaces its poster once playback actually starts',()=>{
  const f=fixture();assert.equal(f.video.muted,true);assert.equal(f.video.defaultMuted,true);assert.equal(f.video.volume,0);
  assert.equal(f.plays,1);assert.equal(f.loads,1);assert.equal(f.cover.classList.contains('has-entry-film'),false);
  f.video.dispatchEvent(new Event('playing'));assert.equal(f.cover.classList.contains('has-entry-film'),true);
  f.video.dispatchEvent(new Event('error'));assert.equal(f.cover.classList.contains('has-entry-film'),false);f.dispose();
});

test('reduced motion avoids a video download and reacts to preference and visibility changes',()=>{
  const f=fixture({reduced:true});assert.equal(f.video.src,undefined);assert.equal(f.plays,0);assert.equal(f.loads,0);
  f.reduce(false);assert.equal(f.loads,1);assert.equal(f.plays,1);f.video.dispatchEvent(new Event('playing'));
  f.visible(false);assert.equal(f.cover.classList.contains('entry-motion-paused'),true);const paused=f.pauses;
  f.visible(true);assert.equal(f.plays,2);assert.equal(f.loads,1);
  f.reduce(true);assert.ok(f.pauses>paused);assert.equal(f.cover.classList.contains('has-entry-film'),false);f.dispose();
});

test('a failed autoplay keeps the poster and can retry on a visitor gesture',async()=>{
  const f=fixture({blocked:true});await Promise.resolve();assert.equal(f.cover.classList.contains('has-entry-film'),false);
  f.cover.dispatchEvent(new Event('pointerdown'));await Promise.resolve();assert.equal(f.plays,2);f.dispose();
});

test('exit releases the media source and all listeners, including a late playing event',()=>{
  const f=fixture();f.dispose();const {plays,loads,pauses}=f;f.dispose();
  f.video.dispatchEvent(new Event('playing'));f.visible(false);f.visible(true);f.reduce(false);f.cover.dispatchEvent(new Event('pointerdown'));
  assert.equal(f.video.src,undefined);assert.equal(f.plays,plays);assert.equal(f.loads,loads);assert.equal(f.pauses,pauses);assert.equal(f.cover.classList.contains('has-entry-film'),false);
});


test('cold entry and pointer gestures cannot download the film before the campus is ready',()=>{
 const f=fixture({ready:false});assert.equal(f.loads,0);f.cover.dispatchEvent(new Event('pointerdown'));assert.equal(f.loads,0);
 f.window.dispatchEvent(new Event('campus:ready'));assert.equal(f.loads,0);assert.equal(f.timers.size,1);
 f.flush();assert.equal(f.loads,1);f.dispose();
});
test('prompt entry cancels delayed film, while slow or metered networks retain the artwork',()=>{
 const f=fixture({ready:false});f.window.dispatchEvent(new Event('campus:ready'));f.dispose();f.flush();assert.equal(f.video.src,undefined);assert.equal(f.plays,0);
 for(const options of [{saveData:true},{effectiveType:'3g'}]){const g=fixture(options);assert.equal(g.loads,0);g.cover.dispatchEvent(new Event('pointerdown'));assert.equal(g.loads,0);g.dispose();}
});
