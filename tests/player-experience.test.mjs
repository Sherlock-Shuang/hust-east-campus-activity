import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createPlayerExperience} from '../src/player-experience.js';

// Only the DOM surface is faked. All registered input handlers, player motion,
// Three.js models and camera calculations below are the production modules.
class Element {
  constructor(tag='div'){
    this.tagName=tag.toUpperCase();this.handlers=new Map();this.dataset={};this.style={};this.attrs={};this.hidden=false;this.textContent='';this.children=[];this.captures=new Set();
    const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,value)=>{const next=value??!classes.has(x);next?classes.add(x):classes.delete(x);return next;}};
  }
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,new Set());this.handlers.get(type).add(fn);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  dispatchEvent(event){return this.emit(event.type,event);}
  emit(type,values={}){const event={type,target:this,code:'',repeat:false,button:0,buttons:0,pointerId:1,pointerType:'mouse',clientX:0,clientY:0,detail:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;},...values};for(const fn of this.handlers.get(type)||[])fn(event);return event;}
  setAttribute(name,value){this.attrs[name]=String(value);}
  getAttribute(name){return this.attrs[name]??null;}
  append(child){this.children.push(child);child.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  closest(selector){return selector.split(',').some(tag=>tag.trim().toUpperCase()===this.tagName)?this:this.parent?.closest(selector)||null;}
  focus(){}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  getBoundingClientRect(){return this.rect||{left:0,top:0,width:120,height:120};}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(selector){if(selector==='button')return this.button??=new Element('button');return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){
    const attribute=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/),result=[];
    const visit=element=>{for(const child of element.children){if(attribute&&child.getAttribute(attribute[1])!==null&&(attribute[2]===undefined||child.getAttribute(attribute[1])===attribute[2]))result.push(child);visit(child);}};
    visit(this);return result;
  }
}

// Optional legacy controls belong to an embedding host. Parse the shipped
// mobile buttons below and retain this separate legacy fixture solely to
// exercise the older embedding host's supported input paths.
const LEGACY_CONTROL_IDS = [
  'player-mouse-toggle','look-sensitivity','look-sensitivity-value','player-side-view',
  'exit-player','player-recenter','walk-controls','player-cruise','player-flight-toggle',
  'player-auto-swing','web-immersive','web-controls','web-suit','web-audio','web-comfort',
  'drive-immersive','drive-comfort','drive-controls','player-takeoff','player-land','player-reset',
];
const REMOVED_HUD_IDS = new Set([
  ...LEGACY_CONTROL_IDS,'drive-toolbar','drive-readouts','drive-phase','drive-heading','drive-climb',
  'player-speed','player-height','player-distance','player-status','web-toolbar','web-readouts',
  'web-phase','web-length','web-chain','web-actions','web-release-hint','web-zip-status',
  'web-maneuvers','web-point-status','web-trick-status','web-launch-meter','web-launch-fill','web-launch-hint',
]);
function fixture(t,{buildings=true,legacyControls=true,transportSources,coarsePointer=false,roadSurfaces=[],spiderPreparation,storage,joystickRect={left:24,top:190,width:120,height:120}}={}){
  const previous={document:globalThis.document,window:globalThis.window};
  const doc=new Element(),win=new Element(),ids=new Map(),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const fromHTML=(tag,attributes)=>{
    const el=new Element(tag);
    for(const match of attributes.matchAll(/([\w-]+)="([^"]*)"/g)){
      const [,name,value]=match;el.setAttribute(name,value);
      if(name==='id')el.id=value;
      if(name.startsWith('data-'))el.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    }
    el.hidden=/\bhidden(?:\s|$|=)/.test(attributes);return el;
  };
  for(const match of html.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="[^"]+"[^>]*)>/g)){const el=fromHTML(match[1],match[2]);ids.set(el.id,el);}
  const mobileButtons=[];
  for(const match of html.matchAll(/<button\b([^>]*\bdata-mobile-(?:action|hold)="[^"]+"[^>]*)>/g)){
    const el=fromHTML('button',match[1]);mobileButtons.push(el);
    ids.get(el.dataset.mobileAction==='continue-portrait'?'mobile-orientation-hint':'mobile-controls').append(el);
  }
  ids.get('mobile-joystick').rect=joystickRect;
  for(const id of REMOVED_HUD_IDS)ids.delete(id);
  if(legacyControls)for(const id of LEGACY_CONTROL_IDS){const el=new Element(id==='look-sensitivity'?'input':'button');el.id=id;ids.set(id,el);}
  const mode=['walk','scooter','helicopter','roadster','hoverboard','spider'].map(playerMode=>Object.assign(new Element('button'),{dataset:{playerMode}}));
  const cameras=(legacyControls?['third','first']:[]).map(playerCamera=>Object.assign(new Element('button'),{dataset:{playerCamera}}));
  const inputs=(legacyControls?['left','forward','right','brake','back','swing','jump','zip','dive','reel','point','trick','up','down','fast']:[]).map(playerInput=>Object.assign(new Element('button'),{dataset:{playerInput}}));
  const optionalReferenceButtons=new Set(['roadster-references','hoverboard-references']);
  doc.body=new Element('body');doc.documentElement=new Element('html');doc.hidden=false;doc.createElement=tag=>new Element(tag);doc.getElementById=id=>{if(!ids.has(id)&&(optionalReferenceButtons.has(id)||REMOVED_HUD_IDS.has(id)))return null;assert.ok(ids.has(id),`fixture missing actual HTML id ${id}`);return ids.get(id);};
  doc.querySelectorAll=selector=>({'[data-player-mode]':mode,'[data-player-camera]':cameras,'[data-player-input]':inputs,'.web-input':inputs.filter(b=>['swing','jump','zip','dive','reel','point','trick'].includes(b.dataset.playerInput)),'.flight-input':inputs.filter(b=>['up','down','fast'].includes(b.dataset.playerInput))}[selector]||[]);
  doc.querySelector=selector=>selector==='dialog[open]'?doc.body.children.find(el=>el.open)||null:selector==='[data-player-input=brake]'?inputs.find(el=>el.dataset.playerInput==='brake'):null;
  const coarseMedia=Object.assign(new Element(),{matches:coarsePointer}),landscapeMedia=Object.assign(new Element(),{matches:true}),reducedMedia=Object.assign(new Element(),{matches:false});
  win.matchMedia=query=>query.includes('coarse')?coarseMedia:query.includes('orientation')?landscapeMedia:reducedMedia;
  win.localStorage=storage;win.innerWidth=844;win.innerHeight=390;win.screen={orientation:new Element()};win.visualViewport=new Element();
  globalThis.document=doc;globalThis.window=win;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(44,16/9,.3,2000),canvas=new Element('canvas');canvas.clientWidth=1280;canvas.clientHeight=720;canvas.rect={left:0,top:0,width:844,height:390};
  const controls=Object.assign(new THREE.EventDispatcher(),{target:new THREE.Vector3(),enabled:true,enableDamping:true,update(){}});
  const route={length:300,dismountProgress:280,roadSurfaces,points:[{x:0,y:.16,z:0,progress:0},{x:0,y:.16,z:-300,progress:300}],segments:[{startProgress:0,endProgress:300,width:7.2}]};
  const rectangle=(x1,z1,x2,z2)=>{const shape=new THREE.Shape();shape.moveTo(x1,-z1);shape.lineTo(x2,-z1);shape.lineTo(x2,-z2);shape.lineTo(x1,-z2);shape.closePath();return {category:'building',feature:{properties:{height:18}},shapes:[shape]};};
  const model={buildings:buildings?[rectangle(8,-160,18,25),rectangle(-18,-160,-8,25)]:[],water:[],bounds:{minX:-200,maxX:200,minZ:-400,maxZ:200}};
  const notices=[];const experience=createPlayerExperience({THREE,scene,camera,controls,canvas,route,simulation:{agents:[]},model,transportSources,spiderPreparation,onEnter(){},notify:s=>notices.push(s),invalidate(){}});
  t.after(()=>{experience.dispose();globalThis.document=previous.document;globalThis.window=previous.window;});
  const tick=seconds=>{for(let remaining=seconds;remaining>1e-9;remaining-=1/60)experience.tick(Math.min(remaining,1/60));};
  const key=(code,type='keydown',extra={})=>win.emit(type,{code,target:canvas,...extra});
  return {experience,scene,camera,controls,canvas,doc,win,notices,tick,key,coarseMedia,landscapeMedia,el:id=>ids.get(id),input:name=>inputs.find(el=>el.dataset.playerInput===name),mobileHold:name=>mobileButtons.find(el=>el.dataset.mobileHold===name),mobileAction:name=>mobileButtons.find(el=>el.dataset.mobileAction===name)};
}

test('street inspection enters at the requested location with a stable eye-level camera',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});
  assert.equal(f.experience.enterAt({x:24,z:-35,yaw:Math.PI/2}).ok,true);
  f.tick(.5);assert.equal(f.experience.active,true);assert.equal(f.experience.state.mode,'walk');
  assert.equal(f.experience.state.x,24);assert.equal(f.experience.state.z,-35);
  assert.ok(Math.abs(f.camera.position.y-1.72)<.03,'eye level must not inherit the aerial camera height');
  assert.equal(f.el('player-hud').hidden,false);assert.equal(f.controls.enabled,false);
  f.key('KeyW');f.tick(.5);f.key('KeyW','keyup');assert.ok(f.experience.state.x<24);
  f.experience.exit();assert.equal(f.controls.enabled,true);
});

test('activity pose restores location, mode and viewpoint without retaining held movement',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});
  f.experience.enterAt({x:24,z:-35,yaw:Math.PI/2});f.tick(.5);
  const saved=f.experience.captureActivityPose();
  f.key('KeyW');f.tick(1);f.key('KeyW','keyup');
  assert.notEqual(f.experience.state.x,saved.state.x);
  assert.equal(f.experience.restoreActivityPose(saved),true);
  assert.equal(f.experience.state.x,saved.state.x);assert.equal(f.experience.state.z,saved.state.z);
  assert.equal(f.experience.state.mode,saved.mode);
  const after={x:f.experience.state.x,z:f.experience.state.z};f.tick(.3);
  assert.equal(f.experience.state.x,after.x);assert.equal(f.experience.state.z,after.z);
  assert.equal(f.experience.restoreActivityPose({...saved,state:{...saved.state,x:Infinity}}),false);
});

test('stale activity returns cannot place the player inside buildings or beyond map bounds',t=>{
  const f=fixture(t,{legacyControls:false});f.experience.enter('walk');
  const saved=f.experience.captureActivityPose(),before=structuredClone(f.experience.state);
  for(const state of [{...saved.state,x:12,z:0},{...saved.state,x:400,z:0}]){
    assert.equal(f.experience.restoreActivityPose({...saved,state}),false);
    assert.deepEqual(f.experience.state,before,'rejected restore leaves the current player unchanged');
  }
});

test('activity return restores the view clipping plane and recomputes a safe camera',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});
  f.experience.enterAt({x:24,z:-35,yaw:0});f.tick(.5);
  const saved=f.experience.captureActivityPose();f.key('KeyV');
  assert.equal(f.camera.near,.12);
  // A cached camera can predate map corrections; it must not bypass today's
  // camera collision constraints or remain disconnected from the saved body.
  saved.camera.position=[1000,-10,1000];
  assert.equal(f.experience.restoreActivityPose(saved),true);
  assert.equal(f.camera.near,.06);
  assert.ok(f.camera.position.distanceTo(new THREE.Vector3(24,1.72,-35))<1);
});

