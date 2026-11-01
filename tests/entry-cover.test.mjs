import test from 'node:test';
import assert from 'node:assert/strict';
import {mountEntryCover} from '../src/entry-cover.js';

class Element extends EventTarget{
  constructor(){
    super();this.dataset={};this.attributes=new Map();this.inert=false;this.hidden=false;this.textContent='';this.disabled=false;
    const names=new Set();this.classList={add:name=>names.add(name),remove:name=>names.delete(name),contains:name=>names.has(name)};
  }
  setAttribute(name,value){this.attributes.set(name,String(value));}
  getAttribute(name){return this.attributes.get(name)??null;}
  hasAttribute(name){return this.attributes.has(name);}
  removeAttribute(name){this.attributes.delete(name);}
  focus(){this.focused=true;}
  querySelector(){return this.button;}
}
function fixture({ready=false,reduced=false,priorHeaderInert=false,initialMarkers=true}={}){
  const cover=new Element(),start=new Element(),status=new Element(),video=new Element(),header=new Element(),viewport=new Element(),body=new Element(),documentElement=new Element(),help=new Element();
  help.hidden=true;help.button=new Element();header.inert=priorHeaderInert;
  if(initialMarkers){for(const el of [header,viewport]){el.inert=true;el.setAttribute('data-entry-cover-inert','');}}
  body.classList.add('entry-cover-open');if(ready)documentElement.dataset.campusReady='true';
  const ids=new Map([['campus-entry-cover',cover],['entry-cover-start',start],['entry-cover-status',status],['entry-cover-film',video],['viewport',viewport],['campus-startup-help',help]]);
  const document={body,documentElement,getElementById:id=>ids.get(id),querySelector:selector=>selector==='body > header'?header:null};
  const window=new EventTarget();window.Event=Event;window.matchMedia=()=>({matches:reduced});
  let sequence=0,mounted=0,stopped=0,entered=0;const timers=new Map();
  window.setTimeout=(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence;};window.clearTimeout=id=>timers.delete(id);
  window.addEventListener('campus:entry-entered',()=>entered++);
  const api=mountEntryCover({document,window,mountMotion:({cover:target,video:film})=>{assert.equal(target,cover);assert.equal(film,video);mounted++;return()=>stopped++;}});
  function emit(type,detail){const event=new Event(type);if(detail!==undefined)Object.defineProperty(event,'detail',{value:detail});window.dispatchEvent(event);}
  function page(type,persisted){const event=new Event(type);Object.defineProperty(event,'persisted',{value:persisted});window.dispatchEvent(event);}
  function advance(){const current=[...timers.values()];timers.clear();for(const {fn} of current)fn();}
  return {api,document,window,cover,start,status,header,viewport,body,help,timers,emit,page,advance,click:()=>start.dispatchEvent(new Event('click')),
    get mounted(){return mounted;},get stopped(){return stopped;},get entered(){return entered;}};
}

test('start remains hidden until real readiness; early clicks cannot queue an entry',()=>{
  const f=fixture();assert.equal(f.cover.dataset.state,'loading');assert.equal(f.header.inert,true);assert.equal(f.viewport.inert,true);
  assert.equal(f.start.hidden,true);assert.equal(f.start.disabled,true);
  f.click();assert.equal(f.cover.dataset.state,'loading');assert.match(f.status.textContent,/准备/);assert.equal(f.timers.size,0);
  f.emit('campus:ready');assert.equal(f.cover.dataset.state,'ready');assert.equal(f.start.hidden,false);assert.equal(f.start.disabled,false);assert.equal(f.timers.size,0);
  assert.equal(f.cover.hidden,false);assert.equal(f.body.classList.contains('entry-cover-open'),true);assert.equal(f.entered,0);
  f.click();assert.equal(f.cover.dataset.state,'entering');assert.equal(f.start.getAttribute('aria-busy'),'true');
  assert.equal([...f.timers.values()][0].delay,900);f.advance();
  assert.equal(f.cover.dataset.state,'entered');assert.equal(f.cover.hidden,true);assert.equal(f.body.classList.contains('entry-cover-open'),false);assert.equal(f.viewport.inert,false);assert.equal(f.header.inert,false);assert.equal(f.header.hasAttribute('data-entry-cover-inert'),false);assert.equal(f.entered,1);assert.equal(f.stopped,1);f.api.dispose();
});

