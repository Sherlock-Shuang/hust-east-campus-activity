import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(process.env.TASAY_SOURCE?path.join(process.env.TASAY_SOURCE,'package.json'):new URL('./.staging/package.json',import.meta.url));
const {JSDOM}=require('jsdom'),ts=require('typescript');
const source=(await readFile(new URL('./ui-overrides/src/hooks/useChatViewport.ts',import.meta.url),'utf8')).replace(/^import .*;\n/m,'').replace('export function useChatViewport','function useChatViewport');
const script=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;

function fixture(t,{embedded=false,viewport=true,blockedParent=false}={}){
  const dom=new JSDOM(embedded?'<iframe></iframe>':'<body></body>',{url:'https://campus.test/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const host=dom.window,element=embedded?host.document.querySelector('iframe'):null,win=element?.contentWindow||host;
  const size=(target,height,width=390)=>{Object.defineProperty(target,'innerHeight',{configurable:true,writable:true,value:height});Object.defineProperty(target,'innerWidth',{configurable:true,writable:true,value:width});};
  size(host,844);if(embedded)size(win,720);
  const visual=(target,height)=>{const vv=new target.EventTarget();Object.assign(vv,{height,width:390,offsetTop:0,scale:1});Object.defineProperty(target,'visualViewport',{configurable:true,value:viewport?vv:null});return vv;};
  const hostViewport=visual(host,844),ownViewport=embedded?visual(win,720):hostViewport;
  let rect={top:120,height:720};
  if(element){element.getBoundingClientRect=()=>({...rect,bottom:rect.top+rect.height,left:0,right:390,width:390});Object.defineProperty(element,'offsetHeight',{configurable:true,value:720});Object.defineProperty(element,'clientTop',{configurable:true,value:0});}
  if(blockedParent)Object.defineProperty(win,'frameElement',{configurable:true,get(){throw new win.DOMException('Blocked','SecurityError');}});
  let id=0,cleanup;const frames=new Map(),timers=new Map(),observers=[];
  win.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};win.cancelAnimationFrame=id=>frames.delete(id);
  win.setTimeout=(callback,delay)=>{timers.set(++id,{callback,delay});return id;};win.clearTimeout=id=>timers.delete(id);
  win.ResizeObserver=class{constructor(callback){this.callback=callback;this.targets=[];this.disconnected=false;observers.push(this);}observe(target){this.targets.push(target);}disconnect(){this.disconnected=true;}};
  win.useEffect=effect=>{cleanup=effect();};
  const root=win.document.documentElement;
  win.eval(script+'\nwindow.mountChatViewport = useChatViewport;');
  const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(callback=>callback(0));};
  const dispatch=(target,name)=>target.dispatchEvent(new win.Event(name));
  const focus=(tag='textarea',type)=>{const field=win.document.createElement(tag);if(type)field.type=type;win.document.body.append(field);field.focus();flush();return field;};
  return {win,host,root,element,hostViewport,ownViewport,size,flush,dispatch,focus,observers,timers,frames,
    mount(){win.mountChatViewport();flush();},dispose(){cleanup();},setRect(value){rect=value;},
    runTimers(delay){for(const [id,timer]of [...timers])if(timer.delay<=delay){timers.delete(id);timer.callback();}flush();},
    height:()=>root.style.getPropertyValue('--chat-viewport-height'),top:()=>root.style.getPropertyValue('--chat-viewport-top'),keyboard:()=>root.dataset.chatKeyboard};
}

test('standalone visual viewport follows keyboard height and iOS pan without forcing focus or page scroll',t=>{
  const f=fixture(t);f.mount();assert.equal(f.height(),'844px');assert.equal(f.top(),'0px');
  const input=f.focus();Object.assign(f.ownViewport,{height:450,offsetTop:90});f.dispatch(f.ownViewport,'resize');f.flush();
  assert.equal(f.height(),'450px');assert.equal(f.top(),'90px');assert.equal(f.keyboard(),'true');assert.equal(f.win.document.activeElement,input);
  Object.assign(f.ownViewport,{height:844,offsetTop:0});input.blur();f.flush();assert.equal(f.height(),'844px');assert.equal(f.keyboard(),'false');f.dispose();
});

test('visual viewport restoration does not get clipped by a stale window innerHeight',t=>{
  const f=fixture(t);f.mount();f.size(f.win,450);Object.assign(f.ownViewport,{height:844,offsetTop:0});f.dispatch(f.ownViewport,'resize');f.flush();
  assert.equal(f.height(),'844px');f.dispose();
});

