import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileControls} from '../src/mobile-controls.js';

class Element {
  constructor(dataset={}){this.dataset=dataset;this.handlers=new Map();this.hidden=false;this.disabled=false;this.style={};this.attrs={};this.captures=new Set();this.children=[];this.textContent='';const values=new Set();this.classList={toggle(k,v){const next=v??!values.has(k);next?values.add(k):values.delete(k);return next;},remove:k=>values.delete(k),contains:k=>values.has(k)};}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  emit(type,overrides={}){const e={type,target:this,pointerId:1,pointerType:'touch',clientX:60,clientY:60,detail:1,code:'',repeat:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...overrides};for(const fn of this.handlers.get(type)||[])fn(e);return e;}
  contains(target){return target===this||this.children.some(child=>child.contains(target));}
  setAttribute(k,v){this.attrs[k]=String(v);}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  getBoundingClientRect(){return{left:0,top:0,width:120,height:120};}
  querySelectorAll(selector){if(selector==='[data-mobile-hold]')return this.children.filter(c=>c.dataset.mobileHold);if(selector==='[data-mobile-action]')return this.children.filter(c=>c.dataset.mobileAction);return[];}
  querySelector(selector){return selector.includes('continue-portrait')?this.children.find(c=>c.dataset.mobileAction==='continue-portrait'):null;}
}
function fixture({coarse=true,landscape=true}={}){
  const ids=new Map(),doc=new Element(),win=new Element(),canvas=new Element();
  canvas.getBoundingClientRect=()=>({left:0,top:0,width:844,height:390});
  for(const id of['mobile-controls','mobile-joystick','mobile-stick','mobile-extra-actions','mobile-orientation-hint','mobile-fullscreen-status','mobile-interact-label','mobile-point-hint','mobile-enable-touch'])ids.set(id,new Element());
  const root=ids.get('mobile-controls'),joy=ids.get('mobile-joystick');
  const holds=Object.fromEntries(['fast','brake','up','down','swing','reel','dive','trick'].map(name=>[name,new Element({mobileHold:name,...(['swing','reel','dive','trick'].includes(name)?{mobileModes:'spider'}:{}),...(['reel','dive','trick'].includes(name)?{mobileExtra:'true'}:{})})]));
  const actions=Object.fromEntries(['jump','zip','point','interact','view','recenter','fullscreen','more','continue-portrait'].map(name=>[name,new Element({mobileAction:name,...(['jump','zip','point'].includes(name)?{mobileModes:'spider'}:{})})]));
  root.children=[...Object.values(holds),...Object.values(actions).filter(b=>b!==actions['continue-portrait'])];
  ids.get('mobile-orientation-hint').children=[actions['continue-portrait']];
  doc.body=new Element();doc.hidden=false;doc.getElementById=id=>ids.get(id)||null;doc.documentElement={};
  const mqCoarse=Object.assign(new Element(),{matches:coarse}),mqLandscape=Object.assign(new Element(),{matches:landscape});
  win.matchMedia=q=>q.includes('coarse')?mqCoarse:mqLandscape;win.screen={orientation:new Element()};win.visualViewport=new Element();win.innerWidth=844;win.innerHeight=390;
  const events={axes:[],look:[],holds:[],actions:[],resets:0,changes:0};let permitted=true;
  const controls=createMobileControls({document:doc,window:win,movementSurface:canvas,canUse:()=>permitted,onAxes:v=>events.axes.push(v),onLook:(x,y)=>events.look.push([x,y]),onHold:(name,value)=>events.holds.push([name,value]),onAction:name=>events.actions.push(name),onReset:()=>events.resets++,onChange:()=>events.changes++});
  controls.update({active:true,mode:'spider',canInteract:true,interactionLabel:'穿上战衣'});
  return{controls,doc,win,canvas,root,joy,holds,actions,events,mqCoarse,mqLandscape,el:id=>ids.get(id),permit:v=>permitted=v};
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
  const f=fixture();down(f.joy,1,{clientY:100});f.win.emit('pointermove',{pointerId:1,clientY:10});down(f.holds.swing,2);down(f.holds.up,3);
  assert.deepEqual(f.events.holds,[['swing',true],['up',true]]);f.win.emit('pointerup',{pointerId:2});f.holds.swing.emit('click',{detail:1});f.holds.swing.emit('click',{detail:0});
  assert.deepEqual(f.events.holds,[['swing',true],['up',true],['swing',false]]);assert.equal(f.controls.axes.forward,1);
  down(f.holds.swing,4);assert.deepEqual(f.events.holds.at(-1),['swing',true]);f.holds.up.emit('lostpointercapture',{pointerId:3});assert.deepEqual(f.events.holds.at(-1),['up',false]);
  f.controls.dispose();assert.deepEqual(f.events.holds.at(-1),['swing',false]);assert.deepEqual(f.events.axes.at(-1),{forward:0,sideways:0});
});
test('a bare left-scene touch creates a neutral floating origin wherever the finger lands',()=>{
  const f=fixture();
  for(const [clientX,clientY]of [[35,330],[310,240],[175,130]]){
    const e=down(f.doc,10,{target:f.canvas,clientX,clientY});
    assert.equal(e.defaultPrevented,true);assert.equal(e.propagationStopped,true,'canvas look must not receive movement touches');
    assert.equal(f.joy.style.left,`${clientX}px`);assert.equal(f.joy.style.top,`${clientY}px`);assert.equal(f.joy.classList.contains('is-pressed'),true);
    assert.deepEqual(f.controls.axes,{forward:0,sideways:0},'landing off the previous center must not start movement');
    f.win.emit('pointermove',{pointerId:10,clientX:clientX+2,clientY:clientY-2});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});
    f.win.emit('pointermove',{pointerId:10,clientX:clientX+90,clientY});assert.equal(Math.abs(f.controls.axes.forward),0);assert.equal(f.controls.axes.sideways,1);
    f.win.emit('pointerup',{pointerId:10});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});
    assert.equal(f.joy.classList.contains('is-pressed'),false);assert.equal(f.joy.style.left,'');assert.equal(f.joy.style.top,'');
  }f.controls.dispose();
});
test('floating movement ignores UI, mouse input and unusable scene states',()=>{
  const f=fixture();
  for(const overrides of[
    {target:f.actions.view},{target:f.holds.swing},{target:new Element()},
    {target:f.canvas,pointerType:'mouse'},
    {target:f.canvas,clientX:-5},{target:f.canvas,clientY:420}
  ]){
    const e=down(f.doc,10,{clientX:180,clientY:200,...overrides});assert.equal(e.defaultPrevented,undefined);assert.equal(e.propagationStopped,undefined);assert.equal(f.joy.captures.size,0);
  }
  f.permit(false);assert.equal(down(f.doc,10,{target:f.canvas,clientX:180,clientY:200}).defaultPrevented,undefined);f.permit(true);
  down(f.doc,10,{target:f.canvas,clientX:180,clientY:200});
  const second=down(f.doc,11,{target:f.canvas,clientX:300,clientY:200});assert.equal(second.propagationStopped,true);
  f.win.emit('pointermove',{pointerId:11,clientX:350,clientY:150});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});
  f.win.emit('pointerup',{pointerId:11});assert.equal(f.joy.captures.has(10),true);
  f.controls.update({suspended:true});assert.equal(f.joy.captures.size,0);assert.equal(f.joy.classList.contains('is-pressed'),false);
  assert.equal(down(f.doc,12,{target:f.canvas,clientX:180,clientY:200}).defaultPrevented,undefined);f.controls.dispose();
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