test('cold activity return restores at its own pose without respawning on the route',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});
  const saved={mode:'walk',view:'first',state:{x:35,y:.14,z:-85,yaw:1,grounded:true}};
  assert.equal(f.experience.restoreActivityPose(saved),true);
  assert.equal(f.experience.active,true);assert.equal(f.experience.state.x,35);assert.equal(f.experience.state.z,-85);
  f.tick(.2);assert.equal(f.experience.state.x,35);assert.equal(f.experience.state.z,-85);
});

function horizontalView(f){
  const direction=new THREE.Vector3();f.camera.getWorldDirection(direction);direction.y=0;return direction.normalize();
}
for(const view of ['third','first'])test(`walking ${view}: W follows the mouse view and A/D/S use that fixed basis`,t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enter('walk');
  if(view==='first')f.key('KeyV');
  f.canvas.emit('pointerenter',{clientX:100,clientY:100});
  f.canvas.emit('pointermove',{clientX:430,clientY:100});f.tick(.7);
  f.canvas.emit('pointerleave');f.tick(2); // No mouse-look grace period can hide camera recentering.
  const forward=horizontalView(f),right=new THREE.Vector3(-forward.z,0,forward.x);
  assert.ok(Math.abs(forward.x)>.8,'view must differ substantially from initial avatar yaw');
  for(const [key,expected] of [['KeyW',forward],['KeyD',right],['KeyA',right.clone().negate()],['KeyS',forward.clone().negate()]]){
    const start={...f.experience.state};f.key(key);f.tick(2);f.key(key,'keyup');f.tick(1);
    const moved=new THREE.Vector3(f.experience.state.x-start.x,0,f.experience.state.z-start.z);
    assert.ok(moved.length()>5,`${key} moves instead of turning in place`);
    assert.ok(moved.normalize().dot(expected)>.999,`${key} follows the view's horizontal basis`);
    f.tick(2);
    assert.ok(horizontalView(f).dot(forward)>.999,'moving and stopping never swing the view behind the avatar');
  }
});

test('walking view switches and activity returns retain the movement basis after sideways movement',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enter('walk');
  f.key('KeyD');f.tick(1);f.key('KeyD','keyup');f.tick(1);
  const forward=horizontalView(f),saved=f.experience.captureActivityPose();
  assert.ok(Math.abs(saved.lookHeading-saved.state.yaw)>1,'body faces right while camera still faces forward');
  f.key('KeyV');f.tick(1);assert.ok(horizontalView(f).dot(forward)>.999);
  f.canvas.emit('pointerenter',{clientX:100,clientY:100});f.canvas.emit('pointermove',{clientX:500,clientY:100});f.tick(.6);
  assert.equal(f.experience.restoreActivityPose(saved),true);f.tick(1);
  assert.ok(horizontalView(f).dot(forward)>.999,'restoration persists beyond the single restored render frame');
  const start={...f.experience.state};f.key('KeyW');f.tick(1);f.key('KeyW','keyup');
  const moved=new THREE.Vector3(f.experience.state.x-start.x,0,f.experience.state.z-start.z).normalize();
  assert.ok(moved.dot(forward)>.999,'returning from a work restores logical movement heading too');
});

test('walking can redirect while moving and explicit recenter settles during held sideways input',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enter('walk');
  f.key('KeyW');f.tick(.6);
  f.canvas.emit('pointerenter',{clientX:100,clientY:100});f.canvas.emit('pointermove',{clientX:500,clientY:100});f.tick(.7);
  const forward=horizontalView(f),start={...f.experience.state};f.tick(.7);f.key('KeyW','keyup');
  const moved=new THREE.Vector3(f.experience.state.x-start.x,0,f.experience.state.z-start.z).normalize();
  assert.ok(moved.dot(forward)>.99,'held W follows a new view without waiting for key release');
  f.tick(1);f.key('KeyD');f.tick(1);const facing=f.experience.state.yaw;
  f.key('KeyC');f.key('KeyC','keyup');f.tick(4);
  const centred=horizontalView(f),expected=new THREE.Vector3(-Math.sin(facing),0,-Math.cos(facing));
  assert.ok(centred.dot(expected)>.999,'C targets the initial facing rather than spinning while D is held');
  f.tick(2);assert.ok(horizontalView(f).dot(centred)>.999);f.key('KeyD','keyup');
});

for(const mode of ['walk','scooter','roadster','helicopter','hoverboard','spider'])test(`${mode}: mouse movement without any button rotates the player camera`,t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enter(mode);f.tick(1);
  const before=f.camera.position.clone(),start={x:f.experience.state.x,z:f.experience.state.z};
  f.canvas.emit('pointerenter',{clientX:180,clientY:200});
  f.canvas.emit('pointermove',{clientX:340,clientY:200,buttons:0});f.tick(.6);
  assert.ok(f.camera.position.distanceTo(before)>.5,'hover input changes the camera without pointerdown');
  assert.equal(f.experience.state.x,start.x);assert.equal(f.experience.state.z,start.z);
  assert.equal(f.experience.state.anchor,null,'looking must not fire a web');
  f.experience.exit();const exited=f.camera.position.clone();
  f.canvas.emit('pointermove',{clientX:600,clientY:350});f.tick(.5);assert.deepEqual(f.camera.position,exited);
});

test('mouse look keeps first-person aim when idle and rebases after HUD exit, blur and view changes',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.key('KeyV');f.tick(1);
  f.canvas.emit('pointerenter',{clientX:100,clientY:100});f.canvas.emit('pointermove',{clientX:300,clientY:130});f.tick(1);
  const looking=f.camera.quaternion.clone();f.tick(2);
  assert.ok(looking.angleTo(f.camera.quaternion)<.01,'idle mouse look must not be pulled back by first-person auto-centering');
  f.canvas.emit('pointerdown',{clientX:300,clientY:130});f.canvas.emit('pointerup');f.tick(2);
  assert.ok(looking.angleTo(f.camera.quaternion)<.01,'a completed click does not end free mouse look');
  for(const boundary of ['pointerleave','blur']){
    boundary==='blur'?f.win.emit('blur'):f.canvas.emit('pointerleave');
    const previous=f.camera.quaternion.clone();
    f.canvas.emit('pointermove',{clientX:1000,clientY:700});f.tick(1/60);
    assert.ok(previous.angleTo(f.camera.quaternion)<.01,'first sample after a boundary must not turn');
    f.canvas.emit('pointermove',{clientX:1100,clientY:700});f.tick(.5);
    assert.ok(previous.angleTo(f.camera.quaternion)>.1,'following movement resumes look');
  }
  f.key('KeyV');f.tick(.6);const switched=f.camera.position.clone();
  f.canvas.emit('pointermove',{clientX:5,clientY:5});f.tick(1/60);
  assert.ok(f.camera.position.distanceTo(switched)<.1,'a view switch discards the old mouse coordinate');
});

test('walking first-person mouse look reaches the overhead sky without moving the eye and both views accept the same range',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enterAt({x:24,z:-35,yaw:.7});f.tick(.5);
  const eye=f.camera.position.clone();
  f.canvas.emit('pointerenter',{clientX:600,clientY:650});
  f.canvas.emit('pointermove',{clientX:600,clientY:0});f.tick(.5);
  assert.equal(f.experience.captureActivityPose().pitch,-1.5);
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995);
  assert.ok(f.camera.position.distanceTo(eye)<1e-8,'looking up rotates the eye without lifting the player');
  f.key('KeyV');f.tick(.5);assert.equal(f.experience.captureActivityPose().pitch,.25);
  f.canvas.emit('pointerenter',{clientX:600,clientY:700});f.canvas.emit('pointermove',{clientX:600,clientY:0});f.tick(.5);
  assert.equal(f.experience.captureActivityPose().pitch,-1.5,'third-person sky look accepts the same upward input');
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995);
  f.key('KeyV');f.tick(.5);assert.equal(f.experience.captureActivityPose().pitch,.04,'switching back still starts with the normal forward view');
});

test('default walking third-person mouse look reaches the sky and survives return without changing pause behavior',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enter('walk');f.tick(.5);
  assert.equal(f.experience.captureActivityPose().view,'third');
  const start={x:f.experience.state.x,z:f.experience.state.z};
  f.canvas.emit('pointerenter',{clientX:600,clientY:700});f.canvas.emit('pointermove',{clientX:600,clientY:0});f.tick(.8);
  const saved=f.experience.captureActivityPose(),orientation=f.camera.quaternion.clone(),eye=f.camera.position.clone();
  assert.equal(saved.view,'third');assert.equal(saved.pitch,-1.5);
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995);
  assert.ok(f.camera.position.y>=f.experience.state.y+1.04,'sky look does not put the eye near the player feet');
  assert.deepEqual({x:f.experience.state.x,z:f.experience.state.z},start);
  f.experience.setSuspended(true);
  f.canvas.emit('pointermove',{clientX:900,clientY:700});f.key('KeyC');f.key('KeyV');f.tick(1);
  assert.ok(f.camera.quaternion.equals(orientation));assert.deepEqual(f.camera.position,eye);
  f.experience.setSuspended(false);f.tick(.5);assert.ok(orientation.angleTo(f.camera.quaternion)<.001);
  f.experience.exit();assert.equal(f.experience.restoreActivityPose(saved),true);f.tick(.8);
  assert.equal(f.experience.captureActivityPose().view,'third');assert.equal(f.experience.captureActivityPose().pitch,-1.5);
  assert.ok(orientation.angleTo(f.camera.quaternion)<.001,'restored third-person sky view persists beyond its initial frame');
  const beforeSwitch=f.camera.quaternion.clone();f.key('KeyV');
  assert.ok(beforeSwitch.angleTo(f.camera.quaternion)<.001,'V keeps the current direction at transition start');
  let previous=f.camera.quaternion.clone();for(let i=0;i<30;i++){f.tick(1/60);assert.ok(previous.angleTo(f.camera.quaternion)<.14);previous=f.camera.quaternion.clone();}
  assert.ok(Math.abs(f.camera.getWorldDirection(new THREE.Vector3()).y+Math.sin(.04))<.001);
});

test('walking first-person pointer lock can look overhead while retaining its downward bound',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});enablePointerLock(f);f.experience.enterAt({x:24,z:-35,yaw:0});f.key('KeyL');
  assert.equal(f.doc.pointerLockElement,f.canvas);
  f.doc.emit('mousemove',{movementX:0,movementY:-1200});f.tick(.5);
  assert.equal(f.experience.captureActivityPose().pitch,-1.5);
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995);
  f.doc.emit('mousemove',{movementX:0,movementY:2000});f.tick(.5);
  assert.equal(f.experience.captureActivityPose().pitch,.85);
  assert.ok(Math.abs(f.camera.getWorldDirection(new THREE.Vector3()).y+Math.sin(.85))<.001);
});

