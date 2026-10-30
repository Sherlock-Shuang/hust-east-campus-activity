import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createTouchKeys} from './touch-controls.mjs';

const adapterSource=await readFile(new URL('./activity-adapter.js',import.meta.url),'utf8');
const touchSource=(await readFile(new URL('./wanyan-touch.mjs',import.meta.url),'utf8')).replace(/^import[^\n]+\n/gm,'');
function fixture(){
  const events=new Map(),messages=[],timeouts=new Map(),intervals=new Map();let nextTimer=1;
  const parent={postMessage:(message)=>messages.push(message)};
  const canvas={dataset:{},focus(){},dispatchEvent:event=>keyEvents.push([event.type,event.code])},keyEvents=[];
  const document={currentScript:{dataset:{work:'wanyan'}},documentElement:{dataset:{campusWorkStatus:'runtime_ready'}},activeElement:{blur(){}},exitPointerLock(){},getElementById:()=>canvas,querySelector:()=>null,hidden:false};
  const sandbox={URL,URLSearchParams,WeakSet,Set,document,parent,console,
    location:{origin:'https://campus.example',search:'?campusAttempt=entry-one'},
    addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},
    removeEventListener(type,fn){events.get(type)?.delete(fn);},
    setTimeout(fn){const id=nextTimer++;timeouts.set(id,fn);return id;},clearTimeout(id){timeouts.delete(id);},
    setInterval(fn){const id=nextTimer++;intervals.set(id,fn);return id;},clearInterval(id){intervals.delete(id);},
  };
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(adapterSource,sandbox);
  const emit=(type,event={})=>{for(const fn of [...events.get(type)||[]])fn(event);};
  const command=(data,source=parent,origin='https://campus.example')=>emit('message',{source,origin,data:{attemptId:'entry-one',...data}});
  return {sandbox,events,messages,document,canvas,keyEvents,timeouts,intervals,emit,command,
    flushTimeouts(){const callbacks=[...timeouts.values()];timeouts.clear();callbacks.forEach(fn=>fn());}};
}
function attachTouch(f){
  const counts={announce:0,reset:0,destroy:0,touchDestroy:0};let controls;
  const pad={available:false,announce(){counts.announce++;},reset(){counts.reset++;},destroy(){counts.destroy++;},press:()=>false,release(){},endLook(){}};
  class KeyboardEvent{constructor(type,init){this.type=type;Object.assign(this,init);}}
  Object.assign(f.sandbox,{
    createTouchKeys:getTarget=>createTouchKeys(getTarget,KeyboardEvent),
    createTouchGamepad:()=>pad,TOUCH_GAMEPAD_ID:'fixture-touch',isTouchLayout:()=>true,skillPresentation:()=>{},
    createTouchControls(options){controls=options;return {root:{querySelector:()=>null},destroy(){counts.touchDestroy++;options.onReset();}};},
    bookrealmNativeControls:{started:true},bookrealmControlsSuspended:false,
  });
  vm.runInContext(touchSource,f.sandbox);
  return {counts,controls,pad};
}

test('dispose before Unity registration rejects late signals and destroys the late controller once',()=>{
  const f=fixture(),api=f.sandbox.campusWorkAdapter,states=[];let destroyed=0,notified=0;
  api.onDispose(()=>notified++);
  f.command({type:'campus:dispose'},{});assert.equal(api.disposed,false);
  f.command({type:'campus:dispose',attemptId:'old-entry'});assert.equal(api.disposed,false);
  f.command({type:'campus:dispose'});assert.equal(api.disposed,true);assert.equal(notified,1);
  const controller={setPaused:value=>states.push(value),dispose:()=>destroyed++};
  api.register(controller);api.register(controller);assert.equal(destroyed,1);assert.deepEqual(states,[true,true]);
  api.ready('runtime_ready');api.fail('late initialization');api.exit();assert.equal(f.messages.length,0);
  f.command({type:'campus:dispose'});f.command({type:'campus:activity',paused:false});assert.equal(destroyed,1);
  let late=0;const unsubscribe=api.onDispose(()=>late++);unsubscribe();assert.equal(late,1);
});

