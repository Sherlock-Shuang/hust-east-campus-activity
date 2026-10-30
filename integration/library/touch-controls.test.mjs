import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {WANYAN_PUBLIC_TEXT} from './wanyan-public-text.mjs';
import {touchVector,movementVector,directionKeys,createTouchKeys,createTouchControls} from './touch-controls.mjs';

test('movement and shooting sticks retain diagonal directions and clamp travel',()=>{
 assert.deepEqual(touchVector(0,0),{x:0,y:0});
 const v=touchVector(100,100);assert(Math.abs(Math.hypot(v.x,v.y)-1)<1e-10);
 assert.deepEqual([...directionKeys({x:-.8,y:-.8})],['KeyA','KeyW']);
 assert.deepEqual([...directionKeys({x:.8,y:0},true)],['ArrowRight']);
 assert.equal(directionKeys({x:.1,y:-.1}).size,0);
 assert.deepEqual(movementVector({x:.06,y:-.05}),{x:0,y:0});
 assert.deepEqual(movementVector({x:.56,y:0}),{x:.5,y:0});
});
test('independent touch owners release only their own held keys, including cancel and pause',()=>{
 const events=[];const target={focus(){},dispatchEvent:e=>events.push([e.type,e.code,e.bookrealmGamepadInput])};
 class Keyboard{constructor(type,init){this.type=type;Object.assign(this,init);}}
 const keys=createTouchKeys(()=>target,Keyboard);
 keys.set('move',['KeyW']);keys.set('attack',['KeyW','KeyJ']);keys.release('move');
 assert.deepEqual(events,[['keydown','KeyW',true],['keydown','KeyJ',true]]);
 keys.release();assert.deepEqual(events.slice(-2),[['keyup','KeyW',true],['keyup','KeyJ',true]]);
 keys.release();assert.equal(events.length,4);
});