test('an overhead walking pose survives activity return and recentres to the original forward pitch',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});
  f.experience.enterAt({x:24,z:-35,yaw:.7,pitch:-2});f.tick(.5);
  const saved=f.experience.captureActivityPose(),looking=f.camera.quaternion.clone();
  assert.equal(saved.pitch,-1.5,'enterAt accepts the full look-up range and safely clamps beyond it');
  f.key('KeyC');f.tick(.5);assert.equal(f.experience.captureActivityPose().pitch,.04);
  assert.ok(Math.abs(f.camera.getWorldDirection(new THREE.Vector3()).y+Math.sin(.04))<.001);
  f.experience.exit();assert.equal(f.experience.restoreActivityPose(saved),true);f.tick(1);
  assert.equal(f.experience.captureActivityPose().pitch,-1.5);
  assert.ok(looking.angleTo(f.camera.quaternion)<.001,'the restored overhead view remains after the saved camera frame');
  f.experience.enter('roadster');f.tick(.5);
  f.canvas.emit('pointerenter',{clientX:600,clientY:650});f.canvas.emit('pointermove',{clientX:600,clientY:0});f.tick(.5);
  assert.equal(f.experience.captureActivityPose().pitch,-.35,'mounting a vehicle restores its existing first-person range');
});

test('mouse look and Spider web hold coexist, but entering from a pressed HUD button cannot fire a web',t=>{
  const f=fixture(t);f.experience.enter('spider');
  f.canvas.emit('pointerenter',{clientX:200,clientY:200,buttons:1});f.canvas.emit('pointermove',{clientX:240,clientY:200,buttons:1});f.tick(.2);
  assert.equal(f.experience.state.swingCount,0);
  f.canvas.emit('pointerdown',{button:0,buttons:1,clientX:240,clientY:200});f.tick(.45);
  assert.ok(f.experience.state.anchor);const before=f.camera.quaternion.clone();
  f.canvas.emit('pointermove',{clientX:340,clientY:200,buttons:1});f.tick(.2);
  assert.ok(before.angleTo(f.camera.quaternion)>.05);assert.ok(f.experience.state.anchor);
  f.canvas.emit('pointerleave');f.tick(1/60);assert.equal(f.experience.state.anchor,null);
});

test('touch still requires a drag, ignores a second finger and blocked dialogs suppress mouse look',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('hoverboard');f.tick(1);const before=f.camera.position.clone();
  f.canvas.emit('pointermove',{pointerType:'touch',clientX:300,clientY:200});f.tick(.2);assert.deepEqual(f.camera.position,before);
  f.canvas.emit('pointerdown',{pointerType:'touch',pointerId:2,clientX:200,clientY:200});
  f.canvas.emit('pointerdown',{pointerType:'touch',pointerId:3,clientX:500,clientY:400});
  f.canvas.emit('pointerup',{pointerType:'touch',pointerId:3});
  f.canvas.emit('pointermove',{pointerType:'touch',pointerId:2,clientX:320,clientY:200});f.tick(.5);
  assert.ok(f.camera.position.distanceTo(before)>.5,'original touch remains the active drag');
  f.canvas.emit('pointerup',{pointerType:'touch',pointerId:2});f.tick(.7);
  const settled=f.camera.position.clone(),dialog=new Element('dialog');dialog.open=true;f.doc.body.append(dialog);
  f.canvas.emit('pointerenter',{clientX:100,clientY:100});f.canvas.emit('pointermove',{clientX:800,clientY:600});f.tick(.5);
  assert.deepEqual(f.camera.position,settled);dialog.close();
  f.canvas.emit('pointermove',{clientX:10,clientY:10});f.tick(1/60);assert.ok(f.camera.position.distanceTo(settled)<.05);
});

function enablePointerLock(f){
  f.doc.pointerLockElement=null;
  f.canvas.requestPointerLock=()=>{f.doc.pointerLockElement=f.canvas;f.doc.emit('pointerlockchange');};
  f.doc.exitPointerLock=()=>{f.doc.pointerLockElement=null;f.doc.emit('pointerlockchange');};
}
test('pointer lock turns from relative deltas beyond screen bounds, and Esc releases without exiting',t=>{
  const f=fixture(t,{buildings:false});enablePointerLock(f);f.experience.enter('roadster');f.tick(.7);f.key('KeyL');
  assert.equal(f.doc.pointerLockElement,f.canvas);assert.equal(f.el('player-hud').dataset.pointerLocked,'true');
  const before=f.camera.position.clone();
  f.doc.emit('mousemove',{movementX:220,movementY:0,clientX:640,clientY:360});f.tick(.5);
  assert.ok(f.camera.position.distanceTo(before)>1,'constant screen coordinates still rotate from relative input');
  const rotated=f.camera.position.clone();f.canvas.emit('pointermove',{clientX:3000,clientY:3000});f.tick(.1);
  assert.ok(f.camera.position.distanceTo(rotated)<.1,'PointerEvent must not double apply locked movement');
  f.key('KeyQ');f.tick(.3);f.key('Escape');assert.equal(f.doc.pointerLockElement,null);assert.equal(f.experience.active,true);
  f.tick(.4);assert.equal(f.experience.state.jetPower,0);assert.equal(f.el('pointer-lock-hint').hidden,true);
  const released=f.camera.position.clone();f.doc.emit('mousemove',{movementX:4000,movementY:3000});f.tick(1/60);assert.ok(f.camera.position.distanceTo(released)<.1);
});
test('pointer lock releases on focus loss and ordinary modes use gameplay FOV',t=>{
  const f=fixture(t,{buildings:false});enablePointerLock(f);f.experience.enter('walk');f.tick(.5);assert.equal(f.camera.fov,58);
  f.key('KeyL');f.key('KeyW');f.tick(.3);f.win.emit('blur');assert.equal(f.doc.pointerLockElement,null);f.tick(1);assert.ok(f.experience.state.speed<.01);
  f.key('KeyL');f.experience.exit();assert.equal(f.doc.pointerLockElement,null);assert.equal(f.camera.fov,44);
});

test('holding Escape after releasing pointer lock never exits on key repeat',t=>{
  const f=fixture(t,{buildings:false});enablePointerLock(f);f.experience.enter('walk');f.key('KeyL');f.key('Escape');
  const later=performance.now()+1000;t.mock.method(performance,'now',()=>later);
  f.win.emit('keydown',{code:'Escape',repeat:true});assert.equal(f.experience.active,true);
});

test('locked Spider firing works with MouseEvents alone and unlock releases the held web',t=>{
  const f=fixture(t);enablePointerLock(f);f.experience.enter('spider');f.key('KeyL');
  f.doc.emit('mousedown',{button:0});f.tick(.45);assert.ok(f.experience.state.anchor);
  f.doc.emit('mouseup',{button:0});f.tick(1/60);assert.equal(f.experience.state.anchor,null);
  f.el('player-reset').emit('click');f.doc.emit('mousedown',{button:0});f.tick(.45);assert.ok(f.experience.state.anchor);
  f.key('Escape');f.tick(1/60);assert.equal(f.experience.state.anchor,null);assert.equal(f.experience.active,true);
});

test('E and mouse hold start traversal; release/cancel cannot queue a stray new web',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyE');f.tick(.45);
  assert.ok(f.experience.state.swingCount>0);assert.ok(f.experience.state.anchor);
  f.key('KeyE','keyup');f.tick(1/60);assert.equal(f.experience.state.anchor,null);
  const count=f.experience.state.swingCount;f.tick(.35);assert.equal(f.experience.state.swingCount,count);
  f.el('player-reset').emit('click');f.canvas.emit('pointerdown',{button:0,buttons:1});f.tick(.45);assert.ok(f.experience.state.anchor);
  f.canvas.emit('pointerup');f.tick(1/60);assert.equal(f.experience.state.anchor,null);
  f.el('player-reset').emit('click');f.canvas.emit('pointerdown',{button:0,buttons:1});f.tick(.4);f.canvas.emit('pointercancel');f.tick(1/60);assert.equal(f.experience.state.anchor,null);
});

test('touch swing releases immediately and its following click does not reattach',t=>{
  const f=fixture(t);f.experience.enter('spider');const button=f.input('swing');
  button.emit('pointerdown',{pointerType:'touch'});f.tick(.45);assert.ok(f.experience.state.anchor);
  button.emit('pointerup',{pointerType:'touch'});button.emit('click',{detail:1});f.tick(.02);
  assert.equal(f.experience.state.anchor,null);const count=f.experience.state.swingCount;f.tick(.3);assert.equal(f.experience.state.swingCount,count);
});

test('overlapping keyboard and mouse holds do not manufacture a second casting press',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyE');f.tick(.3);
  assert.equal(f.experience.state.swingCount,1);
  f.canvas.emit('pointerdown',{button:0,buttons:1});f.tick(.1);
  f.canvas.emit('pointerup');f.tick(.1);
  assert.equal(f.experience.state.swingCount,1,'E is still held, so mouse release is not a full release');
  f.key('KeyE','keyup');f.tick(.2);
  assert.equal(f.experience.state.anchor,null);
  f.canvas.emit('pointerdown',{button:0,buttons:1});f.tick(.15);
  assert.equal(f.experience.state.swingCount,2,'a fresh mouse press after all controls release may cast again');
});

test('legacy automatic traversal controls cannot attach a web; E requires release before another attachment',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyR');
  f.key('KeyR','keydown',{repeat:true});f.el('player-auto-swing').emit('click');f.tick(.6);
  assert.equal(f.experience.state.swingCount,0);assert.equal(f.experience.state.anchor,null);
  f.key('KeyE');f.tick(.45);assert.equal(f.experience.state.swingCount,1);
  const anchor={...f.experience.state.anchor};f.tick(.8);
  if(f.experience.state.anchor)assert.deepEqual(f.experience.state.anchor,anchor);
  assert.equal(f.experience.state.swingCount,1);
  f.key('KeyE','keyup');f.tick(.02);assert.equal(f.experience.state.anchor,null);
  const count=f.experience.state.swingCount;f.tick(.3);assert.equal(f.experience.state.swingCount,count);
  f.key('KeyE');f.tick(.15);assert.equal(f.experience.state.swingCount,count+1);
});

test('browser shortcuts keep their default action and do not trigger traversal keys',t=>{
  const f=fixture(t);f.experience.enter('spider');
  for(const modifier of ['metaKey','ctrlKey','altKey']){
    const event=f.key('KeyR','keydown',{[modifier]:true});
    assert.equal(event.defaultPrevented,undefined);
    f.key('KeyE','keydown',{[modifier]:true});f.tick(.3);assert.equal(f.experience.state.swingCount,0);assert.equal(f.experience.state.anchor,null);
  }
});

test('Space produces one jump in spider mode; key repeat does not bounce after landing',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('spider');f.key('Space');f.tick(.2);
  assert.ok(f.experience.state.y>1);assert.equal(f.experience.state.braking,false);assert.equal(f.experience.state.anchor,null);
  for(let i=0;i<30;i++){f.key('Space','keydown',{repeat:true});f.tick(.1);}
  assert.equal(f.experience.state.grounded,true);assert.ok(Math.abs(f.experience.state.y-.14)<1e-8);
});

test('Space on a focused button retains native activation without jumping; canvas Space still jumps',t=>{
  const f=fixture(t);f.experience.enter('spider');
  const button=new Element('button'),label=new Element('span');button.append(label);
  for(const target of [button,label]){
    const event=f.key('Space','keydown',{target});f.tick(.1);
    assert.equal(event.defaultPrevented,undefined);assert.equal(f.experience.state.grounded,true);
    assert.equal(f.experience.state.zipCount,0);
  }
  f.key('Space');f.tick(.1);assert.equal(f.experience.state.grounded,false);
});

