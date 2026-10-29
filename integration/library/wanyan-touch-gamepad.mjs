/** Activity-only input device: use Unity's existing unlocked Gamepad camera path.
 * Never claim pointer lock, patch the Unity binary, or write game state.
 */
export const TOUCH_BUTTONS = Object.freeze({confirm:0,restart:0,dodge:1,attack:2,heavy:3,heal:4,skill:5,menu:9,recenter:10,lock:11});
export const TOUCH_GAMEPAD_ID='Campus touch controls (STANDARD GAMEPAD)';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
// Undo the original game's radial .20 deadzone so a slow drag still moves smoothly.
export function encodeGamepadStick(x,y){
  const length=Math.hypot(x,y);if(length<1e-5)return [0,0];
  const size=.2+.8*Math.min(length,1);return [x/length*size,y/length*size];
}
export function createTouchGamepad({window:win=window,enabled=true,now=()=>win.performance.now(),isDiscovered=()=>false}={}){
  const nav=win.navigator,original=nav.getGamepads,descriptor=Object.getOwnPropertyDescriptor(nav,'getGamepads');
  const readNative=()=>{try{return Array.from(original?.call(nav)||[]);}catch{return [];}};
  const realPads=pads=>pads.filter(p=>p&&p.connected!==false),initialPads=readNative();
  let index=initialPads.findIndex(p=>!p||p.connected===false);if(index<0)index=initialPads.length;
  let installed=false,disposed=false,announced=false,lastFrame=now(),frame,connectionTimer;
  let virtualPresent=realPads(initialPads).length===0,nativeIndex=-1;
  let pendingX=0,pendingY=0,look=[0,0],move=[0,0],snapshot;
  const down=new Set(),until=new Map(),pressedAt=new Map();
  const id=TOUCH_GAMEPAD_ID;
  function updateSnapshot(time=now()){
    const buttons=Array.from({length:17},(_,i)=>{const pressed=down.has(i)||(until.get(i)||0)>time;return {pressed,touched:pressed,value:pressed?1:0};});
    snapshot={id,index,connected:true,mapping:'standard',timestamp:time,axes:[...move,...look],buttons};
  }
  function tick(){
    if(disposed)return;
    const time=now(),dt=clamp((time-lastFrame)/1000,1/120,.05);lastFrame=time;
    // 0.46 degrees per CSS pixel, bounded by the native camera's angular speed.
    // Gamepad screen Y is down; Unity inverts it when constructing rightStick.
    look=encodeGamepadStick(pendingX*.46/(150*dt),pendingY*.46/(105*dt));pendingX=pendingY=0;
    updateSnapshot(time);frame=win.requestAnimationFrame(tick);
  }
  updateSnapshot();
  function wrapped(){
    const pads=readNative();
    if(disposed||!enabled)return pads;
    const real=realPads(pads);
    if(real.length){
      // Keep the real controller, its identity and disconnect events. Touch overlays
      // the same standard device only while touched; an idle facade is transparent.
      const physical=real.find(p=>p.index===nativeIndex&&p.mapping==='standard')||real.find(p=>p.mapping==='standard');
      if(!physical)return pads;
      nativeIndex=physical.index;
      const hasInput=snapshot.axes.some(v=>Math.abs(v)>0)||snapshot.buttons.some(b=>b.pressed);
      if(!hasInput)return pads;
      const axes=Array.from(physical.axes),buttons=Array.from(physical.buttons);
      for(let i=0;i<4;i++)if(snapshot.axes[i])axes[i]=snapshot.axes[i];
      for(let i=0;i<snapshot.buttons.length;i++)if(snapshot.buttons[i].pressed)buttons[i]=snapshot.buttons[i];
      pads[physical.index]={id:physical.id,index:physical.index,connected:physical.connected,mapping:physical.mapping,timestamp:Math.max(physical.timestamp,snapshot.timestamp),axes,buttons};
      return pads;
    }
    while(pads.length<=index)pads.push(null);
    // Multiple reads by Emscripten and the lock bridge share one immutable frame.
    pads[index]=snapshot;return pads;
  }
  function emitConnection(type,pad){const event=new win.Event(type);Object.defineProperty(event,'gamepad',{value:pad});event.campusTouchDevice=true;win.dispatchEvent(event);}
  function announce(force=false){
    if(!installed||announced||!enabled||realPads(readNative()).length)return;
    // Unity also enumerates at startup. Do not register the same device twice.
    if(force||!isDiscovered())emitConnection('gamepadconnected',snapshot);
    announced=true;
  }
  function reset(){down.clear();until.clear();pressedAt.clear();move=[0,0];pendingX=pendingY=0;look=[0,0];lastFrame=now();updateSnapshot();}
  function syncPhysical(event){
    if(event.campusTouchDevice)return;
    const next=realPads(readNative()).length===0;
    if(next===virtualPresent)return;
    const wasDiscovered=announced||isDiscovered();reset();virtualPresent=next;
    if(!next&&wasDiscovered){emitConnection('gamepaddisconnected',{...snapshot,connected:false});announced=false;}
    if(next){win.clearTimeout(connectionTimer);connectionTimer=win.setTimeout(()=>announce(true),0);}
  }
  if(enabled){
    try{Object.defineProperty(nav,'getGamepads',{configurable:true,writable:true,value:wrapped});installed=true;}
    catch{ /* An unavailable browser API leaves the original device API intact. */ }
  }
  if(installed){win.addEventListener('gamepadconnected',syncPhysical);win.addEventListener('gamepaddisconnected',syncPhysical);frame=win.requestAnimationFrame(tick);}
  return {
    get available(){const real=realPads(readNative());return installed&&(!real.length||real.some(p=>p.mapping==='standard'));},get index(){return index;},announce,
    move(v){if(!installed)return;move=encodeGamepadStick(v.x,v.y);updateSnapshot();},
    look(dx,dy){if(!installed||!Number.isFinite(dx)||!Number.isFinite(dy))return;pendingX+=dx;pendingY+=dy;},
    endLook(){pendingX=pendingY=0;look=[0,0];updateSnapshot();},
    press(action){const button=TOUCH_BUTTONS[action];if(button===undefined||!this.available)return false;announce();down.add(button);pressedAt.set(button,now());updateSnapshot();return true;},
    release(action){const button=TOUCH_BUTTONS[action];if(button===undefined)return;down.delete(button);if(pressedAt.has(button))until.set(button,pressedAt.get(button)+120);pressedAt.delete(button);updateSnapshot();},
    reset,
    destroy(){if(disposed)return;reset();disposed=true;win.cancelAnimationFrame(frame);win.clearTimeout(connectionTimer);win.removeEventListener('gamepadconnected',syncPhysical);win.removeEventListener('gamepaddisconnected',syncPhysical);if(installed&&nav.getGamepads===wrapped){if(descriptor)Object.defineProperty(nav,'getGamepads',descriptor);else delete nav.getGamepads;}installed=false;},
  };
}