test('a prepared campus waits indefinitely for its visitor, including an early ready marker',()=>{
  for(const earlyReady of [false,true]){
    const f=fixture({ready:earlyReady});if(!earlyReady)f.emit('campus:ready');
    assert.equal(f.cover.dataset.state,'ready');assert.equal(f.start.disabled,false);assert.equal(f.timers.size,0);assert.equal(f.cover.hidden,false);assert.equal(f.entered,0);
    f.click();f.advance();assert.equal(f.entered,1);f.api.dispose();
  }
});

test('repeated clicks and ready events cannot shorten the transition or enter twice',()=>{
  const f=fixture();f.click();f.click();f.emit('campus:ready');f.click();f.emit('campus:ready');f.click();
  assert.equal(f.timers.size,1);assert.equal(f.start.textContent,'开始体验');f.advance();f.click();f.emit('campus:ready');f.advance();assert.equal(f.entered,1);assert.equal(f.stopped,1);f.api.dispose();
});

test('startup errors cancel pending entry and leave the existing recovery button usable',()=>{
  const f=fixture({ready:true});f.click();f.help.hidden=false;f.emit('campus:startup-error','网络连接中断，请重新载入。');
  assert.equal(f.cover.dataset.state,'error');assert.equal(f.status.textContent,'网络连接中断，请重新载入。');assert.equal(f.help.button.focused,true);assert.equal(f.help.inert,false);assert.equal(f.start.disabled,true);assert.equal(f.start.hidden,true);assert.equal(f.timers.size,0);
  f.advance();assert.equal(f.entered,0);assert.equal(f.viewport.inert,true);assert.equal(f.cover.hidden,false);
  f.emit('campus:ready');assert.equal(f.cover.dataset.state,'ready');assert.equal(f.timers.size,0,'an error clears the previous start intent');f.click();f.advance();assert.equal(f.entered,1);f.api.dispose();
});

test('cleanup cancels timers, motion and listeners without a false entry or clearing unrelated inert',()=>{
  const f=fixture({ready:true,priorHeaderInert:true,initialMarkers:false});f.click();f.api.dispose();f.api.dispose();f.emit('campus:ready');f.click();f.advance();
  assert.equal(f.entered,0);assert.equal(f.stopped,1);assert.equal(f.timers.size,0);assert.equal(f.header.inert,true);assert.equal(f.viewport.inert,false);assert.equal(f.cover.hidden,true);assert.equal(f.body.classList.contains('entry-cover-open'),false);
});

test('reduced motion keeps the explicit click but skips the long visual transition',()=>{
  const f=fixture({ready:true,reduced:true});assert.equal(f.timers.size,0);f.click();assert.equal([...f.timers.values()][0].delay,0);f.advance();assert.equal(f.entered,1);f.api.dispose();
});

test('pagehide stops animation and a cached home revisit requires a new start gesture',()=>{
  const f=fixture({ready:true});f.click();f.advance();assert.equal(f.entered,1);f.page('pagehide',true);f.page('pageshow',true);
  assert.equal(f.mounted,2);assert.equal(f.cover.hidden,false);assert.equal(f.cover.dataset.state,'ready');assert.equal(f.viewport.inert,true);assert.equal(f.body.classList.contains('entry-cover-open'),true);assert.equal(f.timers.size,0);
  f.click();f.advance();assert.equal(f.entered,2);f.page('pagehide',false);assert.equal(f.stopped,2);assert.equal(f.timers.size,0);
});

test('missing optional cover markup is harmless for alternate entry pages',()=>{
  assert.doesNotThrow(()=>mountEntryCover({document:{getElementById:()=>null},window:{}}).dispose());
});
