import * as THREE from 'three';
import {createOptoC118Interior} from './opto-c118-interior.js';
import {createC118Navigation,indoorMovement,crossedC118Door} from './c118-navigation.js';
import {createPlayerPointerLock} from './player-pointer-lock.js';
import {createC118VideoScreen} from './c118-video-screen.js';
import {createC118ActivitySync} from './c118-activity-sync.js';
import {normalizeC118Flood,getC118FloodElapsed} from './c118-flood-state.js';
import {createC118FloodEffect} from './c118-flood-effect.js';
import {createC118FloodSensory} from './c118-flood-sensory.js';
import {normalizeC118Screen} from './c118-screen-state.js';
import {createC118Seating,c118SeatedFov,c118CinemaFov} from './c118-seating.js';
import {createC118Audience} from './c118-audience.js';
import {createC118Swimming} from './c118-swimming.js';
import './c118-viewer.css';

const canvas=document.querySelector('#hall-canvas'),status=document.querySelector('#hall-status'),stick=document.querySelector('#hall-stick');
let renderer,interior,motion,screenPlayer,raf,screenInView=false,disposed=false,paused=false,returning=false,previous=0,heading=0,pitch=0,joy=null,look=null,mouse=null,axes={forward:0,sideways:0};
let activitySync,floodEffect,floodSensory,floodEvent=null,floodRunning=false;
let resetFloodView=()=>{};
let screenControl=null,audience,seating,seatedSeat=null,seatView=null,beforeSeatPose=null,seatTransition=null;
let cinema=false,cinemaView=null,swimming,swimVertical=0,floodReturn=null;
let enterSeat=()=>{},riseFromSeat=()=>{},faceStage=()=>{};
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const floodStatus=document.querySelector('#hall-flood-status');
const keys=new Set(),listeners=[];
const on=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
const usable=()=>!disposed&&!paused&&!returning&&!document.hidden;
const lock=createPlayerPointerLock({canvas,document,canLock:usable,onChange:()=>resetInput(),onError:()=>{status.hidden=false;status.textContent='可直接移动鼠标环视，或在浏览器中按 L 锁定';}});
function resetInput(){keys.clear();swimVertical=0;joy=look=mouse=null;axes={forward:0,sideways:0};stick.hidden=true;motion?.suspend();}
function rotate(dx,dy,scale=.0025){if(cinema)return;heading-=Math.max(-250,Math.min(250,dx))*scale;pitch=Math.max(-1.35,Math.min(1.3,pitch-dy*scale));}
function exit(){if(paused||returning)return;returning=true;screenPlayer?.update({active:false,visible:false});floodSensory?.update({active:false});resetInput();lock.release();if(window.parent!==window&&window.campusActivity)window.campusActivity.exit();else location.href='./';}
on(document.querySelector('#hall-return'),'click',event=>{event.preventDefault();exit();});
on(document.querySelector('#swim-exit'),'click',exit);
on(window,'keydown',event=>{if(!usable()||event.target.closest?.('a,button,input'))return;if(event.code==='KeyE'&&!event.repeat){event.preventDefault();if(swimming?.state.active)return;if(seatedSeat)riseFromSeat();else enterSeat(true);return;}if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space','KeyC','ControlLeft','ControlRight'].includes(event.code)){event.preventDefault();if(!seatedSeat)keys.add(event.code);}if(event.code==='KeyL'&&!event.repeat){event.preventDefault();lock.toggle();}});
on(window,'keyup',event=>keys.delete(event.code));
on(window,'blur',resetInput);on(document,'visibilitychange',()=>{resetInput();screenPlayer?.update({active:usable()&&!floodRunning,visible:screenInView});if(document.hidden)floodSensory?.update({active:false});});
for(const type of ['pointerdown','keydown'])on(window,type,()=>floodSensory?.unlock(),{capture:true});
on(canvas,'pointerdown',event=>{
  if(!usable())return;canvas.focus({preventScroll:true});
  if(event.pointerType==='mouse')return;
  event.preventDefault();canvas.setPointerCapture(event.pointerId);
  if(event.clientX<innerWidth*.47&&!joy){joy={id:event.pointerId,x:event.clientX,y:event.clientY};stick.style.left=`${joy.x}px`;stick.style.top=`${joy.y}px`;stick.firstElementChild.style.transform='';stick.hidden=false;}
  else if(!look)look={id:event.pointerId,x:event.clientX,y:event.clientY};
});
on(canvas,'pointermove',event=>{
  if(!usable())return;
  if(joy?.id===event.pointerId){const dx=event.clientX-joy.x,dy=event.clientY-joy.y,l=Math.hypot(dx,dy),s=Math.min(1,l/42),gain=s<.12?0:(s-.12)/.88;axes={forward:l?-dy/l*gain:0,sideways:l?dx/l*gain:0};stick.firstElementChild.style.transform=`translate(${l?dx/l*s*36:0}px,${l?dy/l*s*36:0}px)`;}
  else if(look?.id===event.pointerId){rotate(event.clientX-look.x,event.clientY-look.y,.004);look={id:look.id,x:event.clientX,y:event.clientY};}
  else if(event.pointerType==='mouse'&&!lock.locked){if(mouse)rotate(event.clientX-mouse.x,event.clientY-mouse.y);mouse={x:event.clientX,y:event.clientY};}
});
on(document,'mousemove',event=>{if(usable()&&lock.locked)rotate(event.movementX,event.movementY);});
on(canvas,'pointerleave',()=>{mouse=null;});
for(const type of ['pointerup','pointercancel','lostpointercapture'])on(canvas,type,event=>{if(joy?.id===event.pointerId){joy=null;axes={forward:0,sideways:0};stick.hidden=true;}if(look?.id===event.pointerId)look=null;});
activitySync=createC118ActivitySync({embedded:window.parent!==window,bridge:window.campusActivity,onState:state=>{
  paused=state.paused;document.querySelector('#hall-pause').hidden=!paused;
  try{screenControl=normalizeC118Screen(state.c118Screen);}catch{/* Keep the last valid programme during malformed updates. */}
  const previousFloodId=floodEvent?.id,hadFlood=Boolean(floodEvent);
  try{floodEvent=normalizeC118Flood(state.c118Flood);}catch{floodEvent=null;}
  if(previousFloodId&&floodEvent&&previousFloodId!==floodEvent.id){floodEffect?.update({active:false,elapsed:0});floodSensory?.update({active:false});resetFloodView();}
  if(!floodEvent){floodRunning=false;floodEffect?.update({active:false,elapsed:0});floodSensory?.update({active:false});floodStatus.hidden=true;if(hadFlood)resetFloodView();}
  else if(Number.isFinite(state.serverTime))floodRunning=getC118FloodElapsed(floodEvent,state.serverTime)>=0;
  // Apply pause/flood gates before a host selection can start a media request.
  // The initial bridge callback may run before activitySync is assigned.
  if(!usable()||floodRunning)screenPlayer?.update({active:false,visible:screenInView});
  if(screenControl)screenPlayer?.selectMedia(screenControl);
  screenPlayer?.update({active:usable()&&!floodRunning,visible:screenInView});
  if(paused){resetInput();lock.release();floodSensory?.update({active:false});}
  if(state.disposed)dispose();
}});
function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);resetInput();lock.dispose();listeners.forEach(fn=>fn());activitySync?.dispose();floodSensory?.dispose();floodEffect?.dispose();screenPlayer?.dispose();audience?.dispose();interior?.dispose();renderer?.dispose();}
on(window,'pagehide',dispose);
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:devicePixelRatio<=1.5,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#26272c');
  const camera=new THREE.PerspectiveCamera(65,1,.07,90);camera.rotation.order='YXZ';
  interior=createOptoC118Interior(THREE);scene.add(interior.group);motion=createC118Navigation(interior);
  seating=createC118Seating(interior.plan);audience=createC118Audience(THREE,{plan:interior.plan});scene.add(audience.group);
  floodEffect=createC118FloodEffect(THREE,{plan:interior.plan});scene.add(floodEffect.group);
  floodSensory=createC118FloodSensory({document,window});
  swimming=createC118Swimming(interior.plan);
  const underwaterFog=new THREE.FogExp2('#287484',.025);
  const timeLabel=seconds=>{const whole=Math.max(0,Math.floor(seconds));return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;};
  screenPlayer=createC118VideoScreen(THREE,{screen:interior.videoScreen,onState:s=>{
    document.querySelector('#screen-title').textContent=s.title||'Vibe Coding 成果展示';
    document.querySelector('#screen-time').textContent=`${timeLabel(s.time)} / ${timeLabel(s.duration)}`;
    document.querySelector('#screen-play').textContent=s.failed?'重试播放':s.blocked?'播放':s.userPaused?'继续播放':'暂停';
    const sound=document.querySelector('#screen-sound');sound.textContent=s.muted?'开启声音':'关闭声音';sound.setAttribute('aria-pressed',String(!s.muted));
    document.querySelector('#screen-status').textContent=s.failed?'视频暂时无法播放，可重试':!s.active?'播放已暂停':s.userPaused?'已暂停':!s.visible?'面向大屏时继续播放':s.blocked?'点击播放开始观看':s.loading?'视频缓冲中，可继续走动':s.muted?'静音播放 · 可开启声音':'正在播放';
    canvas.dataset.videoState=s.failed?'error':s.playing?'playing':s.loading?'loading':'paused';
    canvas.dataset.mediaId=s.mediaId||'vibe-coding';
  }});
  if(screenControl)screenPlayer.selectMedia(screenControl);
  for(const [id,action] of [['screen-play','togglePlayback'],['screen-sound','toggleSound'],['screen-restart','restart']])on(document.querySelector(`#${id}`),'click',event=>{screenPlayer[action]();if(event.detail>0)canvas.focus({preventScroll:true});});
  const screenFrustum=new THREE.Frustum(),projectionView=new THREE.Matrix4();
  const requestedView=new URLSearchParams(location.search).get('view'),start=interior.viewpoints[requestedView]||interior.spawn;
  if(start!==interior.spawn)motion.placeWalker(start);
  heading=start.yaw??0;pitch=start.pitch??0;
  const seatStatus=document.querySelector('#seat-status'),seatEnter=document.querySelector('#seat-enter'),seatRise=document.querySelector('#seat-rise'),seatFace=document.querySelector('#seat-face'),seatLook=document.querySelector('#seat-look');
  function updateSeatControls(){
    seatEnter.hidden=Boolean(seatedSeat);seatRise.hidden=!seatedSeat;seatFace.hidden=!seatedSeat||cinema;seatLook.hidden=!seatedSeat||!cinema;
    document.querySelector('#hall-seating-controls').hidden=swimming.state.active;
    document.querySelector('#hall-swim-controls').hidden=!swimming.state.active;
    document.body.dataset.cinema=String(cinema);document.body.dataset.swimming=String(swimming.state.active);
    seatStatus.textContent=seatedSeat?`${seatedSeat.label} · ${cinema?'沉浸观影':'已入座'}`:'入座，欣赏舞台与大屏';
    document.querySelector('#hall-input-hint').textContent=swimming.state.active?'WASD 游动 · 空格上浮 · C 下潜 · 可潜到侧门游出':seatedSeat?'鼠标或右侧滑动环视 · E 起身 · 看大屏':'WASD 移动 · E 就近入座 · 鼠标环视 · L 锁定';
    canvas.dataset.seated=String(Boolean(seatedSeat));canvas.dataset.seatId=seatedSeat?.id||'';
    audience.setHiddenSeat(seatedSeat?.id||null);
  }
  function startSeatTransition(){seatTransition={at:performance.now(),position:camera.position.clone(),yaw:camera.rotation.y,pitch:camera.rotation.x,fov:camera.fov};}
  enterSeat=(nearby=false)=>{
    if(!usable()||seatedSeat||swimming.state.active||floodRunning)return;
    const seat=(nearby&&seating.nearest(motion.state))||seating.recommendedSeat;if(!seat)return;
    beforeSeatPose={...motion.state,yaw:heading,pitch};startSeatTransition();
    seatedSeat=seat;seatView=seating.viewFor(seat.id);cinemaView=seating.focusViewFor(seat.id);cinema=true;heading=0;pitch=0;
    resetInput();updateSeatControls();canvas.focus({preventScroll:true});
  };
  riseFromSeat=()=>{
    if(!usable()||!seatedSeat)return;
    const close=beforeSeatPose&&Math.hypot(beforeSeatPose.x-seatedSeat.x,beforeSeatPose.z-seatedSeat.z)<3;
    const pose=seating.exitPoseFor(seatedSeat.id,close?beforeSeatPose:undefined),result=pose&&motion.placeWalker(pose);
    if(!result?.ok){seatStatus.textContent='这侧暂时无法起身，请回看舞台后重试';return;}
    startSeatTransition();seatedSeat=seatView=cinemaView=null;cinema=false;heading=pose.yaw??heading;pitch=pose.pitch??0;
    eyeY=motion.state.y+1.65;resetInput();updateSeatControls();canvas.focus({preventScroll:true});
  };
  faceStage=()=>{if(!usable()||!seatedSeat||floodRunning)return;startSeatTransition();cinema=true;heading=pitch=0;resetInput();updateSeatControls();canvas.focus({preventScroll:true});};
  function lookAround(){if(!seatedSeat||!cinema)return;startSeatTransition();cinema=false;heading=seatView.yaw;pitch=seatView.pitch;resetInput();updateSeatControls();canvas.focus({preventScroll:true});}
  on(seatEnter,'click',()=>enterSeat(false));on(seatRise,'click',riseFromSeat);on(seatFace,'click',faceStage);on(seatLook,'click',()=>{if(usable())lookAround();});updateSeatControls();
  for(const [id,direction] of [['swim-up',1],['swim-down',-1]]){
    const button=document.querySelector(`#${id}`);
    on(button,'pointerdown',event=>{if(!usable()||!swimming.state.active)return;event.preventDefault();button.setPointerCapture(event.pointerId);swimVertical=direction;});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])on(button,type,()=>{if(swimVertical===direction)swimVertical=0;canvas.focus({preventScroll:true});});
    on(button,'keydown',event=>{if(usable()&&swimming.state.active&&['Space','Enter'].includes(event.code)){event.preventDefault();swimVertical=direction;}});
    on(button,'keyup',()=>{swimVertical=0;});on(button,'blur',()=>{swimVertical=0;});
  }
  const fill=new THREE.DirectionalLight('#ffedd5',.7);fill.position.set(-5,10,-8);scene.add(fill);
  // Visible ceiling strips belong to the model; broad fill avoids hundreds of
  // dynamic point lights and their draw cost on event participants' phones.
  function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
  on(window,'resize',resize);resize();
  resetFloodView=()=>{
    swimming.reset();resetInput();
    if(floodReturn){
      const saved=floodReturn;floodReturn=null;seatedSeat=seating.getSeat(saved.seatId);seatView=seatedSeat?seating.viewFor(seatedSeat.id):null;
      cinemaView=seatedSeat?seating.focusViewFor(seatedSeat.id):null;cinema=Boolean(seatedSeat&&saved.cinema);heading=saved.heading;pitch=saved.pitch;
      motion.placeWalker(saved.pose);eyeY=motion.state.y+1.65;seatTransition=null;
    }
    updateSeatControls();audience.update?.({time:(activitySync?.now()??Date.now())/1000,elapsed:null,active:true,reducedMotion:reducedMotion.matches});
    scene.fog=null;document.querySelector('#hall-screen-controls').hidden=false;
    canvas.dataset.floodEvent='';canvas.dataset.floodElapsed='';canvas.dataset.waterHeight='-10.00';
    // A host reset must also clear the frozen water frame during a global pause.
    if(paused&&!document.hidden&&!disposed){
      const view=cinema?cinemaView:seatView;
      camera.position.set(view?.x??motion.state.x,view?.y??motion.state.y+1.65,view?.z??motion.state.z);camera.rotation.set(pitch,heading,0);
      camera.fov=cinema?c118CinemaFov(cinemaView,camera.aspect):seatedSeat?c118SeatedFov(seatView,camera.aspect):65;camera.updateProjectionMatrix();
      renderer.render(scene,camera);
    }
  };
  let eyeY=motion.state.y+1.65,frame=0,ready=false;
  function render(now){
    if(disposed)return;raf=requestAnimationFrame(render);const dt=Math.min(.05,Math.max(0,(now-previous)/1000));previous=now;
    if(!usable())return;
    const serverNow=activitySync.now(),floodElapsed=getC118FloodElapsed(floodEvent,serverNow);
    floodRunning=floodElapsed!==null&&floodElapsed>=0;
    if(floodRunning&&!floodReturn)floodReturn={seatId:seatedSeat?.id,cinema,heading,pitch,pose:{...motion.state}};
    if(floodRunning&&cinema)lookAround();
    if(floodRunning&&!swimming.state.active){
      const body=seatView||{x:motion.state.x,y:motion.state.y+1.65,z:motion.state.z};
      if(floodEffect.sampleAt(body,floodElapsed).waterY>=body.y-.55){
        swimming.enter(body);seatedSeat=seatView=cinemaView=null;cinema=false;seatTransition=null;pitch=Math.min(pitch,.05);resetInput();updateSeatControls();
      }
    }
    const pressed=(...codes)=>codes.some(code=>keys.has(code));
    let forward=axes.forward+Number(pressed('KeyW','ArrowUp'))-Number(pressed('KeyS','ArrowDown')),sideways=axes.sideways+Number(pressed('KeyD','ArrowRight'))-Number(pressed('KeyA','ArrowLeft'));
    const pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected);
    if(pad&&!cinema){const dead=v=>Math.abs(v)>.16?v:0;sideways+=dead(pad.axes[0]||0);forward-=dead(pad.axes[1]||0);heading-=dead(pad.axes[2]||0)*dt*1.8;pitch=Math.max(-1.35,Math.min(1.3,pitch-dead(pad.axes[3]||0)*dt*1.5));}
    if(swimming.state.active){
      const direction=indoorMovement(heading,forward,sideways);
      swimming.step(dt,{moveX:direction.moveX,moveZ:direction.moveZ,vertical:swimVertical+Number(Boolean(pressed('Space')||pad?.buttons[0]?.pressed))-Number(Boolean(pressed('KeyC','ControlLeft','ControlRight')||pad?.buttons[1]?.pressed)),elapsed:floodElapsed,reducedMotion:reducedMotion.matches});
      if(swimming.state.exitDoorId){exit();return;}
    }else if(!seatedSeat)motion.step(dt,{...indoorMovement(heading,forward,sideways),fast:pressed('ShiftLeft','ShiftRight')});
    if(!swimming.state.active&&crossedC118Door(interior.plan,motion.state)){exit();return;}
    eyeY=THREE.MathUtils.damp(eyeY,motion.state.y+1.65,16,dt);
    const view=swimming.state.active?swimming.state:cinema?cinemaView:seatView;
    camera.position.set(view?.x??motion.state.x,view?.y??eyeY,view?.z??motion.state.z);camera.rotation.set(pitch,heading,0);
    let desiredFov=cinema?c118CinemaFov(cinemaView,camera.aspect):seatedSeat?c118SeatedFov(seatView,camera.aspect):65;
    if(seatTransition){
      const raw=Math.min(1,Math.max(0,(now-seatTransition.at)/550)),a=raw*raw*(3-2*raw),target=camera.position.clone();
      camera.position.copy(seatTransition.position).lerp(target,a);
      const angle=Math.atan2(Math.sin(heading-seatTransition.yaw),Math.cos(heading-seatTransition.yaw));
      camera.rotation.set(THREE.MathUtils.lerp(seatTransition.pitch,pitch,a),seatTransition.yaw+angle*a,0);
      desiredFov=THREE.MathUtils.lerp(seatTransition.fov,desiredFov,a);if(raw>=1)seatTransition=null;
    }
    if(Math.abs(camera.fov-desiredFov)>.01){camera.fov=desiredFov;camera.updateProjectionMatrix();}
    audience.update?.({time:floodEvent?floodEvent.startAt/1000+floodElapsed:serverNow/1000,elapsed:floodElapsed,active:true,reducedMotion:reducedMotion.matches});
    floodEffect.update({active:floodRunning,elapsed:floodElapsed??0,reducedMotion:reducedMotion.matches});
    const floodSample=floodRunning?floodEffect.sampleAt(camera.position,floodElapsed):{waterY:-10,impact:0};
    const depth=floodSample.waterY-camera.position.y;
    if(floodRunning&&!reducedMotion.matches){
      const t=floodElapsed,hit=floodSample.impact||0,bob=depth>-.2?.018:0;
      camera.position.x+=hit*.10*Math.sin(t*24.1);camera.position.y+=hit*.075*Math.sin(t*31.7)+bob*Math.sin(t*2.1);
      camera.rotation.x+=hit*.055*Math.sin(t*19.3);camera.rotation.z=hit*.065*Math.sin(t*15.7)+bob*.25*Math.sin(t*1.7);
    }
    floodSensory.update({active:floodRunning,elapsed:floodElapsed??0,waterDepth:depth,impact:floodSample.impact||0,reducedMotion:reducedMotion.matches});
    scene.fog=floodRunning&&depth>.05?underwaterFog:null;
    if(scene.fog)underwaterFog.density=Math.min(.045,.018+depth*.004);
    floodStatus.hidden=!floodEvent;
    if(floodEvent){
      const message=floodElapsed<0?'门外传来低沉的轰鸣…':floodElapsed<3?'海浪正在冲破门口':floodElapsed<10?'海水猛烈涌入报告厅':floodElapsed<18?'水位正在迅速上涨':'急流持续翻涌';
      if(floodStatus.firstElementChild.textContent!==message)floodStatus.firstElementChild.textContent=message;
      floodStatus.lastElementChild.textContent=swimming.state.active?'WASD 游动 · 空格上浮 · C 下潜':'点击画面开启音效 · 海水上涨后可游泳';
    }
    if(swimming.state.active)document.querySelector('#swim-depth').textContent=depth>.2?`水下 ${depth.toFixed(1)} 米`:'水面 · 可下潜';
    canvas.dataset.swimming=String(swimming.state.active);canvas.dataset.cinema=String(cinema);
    document.querySelector('#hall-screen-controls').hidden=floodRunning;
    canvas.dataset.floodEvent=floodEvent?.id||'';canvas.dataset.floodElapsed=floodElapsed===null?'':floodElapsed.toFixed(2);canvas.dataset.waterHeight=String(floodSample.waterY.toFixed(2));
    camera.updateMatrixWorld();projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);screenFrustum.setFromProjectionMatrix(projectionView);
    screenInView=camera.position.z>interior.videoScreen.position.z&&screenFrustum.intersectsObject(interior.videoScreen);
    if(ready)screenPlayer.update({active:usable()&&!floodRunning,visible:screenInView});
    interior.update?.(camera);
    renderer.render(scene,camera);
    if(!ready){ready=true;status.hidden=true;window.campusActivity?.ready('runtime_ready');canvas.focus({preventScroll:true});}
    if(++frame%20===0){canvas.dataset.position=JSON.stringify({x:camera.position.x,y:camera.position.y,z:camera.position.z});canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);canvas.dataset.audienceWalking=String(audience.group.userData.walkingCount||0);canvas.dataset.audienceSwimming=String(audience.group.userData.swimmingCount||0);canvas.dataset.audienceDiving=String(audience.group.userData.divingCount||0);}
  }
  raf=requestAnimationFrame(render);
}catch(error){status.hidden=false;status.textContent=`报告厅加载失败：${error.message}，可返回校园后重试。`;window.campusActivity?.fail(error.message);}
