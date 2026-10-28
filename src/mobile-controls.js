// Touch inputs feed the same movement/actions as the keyboard. Every contact
// owns its input until that exact pointer releases; no gesture latches a web.
export function createMobileControls({document,window,canUse=()=>true,onAction=()=>{},onHold=()=>{},onAxes=()=>{},onReset=()=>{},onChange=()=>{}}={}){
  const $=id=>document?.getElementById?.(id),root=$('mobile-controls'),joystick=$('mobile-joystick'),stick=$('mobile-stick');
  const extra=$('mobile-extra-actions'),orientationHint=$('mobile-orientation-hint');
  const holds=Array.from(root?.querySelectorAll?.('[data-mobile-hold]')||[]),actions=Array.from(root?.querySelectorAll?.('[data-mobile-action]')||[]);
  // The portrait hint is a sibling so it can remain legible over the scene.
  const portraitContinue=orientationHint?.querySelector?.('[data-mobile-action="continue-portrait"]');
  if(portraitContinue&&!actions.includes(portraitContinue))actions.push(portraitContinue);
  const listeners=[],pointers=new Map(),holdOwners=new Map(),keyboardOwners=new Map();
  let disposed=false,resetting=false,joy=null,axes={forward:0,sideways:0},more=false,portraitDismissed=false,pendingFullscreen=false;
  let state={active:false,suspended:false,mode:'walk',view:'third',canInteract:false,interactionLabel:'',pointReady:false,pointPhase:'idle'};
  const coarse=window?.matchMedia?.('(any-pointer: coarse)'),landscape=window?.matchMedia?.('(orientation: landscape)');
  let enabled=!!coarse?.matches;
  const listen=(target,type,handler,options)=>{if(!target?.addEventListener)return;target.addEventListener(type,handler,options);listeners.push(()=>target.removeEventListener(type,handler,options));};
  const visible=()=>enabled&&state.active&&!state.suspended&&!document.hidden;
  const usable=()=>!disposed&&visible()&&canUse();
  const allowed=button=>{const modes=button?.dataset?.mobileModes;return (!modes||modes.split(/[\s,]+/).includes(state.mode))&&(!button?.dataset?.mobileExtra||more);};
  const isLandscape=()=>landscape?landscape.matches:(window?.innerWidth??1)>=(window?.innerHeight??0);
  const prevent=e=>{e.preventDefault?.();e.stopPropagation?.();};
  function pressed(button,value){button?.classList?.toggle('is-pressed',value);if(button?.dataset)button.dataset.pressed=String(value);}
  function capture(button,id){try{button?.setPointerCapture?.(id);}catch{}}
  function releaseCapture(button,id){try{if(button?.hasPointerCapture?.(id))button.releasePointerCapture(id);}catch{}}
  function setAxes(next){
    if(Math.abs(next.forward-axes.forward)<1e-6&&Math.abs(next.sideways-axes.sideways)<1e-6)return;
    axes=next;onAxes({...axes});
  }
  function setHold(action,owner,value){
    let owners=holdOwners.get(action);
    if(value){if(!owners){owners=new Set();holdOwners.set(action,owners);}const empty=owners.size===0;owners.add(owner);if(empty)onHold(action,true);}
    else if(owners?.delete(owner)&&owners.size===0){holdOwners.delete(action);onHold(action,false);}
  }
  function releasePointer(id){
    if(joy?.id===id){const old=joy;joy=null;pressed(joystick,false);if(stick)stick.style.transform='translate(0px, 0px)';setAxes({forward:0,sideways:0});releaseCapture(joystick,old.id);}
    const owned=pointers.get(id);if(!owned)return;
    pointers.delete(id);if(owned.hold)setHold(owned.hold,id,false);pressed(owned.button,false);releaseCapture(owned.button,id);
  }
  function reset(){
    if(disposed||resetting)return;resetting=true;
    if(joy)releasePointer(joy.id);
    for(const id of Array.from(pointers.keys()))releasePointer(id);
    for(const [button,owner]of keyboardOwners){setHold(button.dataset.mobileHold,owner,false);pressed(button,false);}keyboardOwners.clear();
    setAxes({forward:0,sideways:0});onReset();resetting=false;
  }
  function render(){
    document?.body?.classList?.toggle('touch-controls',enabled);
    const enableButton=$('mobile-enable-touch');if(enableButton)enableButton.hidden=enabled;
    if(root){root.hidden=!visible();Object.assign(root.dataset,{mode:state.mode,view:state.view,suspended:String(state.suspended),more:String(more)});}
    for(const button of [...holds,...actions]){
      if(button===portraitContinue)continue;
      button.hidden=!allowed(button);
      button.disabled=state.suspended||!state.active;
      if(button.dataset.mobileAction==='interact'){
        button.hidden=!state.canInteract;
        const label=$('mobile-interact-label');if(label)label.textContent=state.interactionLabel||'使用';
        button.setAttribute?.('aria-label',state.interactionLabel||'使用附近载具');
      }
      if(button.dataset.mobileAction==='more')button.setAttribute?.('aria-expanded',String(more));
      if(button.dataset.mobileAction==='point'){
        const busy=['approach','perch'].includes(state.pointPhase);
        button.dataset.ready=String(state.pointReady||busy);
        const hint=$('mobile-point-hint');if(hint)hint.textContent=busy?'点跳跃弹出':state.pointReady?'屋沿已锁定':'瞄准屋沿';
      }
      if(button.dataset.mobileAction==='view')button.setAttribute?.('aria-label',state.view==='first'?'切换第三人称':'切换第一人称');
      if(button.dataset.mobileHold==='up'){
        const jet=state.mode==='roadster',label=jet?'喷气':'上升';
        if(button.textContent!==label)button.textContent=label;
        button.setAttribute?.('aria-label',jet?'按住喷气升空，松开后下落':'按住上升');
      }
      if(button.dataset.mobileHold==='brake'){
        const hover=['helicopter','hoverboard'].includes(state.mode),label=hover?'悬停':'刹车';
        if(button.textContent!==label)button.textContent=label;
        button.setAttribute?.('aria-label',hover?'按住减速并悬停':'按住刹车');
      }
    }
    if(extra)extra.hidden=!more||!visible();
    if(orientationHint)orientationHint.hidden=!visible()||isLandscape()||portraitDismissed;
  }
  function enable(){if(enabled||disposed)return;enabled=true;render();onChange();}
  listen($('mobile-enable-touch'),'click',enable);
  function moveJoystick(e){
    if(!joy||joy.id!==e.pointerId)return;
    if(!usable()){reset();return;}prevent(e);
    const dx=e.clientX-joy.x,dy=e.clientY-joy.y,d=Math.hypot(dx,dy),scale=d>joy.radius?joy.radius/d:1;
    if(stick)stick.style.transform=`translate(${(dx*scale).toFixed(2)}px, ${(dy*scale).toFixed(2)}px)`;
    const magnitude=Math.min(1,d/joy.radius),strength=magnitude<.12?0:(magnitude-.12)/.88;
    setAxes({forward:d?-dy/d*strength:0,sideways:d?dx/d*strength:0});
  }
  listen(document,'pointerdown',e=>{if(e.pointerType==='touch'||e.pointerType==='pen')enable();},{capture:true,passive:true});
  listen(joystick,'pointerdown',e=>{
    if(!usable()||joy||pointers.has(e.pointerId))return;prevent(e);
    const rect=joystick.getBoundingClientRect(),radius=Math.max(20,Math.min(rect.width,rect.height)*.36);
    joy={id:e.pointerId,x:rect.left+rect.width/2,y:rect.top+rect.height/2,radius};pressed(joystick,true);capture(joystick,e.pointerId);moveJoystick(e);
  },{passive:false});
  listen(joystick,'pointermove',moveJoystick,{passive:false});
  listen(window,'pointermove',moveJoystick,{passive:false});
  for(const button of holds){
    listen(button,'pointerdown',e=>{
      if(!usable()||!allowed(button)||button.hidden||Array.from(pointers.values()).some(p=>p.button===button))return;
      prevent(e);const action=button.dataset.mobileHold;
      pointers.set(e.pointerId,{button,hold:action});pressed(button,true);capture(button,e.pointerId);setHold(action,e.pointerId,true);
    },{passive:false});
    listen(button,'keydown',e=>{
      if(!['Space','Enter'].includes(e.code)||e.repeat||!usable()||!allowed(button)||button.hidden||keyboardOwners.has(button))return;
      prevent(e);const owner={button};keyboardOwners.set(button,owner);pressed(button,true);setHold(button.dataset.mobileHold,owner,true);
    });
    const endKeyboard=()=>{const owner=keyboardOwners.get(button);if(owner){keyboardOwners.delete(button);setHold(button.dataset.mobileHold,owner,false);pressed(button,false);}};
    listen(button,'keyup',e=>{if(['Space','Enter'].includes(e.code)){prevent(e);endKeyboard();}});listen(button,'blur',endKeyboard);
    // Browsers synthesize click after pointerup. Neither it nor an accessibility
    // click can create an indefinite held input; keyboard press/release can.
    listen(button,'click',prevent);
  }
  function status(text){const el=$('mobile-fullscreen-status');if(el)el.textContent=text;}
  async function fullscreen(){
    if(pendingFullscreen||disposed)return;
    reset();pendingFullscreen=true;
    try{
      if(document.fullscreenElement){await document.exitFullscreen?.();window.screen?.orientation?.unlock?.();status('已退出全屏');}
      else if(typeof document.documentElement?.requestFullscreen==='function'){
        await document.documentElement.requestFullscreen();if(disposed)return;
        if(document.fullscreenElement){
          try{await window.screen?.orientation?.lock?.('landscape');}catch{}
          status('已进入全屏；若未自动横屏，请将手机横放');
        }
      }else status('请将手机横放；当前浏览器未提供全屏功能');
    }catch{if(!disposed)status('暂未进入全屏，仍可横放手机继续操作');}
    finally{pendingFullscreen=false;if(!disposed){render();onChange();}}
  }
  function action(name){
    if(!usable())return;
    if(name==='more'){
      more=!more;
      if(!more){
        for(const [id,owner]of pointers)if(owner.button.dataset.mobileExtra)releasePointer(id);
        for(const [button,owner]of keyboardOwners)if(button.dataset.mobileExtra){setHold(button.dataset.mobileHold,owner,false);pressed(button,false);keyboardOwners.delete(button);}
      }
      render();return;
    }
    if(name==='continue-portrait'){portraitDismissed=true;reset();render();return;}
    if(name==='fullscreen'){void fullscreen();return;}
    onAction(name);
  }
  for(const button of actions){
    listen(button,'pointerdown',e=>{
      if(!usable()||!allowed(button)||button.hidden||pointers.has(e.pointerId)||Array.from(pointers.values()).some(p=>p.button===button))return;
      prevent(e);pointers.set(e.pointerId,{button});pressed(button,true);capture(button,e.pointerId);
      // Touch/pen user activation starts at pointerup, unlike a mouse press.
      // Fullscreen must wait for that event; gameplay actions remain immediate.
      if(button.dataset.mobileAction!=='fullscreen')action(button.dataset.mobileAction);
    },{passive:false});
    if(button.dataset.mobileAction==='fullscreen')listen(button,'pointerup',e=>{
      if(pointers.get(e.pointerId)?.button!==button)return;
      prevent(e);releasePointer(e.pointerId);
      if(allowed(button)&&!button.hidden)action('fullscreen');
    },{passive:false});
    listen(button,'click',e=>{prevent(e);if(e.detail===0&&allowed(button)&&!button.hidden)action(button.dataset.mobileAction);});
  }
  for(const element of [joystick,...holds,...actions])for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(element,type,e=>releasePointer(e.pointerId));
  for(const type of ['pointerup','pointercancel'])listen(window,type,e=>releasePointer(e.pointerId));
  const boundary=()=>{reset();render();};
  const rotate=()=>{portraitDismissed=false;reset();render();onChange();};
  listen(window,'blur',boundary);listen(document,'visibilitychange',boundary);
  // An input field or dialog taking focus must not leave a finger's movement
  // active behind a software keyboard or a native dialog.
  listen(document,'focusin',e=>{if(e.target?.closest?.('input,textarea,select,[contenteditable="true"],dialog[open]'))boundary();});
  listen(window,'orientationchange',rotate);listen(window?.screen?.orientation,'change',rotate);
  listen(window,'resize',boundary);listen(window?.visualViewport,'resize',boundary);
  listen(document,'fullscreenchange',boundary);
  listen(coarse,'change',e=>{if(e.matches)enable();});listen(landscape,'change',rotate);
  function update(next){
    if(disposed)return;
    const previous=state;state={...state,...next};
    if(previous.active!==state.active||previous.suspended!==state.suspended||previous.mode!==state.mode){more=false;reset();}
    if(!state.canInteract)for(const [id,p]of pointers)if(p.button.dataset.mobileAction==='interact')releasePointer(id);
    render();
  }
  render();
  return {update,reset,get enabled(){return enabled;},get axes(){return {...axes};},dispose(){if(disposed)return;reset();disposed=true;listeners.forEach(remove=>remove());if(root)root.hidden=true;if(orientationHint)orientationHint.hidden=true;document?.body?.classList?.remove('touch-controls');}};
}