test('same-origin iframe intersects the host visual viewport, including its toolbar offset and keyboard pan',t=>{
  const f=fixture(t,{embedded:true});f.mount();assert.equal(f.height(),'720px');
  f.focus();Object.assign(f.hostViewport,{height:400,offsetTop:150});f.dispatch(f.hostViewport,'resize');f.flush();
  assert.equal(f.ownViewport.height,720,'the iframe itself need not resize when the OS keyboard opens');
  assert.equal(f.height(),'400px');assert.equal(f.top(),'30px');assert.equal(f.keyboard(),'true');
  f.setRect({top:180,height:720});f.dispatch(f.host,'scroll');f.flush();assert.equal(f.top(),'0px');assert.equal(f.height(),'370px');
  assert.equal(f.observers[0].targets[0],f.element);f.dispose();assert.equal(f.observers[0].disconnected,true);
});

test('cross-origin iframe access safely falls back to its own viewport',t=>{
  const f=fixture(t,{embedded:true,blockedParent:true});f.mount();f.focus();f.ownViewport.height=400;f.dispatch(f.ownViewport,'resize');f.flush();
  assert.equal(f.height(),'400px');assert.equal(f.keyboard(),'true');f.dispose();
});

test('layout-resizing keyboards work without visualViewport and rotation does not count as keyboard occlusion',t=>{
  const f=fixture(t,{viewport:false});f.mount();f.focus();f.size(f.win,520);f.dispatch(f.win,'resize');f.flush();
  assert.equal(f.height(),'520px');assert.equal(f.keyboard(),'true');
  f.size(f.win,390,844);f.dispatch(f.win,'orientationchange');f.flush();assert.equal(f.height(),'390px');assert.equal(f.keyboard(),'false');
  f.size(f.win,230,844);f.dispatch(f.win,'resize');f.flush();assert.equal(f.height(),'230px');assert.equal(f.keyboard(),'true');f.dispose();
});

test('pinch zoom leaves the layout intact, while blur can clear the keyboard flag during zoom',t=>{
  const f=fixture(t);f.mount();const input=f.focus();f.ownViewport.height=500;f.dispatch(f.ownViewport,'resize');f.flush();assert.equal(f.keyboard(),'true');
  Object.assign(f.ownViewport,{height:250,offsetTop:80,scale:2});f.dispatch(f.ownViewport,'scroll');f.flush();assert.equal(f.height(),'500px');assert.equal(f.top(),'0px');
  input.blur();f.flush();assert.equal(f.keyboard(),'false');assert.equal(f.height(),'500px');
  Object.assign(f.ownViewport,{height:844,offsetTop:0,scale:1});f.dispatch(f.ownViewport,'resize');f.flush();assert.equal(f.height(),'844px');f.dispose();
});

test('only editable text controls trigger compact mode and delayed keyboard settling is measured',t=>{
  const f=fixture(t);f.mount();const checkbox=f.focus('input','checkbox');f.ownViewport.height=500;f.dispatch(f.ownViewport,'resize');f.flush();assert.equal(f.keyboard(),'false');checkbox.blur();
  f.ownViewport.height=844;f.dispatch(f.ownViewport,'resize');f.flush();const input=f.focus();f.ownViewport.height=520;
  f.runTimers(250);assert.equal(f.height(),'520px');assert.equal(f.keyboard(),'true');
  input.readOnly=true;f.dispatch(f.win.document,'focusin');f.flush();assert.equal(f.keyboard(),'false');f.dispose();
});

test('cleanup cancels pending measurements, disconnects listeners and restores prior root styles',t=>{
  const f=fixture(t);f.root.style.setProperty('--chat-viewport-height','90dvh','important');f.root.style.setProperty('--chat-viewport-top','3px');f.root.dataset.chatKeyboard='previous';
  f.mount();f.focus();f.dispatch(f.ownViewport,'resize');assert.ok(f.frames.size);assert.ok(f.timers.size);f.dispose();
  assert.equal(f.height(),'90dvh');assert.equal(f.root.style.getPropertyPriority('--chat-viewport-height'),'important');assert.equal(f.top(),'3px');assert.equal(f.keyboard(),'previous');
  assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);f.dispatch(f.ownViewport,'resize');f.flush();assert.equal(f.height(),'90dvh');
});
