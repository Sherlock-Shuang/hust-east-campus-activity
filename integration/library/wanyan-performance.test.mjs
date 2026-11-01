import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {applyWanyanPerformance} from './wanyan-performance.mjs';
const source=await readFile(new URL('./wanyan-performance.js',import.meta.url),'utf8');
function fixture({width=1280,height=800,dpr=2,coarse=false,cores=8,search='',pauseSupported=true}={}){
  let now=0,nextId=1,pauses=0,resumes=0,quits=0,paused=false;
  const callbacks=new Map(),timers=new Map();
  class Events{
    listeners=new Map();
    addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
    removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
    emit(type){for(const fn of this.listeners.get(type)||[])fn();}
    count(){return [...this.listeners.values()].reduce((sum,entries)=>sum+entries.size,0);}
  }
  const doc=new Events(),win=new Events(),canvas={clientWidth:width,clientHeight:height};
  Object.assign(doc,{hidden:false,documentElement:{dataset:{}},getElementById:()=>canvas});
  Object.assign(win,{innerWidth:width,innerHeight:height,devicePixelRatio:dpr,location:{search},navigator:{hardwareConcurrency:cores,maxTouchPoints:coarse?5:0},matchMedia:()=>({matches:coarse}),performance:{now:()=>now},
    requestAnimationFrame:fn=>{const id=nextId++;callbacks.set(id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id),
    setTimeout:fn=>{const id=nextId++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    bookrealmNativeControls:Object.freeze({started:true,suspended:false})});
  const module=pauseSupported?{pauseMainLoop(){pauses++;paused=true;},resumeMainLoop(){resumes++;paused=false;}}:{};
  const instance={Module:module,Quit(){quits++;return Promise.resolve();}};
  vm.runInNewContext(source,{window:win,document:doc,URLSearchParams});
  const attach=()=>win.bookrealmAttachRenderQuality(instance);
  function tick(ms=1000/60,{publish=true}={}){
    now+=ms;
    if(publish&&!paused)win.bookrealmNativeControls=Object.freeze({...win.bookrealmNativeControls,suspended:!!win.bookrealmControlsSuspended});
    const ready=[...callbacks.values()];callbacks.clear();for(const fn of ready)fn(now);
  }
  const run=(duration,ms=1000/60,options)=>{for(let time=0;time<duration;time+=ms)tick(ms,options);};
  return {win,doc,module,attach,tick,run,counts:()=>({pauses,resumes,quits,raf:callbacks.size,listeners:win.count()+doc.count()}),flushTimers(){const ready=[...timers.values()];timers.clear();for(const fn of ready)fn();}};
}
test('physical pixel budget respects high-DPI, native large windows and coarse devices',()=>{
  const desktop=fixture();desktop.attach();assert.equal(desktop.module.devicePixelRatio,1.423);
  const large=fixture({width:3840,height:2160,dpr:1});large.attach();assert.equal(large.module.devicePixelRatio,.5);
  const mobile=fixture({width:900,height:400,dpr:3,coarse:true});mobile.attach();assert.equal(mobile.module.devicePixelRatio,1);
});
test('single hitch cannot lower quality; sustained load lowers it with hysteresis',()=>{
  const f=fixture();const controller=f.attach();f.run(6000);f.tick(120);f.run(5000);assert.equal(controller.snapshot().level,0);
  f.run(7000,40);assert.ok(controller.snapshot().level>0);const reduced=controller.snapshot().level;
  f.run(10000);assert.equal(controller.snapshot().level,reduced,'recovery waits for 20 seconds of stable windows');
  f.run(16000);assert.ok(controller.snapshot().level<reduced);
});
test('30 FPS native update cadence with a healthy 60 Hz browser does not downscale',()=>{
  const f=fixture();const c=f.attach();for(let n=0;n<1200;n++)f.tick(1000/60,{publish:n%2===0});assert.equal(c.snapshot().level,0);
});
test('explicit fixed/original resolution diagnostics do not adapt',()=>{
  const original=fixture({search:'?wanyanResolution=original'});const old=original.attach();assert.equal(original.module.devicePixelRatio,1.897);original.run(16000,50);assert.equal(old.snapshot().level,0);
  const fixed=fixture({search:'?wanyanResolution=fixed'});const controlled=fixed.attach();fixed.run(16000,50);assert.equal(controlled.snapshot().level,0);
});
test('host pause actually stops native loop and waits for two native suspended frames on resume',()=>{
  const f=fixture();const c=f.attach();c.setPaused(true);assert.equal(f.counts().pauses,1);assert.equal(f.counts().raf,0);
  c.setPaused(false);f.run(1000,1000/60,{publish:false});assert.equal(f.win.bookrealmControlsSuspended,true,'rAF callbacks alone cannot release controls');
  f.tick();assert.equal(f.win.bookrealmControlsSuspended,true);f.tick();assert.equal(f.win.bookrealmControlsSuspended,false);
  assert.equal(c.snapshot().resuming,false);assert.equal(f.counts().resumes,1);
});
test('nested library, hidden document and host suspension cannot override one another',()=>{
  const f=fixture();f.win.campusWanyanSetLibrarySuspended(true);const c=f.attach();assert.equal(c.snapshot().enginePaused,true);
  c.setPaused(true);f.win.campusWanyanSetLibrarySuspended(false);assert.equal(c.snapshot().enginePaused,true);
  f.doc.hidden=true;f.doc.emit('visibilitychange');c.setPaused(false);assert.equal(c.snapshot().enginePaused,true);
  f.doc.hidden=false;f.doc.emit('visibilitychange');f.tick();f.tick();assert.equal(f.win.bookrealmControlsSuspended,false);
});
test('pause during resume cancels the stale release callback',()=>{
  const f=fixture();const c=f.attach();c.setPaused(true);c.setPaused(false);f.tick();c.setPaused(true);f.run(1000);assert.equal(f.win.bookrealmControlsSuspended,true);assert.equal(c.snapshot().enginePaused,true);
});
test('fallback player without native pause exports retains input suspension',()=>{
  const f=fixture({pauseSupported:false});const c=f.attach();c.setPaused(true);assert.equal(f.win.bookrealmControlsSuspended,true);c.setPaused(false);assert.equal(f.win.bookrealmControlsSuspended,false);
});
test('paused disposal resumes only to quit and removes monitors/listeners idempotently',async()=>{
  const f=fixture();const c=f.attach();c.setPaused(true);f.win.emit('resize');await c.dispose();await c.dispose();f.flushTimers();
  assert.equal(f.counts().quits,1);assert.equal(f.counts().resumes,1);assert.equal(f.counts().raf,0);assert.equal(f.counts().listeners,0);assert.equal(f.win.bookrealmControlsSuspended,true);
});
test('strict conversion preserves original source and refuses an unknown bridge',()=>{
  const html='<script id="bookrealm-render-quality">old budget</script>\nwindow.bookrealmControlsSuspended = event.data.suspended;\n  document.documentElement.dataset.controlsSuspended = String(event.data.suspended);\nwindow.campusWorkAdapter?.register({setPaused(value){window.bookrealmControlsSuspended=value;document.documentElement.dataset.controlsSuspended=String(value);},dispose(){window.bookrealmControlsSuspended=true;unityInstance.Quit?.();}});';
  const result=applyWanyanPerformance(html);assert.match(result,/wanyan-performance\.js/);assert.match(result,/register\(window.campusWanyanPerformance\)/);assert.equal(applyWanyanPerformance(result),result);assert.throws(()=>applyWanyanPerformance('<html/>'),/quality script changed/);
});
