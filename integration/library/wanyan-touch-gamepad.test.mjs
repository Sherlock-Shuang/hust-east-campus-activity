import test from 'node:test';
import assert from 'node:assert/strict';
import {createTouchGamepad,encodeGamepadStick} from './wanyan-touch-gamepad.mjs';
function fixture(nativePads=[null,null,null,null]){
 let time=0,raf;const listeners=new Map(),events=[],timers=new Map();let timer=0;
 const native=()=>nativePads;
 const win={navigator:{getGamepads:native},performance:{now:()=>time},Event:class{constructor(type){this.type=type;}},
  requestAnimationFrame(fn){raf=fn;return 1;},cancelAnimationFrame(){raf=null;},
  addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},
  removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(f=>f!==fn));},
  dispatchEvent(event){events.push(event);for(const fn of listeners.get(event.type)||[])fn(event);},
  setTimeout(fn){timers.set(++timer,fn);return timer;},clearTimeout(id){timers.delete(id);},
 };
 return {win,events,native,setTime:t=>time=t,tick(t){time=t;raf?.();},timers(){for(const fn of [...timers.values()])fn();timers.clear();},setNative(pads){nativePads=pads;}};
}
const physical=()=>({id:'Xbox physical',index:0,connected:true,mapping:'standard',timestamp:1,axes:[.5,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))});

test('virtual pad uses the first empty slot and same frame is stable across all engine reads',()=>{
 const f=fixture(),pad=createTouchGamepad({window:f.win});
 assert.equal(pad.index,0);assert.equal(f.win.navigator.getGamepads().filter(Boolean).length,1);
 pad.look(4,-2);f.tick(16);
 const first=f.win.navigator.getGamepads()[0];assert(first.axes[2]>0);assert(first.axes[3]<0);
 f.setTime(21);assert.equal(f.win.navigator.getGamepads()[0],first,'late lock bridge read cannot consume a different look sample');
 f.setTime(25);assert.equal(f.win.navigator.getGamepads()[0],first);
 f.tick(32);assert.deepEqual(f.win.navigator.getGamepads()[0].axes,[0,0,0,0],'stationary finger has no continuing camera movement');
 pad.look(2,2);pad.endLook();f.tick(48);assert.deepEqual(f.win.navigator.getGamepads()[0].axes,[0,0,0,0]);
 pad.destroy();assert.equal(f.win.navigator.getGamepads,f.native);
});
test('floating movement, look, attack, and cancellation retain independent channels',()=>{
 const f=fixture(),pad=createTouchGamepad({window:f.win});
 pad.move({x:.4,y:-.6});pad.look(5,0);pad.press('attack');f.tick(16);
 let sample=f.win.navigator.getGamepads()[0];assert(sample.axes[0]>0&&sample.axes[1]<0&&sample.axes[2]>0);assert(sample.buttons[2].pressed);
 pad.endLook();sample=f.win.navigator.getGamepads()[0];assert(sample.axes[0]>0);assert.equal(sample.axes[2],0);assert(sample.buttons[2].pressed);
 pad.release('attack');f.tick(64);assert(f.win.navigator.getGamepads()[0].buttons[2].pressed,'brief taps last long enough for the engine to sample');
 f.tick(144);assert.equal(f.win.navigator.getGamepads()[0].buttons[2].pressed,false);
 pad.press('heavy');pad.reset();sample=f.win.navigator.getGamepads()[0];assert.deepEqual(sample.axes,[0,0,0,0]);assert(sample.buttons.every(b=>!b.pressed));pad.destroy();
});
test('physical standard pad remains the same idle object; touch overlays without losing native axes or buttons',()=>{
 const device=physical();device.buttons[4]={pressed:true,touched:true,value:1};
 const f=fixture([device,null,null,null]),pad=createTouchGamepad({window:f.win});
 assert.equal(f.win.navigator.getGamepads()[0],device);assert.equal(f.win.navigator.getGamepads().filter(Boolean).length,1);
 pad.press('attack');pad.look(3,0);f.tick(16);const merged=f.win.navigator.getGamepads()[0];
 assert.equal(merged.id,device.id);assert.equal(merged.index,0);assert.equal(merged.axes[0],.5);assert(merged.axes[2]>0);assert(merged.buttons[2].pressed&&merged.buttons[4].pressed);
 assert.equal(device.buttons[2].pressed,false);assert.equal(device.axes[2],0,'the browser-owned real device is never mutated');
 pad.reset();assert.equal(f.win.navigator.getGamepads()[0],device);pad.destroy();
});
test('native hotplug keeps native events and retires/reconnects only the virtual slot',()=>{
 const f=fixture();let discovered=false;const pad=createTouchGamepad({window:f.win,isDiscovered:()=>discovered});pad.announce();assert.equal(f.events.at(-1).type,'gamepadconnected');
 const real=physical();f.setNative([real,null,null,null]);f.win.dispatchEvent({type:'gamepadconnected',gamepad:real});
 assert.equal(f.events.at(-1).type,'gamepaddisconnected');assert.equal(f.events.at(-1).gamepad.id,'Campus touch controls (STANDARD GAMEPAD)');assert.equal(f.win.navigator.getGamepads()[0],real);
 discovered=true;f.setNative([null,null,null,null]);f.win.dispatchEvent({type:'gamepaddisconnected',gamepad:real});f.timers();
 assert.equal(f.events.at(-1).type,'gamepadconnected');assert.equal(f.win.navigator.getGamepads()[0].index,0);assert.deepEqual(f.win.navigator.getGamepads()[0].axes,[0,0,0,0]);pad.destroy();
});
test('Unity startup enumeration is not followed by duplicate connection registration; desktop and nonstandard pads remain intact',()=>{
 const f=fixture(),pad=createTouchGamepad({window:f.win,isDiscovered:()=>true});pad.announce();pad.press('attack');assert.equal(f.events.length,0);pad.destroy();
 const desktop=fixture(),off=createTouchGamepad({window:desktop.win,enabled:false});assert.equal(desktop.win.navigator.getGamepads,desktop.native);assert.equal(off.available,false);off.destroy();
 const device={...physical(),mapping:''},native=fixture([device]),unsupported=createTouchGamepad({window:native.win});assert.equal(unsupported.available,false);assert.equal(native.win.navigator.getGamepads()[0],device);assert.equal(unsupported.press('attack'),false);unsupported.destroy();
});
test('deadzone compensation preserves small intentional motion and bounds diagonals',()=>{
 assert.deepEqual(encodeGamepadStick(0,0),[0,0]);const [x,y]=encodeGamepadStick(.01,0);assert.equal(y,0);assert(Math.abs((x-.2)/.8-.01)<1e-10);
 assert(Math.abs(Math.hypot(...encodeGamepadStick(5,-5))-1)<1e-10);
});