class Node {
 constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.style={};this.handlers=new Map();this.hidden=false;const names=new Set();this.classList={add:n=>names.add(n),remove:n=>names.delete(n),toggle(n,v){if(v)names.add(n);else names.delete(n);},contains:n=>names.has(n)};}
 set innerHTML(value){this.html=value;if(value.includes('work-touch-toolbar')){this.nav=new Node('nav');this.move=new Node();this.move.knob=new Node();this.move.pad=new Node();this.actions=new Node();}if(value.includes('<i>'))this.knob=new Node();}
 append(child){this.children.push(child);child.parent=this;}
 querySelector(selector){if(selector==='nav')return this.nav;if(selector==='.work-touch-move')return this.move;if(selector==='.work-touch-actions')return this.actions;if(selector==='.work-touch-shoot')return this.children.find(c=>c.className?.includes('work-touch-shoot'));if(selector==='i')return this.knob;if(selector==='.work-touch-pad')return this.pad;return null;}
 setAttribute(name,value){this[name]=value;}
 addEventListener(type,fn){const list=this.handlers.get(type)||[];list.push(fn);this.handlers.set(type,list);}
 removeEventListener(type,fn){this.handlers.set(type,(this.handlers.get(type)||[]).filter(f=>f!==fn));}
 emit(type,properties={}){const event={type,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...properties};for(const fn of this.handlers.get(type)||[])fn(event);}
 getBoundingClientRect(){return {left:0,top:0,width:120,height:120};}
 setPointerCapture(){} releasePointerCapture(){} focus(){} remove(){this.removed=true;}
}
function fixture(){
 const win=new Node(),doc=new Node();let frame;
 Object.assign(win,{innerWidth:390,navigator:{maxTouchPoints:1},matchMedia:()=>({matches:true}),requestAnimationFrame(fn){frame=fn;return 1;},cancelAnimationFrame(){},setTimeout(fn){fn();}});
 Object.assign(doc,{documentElement:new Node(),body:new Node(),createElement:tag=>new Node(tag),hidden:false});
 return {win,doc,tick:()=>frame()};
}
test('multi-touch move and shoot cancel independently and do not retain movement after pause',()=>{
 const {win,doc,tick}=fixture();const moves=[],shots=[];let active=true;
 const touch=createTouchControls({kind:'isaac',window:win,document:doc,canPlay:()=>active,onMove:v=>moves.push(v),onShoot:v=>shots.push(v)});
 const move=touch.root.querySelector('.work-touch-move'),shoot=touch.root.querySelector('.work-touch-shoot');
 move.emit('pointerdown',{pointerId:1,clientX:80,clientY:140});move.emit('pointermove',{pointerId:1,clientX:80,clientY:80});shoot.emit('pointerdown',{pointerId:2,clientX:120,clientY:60});
 assert.equal(moves.at(-1).y,-1);assert.equal(shots.at(-1).x,1);
 touch.root.emit('pointercancel',{pointerId:1});assert.deepEqual(moves.at(-1),{x:0,y:0});assert.equal(shots.at(-1).x,1);
 active=false;tick();assert.deepEqual(shots.at(-1),{x:0,y:0});assert.equal(touch.root.hidden,true);
 active=true;tick();assert.equal(touch.root.hidden,false);assert.deepEqual(moves.at(-1),{x:0,y:0});touch.destroy();
});
test('pointer capture loss, resize and visibility release held actions; hidden phase cannot press',()=>{
 const {win,doc,tick}=fixture();const events=[];let phase='combat';
 const touch=createTouchControls({kind:'wanyan',window:win,document:doc,phase:()=>phase,onPress:id=>events.push(['down',id]),onRelease:id=>events.push(['up',id]),actions:[{id:'attack',label:'攻击',phases:['combat']}]});
 const button=touch.root.querySelector('.work-touch-actions').children[0];
 button.emit('pointerdown',{pointerId:4});touch.root.emit('lostpointercapture',{pointerId:4});assert.deepEqual(events,[['down','attack'],['up','attack']]);
 button.emit('pointerdown',{pointerId:5});win.emit('resize');assert.deepEqual(events.at(-1),['up','attack']);
 button.emit('pointerdown',{pointerId:6});phase='paused';tick();assert.equal(button.hidden,true);assert.deepEqual(events.at(-1),['up','attack']);
 const length=events.length;button.emit('pointerdown',{pointerId:7});assert.equal(events.length,length);
 doc.hidden=true;doc.emit('visibilitychange');tick();assert.equal(touch.root.hidden,true);touch.destroy();
});
test('narrow-layout mouse drag shares touch look while native canvas menus keep their input',()=>{
 const {win,doc}=fixture(),canvas=new Node('canvas'),looks=[];let combat=false;
 const touch=createTouchControls({kind:'wanyan',canvas,window:win,document:doc,canLook:()=>combat,onLook:(x,y)=>looks.push([x,y])});
 canvas.emit('pointerdown',{pointerId:1,pointerType:'mouse',button:0,clientX:10,clientY:20});canvas.emit('pointermove',{pointerId:1,clientX:40,clientY:40});assert.deepEqual(looks,[]);
 combat=true;canvas.emit('pointerdown',{pointerId:2,pointerType:'mouse',button:0,clientX:10,clientY:20});canvas.emit('pointermove',{pointerId:2,clientX:40,clientY:40});assert.deepEqual(looks,[[30,20]]);
 canvas.emit('pointercancel',{pointerId:2});canvas.emit('pointermove',{pointerId:2,clientX:60,clientY:40});assert.equal(looks.length,1);touch.destroy();
});
test('phase transitions hide inactive movement and release every held input before resume',()=>{
 const {win,doc,tick}=fixture(),moves=[];let phase='intro',resets=0;
 const touch=createTouchControls({kind:'wanyan',window:win,document:doc,phase:()=>phase,movePhases:['combat'],onMove:v=>moves.push(v),onReset:()=>resets++});
 const move=touch.root.querySelector('.work-touch-move');assert.equal(move.hidden,true);
 move.emit('pointerdown',{pointerId:1,clientX:120,clientY:60});assert.equal(moves.length,0);
 phase='combat';tick();assert.equal(move.hidden,false);move.emit('pointerdown',{pointerId:2,clientX:120,clientY:60});move.emit('pointermove',{pointerId:2,clientX:180,clientY:60});assert.equal(moves.at(-1).x,1);
 phase='paused';tick();assert.equal(move.hidden,true);assert.deepEqual(moves.at(-1),{x:0,y:0});assert.equal(resets,2);
 phase='combat';tick();move.emit('pointermove',{pointerId:2,clientX:0,clientY:60});assert.deepEqual(moves.at(-1),{x:0,y:0});assert.equal(resets,3);touch.destroy();
});
test('floating movement follows each new landing point; camera and combat pointers stay independent',()=>{
 const {win,doc}=fixture(),canvas=new Node('canvas'),moves=[],looks=[],actions=[];let ends=0;
 const touch=createTouchControls({kind:'wanyan',canvas,window:win,document:doc,onMove:v=>moves.push(v),onLook:(x,y)=>looks.push([x,y]),onLookEnd:()=>ends++,onPress:id=>actions.push(['down',id]),onRelease:id=>actions.push(['up',id]),actions:[{id:'attack',label:'普攻'}]});
 const move=touch.root.querySelector('.work-touch-move'),button=touch.root.querySelector('.work-touch-actions').children[0];
 move.emit('pointerdown',{pointerId:1,clientX:210,clientY:185});assert.deepEqual(moves.at(-1),{x:0,y:0});assert.equal(move.pad.style.left,'210px');assert.equal(move.pad.style.top,'185px');
 move.emit('pointermove',{pointerId:1,clientX:212,clientY:186});assert.deepEqual(moves.at(-1),{x:0,y:0},'small thumb jitter stays neutral while the visual knob follows the finger');
 move.emit('pointermove',{pointerId:1,clientX:250,clientY:185});assert(moves.at(-1).x>.9);
 canvas.emit('pointerdown',{pointerId:2,pointerType:'touch',clientX:500,clientY:150});canvas.emit('pointermove',{pointerId:2,clientX:525,clientY:130});
 button.emit('pointerdown',{pointerId:3});assert.deepEqual(looks,[[25,-20]]);assert.deepEqual(actions,[['down','attack']]);
 touch.root.emit('pointerup',{pointerId:3});assert(moves.at(-1).x>.9);assert.equal(ends,0);
 touch.root.emit('pointercancel',{pointerId:1});assert.equal(move.pad.style.left,'');assert.deepEqual(moves.at(-1),{x:0,y:0});
 move.emit('pointerdown',{pointerId:4,clientX:55,clientY:320});assert.equal(move.pad.style.left,'55px');assert.equal(move.pad.style.top,'320px');assert.deepEqual(moves.at(-1),{x:0,y:0});
 win.emit('orientationchange');assert.equal(ends,1);canvas.emit('pointermove',{pointerId:2,clientX:550,clientY:120});assert.equal(looks.length,1);assert.deepEqual(moves.at(-1),{x:0,y:0});touch.destroy();
});
test('generated copies use the verified activity Unity build, retain SWF bytes, and only rename sanctuary text in its data',async()=>{
 const base=new URL('../../work-assets/',import.meta.url);
 const library=await readFile(new URL('library/hub/main.mjs',base),'utf8');
 assert(library.includes('campusTouchMove.x'));assert(library.includes("if(id==='book'){updateCamera();inspectBook();if(hovered)openBook(hovered)"));assert(library.includes("if(id==='dodge')startDodge(player,input(),yaw)"));
 const isaac=await readFile(new URL('library/games/isaac/index.html',base),'utf8');assert(isaac.includes('attachIsaacTouch(player, requestMenu)'));assert(isaac.includes('viewport-fit=cover'));
 const unity=await readFile(new URL('wanyan/index.html',base),'utf8');assert(unity.includes('mobile?1.1:2'));assert(unity.includes('wanyan-touch.mjs'));assert(!unity.includes('user-scalable=no'));
 const manifest=JSON.parse(await readFile(new URL('library-manifest.json',base),'utf8'));
 const baseline=JSON.parse(await readFile(new URL('./fixtures/runtime-baseline.json',import.meta.url),'utf8'));
 const unityRuntime=manifest.unityRuntime||baseline.unityRuntime;
 assert.equal(baseline.schemaVersion,1);
 for(const name of ['library/isaac-source/剧情扩展/Isaac-High-Damage.swf']){
  const output=manifest.entries.find(x=>x.file===name),source=Array.isArray(manifest.sourceChecks)?manifest.sourceChecks.find(x=>x.sha256===output.sha256):baseline.sourceFiles.find(x=>x.file===name&&x.sha256===output.sha256);assert(source,`${name} must be copied byte-for-byte`);
  assert.equal(createHash('sha256').update(await readFile(new URL(name,base))).digest('hex'),source.sha256,'actual SWF bytes must match independent baseline');
 }
 assert.equal(unityRuntime.bridgeVersion,1);
 for(const ext of ['wasm','framework.js','loader.js']){
  const output=manifest.entries.find(x=>x.file===`wanyan/Build/wanyan.${ext}`),input=unityRuntime.files.find(x=>x.file===`Build/wanyan.${ext}`);
  assert.equal(output.sha256,input.sha256,`${ext} must match the verified activity build`);
  assert.equal(createHash('sha256').update(await readFile(new URL(output.file,base))).digest('hex'),input.sha256,`${ext} actual bytes must match the verified activity build`);
 }
 const framework=await readFile(new URL('wanyan/Build/wanyan.framework.js',base),'utf8');assert(framework.includes('bookrealmNativeSkill'));
 const data=await readFile(new URL('wanyan/Build/wanyan.data',base));
 for(const [before,after]of WANYAN_PUBLIC_TEXT){const value=Buffer.from(after),at=data.indexOf(value);assert(at>=0);assert.equal(data.indexOf(value,at+value.length),-1);Buffer.from(before).copy(data,at);}
 const original=unityRuntime.files.find(x=>x.file==='Build/wanyan.data');
 assert.equal(createHash('sha256').update(data).digest('hex'),original.sha256,'reversing only four names must reproduce the exact activity Unity output');
});