test('blur clears held actions, hidden documents stop stepping, and exit restores camera settings',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyE');f.tick(.4);assert.ok(f.experience.state.anchor);
  f.win.emit('blur');f.tick(.02);assert.equal(f.experience.state.anchor,null);
  f.doc.hidden=true;f.doc.emit('visibilitychange');const frozen=structuredClone(f.experience.state);f.tick(.5);assert.deepEqual(f.experience.state,frozen);
  f.doc.hidden=false;f.doc.emit('visibilitychange');f.tick(.05);assert.equal(f.experience.state.anchor,null);
  f.key('Escape');assert.equal(f.experience.active,false);assert.equal(f.controls.enabled,true);assert.equal(f.camera.fov,44);assert.equal(f.camera.near,.3);
  for(const key of['speed','vx','vz','verticalSpeed'])assert.equal(f.experience.state[key],0,key);
  assert.equal(f.experience.state.anchor,null);assert.equal(f.doc.body.classList.contains('spider-immersive'),false);
});

test('suit inspection pauses actual motion, then resumes without a stale held swing',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyE');f.tick(.4);
  f.el('web-suit').emit('click');const frozen=structuredClone(f.experience.state);f.tick(.5);assert.deepEqual(f.experience.state,frozen);
  assert.equal(f.camera.fov,45);
  f.el('web-suit').emit('click');f.tick(.05);
  assert.equal(f.experience.state.anchor,null);assert.notEqual(f.experience.state.z,frozen.z);
  assert.ok(f.camera.fov>45);
});

test('suit inspection frames the stationary body even when entered with lateral flight velocity',t=>{
  const f=fixture(t);f.experience.enter('spider');
  Object.assign(f.experience.state,{x:0,y:10,z:0,yaw:0,vx:25,vz:0,speed:25,verticalSpeed:0,grounded:false});
  f.el('web-suit').emit('click');f.tick(.1);f.camera.updateMatrixWorld(true);
  const chest=new THREE.Vector3(0,11.05,0).project(f.camera);
  assert.ok(Math.abs(chest.x)<.15,`inspector should frame the body, not old velocity lead: NDC x=${chest.x}`);
});

test('first person keeps the world web but hides the character and mode changes restore ordinary FOV',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyE');f.tick(.45);f.key('KeyV');f.tick(.02);
  assert.equal(f.scene.getObjectByName('spider-character').visible,false);
  assert.equal(f.scene.getObjectByName('spider-web-main').visible,true);
  assert.equal(f.camera.near,.06);
  f.key('KeyV');f.tick(.02);assert.equal(f.scene.getObjectByName('spider-character').visible,true);
  f.el('player-reset').emit('click');f.experience.enter('walk');assert.equal(f.camera.fov,58);assert.equal(f.experience.state.mode,'walk');
  assert.equal(f.scene.getObjectByName('player-spider').visible,false);
});

test('camera-relative lateral input remains straight while the character turns',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('spider');f.key('KeyD');f.tick(1);
  assert.ok(f.experience.state.x>2);assert.ok(Math.abs(f.experience.state.z)<.001);
  assert.ok(Math.abs(f.experience.state.yaw)>1);
  f.key('KeyD','keyup');f.key('KeyW');f.tick(.3);assert.ok(f.experience.state.z<-.1);
});

test('ordinary ground braking and helicopter Q/E controls remain active',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('scooter');f.key('KeyW');f.tick(1);assert.ok(f.experience.state.speed>1);
  f.key('Space');f.tick(.4);assert.equal(f.experience.state.speed,0);assert.equal(f.experience.state.grounded,true);
  f.key('KeyW','keyup');f.key('Space','keyup');f.experience.enter('helicopter');f.key('KeyQ');f.tick(2);
  assert.ok(f.experience.state.y>1);assert.equal(f.experience.state.grounded,false);
  f.key('KeyQ','keyup');f.key('KeyE');f.tick(5);assert.equal(f.experience.state.grounded,true);
  assert.equal(f.camera.fov,60);
});

test('F performs one geometry-backed air zip and key repeat never retriggers it',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyF');f.tick(.2);
  assert.equal(f.experience.state.zipCount,0);assert.equal(f.experience.state.flightEnabled,false);
  f.key('Space');f.tick(.35);f.key('Space','keyup');f.key('KeyF');f.tick(.08);
  assert.equal(f.experience.state.zipCount,1);assert.equal(f.experience.state.zipActive,true);
  assert.ok(f.experience.state.zipAnchors.length>0);
  for(let i=0;i<20;i++){f.key('KeyF','keydown',{repeat:true});f.tick(.1);}
  assert.equal(f.experience.state.zipCount,1);
  f.el('player-reset').emit('click');f.experience.enter('roadster');f.key('KeyF');assert.equal(f.experience.state.flightEnabled,true,'legacy F still enables Roadster flight');
});

test('Space is contextual: ground jump, free-air zip, and attached-web jump release',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('Space');f.tick(.35);f.key('Space','keyup');
  assert.equal(f.experience.state.zipCount,0);assert.equal(f.experience.state.grounded,false);
  f.key('Space');f.tick(.06);assert.equal(f.experience.state.zipCount,1);
  f.el('player-reset').emit('click');f.key('KeyE');f.tick(.45);assert.ok(f.experience.state.anchor);
  f.key('Space');f.tick(.03);assert.equal(f.experience.state.anchor,null);assert.equal(f.experience.state.zipCount,0);assert.ok(f.experience.state.verticalSpeed>0);
});

test('X and touch dive detach, clear on release/cancel, and cannot remain held across blur',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyE');f.tick(.45);f.key('KeyE','keyup');f.key('KeyX');f.tick(.2);
  assert.equal(f.experience.state.anchor,null);assert.equal(f.experience.state.diving,true);
  f.key('KeyX','keyup');f.tick(.02);assert.equal(f.experience.state.diving,false);
  Object.assign(f.experience.state,{y:10,grounded:false,verticalSpeed:-1});const button=f.input('dive');
  button.emit('pointerdown',{pointerType:'touch'});f.tick(.04);assert.equal(f.experience.state.diving,true);
  button.emit('pointercancel');button.emit('click',{detail:1});f.tick(.03);assert.equal(f.experience.state.diving,false);
  f.key('KeyX');f.tick(.03);f.win.emit('blur');f.tick(.03);assert.equal(f.experience.state.diving,false);
});

test('touch zip triggers once and its synthetic click cannot queue a second zip',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('Space');f.tick(.35);f.key('Space','keyup');const button=f.input('zip');
  button.emit('pointerdown',{pointerType:'touch'});f.tick(.05);assert.equal(f.experience.state.zipCount,1);
  button.emit('pointerup');button.emit('click',{detail:1});f.tick(1.5);assert.equal(f.experience.state.zipCount,1);
});

test('comfortable camera changes presentation without mutating movement and survives view switching',t=>{
  const f=fixture(t);f.experience.enter('spider');Object.assign(f.experience.state,{y:12,grounded:false,vz:-25,speed:25,verticalSpeed:0});
  const before=structuredClone(f.experience.state);f.el('web-comfort').emit('click');assert.deepEqual(f.experience.state,before);
  f.tick(2);assert.ok(Math.abs(f.camera.fov-58)<.01);
  f.key('KeyV');f.tick(.2);assert.ok(Math.abs(f.camera.fov-56)<.01);
  f.el('player-reset').emit('click');f.experience.enter('walk');assert.equal(f.camera.fov,58);
});

test('suit inspection suppresses transient zip and dive rendering while preserving paused movement',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('Space');f.tick(.35);f.key('Space','keyup');f.key('KeyF');f.tick(.05);
  assert.equal(f.experience.state.zipActive,true);f.el('web-suit').emit('click');const before=structuredClone(f.experience.state);f.tick(.4);
  assert.deepEqual(f.experience.state,before);assert.equal(f.camera.fov,45);
  f.el('player-reset').emit('click');assert.equal(f.experience.state.zipActive,false);assert.equal(f.experience.state.zipCount,0);assert.equal(f.experience.state.diving,false);
});


test('G commits once to a real point; contextual Space launches from the reached roof',t=>{
  const f=fixture(t);f.experience.enter('spider');f.key('KeyG');f.tick(.12);
  assert.equal(f.experience.state.pointCount,1);assert.equal(f.experience.state.pointPhase,'approach');
  assert.ok(f.experience.state.pointTarget?.perch);assert.equal(f.experience.state.zipCount,0);
  for(let i=0;i<360&&f.experience.state.pointPhase==='approach';i++){f.key('KeyG','keydown',{repeat:true});f.tick(1/60);}
  assert.equal(f.experience.state.pointPhase,'perch');assert.equal(f.experience.state.pointCount,1);
  f.key('Space');f.tick(.05);assert.equal(f.experience.state.pointLaunchCount,1);
  assert.ok(f.experience.state.verticalSpeed>0);assert.equal(f.experience.state.zipCount,0);
  assert.equal(f.experience.state.grounded,false);
});

test('point touch action fires once and a cleared launch buffer cannot fire after focus returns',t=>{
  const f=fixture(t);f.experience.enter('spider');const button=f.input('point');
  button.emit('pointerdown',{pointerType:'touch'});f.tick(.05);button.emit('pointerup');button.emit('click',{detail:1});
  assert.equal(f.experience.state.pointCount,1);
  for(let i=0;i<360&&!f.experience.state.pointLaunchReady&&f.experience.state.pointPhase==='approach';i++)f.tick(1/60);
  assert.equal(f.experience.state.pointPhase,'approach');assert.equal(f.experience.state.pointLaunchReady,true);
  f.key('Space');f.tick(.02);f.win.emit('blur');f.tick(1);
  assert.equal(f.experience.state.pointLaunchCount,0);assert.equal(f.experience.state.pointPhase,'perch');
  assert.equal(f.experience.state.pointCount,1);
});

test('T plus direction selects a trick; fresh E interrupts into traversal without a stuck key',t=>{
  const f=fixture(t);f.experience.enter('spider');Object.assign(f.experience.state,{y:12,grounded:false,verticalSpeed:1,airTime:1,vz:-12,speed:12});
  f.key('KeyT');f.key('KeyD');f.tick(.2);
  assert.equal(f.experience.state.trickActive,true);assert.equal(f.experience.state.trickType,'rightroll');
  f.key('KeyE');f.tick(.05);assert.equal(f.experience.state.trickActive,false);
  f.key('KeyE','keyup');f.key('KeyT','keyup');f.key('KeyD','keyup');f.tick(.25);
  assert.ok(f.experience.state.trickBlend<.05);assert.ok(Number.isFinite(f.camera.position.y));
});

test('touch trick cancellation does not restart on synthetic click; inspection pauses and reset clears new actions',t=>{
  const f=fixture(t);f.experience.enter('spider');Object.assign(f.experience.state,{y:15,grounded:false,verticalSpeed:0,airTime:1,vz:-10,speed:10});
  const button=f.input('trick');button.emit('pointerdown',{pointerType:'touch'});f.tick(.2);assert.equal(f.experience.state.trickActive,true);
  button.emit('pointercancel');button.emit('click',{detail:1});f.tick(.25);assert.equal(f.experience.state.trickActive,false);
  f.key('KeyT');f.tick(.1);f.el('web-suit').emit('click');const frozen=structuredClone(f.experience.state);f.tick(.3);
  assert.deepEqual(f.experience.state,frozen);
  f.el('player-reset').emit('click');assert.equal(f.experience.state.pointPhase,'idle');assert.equal(f.experience.state.trickCount,0);assert.equal(f.experience.state.trickActive,false);
});

