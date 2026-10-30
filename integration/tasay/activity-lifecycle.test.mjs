import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(process.env.TASAY_SOURCE?path.join(process.env.TASAY_SOURCE,'package.json'):new URL('./.staging/package.json',import.meta.url));
const {JSDOM}=require('jsdom'),source=(await readFile(new URL('./activity-adapter.js',import.meta.url),'utf8')).replace('__CAMPUS_ALLOWED_ORIGINS__','[]');
function fixture(t){
 const dom=new JSDOM('<iframe src="https://campus.test/works/tasay/?campusParentOrigin=https%3A%2F%2Fcampus.test&campusAttempt=active-attempt"></iframe>',{url:'https://campus.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const host=dom.window,win=host.document.querySelector('iframe').contentWindow;win.document.open();win.document.write('<html><head></head><body><div id="root"><main>Existing story</main></div></body></html>');win.document.close();
 let id=0,unmounted=0,parentCallbacks=0,closed=0,disconnected=0,reloads=0;const timers=new Map(),frames=new Map();
 win.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms,interval:false});return key;};win.setInterval=(fn,ms)=>{const key=++id;timers.set(key,{fn,ms,interval:true});return key;};win.clearTimeout=win.clearInterval=id=>timers.delete(id);win.requestAnimationFrame=fn=>{const key=++id;frames.set(key,fn);return key;};win.cancelAnimationFrame=id=>frames.delete(id);
 win.MutationObserver=class{observe(){}disconnect(){disconnected++;}};
 win.AudioContext=class{state='running';suspend(){this.state='suspended';return Promise.resolve();}resume(){this.state='running';return Promise.resolve();}close(){closed++;return Promise.resolve();}};
 win.__testLocation={search:win.location.search,origin:win.location.origin,reload(){reloads++;}};win.eval('(function(location){'+source+'})(window.__testLocation)');const callback=()=>parentCallbacks++;host.addEventListener('resize',callback);win.addEventListener('campus:dispose',()=>{unmounted++;host.removeEventListener('resize',callback);},{once:true});
 const message=(type,attemptId='active-attempt',origin='https://campus.test')=>win.dispatchEvent(new win.MessageEvent('message',{source:host,origin,data:{type,attemptId,paused:true}}));
 return {win,host,timers,frames,message,stats:()=>({unmounted,parentCallbacks,closed,disconnected,reloads})};
}
test('authenticated dispose unmounts React once, removes parent references, closes audio and stops all timers',t=>{
 const f=fixture(t);new f.win.AudioContext();f.win.setInterval(()=>{},100);f.win.requestAnimationFrame(()=>{});assert(f.timers.size>0);assert(f.frames.size>0);
 f.message('campus:dispose','wrong-attempt');assert.equal(f.stats().unmounted,0);f.message('campus:dispose','active-attempt','https://wrong.test');assert.equal(f.stats().unmounted,0);
 f.message('campus:dispose');assert.equal(f.stats().unmounted,1);assert.equal(f.stats().closed,1);assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);assert.equal(f.win.document.documentElement.dataset.campusDisposed,'true');
 f.host.dispatchEvent(new f.host.Event('resize'));assert.equal(f.stats().parentCallbacks,0);
 f.message('campus:dispose');f.win.dispatchEvent(new f.win.Event('pagehide'));assert.equal(f.stats().unmounted,1);assert.equal(f.stats().closed,1);
 f.win.setTimeout(()=>{},0);f.win.requestAnimationFrame(()=>{});assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);
});
test('pagehide releases parent viewport listeners even when iframe detach precedes its async dispose message',t=>{
 const f=fixture(t);f.win.dispatchEvent(new f.win.Event('pagehide'));assert.equal(f.stats().unmounted,1);assert.equal(f.timers.size,0);f.host.dispatchEvent(new f.host.Event('resize'));assert.equal(f.stats().parentCallbacks,0);
});

test('BFCache restoration reloads an already unmounted activity and leaves persisted story data intact',t=>{
 const f=fixture(t);f.win.localStorage.setItem('ta-say:original-story:sentinel','unchanged');
 f.win.dispatchEvent(new f.win.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(f.stats().reloads,0);
 f.win.dispatchEvent(new f.win.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(f.stats().unmounted,1);
 f.win.dispatchEvent(new f.win.PageTransitionEvent('pageshow',{persisted:false}));assert.equal(f.stats().reloads,0);
 f.win.dispatchEvent(new f.win.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(f.stats().reloads,1);assert.equal(f.win.localStorage.getItem('ta-say:original-story:sentinel'),'unchanged');
});
