import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileControls} from '../src/mobile-controls.js';

class Element {
  constructor(dataset={}){this.dataset=dataset;this.handlers=new Map();this.hidden=false;this.disabled=false;this.style={};this.attrs={};this.captures=new Set();this.children=[];this.textContent='';const values=new Set();this.classList={toggle(k,v){const next=v??!values.has(k);next?values.add(k):values.delete(k);return next;},remove:k=>values.delete(k),contains:k=>values.has(k)};}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  emit(type,overrides={}){const e={type,pointerId:1,pointerType:'touch',clientX:60,clientY:60,detail:1,code:'',repeat:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...overrides};for(const fn of this.handlers.get(type)||[])fn(e);return e;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  getBoundingClientRect(){return{left:0,top:0,width:120,height:120};}
  querySelectorAll(selector){if(selector==='[data-mobile-hold]')return this.children.filter(c=>c.dataset.mobileHold);if(selector==='[data-mobile-action]')return this.children.filter(c=>c.dataset.mobileAction);return[];}
  querySelector(selector){return selector.includes('continue-portrait')?this.children.find(c=>c.dataset.mobileAction==='continue-portrait'):null;}
}
function fixture({coarse=true,landscape=true}={}){
  const ids=new Map(),doc=new Element(),win=new Element();
  for(const id of['mobile-controls','mobile-joystick','mobile-stick','mobile-extra-actions','mobile-orientation-hint','mobile-fullscreen-status','mobile-interact-label','mobile-point-hint','mobile-enable-touch'])ids.set(id,new Element());
  const root=ids.get('mobile-controls'),joy=ids.get('mobile-joystick');
  const holds=Object.fromEntries(['fast','brake','up','down','swing','reel','dive','trick'].map(name=>[name,new Element({mobileHold:name,...(['swing','reel','dive','trick'].includes(name)?{mobileModes:'spider'}:{}),...(['reel','dive','trick'].includes(name)?{mobileExtra:'true'}:{})})]));
  const actions=Object.fromEntries(['jump','zip','point','interact','view','recenter','fullscreen','more','continue-portrait'].map(name=>[name,new Element({mobileAction:name,...(['jump','zip','point'].includes(name)?{mobileModes:'spider'}:{})})]));
  root.children=[...Object.values(holds),...Object.values(actions).filter(b=>b!==actions['continue-portrait'])];
  ids.get('mobile-orientation-hint').children=[actions['continue-portrait']];
  doc.body=new Element();doc.hidden=false;doc.getElementById=id=>ids.get(id)||null;doc.documentElement={};
  const mqCoarse=Object.assign(new Element(),{matches:coarse}),mqLandscape=Object.assign(new Element(),{matches:landscape});
  win.matchMedia=q=>q.includes('coarse')?mqCoarse:mqLandscape;win.screen={orientation:new Element()};win.visualViewport=new Element();win.innerWidth=844;win.innerHeight=390;
  const events={axes:[],holds:[],actions:[],resets:0,changes:0};let permitted=true;
  const controls=createMobileControls({document:doc,window:win,canUse:()=>permitted,onAxes:v=>events.axes.push(v),onHold:(name,value)=>events.holds.push([name,value]),onAction:name=>events.actions.push(name),onReset:()=>events.resets++,onChange:()=>events.changes++});
  controls.update({active:true,mode:'spider',canInteract:true,interactionLabel:'穿上战衣'});
  return{controls,doc,win,root,joy,holds,actions,events,mqCoarse,mqLandscape,el:id=>ids.get(id),permit:v=>permitted=v};
}
const down=(el,id,xy={})=>el.emit('pointerdown',{pointerId:id,...xy});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('desktop has no overlay until manual touch toggle or a real touch, without intercepting ordinary mouse input',()=>{
  const f=fixture({coarse:false});assert.equal(f.controls.enabled,false);assert.equal(f.root.hidden,true);f.doc.emit('pointerdown',{pointerType:'mouse'});assert.equal(f.controls.enabled,false);
  f.el('mobile-enable-touch').emit('click');assert.equal(f.controls.enabled,true);assert.equal(f.root.hidden,false);assert.equal(f.doc.body.classList.contains('touch-controls'),true);assert.equal(f.el('mobile-enable-touch').hidden,true);
  assert.equal(f.events.changes,1);f.controls.dispose();
  const g=fixture({coarse:false});g.doc.emit('pointerdown',{pointerType:'touch'});assert.equal(g.controls.enabled,true);g.controls.dispose();
});
test('joystick emits proportional clamped axes, has a dead zone and cannot be taken over by a second finger',()=>{
  const f=fixture();down(f.joy,10);f.win.emit('pointermove',{pointerId:10,clientX:62,clientY:59});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});
  f.win.emit('pointermove',{pointerId:10,clientX:60,clientY:38});assert.ok(f.controls.axes.forward>.4&&f.controls.axes.forward<.5);assert.equal(f.controls.axes.sideways,0);
  down(f.joy,11,{clientX:100,clientY:60});f.win.emit('pointermove',{pointerId:11,clientX:200,clientY:200});assert.equal(f.controls.axes.sideways,0);
  f.win.emit('pointerup',{pointerId:11});assert.ok(f.controls.axes.forward>.4);
  f.win.emit('pointermove',{pointerId:10,clientX:400,clientY:-280});assert.ok(Math.abs(Math.hypot(f.controls.axes.forward,f.controls.axes.sideways)-1)<1e-9);
  f.win.emit('pointerup',{pointerId:10});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});assert.equal(f.joy.captures.size,0);f.controls.dispose();
});
test('joystick, swing and lift contacts remain independent and releasing never synthesizes another web hold',()=>{
  const f=fixture();down(f.joy,1,{clientY:10});down(f.holds.swing,2);down(f.holds.up,3);
  assert.deepEqual(f.events.holds,[['swing',true],['up',true]]);f.win.emit('pointerup',{pointerId:2});f.holds.swing.emit('click',{detail:1});f.holds.swing.emit('click',{detail:0});
  assert.deepEqual(f.events.holds,[['swing',true],['up',true],['swing',false]]);assert.equal(f.controls.axes.forward,1);
  down(f.holds.swing,4);assert.deepEqual(f.events.holds.at(-1),['swing',true]);f.holds.up.emit('lostpointercapture',{pointerId:3});assert.deepEqual(f.events.holds.at(-1),['up',false]);
  f.controls.dispose();assert.deepEqual(f.events.holds.at(-1),['swing',false]);assert.deepEqual(f.events.axes.at(-1),{forward:0,sideways:0});
});
test('cancel, resize, hidden tab and pause clear held contacts, and old fingers cannot resume them',()=>{
  const f=fixture();
  for(const boundary of['cancel','resize','hidden','pause']){
    down(f.joy,1,{clientY:0});down(f.holds.swing,2);assert.equal(f.events.holds.at(-1)[1],true);
    if(boundary==='cancel'){f.joy.emit('pointercancel',{pointerId:1});f.holds.swing.emit('pointercancel',{pointerId:2});}
    if(boundary==='resize')f.win.emit('resize');
    if(boundary==='hidden'){f.doc.hidden=true;f.doc.emit('visibilitychange');f.doc.hidden=false;f.doc.emit('visibilitychange');}
    if(boundary==='pause'){f.controls.update({suspended:true});assert.equal(f.root.hidden,true);f.controls.update({suspended:false});}
    assert.equal(f.events.holds.at(-1)[1],false);assert.deepEqual(f.controls.axes,{forward:0,sideways:0});
    f.win.emit('pointermove',{pointerId:1,clientY:-100});f.holds.swing.emit('click');assert.deepEqual(f.controls.axes,{forward:0,sideways:0});assert.equal(f.events.holds.at(-1)[1],false);
  }f.controls.dispose();
});
test('mode changes release incompatible controls and preserve interaction button contents',()=>{
  const f=fixture();down(f.holds.swing,1);f.controls.update({mode:'roadster',interactionLabel:'下车',view:'first'});
  assert.deepEqual(f.events.holds.at(-1),['swing',false]);assert.equal(f.holds.swing.hidden,true);assert.equal(f.actions.jump.hidden,true);assert.equal(f.el('mobile-interact-label').textContent,'下车');assert.equal(f.actions.view.attrs['aria-label'],'切换第三人称');
  assert.equal(f.holds.up.textContent,'喷气');assert.match(f.holds.up.attrs['aria-label'],/松开后下落/);assert.equal(f.holds.brake.textContent,'刹车');
  for(const mode of['helicopter','hoverboard']){f.controls.update({mode});assert.equal(f.holds.up.textContent,'上升');assert.equal(f.holds.up.attrs['aria-label'],'按住上升');assert.equal(f.holds.brake.textContent,'悬停');assert.match(f.holds.brake.attrs['aria-label'],/悬停/);}
  f.controls.update({mode:'scooter'});assert.equal(f.holds.brake.textContent,'刹车');assert.equal(f.holds.brake.attrs['aria-label'],'按住刹车');
  f.controls.update({canInteract:false});assert.equal(f.actions.interact.hidden,true);f.controls.dispose();
});
test('one action fires for each deliberate press and accessibility activation, never again from pointer click',()=>{
  const f=fixture();down(f.actions.jump,5);down(f.actions.jump,6);f.win.emit('pointerup',{pointerId:5});f.actions.jump.emit('click',{detail:1});assert.deepEqual(f.events.actions,['jump']);
  f.actions.jump.emit('click',{detail:0});assert.deepEqual(f.events.actions,['jump','jump']);f.permit(false);down(f.actions.jump,7);f.actions.jump.emit('click',{detail:0});assert.equal(f.events.actions.length,2);f.controls.dispose();
});
test('keyboard-operated hold buttons release on keyup or blur and do not create an accessibility latch',()=>{
  const f=fixture();f.holds.swing.emit('keydown',{code:'Space'});f.holds.swing.emit('keydown',{code:'Space',repeat:true});f.holds.swing.emit('keyup',{code:'Space'});f.holds.swing.emit('click',{detail:0});
  assert.deepEqual(f.events.holds,[['swing',true],['swing',false]]);f.holds.swing.emit('keydown',{code:'Enter'});f.holds.swing.emit('blur');assert.deepEqual(f.events.holds.slice(-2),[['swing',true],['swing',false]]);f.controls.dispose();
});
test('portrait fallback can be dismissed and rotation clears gestures without trapping gameplay',()=>{
  const f=fixture({landscape:false});assert.equal(f.el('mobile-orientation-hint').hidden,false);down(f.actions['continue-portrait'],10);assert.equal(f.el('mobile-orientation-hint').hidden,true);
  down(f.holds.swing,11);f.mqLandscape.matches=true;f.mqLandscape.emit('change');assert.deepEqual(f.events.holds.at(-1),['swing',false]);assert.equal(f.el('mobile-orientation-hint').hidden,true);
  f.mqLandscape.matches=false;f.mqLandscape.emit('change');assert.equal(f.el('mobile-orientation-hint').hidden,false);f.controls.update({suspended:true});assert.equal(f.el('mobile-orientation-hint').hidden,true);f.controls.dispose();
});
test('full screen degrades gracefully when unsupported or rejected, and attempts landscape only after a real grant',async()=>{
  const f=fixture(),tap=id=>{down(f.actions.fullscreen,id);f.actions.fullscreen.emit('pointerup',{pointerId:id});};down(f.holds.swing,1);tap(2);await flush();assert.match(f.el('mobile-fullscreen-status').textContent,/未提供/);assert.deepEqual(f.events.holds.at(-1),['swing',false]);
  let locks=0;f.doc.documentElement.requestFullscreen=()=>Promise.reject(new Error('denied'));f.win.screen.orientation.lock=()=>{locks++;};tap(3);await flush();assert.match(f.el('mobile-fullscreen-status').textContent,/暂未/);assert.equal(locks,0);
  f.doc.documentElement.requestFullscreen=()=>{f.doc.fullscreenElement=f.doc.documentElement;return Promise.resolve();};f.win.screen.orientation.lock=()=>{locks++;return Promise.reject(new Error('unsupported'));};tap(4);await flush();assert.equal(locks,1);assert.match(f.el('mobile-fullscreen-status').textContent,/已进入全屏/);assert.equal(f.root.hidden,false);f.controls.dispose();
});
test('fullscreen waits for its owning pointer release and never activates from a cancelled contact or synthetic click',async()=>{
  const f=fixture();let requests=0;f.doc.documentElement.requestFullscreen=()=>{requests++;return Promise.resolve();};
  for(const pointerType of['touch','pen','mouse']){
    const before=requests;down(f.actions.fullscreen,10,{pointerType});assert.equal(requests,before,'pointerdown cannot use touch activation');
    f.actions.fullscreen.emit('pointerup',{pointerId:11,pointerType});assert.equal(requests,before,'another finger cannot activate');
    f.actions.fullscreen.emit('pointerup',{pointerId:10,pointerType});assert.equal(requests,before+1);
    f.win.emit('pointerup',{pointerId:10,pointerType});f.actions.fullscreen.emit('click',{detail:1,pointerType});await flush();assert.equal(requests,before+1);
  }
  for(const boundary of['pointercancel','lostpointercapture','resize','pause']){
    const before=requests;down(f.actions.fullscreen,12);
    if(boundary==='resize')f.win.emit('resize');else if(boundary==='pause'){f.controls.update({suspended:true});f.controls.update({suspended:false});}else f.actions.fullscreen.emit(boundary,{pointerId:12});
    f.actions.fullscreen.emit('pointerup',{pointerId:12});f.actions.fullscreen.emit('click',{detail:1});await flush();assert.equal(requests,before,boundary);
  }
  // Browser keyboard activation and assistive activation arrive as detail=0.
  for(const activation of['keyboard','accessibility']){const before=requests;f.actions.fullscreen.emit('click',{detail:0});await flush();assert.equal(requests,before+1,activation);}
  f.controls.dispose();
});
test('disposal releases inputs, removes listeners and does not call callbacks after removal',()=>{
  const f=fixture();down(f.holds.swing,1);down(f.joy,2,{clientY:0});f.controls.dispose();const before=JSON.stringify(f.events);
  f.win.emit('pointermove',{pointerId:2,clientX:300});f.holds.swing.emit('pointerdown',{pointerId:3});f.doc.emit('pointerdown',{pointerType:'touch'});f.win.emit('resize');f.controls.dispose();assert.equal(JSON.stringify(f.events),before);assert.equal(f.root.hidden,true);assert.equal(f.doc.body.classList.contains('touch-controls'),false);
});