test('dispose listeners can unsubscribe and teardown survives throwing or rejecting runtimes',async()=>{
  const f=fixture(),api=f.sandbox.campusWorkAdapter;let cancelled=0,remaining=0;
  const unsubscribe=api.onDispose(()=>cancelled++);unsubscribe();
  api.onDispose(()=>{throw new Error('listener teardown');});api.onDispose(()=>remaining++);
  api.register({dispose:()=>Promise.reject(new Error('Unity already detached'))});
  f.command({type:'campus:dispose'});await Promise.resolve();await Promise.resolve();
  assert.equal(cancelled,0);assert.equal(remaining,1);
  assert.doesNotThrow(()=>api.register({dispose(){throw new Error('engine closed');}}));
});

for(const boundary of ['activity','pagehide'])test(`Wanyan ${boundary} cancels announced timers, releases held keys and destroys inputs once`,()=>{
  const f=fixture(),{counts,controls}=attachTouch(f);
  const ready=f.sandbox.campusWanyanTouchReady;
  ready();ready();assert.equal(f.timeouts.size,1,'repeated runtime-ready deduplicates announce');
  controls.onMove({x:1,y:0});controls.onPress('attack');
  assert.deepEqual(f.keyEvents,[['keydown','KeyD'],['keydown','KeyJ']]);
  assert.equal(f.intervals.size,1);
  if(boundary==='activity')f.command({type:'campus:dispose'});else f.emit('pagehide');
  assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);
  assert.deepEqual(f.keyEvents.slice(-2),[['keyup','KeyD'],['keyup','KeyJ']]);
  assert.equal(counts.touchDestroy,1);assert.equal(counts.destroy,1);assert.equal(counts.announce,0);
  assert.equal(f.events.get('pagehide').size,0);assert.equal(f.sandbox.campusWanyanTouchReady,undefined);
  ready();f.flushTimeouts();f.emit('pagehide');f.command({type:'campus:dispose'});
  assert.equal(counts.announce,0);assert.equal(counts.touchDestroy,1);assert.equal(counts.destroy,1);
});

test('Wanyan loaded after activity disposal immediately cleans up without accepting delayed readiness',()=>{
  const f=fixture();f.command({type:'campus:dispose'});
  const {counts}=attachTouch(f);
  assert.equal(counts.destroy,1);assert.equal(counts.touchDestroy,1);
  assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);assert.equal(f.events.get('pagehide').size,0);
  assert.equal(f.sandbox.campusWanyanTouchReady,undefined);
});

test('normal runtime-ready announces once and a late timer callback cannot revive disposed input',()=>{
  const f=fixture(),{counts}=attachTouch(f);f.sandbox.campusWanyanTouchReady();f.flushTimeouts();assert.equal(counts.announce,1);
  f.sandbox.campusWanyanTouchReady();const callback=[...f.timeouts.values()][0];f.command({type:'campus:dispose'});
  callback();assert.equal(counts.announce,1);assert.equal(f.timeouts.size,0);
});

test('all three local runtime wrappers match integration sources',async()=>{
  for(const [route,file] of [['library/activity-adapter.js','activity-adapter.js'],['wanyan/activity-adapter.js','activity-adapter.js'],['wanyan/wanyan-touch.mjs','wanyan-touch.mjs']]){
    assert.deepEqual(await readFile(new URL('../../work-assets/'+route,import.meta.url)),await readFile(new URL(file,import.meta.url)),route+' runtime source');
  }
});

test('all three shipped gzip wrappers match integration sources when the deployment pack is present',async t=>{
  let manifest;
  try{manifest=JSON.parse(await readFile(new URL('../../asset-source/manifest.json',import.meta.url),'utf8'));}
  catch(error){if(error.code==='ENOENT'){t.skip('Original local build uses work-assets directly; no deployment asset pack');return;}throw error;}
  for(const [route,file] of [['library/activity-adapter.js','activity-adapter.js'],['wanyan/activity-adapter.js','activity-adapter.js'],['wanyan/wanyan-touch.mjs','wanyan-touch.mjs']]){
    const source=await readFile(new URL(file,import.meta.url)),entry=manifest.routes['/works/'+route];
    const raw=Buffer.concat(await Promise.all(entry.chunks.map(async chunk=>gunzipSync(await readFile(new URL('../../asset-source/chunks/'+chunk.url.split('/').at(-1),import.meta.url))))));
    assert.deepEqual(raw,source,route+' pack source');assert.equal(entry.bytes,source.length);
    assert.equal(entry.sha256,createHash('sha256').update(source).digest('hex'));
  }
});