test('Roadster primary button provides lift only while held, release and synthetic click cannot latch thrust',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');const button=f.el('player-takeoff');
  button.emit('pointerdown',{pointerType:'touch'});f.tick(3);
  const s=f.experience.state;assert.equal(s.flightEnabled,true);assert.ok(s.y>3);assert.ok(s.jetPower>.4);
  button.emit('pointerup');button.emit('click',{detail:1});f.tick(.35);
  assert.ok(s.jetPower<.05,'release stops the visible jet');const speed=s.verticalSpeed;
  f.tick(.6);assert.ok(s.verticalSpeed<speed-3,'gravity accelerates after release');
  assert.equal(f.doc.body.classList.contains('drive-immersive'),true);
  f.tick(6);assert.equal(s.grounded,true);assert.equal(s.verticalSpeed,0);
});

test('Roadster Q arms the system; falling can be caught by a new sustained jet without teleporting',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.key('KeyQ');f.tick(4);f.key('KeyQ','keyup');f.tick(1.4);
  const s=f.experience.state,falling=s.verticalSpeed,y=s.y;assert.ok(falling<0);assert.ok(y>2);
  f.key('KeyQ');f.tick(1/60);assert.ok(Math.abs(s.y-y)<.5,'thrust adds force rather than resetting altitude');
  f.tick(.4);assert.ok(s.verticalSpeed>falling,'jet first reduces descent');f.tick(1.3);assert.ok(s.verticalSpeed>0);
  f.key('KeyQ','keyup');f.el('player-land').emit('click');const before=s.y;
  assert.equal(s.flightEnabled,false);assert.equal(s.y,before,'cutoff never snaps to the ground');f.tick(6);assert.equal(s.grounded,true);
  f.key('Escape');assert.equal(f.doc.body.classList.contains('drive-immersive'),false);assert.equal(f.camera.fov,44);
});

test('Roadster Space mutes a held jet but cannot suspend gravity',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.key('KeyQ');f.tick(3);f.key('KeyW');f.tick(.5);
  const forward=f.experience.state.speed;assert.ok(forward>1);
  f.key('Space');f.tick(.4);const v=f.experience.state.verticalSpeed;
  f.tick(.6);assert.ok(f.experience.state.verticalSpeed<v-3,'Space continues a ballistic arc');assert.ok(f.experience.state.speed<forward);assert.ok(f.experience.state.speed<.05);assert.ok(f.experience.state.jetPower<.05);
  f.key('KeyQ','keyup');f.key('KeyW','keyup');f.key('Space','keyup');f.tick(5);assert.equal(f.experience.state.grounded,true);
});

test('Roadster touch cancellation, lost capture and focus loss release every jet input',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');const main=f.el('player-takeoff');
  for(const event of['pointercancel','lostpointercapture']){
    main.emit('pointerdown',{pointerType:'touch'});f.tick(1.2);main.emit(event);main.emit('click',{detail:1});f.tick(.4);assert.ok(f.experience.state.jetPower<.05,event);
  }
  f.input('up').emit('pointerdown',{pointerType:'touch'});f.tick(1);f.win.emit('blur');f.tick(.4);assert.ok(f.experience.state.jetPower<.05,'blur');
  f.input('up').emit('pointerup');f.input('up').emit('click',{detail:1});f.tick(.2);assert.ok(f.experience.state.jetPower<.05);
});

test('Roadster engine cutoff and focus loss cannot be undone by stale held-key repeat',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.key('KeyQ');f.tick(3);
  f.key('KeyF');f.key('KeyQ','keydown',{repeat:true});f.tick(.5);
  assert.equal(f.experience.state.flightEnabled,false);assert.equal(f.experience.state.jetPower,0);
  f.key('KeyQ','keyup');f.key('KeyQ');f.tick(.4);assert.ok(f.experience.state.jetPower>.4);
  f.win.emit('blur');f.key('KeyQ','keydown',{repeat:true});f.tick(.4);assert.equal(f.experience.state.jetPower,0);
});

test('Roadster keyboard-activated jet button is a hold, assistive click is only a short pulse',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');const b=f.el('player-takeoff');
  b.emit('keydown',{code:'Space'});f.tick(2);assert.ok(f.experience.state.jetPower>.4);
  b.emit('keyup',{code:'Space'});b.emit('click',{detail:0});f.tick(.4);assert.ok(f.experience.state.jetPower<.05,'keyboard release synthetic click does not re-ignite');
  b.emit('click',{detail:0});f.tick(.1);assert.ok(f.experience.state.jetPower>.1);f.tick(.6);assert.ok(f.experience.state.jetPower<.05,'accessible click cannot latch the motor');
});

test('Roadster view switches blend the camera during free fall and comfort fixes FOV',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.key('KeyQ');f.tick(4);f.key('KeyQ','keyup');
  const before=structuredClone(f.experience.state),camera=f.camera.position.clone();f.key('KeyV');assert.deepEqual(f.experience.state,before);
  assert.ok(f.camera.position.distanceTo(camera)<.01,'view switch must not teleport the camera');
  f.tick(.5);assert.ok(f.camera.position.distanceTo(camera)>3);
  f.el('drive-comfort').emit('click');f.key('KeyW');f.tick(1);assert.ok(f.experience.state.speed>1);assert.ok(Math.abs(f.camera.fov-58)<.02);
  f.key('KeyW','keyup');f.el('drive-immersive').emit('click');assert.equal(f.doc.body.classList.contains('drive-immersive'),false);
});

test('Roadster C eases around the car and view transition never exposes the cabin shell',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.el('player-side-view').emit('click');f.tick(2);
  const before=f.camera.position.clone();f.key('KeyC');f.tick(1/60);
  assert.ok(f.camera.position.distanceTo(before)<.5,'recenter must not jump in one frame');
  f.tick(3);assert.ok(Math.abs(f.camera.position.x-f.experience.state.x)<.1);
  f.key('KeyV');f.tick(.5);f.key('KeyV');
  assert.equal(f.scene.getObjectByName('player').visible,false,'shell hidden while camera leaves cockpit');
  f.tick(.5);assert.equal(f.scene.getObjectByName('player').visible,true);
});

test('hoverboard uses its own wide centered camera and immersive flight mode',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('hoverboard');f.tick(.2);
  assert.ok(Math.abs(f.camera.fov-62)<.02,'map FOV must not override flight framing');
  assert.ok(Math.abs(f.camera.position.x-f.experience.state.x)<.01,'initial camera is directly behind the rider');
  assert.equal(f.doc.body.classList.contains('drive-immersive'),true);
  const before=f.camera.position.clone();f.el('player-side-view').emit('click');
  assert.ok(f.camera.position.distanceTo(before)<.01,'side view must ease instead of teleporting');
  f.tick(.7);assert.ok(f.camera.position.distanceTo(before)>2);
  const side=f.camera.position.clone();f.key('KeyV');
  assert.ok(f.camera.position.distanceTo(side)<.01,'view switch preserves the camera pose at its start');
  f.tick(.5);f.key('KeyV');
  assert.equal(f.scene.getObjectByName('player').visible,false,'rider must not appear inside the camera during first-person exit');
  f.tick(.5);assert.equal(f.scene.getObjectByName('player').visible,true);f.key('KeyC');f.tick(3);
  assert.ok(Math.abs(f.camera.position.x-f.experience.state.x)<.05);
  f.key('Escape');assert.equal(f.camera.fov,44);assert.equal(f.doc.body.classList.contains('drive-immersive'),false);
});

test('hoverboard horizontal orbit preserves pitch and repeated side-view has no snap',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('hoverboard');f.tick(.2);
  const beforeY=f.camera.position.y;
  f.canvas.emit('pointerdown',{clientX:300,clientY:200});
  f.canvas.emit('pointermove',{clientX:400,clientY:200});f.tick(.5);
  assert.ok(Math.abs(f.camera.position.y-beforeY)<.01,'horizontal orbit must not change the authored camera pitch');
  f.canvas.emit('pointermove',{clientX:400,clientY:290});f.tick(.5);f.canvas.emit('pointerup');
  const dragged=f.camera.position.clone();f.el('player-side-view').emit('click');
  assert.ok(f.camera.position.distanceTo(dragged)<.01,'side preset must not snap through the default pitch');
  f.tick(.25);const moving=f.camera.position.clone();f.el('player-side-view').emit('click');
  assert.ok(f.camera.position.distanceTo(moving)<.01,'repeated preset remains continuous');
});

test('hoverboard one-click takeoff captures 20 m and landing actually reaches ground',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('hoverboard');f.el('player-takeoff').emit('click');f.tick(10);
  const s=f.experience.state;
  assert.ok(Math.abs(s.y-20.14)<.025,`altitude ${s.y}`);assert.ok(Math.abs(s.verticalSpeed)<.05);
  f.el('player-cruise').emit('click');f.tick(3);assert.ok(s.speed>23.9);
  f.el('player-land').emit('click');f.tick(3);assert.ok(Math.abs(s.speed)<.01);
  const x=s.x,z=s.z;f.tick(10);
  assert.equal(s.grounded,true,'landing must not be blocked by Space/hover priority');
  assert.ok(Math.hypot(s.x-x,s.z-z)<.01);assert.equal(s.verticalSpeed,0);
});

test('hoverboard automatic landing below a viaduct selects the lower floor through the registered control',t=>{
  const roadSurfaces=[{bridge:true,surfaceY:11.14,polygon:[{x:-20,z:-20},{x:20,z:-20},{x:20,z:20},{x:-20,z:20}]}];
  const f=fixture(t,{buildings:false,roadSurfaces});f.experience.enter('hoverboard');
  f.key('KeyQ');f.tick(1.2);f.key('KeyQ','keyup');f.tick(1);
  const s=f.experience.state,hoverY=s.y;
  assert.ok(hoverY>1&&hoverY<8,'manual takeoff remains below the bridge');
  assert.equal(s.grounded,false);
  f.el('player-land').emit('click');f.tick(.8);
  assert.ok(s.y<hoverY-.5,'landing starts descending rather than targeting the deck overhead');
  f.tick(8);
  assert.equal(s.grounded,true);
  assert.ok(Math.abs(s.y-.14)<.001,'automatic landing returns to the same lower floor');
  assert.equal(s.verticalSpeed,0);
});

test('hoverboard boost is available from keyboard and touch; Space cancels automatic controls',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('hoverboard');f.el('player-takeoff').emit('click');f.tick(10);
  const s=f.experience.state;f.key('KeyW');f.tick(3);assert.ok(Math.abs(s.speed-24)<.01);
  f.input('fast').emit('pointerdown',{pointerType:'touch'});f.tick(1.3);assert.ok(Math.abs(s.speed-36)<.01);
  f.input('fast').emit('pointerup',{pointerType:'touch'});f.input('fast').emit('click',{detail:1});f.tick(1.5);assert.ok(Math.abs(s.speed-24)<.01);
  f.key('ShiftLeft');f.tick(1.3);assert.ok(Math.abs(s.speed-36)<.01);
  f.key('KeyQ');f.tick(.2);f.key('Space');f.tick(2.5);
  const altitude=s.y;assert.ok(Math.abs(s.speed)<.01);f.tick(1);assert.ok(Math.abs(s.y-altitude)<.01);
  f.key('KeyQ','keyup');f.key('KeyW','keyup');f.key('Space','keyup');f.key('ShiftLeft','keyup');
  f.el('player-takeoff').emit('click');f.tick(.3);f.key('Space');f.tick(1);f.key('Space','keyup');
  const hold=s.y;f.tick(2);assert.ok(Math.abs(s.y-hold)<.02);
});