test('point launch is available without opening more and reports the current roof targeting state',()=>{
  const f=fixture();assert.equal(f.el('mobile-extra-actions').hidden,true);assert.equal(f.actions.point.hidden,false);
  down(f.actions.point,1);f.win.emit('pointerup',{pointerId:1});f.actions.point.emit('click',{detail:1});assert.deepEqual(f.events.actions,['point']);
  assert.equal(f.el('mobile-point-hint').textContent,'瞄准屋沿');f.controls.update({pointReady:true});assert.equal(f.el('mobile-point-hint').textContent,'屋沿已锁定');
  f.controls.update({pointPhase:'approach'});assert.equal(f.el('mobile-point-hint').textContent,'点跳跃弹出');f.controls.dispose();
});

test('closing more releases hidden finger and keyboard holds without interrupting the main swing gesture',()=>{
  const f=fixture();assert.equal(f.holds.reel.hidden,true);down(f.holds.reel,1);assert.deepEqual(f.events.holds,[]);
  down(f.actions.more,2);f.win.emit('pointerup',{pointerId:2});assert.equal(f.holds.reel.hidden,false);
  down(f.holds.reel,3);f.holds.trick.emit('keydown',{code:'Space'});down(f.holds.swing,4);
  down(f.actions.more,5);f.win.emit('pointerup',{pointerId:5});assert.equal(f.holds.reel.hidden,true);assert.equal(f.el('mobile-extra-actions').hidden,true);
  assert.ok(f.events.holds.some(([name,held])=>name==='reel'&&!held));assert.ok(f.events.holds.some(([name,held])=>name==='trick'&&!held));
  assert.equal(f.events.holds.filter(([name,held])=>name==='swing'&&!held).length,0);
  f.win.emit('pointerup',{pointerId:4});assert.deepEqual(f.events.holds.at(-1),['swing',false]);
  f.holds.trick.emit('keydown',{code:'Space'});assert.deepEqual(f.events.holds.at(-1),['swing',false]);f.controls.dispose();
});

test('focusing an editable field releases movement before the phone keyboard can obscure it',()=>{
  const f=fixture();down(f.joy,10,{clientY:0});down(f.holds.swing,11);
  f.doc.emit('focusin',{target:{closest:()=>({tagName:'INPUT'})}});
  assert.deepEqual(f.controls.axes,{forward:0,sideways:0});assert.deepEqual(f.events.holds.at(-1),['swing',false]);
  f.win.emit('pointermove',{pointerId:10,clientY:-200});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});f.controls.dispose();
});
