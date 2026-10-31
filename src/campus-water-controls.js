export function createCampusWaterControls({host,water,state,canAct,onSurf,onBoard}){
  const root=document.createElement('div');root.className='campus-water-controls';root.hidden=true;root.setAttribute('aria-label','水面操作');
  const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.waterAction=action;root.append(b);return b;};
  const surf=button('冲浪','surf'),board=button('上板','board'),up=button('上浮','up'),down=button('下潜','down'),status=document.createElement('span');
  status.className='surf-status';root.append(status);host.append(root);
  const held=new Set(),removers=[];
  const on=(el,type,fn)=>{el.addEventListener(type,fn);removers.push(()=>el.removeEventListener(type,fn));};
  on(surf,'click',()=>{if(canAct())onSurf();});on(board,'click',()=>{if(canAct())onBoard();});
  for(const [b,direction]of[[up,1],[down,-1]]){
    on(b,'pointerdown',e=>{if(!canAct())return;e.preventDefault();held.add(direction);b.setPointerCapture?.(e.pointerId);});
    for(const event of['pointerup','pointercancel','lostpointercapture'])on(b,event,()=>held.delete(direction));
    on(b,'keydown',e=>{if(canAct()&&['Space','Enter'].includes(e.code)){e.preventDefault();held.add(direction);}});
    on(b,'keyup',()=>held.delete(direction));on(b,'blur',()=>held.delete(direction));
  }
  const reset=()=>held.clear();on(window,'blur',reset);on(document,'visibilitychange',reset);
  function update(){
    const wet=water.active&&state.mode==='walk'&&state.waterMode!=='dry';root.hidden=!canAct()||!wet;
    if(root.hidden){reset();return;}
    root.dataset.mode=state.waterMode;
    surf.hidden=state.surfWindowRemaining<=0||state.waterMode==='surf';surf.textContent=`冲浪 · ${state.surfWindowRemaining.toFixed(1)}s`;surf.title='G · 跟随海浪前滑 5 秒';
    const onboard=['board','surf'].includes(state.waterMode);board.hidden=!onboard&&!water.nearbyBoard();board.textContent=onboard?'下板':'上板';board.title='F';
    status.hidden=state.waterMode!=='surf';status.textContent=status.hidden?'':`冲浪 ${state.surfRemaining.toFixed(1)}s`;
    up.hidden=onboard;up.title='空格 / Q';down.title='C / E';
  }
  return{update,reset,get vertical(){return Number(held.has(1))-Number(held.has(-1));},dispose(){removers.forEach(fn=>fn());root.remove();}};
}