test('continuous touch release cannot create a second acceleration pulse; accessible click still works',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('hoverboard');f.el('player-takeoff').emit('click');f.tick(10);
  const button=f.input('forward');button.emit('pointerdown',{pointerType:'touch'});button.emit('pointerup',{pointerType:'touch'});button.emit('click',{detail:1});f.tick(.3);
  assert.equal(f.experience.state.speed,0,'post-release synthetic click must not create motion');
  button.emit('click',{detail:0});f.tick(.2);assert.ok(f.experience.state.speed>.5,'keyboard/assistive click provides a nudge');
  f.tick(2);assert.ok(Math.abs(f.experience.state.speed)<.01);
});

for(const mode of ['walk','roadster','spider'])test(`${mode}: administrative pause freezes the pose and camera and discards held controls`,t=>{
  const f=fixture(t,{buildings:mode==='spider',legacyControls:false});
  enablePointerLock(f);f.experience.enter(mode);
  if(mode==='roadster'){f.key('KeyQ');f.tick(3);}
  else if(mode==='spider'){f.key('KeyE');f.tick(.45);assert.ok(f.experience.state.anchor);}
  else {f.key('KeyW');f.tick(.6);}
  f.key('KeyL');assert.equal(f.doc.pointerLockElement,f.canvas);
  const before=structuredClone(f.experience.state),camera=f.camera.position.clone(),orientation=f.camera.quaternion.clone();
  f.experience.setSuspended(true);
  assert.equal(f.experience.suspended,true);assert.equal(f.experience.active,true);
  assert.equal(f.doc.pointerLockElement,null,'an administrative pause releases the cursor');
  assert.deepEqual(f.experience.state,before,'pausing preserves full physical state, including velocity and active traversal');
  for(const code of ['KeyW','KeyQ','KeyE','KeyR','KeyV','KeyF','Space','Escape','KeyL'])f.key(code);
  f.canvas.emit('pointerenter',{clientX:200,clientY:200});
  f.canvas.emit('pointerdown',{clientX:200,clientY:200,buttons:1});
  f.canvas.emit('pointermove',{clientX:600,clientY:400,buttons:1});
  f.canvas.emit('wheel',{deltaY:500});
  f.doc.querySelectorAll('[data-player-mode]').find(b=>b.dataset.playerMode!==mode).emit('click');
  assert.equal(f.experience.enterAt({x:120,z:-120}).ok,false,'direct entry APIs cannot teleport a paused player');
  f.tick(2);
  assert.deepEqual(f.experience.state,before);assert.deepEqual(f.camera.position,camera);assert.ok(f.camera.quaternion.equals(orientation));
  assert.equal(f.experience.active,true);assert.equal(f.doc.pointerLockElement,null);
  f.experience.setSuspended(false);
  assert.equal(f.experience.suspended,false);assert.equal(f.doc.pointerLockElement,null,'resume never relocks without a gesture');
  // A browser continues key repeat when the physical key stayed down during
  // the pause. Those repeats must not resurrect an old command.
  for(const code of ['KeyW','KeyQ','KeyE','KeyR'])f.key(code,'keydown',{repeat:true});
  f.tick(mode==='spider'?.2:.7);
  if(mode==='walk')assert.ok(Math.abs(f.experience.state.speed)<.01,'old forward input decays to a stop');
  if(mode==='roadster')assert.ok(f.experience.state.jetPower<.01,'old thrust is released, gravity resumes');
  if(mode==='spider'){
    assert.equal(f.experience.state.anchor,null,'old automatic swing is no longer held');
    assert.equal(f.experience.state.swingCount,before.swingCount,'resume does not automatically attach a new web');
  }
  f.key('KeyW','keyup');f.key('KeyW');f.tick(.5);
  assert.ok(Math.hypot(f.experience.state.x-before.x,f.experience.state.z-before.z)>.1,'a fresh gesture moves normally after resume');
});

test('administrative pause blocks optional host buttons and touch inputs without resetting the player',t=>{
  const f=fixture(t,{buildings:false});f.experience.enter('roadster');f.key('KeyQ');f.tick(3);
  f.experience.setSuspended(true);const before=structuredClone(f.experience.state),camera=f.camera.position.clone();
  for(const id of ['player-reset','player-land','player-side-view','player-cruise','player-flight-toggle','exit-player'])f.el(id).emit('click');
  f.el('player-takeoff').emit('pointerdown',{pointerType:'touch'});
  f.input('up').emit('pointerdown',{pointerType:'touch'});
  f.input('forward').emit('click',{detail:0});
  f.doc.querySelectorAll('[data-player-camera]')[1].emit('click');f.tick(.5);
  assert.deepEqual(f.experience.state,before);assert.deepEqual(f.camera.position,camera);assert.equal(f.experience.active,true);
  f.experience.setSuspended(false);f.tick(.7);
  assert.ok(f.experience.state.jetPower<.01);assert.ok(Math.abs(f.experience.state.speed)<.01);
});

test('administrative pause received before mode selection blocks entry until resumed',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.setSuspended(true);
  const before=structuredClone(f.experience.state);
  f.doc.querySelectorAll('[data-player-mode]').find(b=>b.dataset.playerMode==='walk').emit('click');
  assert.equal(f.experience.enterAt({x:10,z:-20}).ok,false);f.tick(.4);
  assert.equal(f.experience.active,false);assert.deepEqual(f.experience.state,before);
  f.experience.setSuspended(false);f.experience.enter('walk');assert.equal(f.experience.active,true);
});

function inventory(mode,pose={}){
  const item={id:`scene-${mode}`,mode,label:mode,x:1,y:.14,z:0,yaw:0,...pose,taken:false};
  return {items:[item],nearest(s){return !item.taken&&Math.hypot(s.x-item.x,s.z-item.z)<5?item:null;},take(i){if(i.taken)return{ok:false};i.taken=true;return{ok:true};},release(i,p){Object.assign(i,p,{taken:false});return{ok:true};},restore(i){i.taken=false;return{ok:true};}};
}
test('scene F mounts the nearby car, does not arm jets or repeat, and dismounts to walking',t=>{
  const source=inventory('roadster'),f=fixture(t,{buildings:false,transportSources:[source],legacyControls:false});
  f.experience.enter('walk');f.tick(.2);assert.equal(f.el('transport-interact').hidden,false);
  f.key('KeyF');assert.equal(f.experience.state.mode,'roadster');assert.equal(source.items[0].taken,true);assert.equal(f.experience.state.flightEnabled,false);
  f.key('KeyF','keydown',{repeat:true});assert.equal(f.experience.state.mode,'roadster');
  f.key('KeyF','keyup');f.key('KeyF');assert.equal(f.experience.state.mode,'walk');assert.equal(source.items[0].taken,false);
  assert.match(f.el('player-help').textContent,/F 使用/);
});
test('scene interactions respect admin pause and preserve manual spider controls in air',t=>{
  const source=inventory('spider'),f=fixture(t,{transportSources:[source],legacyControls:false});f.experience.enter('walk');
  f.experience.setSuspended(true);f.key('KeyF');assert.equal(source.items[0].taken,false);f.experience.setSuspended(false);
  f.key('KeyF');assert.equal(f.experience.state.mode,'spider');f.key('KeyF','keyup');
  f.key('Space');f.tick(.35);f.key('Space','keyup');assert.equal(f.experience.state.grounded,false);
  f.key('KeyF');f.tick(.08);assert.equal(f.experience.state.mode,'spider');assert.equal(source.items[0].taken,true);
  assert.ok(f.experience.state.zipCount>0);assert.match(f.el('player-help').textContent,/松手后重按换点/);
});
test('refresh return places the saved helicopter at its own location and claims one world copy',t=>{
  const source=inventory('helicopter',{x:40,z:20}),f=fixture(t,{transportSources:[source],legacyControls:false});f.experience.enter('walk');
  const saved={mode:'helicopter',transport:{id:'scene-helicopter',mode:'helicopter'},view:'third',state:{x:40,y:.14,z:20,yaw:0,grounded:true,speed:0}};
  assert.equal(f.experience.restoreActivityPose(saved),true);assert.equal(source.items[0].taken,true);assert.equal(f.experience.state.x,40);
  assert.equal(f.experience.restoreActivityPose(saved),true);assert.equal(source.items.length,1);f.key('KeyF');assert.equal(f.experience.state.mode,'walk');assert.equal(source.items[0].taken,false);
});
test('failed refreshed vehicle placement returns its inventory item instead of leaving it hidden',t=>{
  const source=inventory('helicopter',{x:12,z:0}),f=fixture(t,{transportSources:[source],legacyControls:false});f.experience.enter('walk');
  assert.equal(f.experience.restoreActivityPose({mode:'helicopter',transport:{id:'scene-helicopter',mode:'helicopter'},view:'third',state:{x:12,y:.14,z:0,yaw:0,grounded:true}}),false);
  assert.equal(source.items[0].taken,false);assert.equal(f.experience.state.mode,'walk');
});

test('activity restore cannot detach inventory identity from the restored vehicle mode',t=>{
  const source=inventory('roadster'),f=fixture(t,{buildings:false,transportSources:[source],legacyControls:false});
  f.experience.enter('walk');f.key('KeyF');
  const saved=f.experience.captureActivityPose(),before=structuredClone(f.experience.state);
  for(const snapshot of [{...saved,mode:'helicopter'},{...saved,transport:null},{...saved,mode:'walk',transport:null}]){
    assert.equal(f.experience.restoreActivityPose(snapshot),false);
    assert.deepEqual(f.experience.state,before);assert.equal(source.items[0].taken,true);
  }
  f.key('KeyF','keyup');f.key('KeyF');assert.equal(source.items[0].taken,false);
});

test('airborne activity return keeps valid momentum and clears old held thrust',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false});f.experience.enter('roadster');
  f.key('KeyQ');f.tick(2);const saved=f.experience.captureActivityPose();
  assert.equal(saved.state.grounded,false);assert.ok(saved.state.verticalSpeed>1);
  f.key('KeyQ','keyup');f.tick(1.5);assert.ok(f.experience.state.verticalSpeed<saved.state.verticalSpeed);
  assert.equal(f.experience.restoreActivityPose(saved),true);
  assert.equal(f.experience.state.y,saved.state.y);assert.equal(f.experience.state.verticalSpeed,saved.state.verticalSpeed);
  f.tick(1/120);
  assert.ok(f.experience.state.verticalSpeed<saved.state.verticalSpeed,'released thrust resumes gravity');
  assert.ok(f.experience.state.verticalSpeed>saved.state.verticalSpeed-.3,'integrator uses the saved velocity');
});

