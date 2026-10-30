import {createTouchControls,createTouchKeys,isTouchLayout} from './touch-controls.mjs';
import {createTouchGamepad,TOUCH_GAMEPAD_ID} from './wanyan-touch-gamepad.mjs';
import {skillPresentation} from './wanyan-skill-state.mjs';
const pad=createTouchGamepad({enabled:isTouchLayout(),isDiscovered:()=>!!window.bookrealmNativeControls?.connected&&window.bookrealmNativeControls?.rawGamepad?.id===TOUCH_GAMEPAD_ID});
const canvas=document.getElementById('unity-canvas');
const keys=createTouchKeys(()=>canvas);
const mapping={attack:'KeyJ',heavy:'KeyF',skill:'KeyQ',heal:'KeyE',dodge:'Space',lock:'Tab',recenter:'KeyC',menu:'Escape',confirm:'Enter',restart:'KeyR',upgrade1:'Digit1',upgrade2:'Digit2',upgrade3:'Digit3'};
const phase=()=>{const s=window.bookrealmNativeControls;return !s?.started?'intro':s.ended?'ended':s.paused?'paused':s.choosing?'choosing':'combat';};
const touch=createTouchControls({kind:'wanyan',canvas,movePhases:['combat'],onReset:()=>{keys.release();pad.reset();},
 canPlay:()=>document.documentElement.dataset.campusWorkStatus==='runtime_ready'&&!window.bookrealmControlsSuspended&&!document.querySelector('#bookrealm-gamepad-setup:not([hidden])'),canLook:()=>phase()==='combat',phase,
 onMove:v=>{if(pad.available){pad.move(phase()==='combat'?v:{x:0,y:0});return;}const next=new Set();if(phase()==='combat'){if(v.x<-.24)next.add('KeyA');if(v.x>.24)next.add('KeyD');if(v.y<-.24)next.add('KeyW');if(v.y>.24)next.add('KeyS');}keys.set('move',next);},
 onLook:(dx,dy)=>{if(phase()==='combat')pad.look(dx,dy);},onLookEnd:()=>pad.endLook(),
 onPress:id=>{canvas?.focus({preventScroll:true});if(!pad.press(id))keys.set(id,[mapping[id]]);},onRelease:id=>{pad.release(id);keys.release(id);},
 toolbar:[{id:'menu',label:'暂停 / 继续',phases:['combat','paused']},{id:'confirm',label:'开始 / 确认',phases:['intro','combat']},{id:'restart',label:'重新开始',phases:['ended']},{id:'recenter',label:'镜头回正',phases:['combat']},{id:'upgrade1',label:'选择强化 1',phases:['choosing']},{id:'upgrade2',label:'选择强化 2',phases:['choosing']},{id:'upgrade3',label:'选择强化 3',phases:['choosing']}],
 actions:[{id:'heal',label:'回血',phases:['combat']},{id:'skill',label:'技能',phases:['combat']},{id:'lock',label:'锁定',phases:['combat']},{id:'heavy',label:'重击',phases:['combat']},{id:'attack',label:'普攻',phases:['combat']},{id:'dodge',label:'闪避',phases:['combat']}],
});
const skillButton=touch.root.querySelector('[data-touch-action="skill"]');
let skillStatus,lastSkillUI='';
if(skillButton){
 const name=document.createElement('span');name.className='work-skill-name';name.textContent='技能';
 skillStatus=document.createElement('small');skillStatus.className='work-skill-status';skillStatus.textContent='同步中';
 name.setAttribute('aria-hidden','true');skillStatus.setAttribute('aria-hidden','true');
 skillButton.replaceChildren(name,skillStatus);
}
function updateSkill(){
 if(!skillButton)return;
 const ui=skillPresentation(window.bookrealmNativeSkill,{phase:phase(),suspended:!!window.bookrealmControlsSuspended||document.hidden});
 const charge=`${Math.round(ui.charge*100)}%`,stamp=`${ui.state}|${ui.label}|${ui.hint}|${charge}`;
 if(stamp===lastSkillUI)return;lastSkillUI=stamp;
 skillButton.dataset.skillState=ui.state;skillButton.dataset.skillReady=String(ui.ready);skillButton.dataset.skillCharged=String(ui.charged);
 skillButton.style.setProperty('--skill-charge',charge);skillStatus.textContent=ui.label;
 skillButton.setAttribute('aria-label',ui.hint);skillButton.title=ui.hint;
 // These are display states only. Do not disable this button: Unity owns
 // the existing action buffering, costs, cooldowns and input rejection.
}
updateSkill();
let disposed=false,announceTimer=0,unsubscribeDispose=()=>{};
const announceReady=()=>{
 if(disposed)return;
 window.clearTimeout(announceTimer);
 announceTimer=window.setTimeout(()=>{announceTimer=0;if(!disposed)pad.announce();},250);
};
window.campusWanyanTouchReady=announceReady;
// Read-only DOM diagnostics from the actual Unity bridge, sampled at 5 Hz.
const diagnostics=window.setInterval(()=>{
 if(disposed)return;
 updateSkill();
 const s=window.bookrealmNativeControls;if(!s||!canvas)return;
 canvas.dataset.touchInput=pad.available?'gamepad':'keyboard';
 for(const key of ['yaw','pitch','lookX','lookY','moveX','moveY','playerX','playerZ'])if(Number.isFinite(s[key]))canvas.dataset[`native${key[0].toUpperCase()+key.slice(1)}`]=s[key].toFixed(3);
 canvas.dataset.nativeReady=String(s.ready);canvas.dataset.nativePhase=phase();
 canvas.dataset.nativeLocked=String(s.locked);canvas.dataset.nativeAttacking=String(s.attacking);
},200);
function dispose(){
 if(disposed)return;disposed=true;
 window.clearTimeout(announceTimer);announceTimer=0;window.clearInterval(diagnostics);
 touch.destroy();keys.release();pad.destroy();unsubscribeDispose();
 window.removeEventListener('pagehide',dispose);
 if(window.campusWanyanTouchReady===announceReady)delete window.campusWanyanTouchReady;
}
window.addEventListener('pagehide',dispose,{once:true});
unsubscribeDispose=window.campusWorkAdapter?.onDispose?.(dispose)||(()=>{});
