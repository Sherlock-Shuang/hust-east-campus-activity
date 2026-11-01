import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEntryCoverMotion} from '../src/entry-cover-motion.js';

function fixture({reduced=false,hidden=false,blocked=false}={}){
  const cover=new EventTarget(),video=new EventTarget(),document=new EventTarget(),preference=new EventTarget();
  const classes=new Set();cover.classList={add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
  cover.hidden=false;document.hidden=hidden;preference.matches=reduced;
  let plays=0,pauses=0,loads=0;
  video.dataset={src:'/media/entry-cover/east-campus-sunset-v2.mp4'};
  video.play=()=>{plays++;return blocked?Promise.reject(new Error('autoplay blocked')):Promise.resolve();};
  video.pause=()=>pauses++;video.load=()=>loads++;video.removeAttribute=name=>delete video[name];
  const window={matchMedia:()=>preference};
  const dispose=mountEntryCoverMotion({cover,video,document,window});
  const visible=value=>{document.hidden=!value;document.dispatchEvent(new Event('visibilitychange'));};
  const reduce=value=>{preference.matches=value;preference.dispatchEvent(new Event('change'));};
  return {cover,video,dispose,visible,reduce,get plays(){return plays;},get pauses(){return pauses;},get loads(){return loads;}};
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