function touch(element,type,pointerId,values={}){return element.emit(type,{pointerType:'touch',pointerId,...values});}
function sceneTouchDown(f,pointerId,values={}){
  const captured=touch(f.doc,'pointerdown',pointerId,{target:f.canvas,...values});
  if(!captured.propagationStopped)touch(f.canvas,'pointerdown',pointerId,values);
  return captured;
}
function pushJoystick(f,pointerId=10){
  const joystick=f.el('mobile-joystick'),rect=joystick.getBoundingClientRect(),clientX=rect.left+rect.width/2,clientY=rect.top+rect.height/2;
  sceneTouchDown(f,pointerId,{clientX,clientY});
  touch(f.win,'pointermove',pointerId,{clientX,clientY:clientY-rect.height*.45});
  return {clientX,clientY};
}

test('floating left touches move the walker from fresh origins without rotating its camera',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');f.tick(1);
  for(const [clientX,clientY]of [[280,260],[110,180]]){
    const start={...f.experience.state},view=horizontalView(f);
    assert.equal(sceneTouchDown(f,10,{clientX,clientY}).propagationStopped,true);
    f.tick(.2);assert.equal(f.experience.state.x,start.x);assert.equal(f.experience.state.z,start.z);
    touch(f.win,'pointermove',10,{clientX,clientY:clientY-65});f.tick(.7);
    assert.ok(Math.hypot(f.experience.state.x-start.x,f.experience.state.z-start.z)>1);
    assert.ok(horizontalView(f).dot(view)>.999,'left-drag movement must not also turn the camera');
    touch(f.win,'pointerup',10);f.tick(1);assert.ok(Math.abs(f.experience.state.speed)<.01);
  }
});

test('touch look has 1.5 times mouse sensitivity while ordinary mouse gain stays unchanged',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');f.tick(1);
  const original=f.experience.captureActivityPose();
  f.canvas.emit('pointerenter',{clientX:600,clientY:160});f.canvas.emit('pointermove',{clientX:640,clientY:180});
  const mouse=f.experience.captureActivityPose();
  assert.ok(Math.abs(mouse.yawOffset-original.yawOffset+.128)<1e-9);assert.ok(Math.abs(mouse.pitch-original.pitch-.05)<1e-9);
  f.experience.restoreActivityPose(original);
  assert.equal(sceneTouchDown(f,20,{clientX:600,clientY:160}).propagationStopped,true);
  touch(f.canvas,'pointermove',20,{clientX:640,clientY:180});
  const finger=f.experience.captureActivityPose();
  assert.ok(Math.abs((finger.yawOffset-original.yawOffset)/(mouse.yawOffset-original.yawOffset)-1.5)<1e-9);
  assert.ok(Math.abs((finger.pitch-original.pitch)/(mouse.pitch-original.pitch)-1.5)<1e-9);
  touch(f.canvas,'pointerup',20);
});

test('right-side touch drags can look overhead in first person and mobile recenter restores forward view',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enterAt({x:24,z:-35,yaw:0});f.tick(.5);
  const start={x:f.experience.state.x,z:f.experience.state.z};
  for(const pointerId of [21,22]){
    assert.equal(sceneTouchDown(f,pointerId,{clientX:600,clientY:360}).propagationStopped,true);
    touch(f.canvas,'pointermove',pointerId,{clientX:600,clientY:0});
    touch(f.canvas,'pointerup',pointerId);f.tick(.5);
  }
  assert.equal(f.experience.captureActivityPose().pitch,-1.5);
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995);
  f.tick(2);assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995,'releasing the drag keeps the sky in view');
  assert.deepEqual({x:f.experience.state.x,z:f.experience.state.z},start,'right-side look never starts the movement joystick');
  f.mobileAction('recenter').emit('click',{detail:0});f.tick(.5);
  assert.equal(f.experience.captureActivityPose().pitch,.04);
  assert.ok(Math.abs(f.camera.getWorldDirection(new THREE.Vector3()).y+Math.sin(.04))<.001);
});

test('default walking third-person touch look reaches the sky and mobile recenter is gradual',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');f.tick(.5);
  assert.equal(f.experience.captureActivityPose().view,'third');
  const start={x:f.experience.state.x,z:f.experience.state.z};
  for(const pointerId of [21,22]){
    assert.equal(sceneTouchDown(f,pointerId,{clientX:600,clientY:360}).propagationStopped,true);
    touch(f.canvas,'pointermove',pointerId,{clientX:600,clientY:0});touch(f.canvas,'pointerup',pointerId);f.tick(.6);
  }
  assert.equal(f.experience.captureActivityPose().pitch,-1.5);
  assert.ok(f.camera.getWorldDirection(new THREE.Vector3()).y>.995);
  assert.deepEqual({x:f.experience.state.x,z:f.experience.state.z},start);
  let previous=f.camera.quaternion.clone();f.mobileAction('recenter').emit('click',{detail:0});
  for(let i=0;i<60;i++){f.tick(1/60);assert.ok(previous.angleTo(f.camera.quaternion)<.11,'mobile recenter cannot cut straight down from the sky');previous=f.camera.quaternion.clone();}
  assert.equal(f.experience.captureActivityPose().view,'third');assert.equal(f.experience.captureActivityPose().pitch,.25);
  assert.ok(Math.abs(f.camera.getWorldDirection(new THREE.Vector3()).y+Math.sin(.25))<.001);
});

test('touch sideways walking uses the same camera basis as keys and does not orbit after release',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');
  touch(f.canvas,'pointerdown',20,{clientX:600,clientY:150});
  touch(f.canvas,'pointermove',20,{clientX:900,clientY:150});
  touch(f.canvas,'pointerup',20);f.tick(2);
  const forward=horizontalView(f),right=new THREE.Vector3(-forward.z,0,forward.x),start={...f.experience.state};
  const joystick=f.el('mobile-joystick'),rect=joystick.getBoundingClientRect(),clientX=rect.left+rect.width/2,clientY=rect.top+rect.height/2;
  touch(joystick,'pointerdown',10,{clientX,clientY});
  touch(f.win,'pointermove',10,{clientX:clientX+rect.width*.45,clientY});f.tick(2);
  touch(f.win,'pointerup',10);f.tick(2);
  const moved=new THREE.Vector3(f.experience.state.x-start.x,0,f.experience.state.z-start.z);
  assert.ok(moved.length()>5);assert.ok(moved.normalize().dot(right)>.999);
  assert.ok(horizontalView(f).dot(forward)>.999,'release must not redirect the view toward the walking avatar');
});

test('shipped mobile joystick moves the real walker while an independent finger turns the camera',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true,joystickRect:{left:32,top:170,width:132,height:132}});
  f.experience.enter('walk');f.tick(.6);
  assert.equal(f.el('mobile-controls').hidden,false);
  const start={x:f.experience.state.x,z:f.experience.state.z};
  pushJoystick(f,10);f.tick(1);
  assert.ok(Math.hypot(f.experience.state.x-start.x,f.experience.state.z-start.z)>1,'the actual joystick drives production walking physics');
  touch(f.canvas,'pointerdown',20,{clientX:600,clientY:150});
  const looking=f.camera.quaternion.clone();
  touch(f.canvas,'pointermove',20,{clientX:700,clientY:170});f.tick(.3);
  assert.ok(looking.angleTo(f.camera.quaternion)>.05,'the camera finger turns independently of the joystick');
  touch(f.win,'pointerup',30);f.tick(.2);
  assert.ok(f.experience.state.speed>1,'releasing an unrelated finger must not stop movement');
  touch(f.win,'pointerup',10);f.tick(1);
  assert.ok(Math.abs(f.experience.state.speed)<.01,'releasing the joystick decelerates to rest');
  const stillLooking=f.camera.quaternion.clone();
  touch(f.canvas,'pointermove',20,{clientX:800,clientY:170});f.tick(.3);
  assert.ok(stillLooking.angleTo(f.camera.quaternion)>.05,'releasing the joystick must not release the camera finger');
  touch(f.canvas,'pointerup',20);
});

for(const boundary of ['pause','rotation'])test(`mobile ${boundary} clears the joystick and old camera contact without resetting the player`,t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');f.tick(.5);
  const joystickPoint=pushJoystick(f,10);f.tick(.5);
  touch(f.canvas,'pointerdown',20,{clientX:600,clientY:150});
  const before=structuredClone(f.experience.state),orientation=f.camera.quaternion.clone();
  if(boundary==='pause'){
    f.experience.setSuspended(true);assert.equal(f.el('mobile-controls').hidden,true);
    touch(f.win,'pointermove',10,{...joystickPoint,clientY:0});touch(f.canvas,'pointermove',20,{clientX:800,clientY:250});
    f.tick(.5);assert.deepEqual(f.experience.state,before);assert.ok(f.camera.quaternion.equals(orientation));
    f.experience.setSuspended(false);assert.equal(f.el('mobile-controls').hidden,false);
  }else{
    f.win.innerWidth=390;f.win.innerHeight=844;f.landscapeMedia.matches=false;f.win.emit('orientationchange');
    assert.deepEqual(f.experience.state,before,'rotation clears gestures without teleporting or zeroing physical velocity');
  }
  assert.equal(f.el('mobile-stick').style.transform,'translate(0px, 0px)');
  assert.equal(f.el('mobile-joystick').captures.size,0);
  f.tick(1);assert.ok(Math.abs(f.experience.state.speed)<.01);
  const rest={x:f.experience.state.x,z:f.experience.state.z},camera=f.camera.quaternion.clone();
  touch(f.win,'pointermove',10,{...joystickPoint,clientY:0});touch(f.canvas,'pointermove',20,{clientX:1200,clientY:600});f.tick(.3);
  assert.equal(f.experience.state.x,rest.x);assert.equal(f.experience.state.z,rest.z);
  assert.ok(camera.angleTo(f.camera.quaternion)<.01,'stale camera contacts cannot jump the viewpoint after the boundary');
  pushJoystick(f,11);f.tick(.4);assert.ok(f.experience.state.speed>1,'a fresh gesture works after the boundary');
});

test('mobile rotation discards a queued Spider jump before the first physics tick',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('spider');
  const jump=f.mobileAction('jump'),height=f.experience.state.y;
  touch(jump,'pointerdown',30);f.win.emit('orientationchange');f.tick(.3);
  assert.equal(f.experience.state.grounded,true);assert.equal(f.experience.state.y,height,'an interrupted gesture must not jump after rotation');
  touch(jump,'pointerdown',31);f.tick(.2);
  assert.equal(f.experience.state.grounded,false);assert.ok(f.experience.state.y>height+.5,'a new deliberate jump still works');
});

test('the shipped mobile swing button keeps one anchor until release and never reattaches from its synthetic click',t=>{
  const f=fixture(t,{legacyControls:false,coarsePointer:true});f.experience.enter('spider');
  const swing=f.mobileHold('swing');assert.equal(swing.hidden,false);
  touch(swing,'pointerdown',30);f.tick(.45);
  const anchor=structuredClone(f.experience.state.anchor);assert.ok(anchor);assert.equal(f.experience.state.swingCount,1);
  f.tick(.6);assert.deepEqual(f.experience.state.anchor,anchor,'a held gesture cannot switch to another anchor');
  touch(f.win,'pointerup',30);swing.emit('click',{detail:1});f.tick(1/60);
  assert.equal(f.experience.state.anchor,null);f.tick(.3);assert.equal(f.experience.state.swingCount,1);
  touch(swing,'pointerdown',31);f.tick(.15);
  assert.equal(f.experience.state.swingCount,2,'only a fresh press casts again');
  touch(swing,'pointercancel',31);swing.emit('click',{detail:1});f.tick(.3);
  assert.equal(f.experience.state.anchor,null);assert.equal(f.experience.state.swingCount,2);
});

