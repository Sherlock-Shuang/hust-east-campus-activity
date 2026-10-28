/** Touch input for the campus copies; never changes game progress. */
export function touchVector(x, y, radius = 48) {
  const length = Math.hypot(x, y), scale = length > radius ? radius / length : 1;
  return { x: x * scale / radius, y: y * scale / radius };
}
export function directionKeys(vector, shoot = false) {
  const out = new Set(), keys = shoot ? ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'] : ['KeyA','KeyD','KeyW','KeyS'];
  if (vector.x < -.24) out.add(keys[0]); if (vector.x > .24) out.add(keys[1]);
  if (vector.y < -.24) out.add(keys[2]); if (vector.y > .24) out.add(keys[3]);
  return out;
}
const keyInfo = {
  KeyW:['w',87],KeyA:['a',65],KeyS:['s',83],KeyD:['d',68],KeyJ:['j',74],KeyF:['f',70],KeyQ:['q',81],KeyE:['e',69],KeyC:['c',67],KeyR:['r',82],KeyP:['p',80],
  ArrowUp:['ArrowUp',38],ArrowDown:['ArrowDown',40],ArrowLeft:['ArrowLeft',37],ArrowRight:['ArrowRight',39],Space:[' ',32],Enter:['Enter',13],Escape:['Escape',27],Tab:['Tab',9],Digit1:['1',49],Digit2:['2',50],Digit3:['3',51],
};
export function createTouchKeys(getTarget, EventClass = globalThis.KeyboardEvent) {
  const owners = new Map(), held = new Map();
  const emit=(target,type,code)=>{const [key,keyCode]=keyInfo[code]||[code,0];const e=new EventClass(type,{key,code,keyCode,which:keyCode,bubbles:true,composed:true,cancelable:true});e.bookrealmGamepadInput=true;e.campusTouchInput=true;target.dispatchEvent(e);};
  function sync(){
    const desired=new Set([...owners.values()].flatMap(keys=>[...keys]));
    for(const [code,target] of held)if(!desired.has(code)){emit(target,'keyup',code);held.delete(code);}
    for(const code of desired)if(!held.has(code)){const target=getTarget();if(target){target.focus?.({preventScroll:true});emit(target,'keydown',code);held.set(code,target);}}
  }
  return {set(owner,keys){owners.set(owner,new Set(keys));sync();},release(owner){if(owner===undefined)owners.clear();else owners.delete(owner);sync();},get held(){return new Set(held.keys());}};
}
export function isTouchLayout(win = window) { return win.matchMedia?.('(pointer: coarse)').matches || win.navigator?.maxTouchPoints > 0 || win.innerWidth <= 900; }