test('movement and look own separate fingers even when pointer capture is rejected by a WebView',()=>{
  const f=fixture();f.canvas.setPointerCapture=f.joy.setPointerCapture=()=>{throw Error('capture unavailable');};
  down(f.doc,1,{target:f.canvas,clientX:130,clientY:220});
  down(f.doc,2,{target:f.canvas,clientX:650,clientY:180});
  assert.equal(f.controls.looking,true);
  f.win.emit('pointermove',{pointerId:1,clientX:130,clientY:140});
  f.win.emit('pointermove',{pointerId:2,clientX:710,clientY:150});
  assert.equal(f.controls.axes.forward,1);assert.deepEqual(f.events.look,[[60,-30]]);
  // Crossing sides never transfers ownership to the joystick.
  f.canvas.emit('pointermove',{pointerId:2,clientX:200,clientY:160});
  f.win.emit('pointermove',{pointerId:2,clientX:200,clientY:160});
  assert.deepEqual(f.events.look.at(-1),[-510,10]);assert.equal(f.events.look.length,2,'bubbling move is applied once');
  f.win.emit('pointerup',{pointerId:2});assert.equal(f.controls.looking,false);assert.equal(f.controls.axes.forward,1);
  down(f.doc,3,{target:f.canvas,clientX:620,clientY:200});f.win.emit('pointermove',{pointerId:3,clientX:650,clientY:220});
  assert.deepEqual(f.events.look.at(-1),[30,20]);f.win.emit('pointerup',{pointerId:1});assert.deepEqual(f.controls.axes,{forward:0,sideways:0});assert.equal(f.controls.looking,true);
  f.win.emit('pointercancel',{pointerId:3});assert.equal(f.controls.looking,false);f.controls.dispose();
});
test('look contact cannot be stolen and cancellation or a viewport boundary allows a fresh gesture',()=>{
  const f=fixture();down(f.doc,1,{target:f.canvas,clientX:600,clientY:100});down(f.doc,2,{target:f.canvas,clientX:700,clientY:200});
  f.win.emit('pointermove',{pointerId:2,clientX:730,clientY:230});f.canvas.emit('lostpointercapture',{pointerId:2});assert.deepEqual(f.events.look,[]);assert.equal(f.controls.looking,true);
  f.win.emit('pointermove',{pointerId:1,clientX:620,clientY:130});assert.deepEqual(f.events.look,[[20,30]]);
  f.win.emit('resize');assert.equal(f.controls.looking,false);f.win.emit('pointermove',{pointerId:1,clientX:650,clientY:150});assert.equal(f.events.look.length,1);
  down(f.doc,3,{target:f.canvas,clientX:620,clientY:150});f.win.emit('pointermove',{pointerId:3,clientX:660,clientY:150});assert.deepEqual(f.events.look.at(-1),[40,0]);f.controls.dispose();
});
test('native long press and selection are blocked only on active game surfaces',()=>{
  const f=fixture();
  for(const type of ['contextmenu','selectstart','dragstart','touchstart']){
    assert.equal(f.doc.emit(type,{target:f.canvas}).defaultPrevented,true,type);
    assert.equal(f.doc.emit(type,{target:f.joy}).defaultPrevented,true,type);
    assert.equal(f.doc.emit(type,{target:f.actions.view}).defaultPrevented,true,type);
    assert.equal(f.doc.emit(type,{target:new Element()}).defaultPrevented,undefined,'forms and other screens keep native behavior');
  }
  f.controls.update({suspended:true});assert.equal(f.doc.emit('contextmenu',{target:f.canvas}).defaultPrevented,undefined);f.controls.dispose();
});