test('the shipped mobile Tesla lift button rises while held, falls after release and cannot latch from a click',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('roadster');
  const up=f.mobileHold('up');assert.equal(up.hidden,false);
  touch(up,'pointerdown',30);f.tick(4);
  const state=f.experience.state;assert.equal(state.flightEnabled,true);assert.ok(state.y>3);assert.ok(state.verticalSpeed>0);assert.ok(state.jetPower>.4);
  touch(up,'pointerup',30);up.emit('click',{detail:1});f.tick(.35);
  assert.ok(state.jetPower<.05);const speed=state.verticalSpeed;
  f.tick(.6);assert.ok(state.verticalSpeed<speed-3,'gravity resumes through the real Roadster physics');
  f.tick(.6);assert.ok(state.verticalSpeed<0);const fallingHeight=state.y;
  f.tick(.2);assert.ok(state.y<fallingHeight,'the car physically falls after releasing thrust');
  f.tick(6);assert.equal(state.grounded,true);assert.equal(state.verticalSpeed,0);
});

test('the shipped mobile nearby-vehicle action mounts and dismounts once per gesture',t=>{
  const source=inventory('roadster'),f=fixture(t,{buildings:false,transportSources:[source],legacyControls:false,coarsePointer:true});
  f.experience.enter('walk');f.tick(.2);const interact=f.mobileAction('interact');
  assert.equal(interact.hidden,false);assert.match(f.el('mobile-interact-label').textContent,/roadster/);
  touch(interact,'pointerdown',30);touch(f.win,'pointerup',30);interact.emit('click',{detail:1});
  assert.equal(f.experience.state.mode,'roadster');assert.equal(source.items[0].taken,true);assert.equal(f.experience.state.flightEnabled,false);
  assert.equal(interact.hidden,false);assert.match(f.el('mobile-interact-label').textContent,/下车/);
  touch(interact,'pointerdown',31);touch(f.win,'pointerup',31);interact.emit('click',{detail:1});
  assert.equal(f.experience.state.mode,'walk');assert.equal(source.items[0].taken,false);
  assert.equal(source.items.length,1,'dismount returns the leased scene vehicle instead of creating another one');
});

test('the shipped first-level mobile G action reaches a roof and its jump button launches from that point',t=>{
  const f=fixture(t,{legacyControls:false,coarsePointer:true});f.experience.enter('spider');f.tick(.2);
  const point=f.mobileAction('point');assert.equal(point.hidden,false);assert.equal(f.el('mobile-extra-actions').hidden,true);
  assert.match(f.el('player-help').textContent,/定点弹射/);assert.equal(f.el('web-point-label').textContent,'定点');
  touch(point,'pointerdown',31);f.tick(.12);touch(point,'pointerup',31);point.emit('click',{detail:1});
  assert.equal(f.experience.state.pointCount,1);assert.equal(f.experience.state.pointPhase,'approach');
  for(let i=0;i<360&&f.experience.state.pointPhase==='approach';i++)f.tick(1/60);
  assert.equal(f.experience.state.pointPhase,'perch');
  touch(f.mobileAction('jump'),'pointerdown',32);f.tick(.05);
  assert.equal(f.experience.state.pointLaunchCount,1);assert.equal(f.experience.state.pointCount,1);
});


test('real camera touch turns are normalized by the CSS viewport and inverted preference survives reload',t=>{
  const entries=new Map([['dongjiu.controls.v1',JSON.stringify({sensitivity:1.25,invertY:true,joystickScale:1.1})]]);
  const storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true,storage});f.experience.enter('walk');f.tick(.2);
  const original=f.experience.captureActivityPose(),results=[];
  for(const [width,height]of [[844,390],[667,375],[1024,768]]){
    f.canvas.rect={left:0,top:0,width,height};f.experience.restoreActivityPose(original);
    touch(f.canvas,'pointerdown',20,{clientX:width*.7,clientY:height*.4});
    touch(f.canvas,'pointermove',20,{clientX:width*.8,clientY:height*.45});
    const pose=f.experience.captureActivityPose();results.push([pose.yawOffset-original.yawOffset,pose.pitch-original.pitch]);
    touch(f.canvas,'pointerup',20);
  }
  for(const [yaw,pitch]of results){assert.ok(Math.abs(yaw-results[0][0])<1e-9);assert.ok(Math.abs(pitch-results[0][1])<1e-9);assert.ok(pitch<0,'inverted Y reverses only vertical look');}
});

test('reload restoration waits for Spider preparation without dropping its position or inventory',async t=>{
  let resolve;const spiderPreparation=new Promise(r=>resolve=r),source=inventory('spider');
  const f=fixture(t,{buildings:false,legacyControls:false,transportSources:[source],spiderPreparation});f.experience.enter('walk');
  const saved={mode:'spider',transport:{id:source.items[0].id,mode:'spider'},view:'third',state:{x:40,y:3,z:-20,yaw:.5,grounded:false}};
  assert.equal(f.experience.restoreActivityPose(saved),false);
  const restoring=f.experience.restorePreparedActivityPose(saved);assert.equal(source.items[0].taken,false);
  resolve(true);assert.equal(await restoring,true);assert.equal(f.experience.state.mode,'spider');assert.equal(f.experience.state.x,40);assert.equal(source.items[0].taken,true);
});

test('walking is ready while Spider prepares, deliberate early pickup is deduplicated and uses the same nearby suit',async t=>{
  let resolve;const spiderPreparation=new Promise(r=>resolve=r),source=inventory('spider');
  const f=fixture(t,{buildings:false,legacyControls:false,transportSources:[source],spiderPreparation});
  f.experience.enter('walk');assert.equal(f.experience.state.mode,'walk');assert.equal(f.scene.getObjectByName('spider-character'),undefined);
  f.key('KeyF');f.key('KeyF','keyup');f.key('KeyF');f.key('KeyF','keyup');
  assert.equal(f.experience.state.mode,'walk');assert.equal(source.items[0].taken,false);assert.equal(f.notices.filter(s=>s.includes('战衣正在准备')).length,1);
  resolve(true);await new Promise(r=>setImmediate(r));
  assert.equal(f.experience.state.mode,'spider');assert.equal(source.items[0].taken,true);assert.ok(f.scene.getObjectByName('spider-character'));
});

for(const boundary of ['pause','blur','rotation','leave','dispose'])test(`pending Spider pickup is cancelled by ${boundary} and cannot switch the player later`,async t=>{
  let resolve;const spiderPreparation=new Promise(r=>resolve=r),source=inventory('spider');
  const f=fixture(t,{buildings:false,legacyControls:false,transportSources:[source],spiderPreparation});
  f.experience.enter('walk');f.key('KeyF');f.key('KeyF','keyup');
  if(boundary==='pause'){f.experience.setSuspended(true);f.experience.setSuspended(false);}
  if(boundary==='blur')f.win.emit('blur');
  if(boundary==='rotation')f.win.emit('orientationchange');
  if(boundary==='leave'){f.key('KeyW');f.tick(2);f.key('KeyW','keyup');}
  if(boundary==='dispose')f.experience.dispose();
  resolve(true);await new Promise(r=>setImmediate(r));
  assert.equal(f.experience.state.mode,'walk');assert.equal(source.items[0].taken,false);assert.equal(f.scene.getObjectByName('spider-character'),undefined);
});

test('opening control preferences releases both mobile gestures and closing never resumes their old contacts',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');
  pushJoystick(f,10);touch(f.canvas,'pointerdown',20,{clientX:600,clientY:160});assert.equal(f.canvas.captures.has(20),true);
  const settings=f.el('player-hud').children.find(e=>e.attrs['aria-label']==='调整操作偏好');assert.ok(settings);settings.emit('click');
  const dialog=f.doc.body.children.find(e=>e.tagName==='DIALOG');assert.equal(dialog.open,true);assert.equal(f.canvas.captures.has(20),false);
  assert.equal(f.el('mobile-joystick').captures.size,0);f.tick(.5);const pose=f.experience.captureActivityPose();
  dialog.close();dialog.emit('close');touch(f.win,'pointermove',10,{clientY:0});touch(f.canvas,'pointermove',20,{clientX:800,clientY:50});f.tick(.5);
  assert.equal(f.experience.state.x,pose.state.x);assert.equal(f.experience.state.z,pose.state.z);assert.equal(f.experience.captureActivityPose().yawOffset,pose.yawOffset);
});


test('control settings persist changes and continue or Escape restores canvas focus without relocking',t=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const f=fixture(t,{buildings:false,legacyControls:false,storage});f.experience.enter('walk');let focused=0;f.canvas.focus=()=>{focused++;};
  const button=f.el('player-hud').children.find(e=>e.attrs['aria-label']==='调整操作偏好');button.emit('click');
  const dialog=f.doc.body.children.find(e=>e.tagName==='DIALOG'),sensitivity=dialog.querySelector('[aria-label="视角灵敏度"]'),invert=dialog.querySelector('[aria-label="反转上下视角"]');
  sensitivity.value='1.4';sensitivity.emit('input');invert.checked=true;invert.emit('change');
  assert.equal(JSON.parse(entries.get('dongjiu.controls.v1')).sensitivity,1.4);assert.equal(JSON.parse(entries.get('dongjiu.controls.v1')).invertY,true);
  const done=dialog.children.at(-1).children.find(e=>e.textContent==='继续探索');done.emit('click');assert.equal(dialog.open,false);assert.equal(focused,1);assert.notEqual(f.doc.pointerLockElement,f.canvas);
  dialog.emit('close');assert.equal(focused,1,'native close arriving after the button must not repeat restoration');
  button.emit('click');dialog.emit('cancel');dialog.close();dialog.emit('close');assert.equal(focused,2);assert.notEqual(f.doc.pointerLockElement,f.canvas);
});

test('look survives missing pointer capture, releases outside the canvas and accepts the next finger',t=>{
  const f=fixture(t,{buildings:false,legacyControls:false,coarsePointer:true});f.experience.enter('walk');
  f.canvas.setPointerCapture=()=>{throw Error('WebView capture not available');};
  const initial=f.experience.captureActivityPose();
  sceneTouchDown(f,51,{clientX:600,clientY:160});touch(f.win,'pointermove',51,{clientX:720,clientY:180});f.tick(.2);
  const first=f.experience.captureActivityPose();assert.notEqual(first.yawOffset,initial.yawOffset);
  touch(f.win,'pointerup',51);touch(f.win,'pointermove',51,{clientX:900,clientY:180});assert.equal(f.experience.captureActivityPose().yawOffset,first.yawOffset);
  sceneTouchDown(f,52,{clientX:610,clientY:160});touch(f.win,'pointermove',52,{clientX:710,clientY:160});f.tick(.2);assert.notEqual(f.experience.captureActivityPose().yawOffset,first.yawOffset);
  touch(f.win,'pointercancel',52);
  // Embedding hosts may send directly to canvas without the document adapter.
  touch(f.canvas,'pointerdown',53,{clientX:600,clientY:160});touch(f.canvas,'pointermove',53,{clientX:680,clientY:160});touch(f.win,'pointerup',53);
  const third=f.experience.captureActivityPose();touch(f.canvas,'pointerdown',54,{clientX:620,clientY:160});touch(f.canvas,'pointermove',54,{clientX:690,clientY:160});assert.notEqual(f.experience.captureActivityPose().yawOffset,third.yawOffset);
});