export function createTouchControls({kind,canvas,canPlay=()=>true,canLook=canPlay,onMove=()=>{},onShoot,onLook,onPress=()=>{},onRelease=()=>{},onReset=()=>{},movePhases,actions=[],toolbar=[],phase=()=>'',window:win=window,document:doc=document}) {
  const root=doc.createElement('section');root.className='campus-work-touch';root.dataset.kind=kind;root.setAttribute('aria-label','触屏游戏操作');root.hidden=true;
  root.innerHTML='<nav class="work-touch-toolbar" aria-label="游戏菜单"></nav><div class="work-touch-stick work-touch-move" role="group" aria-label="拖动摇杆移动"><i></i><span>移动</span></div><div class="work-touch-actions"></div>';
  if(onShoot){const shoot=doc.createElement('div');shoot.className='work-touch-stick work-touch-shoot';shoot.setAttribute('role','group');shoot.setAttribute('aria-label','拖动摇杆控制射击方向');shoot.innerHTML='<i></i><span>射击</span>';root.append(shoot);}
  const allButtons=[];
  function addButton(config,container){const button=doc.createElement('button');button.type='button';button.textContent=config.label;button.setAttribute('aria-label',config.ariaLabel||config.label);button.dataset.touchAction=config.id;button._touchConfig=config;container.append(button);allButtons.push(button);return button;}
  toolbar.forEach(c=>addButton(c,root.querySelector('nav')));actions.forEach(c=>addButton(c,root.querySelector('.work-touch-actions')));doc.body.append(root);
  const removers=[],pointers=new Map();let enabled=false,visible=false,disposed=false,frame=0,lookPointer=null,previousPhase;
  const listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);removers.push(()=>node.removeEventListener(type,fn,options));};
  const prevent=e=>{e.preventDefault?.();e.stopPropagation?.();};
  function releasePointer(id){const record=pointers.get(id);if(!record)return;pointers.delete(id);if(record.stick){record.stick.querySelector('i').style.transform='translate(-50%, -50%)';record.callback({x:0,y:0});}else{record.button.classList.remove('is-held');onRelease(record.id);}try{record.target.releasePointerCapture(id);}catch{}}
  function release(){for(const id of [...pointers.keys()])releasePointer(id);lookPointer=null;onMove({x:0,y:0});onShoot?.({x:0,y:0});onReset();}
  function stick(element,callback){if(!element)return;const update=(e,rect)=>{const v=touchVector(e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2,rect.width*.34);element.querySelector('i').style.transform=`translate(calc(-50% + ${v.x*rect.width*.28}px),calc(-50% + ${v.y*rect.height*.28}px))`;callback(v);};listen(element,'pointerdown',e=>{if(!visible||element.hidden||[...pointers.values()].some(p=>p.stick===element))return;prevent(e);const rect=element.getBoundingClientRect();element.setPointerCapture?.(e.pointerId);pointers.set(e.pointerId,{stick:element,target:element,callback,rect});update(e,rect);});listen(element,'pointermove',e=>{const p=pointers.get(e.pointerId);if(p?.stick!==element)return;prevent(e);update(e,p.rect);});}
  stick(root.querySelector('.work-touch-move'),onMove);stick(root.querySelector('.work-touch-shoot'),onShoot);
  for(const button of allButtons){listen(button,'pointerdown',e=>{if(!visible||button.hidden)return;prevent(e);button.setPointerCapture?.(e.pointerId);button.classList.add('is-held');pointers.set(e.pointerId,{button,id:button._touchConfig.id,target:button});onPress(button._touchConfig.id);});listen(button,'click',e=>{prevent(e);if(e.detail===0&&visible&&!button.hidden){onPress(button._touchConfig.id);win.setTimeout(()=>onRelease(button._touchConfig.id),120);}});}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(root,type,e=>{if(pointers.has(e.pointerId)){prevent(e);releasePointer(e.pointerId);}});
  if(canvas&&onLook){listen(canvas,'pointerdown',e=>{if(!visible||!canLook()||(e.pointerType==='mouse'&&e.button!==0)||lookPointer!==null)return;e.preventDefault();e.stopImmediatePropagation();canvas.focus?.({preventScroll:true});canvas.setPointerCapture?.(e.pointerId);lookPointer={id:e.pointerId,x:e.clientX,y:e.clientY};},true);listen(canvas,'pointermove',e=>{if(lookPointer?.id!==e.pointerId)return;if(!canLook()){lookPointer=null;return;}e.preventDefault();e.stopImmediatePropagation();onLook(e.clientX-lookPointer.x,e.clientY-lookPointer.y);lookPointer.x=e.clientX;lookPointer.y=e.clientY;},true);for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,type,e=>{if(lookPointer?.id===e.pointerId){e.preventDefault();lookPointer=null;}},true);}
  function refresh(){if(disposed)return;enabled=!!isTouchLayout(win);const next=enabled&&!doc.hidden&&!!canPlay();if(next!==visible){visible=next;root.hidden=!next;if(!next)release();}doc.documentElement.classList.toggle('campus-work-mobile',enabled);const currentPhase=phase();if(previousPhase!==undefined&&currentPhase!==previousPhase)release();previousPhase=currentPhase;root.dataset.phase=currentPhase;root.querySelector('.work-touch-move').hidden=!!movePhases&&!movePhases.includes(currentPhase);for(const b of allButtons){const allowed=!b._touchConfig.phases||b._touchConfig.phases.includes(currentPhase);if(!allowed&&!b.hidden){for(const [id,p]of pointers)if(p.button===b)releasePointer(id);}b.hidden=!allowed;}frame=win.requestAnimationFrame(refresh);}
  listen(win,'blur',release);listen(win,'pagehide',release);listen(win,'resize',release);listen(doc,'visibilitychange',release);
  refresh();return {root,get enabled(){return enabled;},get active(){return visible;},release,destroy(){disposed=true;win.cancelAnimationFrame(frame);release();removers.forEach(fn=>fn());root.remove();}};
}