test('rotating into landscape clears old fingers and new landscape contacts move and turn independently',()=>{
  const f=fixture({landscape:false});
  f.canvas.getBoundingClientRect=()=>({left:0,top:0,width:390,height:844});
  down(f.doc,1,{target:f.canvas,clientX:80,clientY:550});down(f.doc,2,{target:f.canvas,clientX:290,clientY:300});
  f.win.emit('pointermove',{pointerId:1,clientX:80,clientY:470});f.win.emit('pointermove',{pointerId:2,clientX:330,clientY:300});
  assert.equal(f.controls.axes.forward,1);assert.equal(f.controls.looking,true);
  f.canvas.getBoundingClientRect=()=>({left:28,top:0,width:788,height:390});
  f.mqLandscape.matches=true;f.mqLandscape.emit('change');
  assert.equal(f.controls.looking,false);assert.deepEqual(f.controls.axes,{forward:0,sideways:0});assert.equal(f.el('mobile-orientation-hint').hidden,true);
  const before=f.events.look.length;
  f.win.emit('pointermove',{pointerId:2,clientX:700,clientY:150});assert.equal(f.events.look.length,before);
  down(f.doc,3,{target:f.canvas,clientX:190,clientY:260});down(f.doc,4,{target:f.canvas,clientX:650,clientY:170});
  f.win.emit('pointermove',{pointerId:3,clientX:190,clientY:180});f.win.emit('pointermove',{pointerId:4,clientX:700,clientY:160});
  assert.equal(f.controls.axes.forward,1);assert.deepEqual(f.events.look.at(-1),[50,-10]);
  f.win.emit('pointerup',{pointerId:3});assert.equal(f.controls.looking,true);f.controls.dispose();
});
