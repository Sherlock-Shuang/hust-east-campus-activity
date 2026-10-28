import {createTouchControls,createTouchKeys} from './touch-controls.mjs';
const canvas=document.getElementById('unity-canvas');
const keys=createTouchKeys(()=>canvas);
const mapping={attack:'KeyJ',heavy:'KeyF',skill:'KeyQ',heal:'KeyE',dodge:'Space',lock:'Tab',recenter:'KeyC',menu:'Escape',confirm:'Enter',restart:'KeyR',upgrade1:'Digit1',upgrade2:'Digit2',upgrade3:'Digit3'};
const phase=()=>{const s=window.bookrealmNativeControls;return !s?.started?'intro':s.ended?'ended':s.paused?'paused':s.choosing?'choosing':'combat';};
const touch=createTouchControls({kind:'wanyan',canvas,movePhases:['combat'],onReset:()=>keys.release(),
 canPlay:()=>document.documentElement.dataset.campusWorkStatus==='runtime_ready'&&!window.bookrealmControlsSuspended&&!document.querySelector('#bookrealm-gamepad-setup:not([hidden])'),canLook:()=>phase()==='combat',phase,
 onMove:v=>{const next=new Set();if(phase()==='combat'){if(v.x<-.24)next.add('KeyA');if(v.x>.24)next.add('KeyD');if(v.y<-.24)next.add('KeyW');if(v.y>.24)next.add('KeyS');}keys.set('move',next);},
 onLook:(dx,dy)=>{if(phase()!=='combat')return;const rect=canvas.getBoundingClientRect();const e=new MouseEvent('mousemove',{bubbles:true,clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2});Object.defineProperties(e,{movementX:{value:dx},movementY:{value:dy}});canvas.dispatchEvent(e);},
 onPress:id=>keys.set(id,[mapping[id]]),onRelease:id=>keys.release(id),
 toolbar:[{id:'menu',label:'暂停 / 继续',phases:['combat','paused']},{id:'confirm',label:'开始 / 确认',phases:['intro','combat']},{id:'restart',label:'重新开始',phases:['ended']},{id:'recenter',label:'镜头回正',phases:['combat']},{id:'upgrade1',label:'选择强化 1',phases:['choosing']},{id:'upgrade2',label:'选择强化 2',phases:['choosing']},{id:'upgrade3',label:'选择强化 3',phases:['choosing']}],
 actions:[{id:'heal',label:'回血',phases:['combat']},{id:'skill',label:'技能',phases:['combat']},{id:'lock',label:'锁定',phases:['combat']},{id:'heavy',label:'重击',phases:['combat']},{id:'attack',label:'攻击',phases:['combat']},{id:'dodge',label:'闪避',phases:['combat']}],
});
window.addEventListener('pagehide',()=>{touch.destroy();keys.release();},{once:true});
