import * as THREE from 'three';
import {createOptoC118Interior} from './opto-c118-interior.js';
import {createC118Navigation,indoorMovement,crossedC118Door} from './c118-navigation.js';
import {createPlayerPointerLock} from './player-pointer-lock.js';
import {createC118VideoScreen} from './c118-video-screen.js';
import './c118-viewer.css';

const canvas=document.querySelector('#hall-canvas'),status=document.querySelector('#hall-status'),stick=document.querySelector('#hall-stick');
let renderer,interior,motion,screenPlayer,raf,screenInView=false,disposed=false,paused=false,returning=false,previous=0,heading=0,pitch=0,joy=null,look=null,mouse=null,axes={forward:0,sideways:0};
const keys=new Set(),listeners=[];
const on=(target,type,fn,options)=>{target.addEventListener(type,fn,options);listeners.push(()=>target.removeEventListener(type,fn,options));};
const usable=()=>!disposed&&!paused&&!returning&&!document.hidden;
const lock=createPlayerPointerLock({canvas,document,canLock:usable,onChange:()=>resetInput(),onError:()=>{status.hidden=false;status.textContent='可直接移动鼠标环视，或在浏览器中按 L 锁定';}});
function resetInput(){keys.clear();joy=look=mouse=null;axes={forward:0,sideways:0};stick.hidden=true;motion?.suspend();}
function rotate(dx,dy,scale=.0025){heading-=Math.max(-250,Math.min(250,dx))*scale;pitch=Math.max(-1.35,Math.min(1.3,pitch-dy*scale));}
function exit(){if(paused||returning)return;returning=true;screenPlayer?.update({active:false,visible:false});resetInput();lock.release();if(window.parent!==window&&window.campusActivity)window.campusActivity.exit();else location.href='./';}
on(document.querySelector('#hall-return'),'click',event=>{event.preventDefault();exit();});
on(window,'keydown',event=>{if(!usable()||event.target.closest?.('a,button,input'))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(event.code)){event.preventDefault();keys.add(event.code);}if(event.code==='KeyL'&&!event.repeat){event.preventDefault();lock.toggle();}});
on(window,'keyup',event=>keys.delete(event.code));
on(window,'blur',resetInput);on(document,'visibilitychange',()=>{resetInput();screenPlayer?.update({active:usable(),visible:screenInView});});
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
const unsubscribe=window.campusActivity?.subscribe(state=>{paused=state.paused;document.querySelector('#hall-pause').hidden=!paused;screenPlayer?.update({active:usable(),visible:screenInView});if(paused){resetInput();lock.release();}if(state.disposed)dispose();});
function dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);resetInput();lock.dispose();listeners.forEach(fn=>fn());unsubscribe?.();screenPlayer?.dispose();interior?.dispose();renderer?.dispose();}
on(window,'pagehide',dispose);
try{
  renderer=new THREE.WebGLRenderer({canvas,antialias:devicePixelRatio<=1.5,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#26272c');
  const camera=new THREE.PerspectiveCamera(65,1,.07,90);camera.rotation.order='YXZ';
  interior=createOptoC118Interior(THREE);scene.add(interior.group);motion=createC118Navigation(interior);
  const timeLabel=seconds=>`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
  screenPlayer=createC118VideoScreen(THREE,{screen:interior.videoScreen,onState:s=>{
    document.querySelector('#screen-time').textContent=`${timeLabel(s.time)} / ${timeLabel(s.duration)}`;
    document.querySelector('#screen-play').textContent=s.failed?'重试播放':s.blocked?'播放':s.userPaused?'继续播放':'暂停';
    const sound=document.querySelector('#screen-sound');sound.textContent=s.muted?'开启声音':'关闭声音';sound.setAttribute('aria-pressed',String(!s.muted));
    document.querySelector('#screen-status').textContent=s.failed?'视频暂时无法播放，可重试':!s.active?'播放已暂停':s.userPaused?'已暂停':!s.visible?'面向大屏时继续播放':s.blocked?'点击播放开始观看':s.loading?'视频缓冲中，可继续走动':s.muted?'静音播放 · 可开启背景音乐':'正在播放';
    canvas.dataset.videoState=s.failed?'error':s.playing?'playing':s.loading?'loading':'paused';
  }});
  for(const [id,action] of [['screen-play','togglePlayback'],['screen-sound','toggleSound'],['screen-restart','restart']])on(document.querySelector(`#${id}`),'click',event=>{screenPlayer[action]();if(event.detail>0)canvas.focus({preventScroll:true});});
  const screenFrustum=new THREE.Frustum(),projectionView=new THREE.Matrix4();
  const requestedView=new URLSearchParams(location.search).get('view'),start=interior.viewpoints[requestedView]||interior.spawn;
  if(start!==interior.spawn)motion.placeWalker(start);
  heading=start.yaw??0;pitch=start.pitch??0;
  const fill=new THREE.DirectionalLight('#ffedd5',.7);fill.position.set(-5,10,-8);scene.add(fill);
  // Visible ceiling strips belong to the model; broad fill avoids hundreds of
  // dynamic point lights and their draw cost on event participants' phones.
  function resize(){renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();}
  on(window,'resize',resize);resize();
  let eyeY=motion.state.y+1.65,frame=0,ready=false;
  function render(now){
    if(disposed)return;raf=requestAnimationFrame(render);const dt=Math.min(.05,Math.max(0,(now-previous)/1000));previous=now;
    if(!usable())return;
    const pressed=(...codes)=>codes.some(code=>keys.has(code));
    let forward=axes.forward+Number(pressed('KeyW','ArrowUp'))-Number(pressed('KeyS','ArrowDown')),sideways=axes.sideways+Number(pressed('KeyD','ArrowRight'))-Number(pressed('KeyA','ArrowLeft'));
    const pad=Array.from(navigator.getGamepads?.()||[]).find(p=>p?.connected);
    if(pad){const dead=v=>Math.abs(v)>.16?v:0;sideways+=dead(pad.axes[0]||0);forward-=dead(pad.axes[1]||0);heading-=dead(pad.axes[2]||0)*dt*1.8;pitch=Math.max(-1.35,Math.min(1.3,pitch-dead(pad.axes[3]||0)*dt*1.5));}
    motion.step(dt,{...indoorMovement(heading,forward,sideways),fast:pressed('ShiftLeft','ShiftRight')});
    if(crossedC118Door(interior.plan,motion.state)){exit();return;}
    eyeY=THREE.MathUtils.damp(eyeY,motion.state.y+1.65,16,dt);camera.position.set(motion.state.x,eyeY,motion.state.z);camera.rotation.set(pitch,heading,0);
    camera.updateMatrixWorld();projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);screenFrustum.setFromProjectionMatrix(projectionView);
    screenInView=camera.position.z>interior.videoScreen.position.z&&screenFrustum.intersectsObject(interior.videoScreen);
    if(ready)screenPlayer.update({active:usable(),visible:screenInView});
    interior.update?.(camera);
    renderer.render(scene,camera);
    if(!ready){ready=true;status.hidden=true;window.campusActivity?.ready('runtime_ready');canvas.focus({preventScroll:true});}
    if(++frame%20===0){canvas.dataset.position=JSON.stringify({x:motion.state.x,y:motion.state.y,z:motion.state.z});canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.triangles=String(renderer.info.render.triangles);}
  }
  raf=requestAnimationFrame(render);
}catch(error){status.hidden=false;status.textContent=`报告厅加载失败：${error.message}，可返回校园后重试。`;window.campusActivity?.fail(error.message);}
