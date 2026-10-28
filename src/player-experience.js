import {planCanteenBoundary} from './yunyuan-canteen.js';
import { installHoverboardReferences } from './hoverboard-references.js';
import { installRoadsterReferences } from './roadster-references.js';
import { createPlayerMotion } from './player-motion.js';
import { createPlayerModels } from './player-models.js';
import { createWebSwingAudio } from './web-swing-audio.js';
import { createVehicleCameraRig, createTraversalCameraRig } from './player-camera.js';
import { getBuildingProfile } from './building-profiles.js';
import { getReconstructionBuildings } from './campus-feature-selection.js';
import { createPlayerPointerLock } from './player-pointer-lock.js';
import { createWorldTransport } from './world-transport.js';
import { createTransportInteraction } from './transport-interaction.js';

// Keep the spawn relative to the model's projected entrance, not a GIS origin
// or the separate dorm-to-class traffic route. Leave room for all vehicle sizes.
export function getCampusPlayerSpawn(model) {
  const canteen=model.buildings.find(record=>record.id==='way/103814566');
  const entrance=canteen&&planCanteenBoundary(canteen)?.adjacent;
  if(!entrance)return null;
  const [a,b]=entrance.points,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
  const tx=dx/length,tz=dz/length,nx=-tz,nz=tx;
  return {x:a.x+tx*2.4+nx*10,z:a.z+tz*2.4+nz*10,yaw:Math.atan2(nx,nz)};
}

// Collision footprints use the same projection and height estimates as the scene.
export function createPlayerWorld(model,{movableParking=false}={}) {
  const polygons = records => records.flatMap(record => (record.shapes || []).map(shape => ({
    id:record.id, surfaceY:record.mesh?.position.y??.022,
    rings: record.id==='way/103814566' ? [planCanteenBoundary(record).boundary.map(p=>({...p}))] : [shape, ...shape.holes].map(r => r.getPoints().map(p => ({ x:p.x, z:-p.y }))),
    height: record.category === 'building' ? getBuildingProfile(record.feature).height + .065 : 0,
    minHeight: record.category === 'building' ? getBuildingProfile(record.feature).baseHeight + .065 : 0,
  })));
  const architecture=model.architectureInfrastructure||{},sports=model.sportsInfrastructure||{},parking=model.parkingInfrastructure||{};
  const replacedBuildings=new Set([...(sports.replacedBuildingIds||[]),...(architecture.replacedBuildingIds||[])]);
  return { buildings:[...polygons(getReconstructionBuildings(model).filter(record=>!replacedBuildings.has(record.id))),...(architecture.buildings||[])], water:polygons(model.water), bounds:{...model.bounds}, barriers:[...(sports.barriers||[]),...(architecture.barriers||[]),...(parking.barriers||[]).filter(b=>!movableParking||!String(b.id).startsWith('parked-east-nine-'))], walkSurfaces:[...(sports.walkSurfaces||[]),...(architecture.walkSurfaces||[])] };
}

export function createPlayerExperience({ THREE, scene, camera, controls, canvas, route, simulation,
  model, onEnter, notify, invalidate, scooterTransport, transportSources }) {
  const $ = id => document.getElementById(id), world = createPlayerWorld(model,{movableParking:!!scooterTransport});
  const updateElement = (id, properties) => {
    const element = $(id);
    if (element) Object.assign(element, properties);
  };
  const motion = createPlayerMotion({route,world,traffic:()=>scooterTransport?[...simulation.agents,...scooterTransport.parkedAgents]:simulation.agents,getPoseAt:simulation.getPoseAt});
  const spawnPose = getCampusPlayerSpawn(model);
  const models = createPlayerModels(THREE), spiderCamera=createTraversalCameraRig(), vehicleCamera=createVehicleCameraRig(), webAudio=createWebSwingAudio();
  const disposeReferences=installRoadsterReferences(),disposeHoverboardReferences=installHoverboardReferences();
  scene.add(models.group); models.group.visible = false;
  const worldTransport=scooterTransport?createWorldTransport({THREE,scene,model,route,simulation,playerModels:models,groundAt:motion.groundAt,canPlaceMode:motion.canPlaceMode}):null;
  const interaction=worldTransport||transportSources?createTransportInteraction({motion,sources:transportSources||[worldTransport,scooterTransport],notify,onChange:mode=>{if(mode==='scooter')models.setScooterAppearance(interaction.mounted.item.appearance);enter(mode);}}):null;
  const keys = new Set(), held = new Set(), pulses = new Map(), listeners = [];
  let active=false, suspended=false, initialized=false, view='third', yawOffset=0, pitch=.25, distance, drag=null, mouseLook=null,
    cruise=false, liftTarget=null, landing=false, uiElapsed=0, savedNear=camera.near, savedFov=camera.fov, disposed=false, immersive=true, driveImmersive=true, suitView=false, lookHold=0, manualPitch=false, steeringSideways=false, suitAngle=0, suitPitch=.03, suitDistance=3.15;
  const aimPosition=new THREE.Vector3();
  let comfortableCamera=!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let lookSensitivity=1,escapeReleaseUntil=0;
  const followPosition = new THREE.Vector3(), lookTarget = new THREE.Vector3();
  const modeNames={walk:'步行探索',scooter:'电动车骑行',helicopter:'直升机探索',roadster:'特斯拉 · 喷气跑车',hoverboard:'电动飞行器',spider:'蜘蛛侠 · 蛛丝摆荡',boat:'湖上游艇'};
  const codes=new Set(['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyQ','KeyE','KeyF','KeyX','KeyG','KeyT','Space','ShiftLeft','ShiftRight','KeyV','KeyC','KeyL','Escape']);
  // Pause guards every event entry point, including optional host/touch controls.
  const actionEvents=new Set(['keydown','pointerenter','pointerdown','pointermove','mousedown','mousemove','wheel','click','input','change']);
  const on=(el,type,fn,options)=>{if(!el)return;const handler=e=>{if(suspended&&actionEvents.has(type))return;return fn(e);};el.addEventListener(type,handler,options);listeners.push(()=>el.removeEventListener(type,handler,options));};
  const editing=target=>target?.closest?.('input,select,textarea,[contenteditable="true"],dialog[open]');
  const inputBlocked=()=>suspended||document.hidden||!!document.querySelector('dialog[open]');
  const pointerLock=createPlayerPointerLock({canvas,document,canLock:()=>active&&!disposed&&!inputBlocked(),
    onChange(locked){clearInput();if(!locked)escapeReleaseUntil=performance.now()+300;updateUI();invalidate();},
    onError(){notify(pointerLock.supported?'暂未锁定鼠标：请先点一下游戏画面，再按 L；仍可直接移动鼠标环视。':'当前浏览器不支持鼠标锁定，仍可移动鼠标环视；在 Chrome 中打开此预览可使用锁定。');},
  });
  function clearInput(){if(!suspended)motion.clearActionInputs?.();keys.clear();held.clear();pulses.clear();cruise=false;liftTarget=null;landing=false;drag=null;mouseLook=null;held.delete('mouse-swing');webAudio.setActive(false);}
  function recenter(preserveVehicleCamera=false,smooth=false){mouseLook=null;yawOffset=0;pitch=view==='first'?.04:motion.state.mode==='spider'?.18:motion.state.mode==='hoverboard'?.12:motion.state.mode==='roadster'?.15:.25;distance=undefined;manualPitch=false;lookHold=0;spiderCamera.reset(motion.state);if(smooth)vehicleCamera.recenter(motion.state);else if(!preserveVehicleCamera)vehicleCamera.reset(motion.state,motion.state.yaw);}
  function setImmersive(value){immersive=!!value;document.body.classList.toggle('spider-immersive',active&&motion.state.mode==='spider'&&immersive);document.body.classList.toggle('drive-immersive',active&&['roadster','hoverboard'].includes(motion.state.mode)&&driveImmersive);window.dispatchEvent(new Event('resize'));}
  function stopSuitView(){if(!suitView)return;suitView=false;recenter();updateUI();}
  function queueJump(){const s=motion.state;const freeAir=!['approach','perch'].includes(s.pointPhase)&&!s.grounded&&!s.anchor&&!s.wallContact&&s.airTime>.12;pulses.set(freeAir?'zip':'jump',.12);}
  function cameraFrame(dt,snap=false){
    const spider=motion.state.mode==='spider';
    const cameraState=suitView?{...motion.state,vx:0,vz:0,speed:0,verticalSpeed:0,grounded:true,anchor:null,candidateAnchor:null,lean:0,zipActive:false,diving:false,pointPhase:'idle',pointTarget:null,trickActive:false,trickBlend:0}:motion.state;
    const desired=spider?spiderCamera.update(cameraState,dt,{view,snap,world,groundAt:motion.groundAt,
      lookLocked:pointerLock.locked||lookHold>0||!!drag||!!mouseLook?.looking||steeringSideways||suitView,comfortable:comfortableCamera,
      heading:suitView?suitAngle:undefined,
      pitch:suitView?suitPitch:(manualPitch||view==='first'?pitch:undefined),distance:suitView?suitDistance:distance
    }):vehicleCamera.update(motion.state,dt,{view,snap,world,groundAt:motion.groundAt,lookLocked:pointerLock.locked||lookHold>0||!!drag||!!mouseLook?.looking,comfortable:comfortableCamera,pitch:manualPitch||view==='first'?pitch:undefined,distance,baseFov:motion.state.mode==='roadster'?58:undefined});
    followPosition.set(desired.position.x,desired.position.y,desired.position.z);
    lookTarget.set(desired.target.x,desired.target.y,desired.target.z);
    camera.position.copy(followPosition);controls.target.copy(lookTarget);camera.lookAt(lookTarget);
    if(!spider)models.group.visible=active&&view==='third'&&!(['roadster','hoverboard'].includes(motion.state.mode)&&desired.transitioning);
    if(spider&&desired.roll)camera.rotateZ(desired.roll);
    const targetFov=spider?(suitView?45:desired.fov??58):(desired.fov??savedFov);
    const nextFov=targetFov;
    if(Math.abs(nextFov-camera.fov)>.005){camera.fov=nextFov;camera.updateProjectionMatrix();}
    if(spider){
      camera.updateMatrixWorld();
      const anchor=motion.state.anchor||(motion.state.zipActive?motion.state.zipAnchors?.[0]:null)||motion.state.candidateAnchor;
      $('web-aim').hidden=!anchor||suitView;
      if(anchor){aimPosition.set(anchor.x,anchor.y,anchor.z).project(camera);const width=canvas.clientWidth,height=canvas.clientHeight;
        $('web-aim').hidden=suitView||aimPosition.z>1||aimPosition.z< -1||Math.abs(aimPosition.x)>.94||Math.abs(aimPosition.y)>.92;
        $('web-aim').style.left=`${(aimPosition.x*.5+.5)*width}px`;$('web-aim').style.top=`${(-aimPosition.y*.5+.5)*height}px`;
        $('web-aim').dataset.attached=String(!!motion.state.anchor);
      }
      const pointBusy=['approach','perch'].includes(motion.state.pointPhase),point=pointBusy?motion.state.pointTarget:motion.state.candidatePoint;
      const marker=$('web-point-aim');marker.hidden=!point||suitView;
      if(point){aimPosition.set(point.x,point.y,point.z).project(camera);
        marker.hidden=suitView||aimPosition.z>1||aimPosition.z< -1||Math.abs(aimPosition.x)>.94||Math.abs(aimPosition.y)>.92;
        marker.style.left=`${(aimPosition.x*.5+.5)*canvas.clientWidth}px`;marker.style.top=`${(-aimPosition.y*.5+.5)*canvas.clientHeight}px`;
        marker.dataset.committed=String(pointBusy);
      }
      $('web-speed-shade').style.opacity=suitView||comfortableCamera?'0':String(Math.min(.6,Math.max(0,(Math.hypot(motion.state.speed,motion.state.diving?motion.state.verticalSpeed:0)-9)/40)));
    }
    controls.dispatchEvent({type:'change'});
  }
  function setView(next){if(suspended)return;if(next===view){if(active)canvas.focus({preventScroll:true});return;}if(next==='first')suitView=false;view=next;recenter(true);camera.near=view==='first'?.06:.12;camera.updateProjectionMatrix();models.group.visible=active&&(view==='third'||motion.state.mode==='spider');updateUI();if(active){cameraFrame(0,true);canvas.focus({preventScroll:true});}}
  function updateUI(){
    const s=motion.state,spider=s.mode==='spider';
    document.querySelectorAll('[data-player-mode]').forEach(button=>{
      button.setAttribute('aria-pressed',String(active&&button.dataset.playerMode===s.mode));
    });
    updateElement('player-mode-label',{textContent:modeNames[s.mode]});
    updateElement('pointer-lock-hint',{hidden:!active||!pointerLock.locked});
    updateElement('player-look-reticle',{hidden:!active||!pointerLock.locked});
    $('viewport').classList.toggle('pointer-locked',active&&pointerLock.locked);
    const hud=$('player-hud');
    if(hud)Object.assign(hud.dataset,{
      pointerLockSupported:String(pointerLock.supported),pointerLocked:String(pointerLock.locked),
      mode:s.mode,view,inspect:String(suitView),suspended:String(suspended),
    });
    updateElement('web-target-status',{hidden:!active||!spider});
    updateElement('web-speed-shade',{hidden:!active||!spider});
    if(!active||!spider){
      updateElement('web-aim',{hidden:true});
      updateElement('web-point-aim',{hidden:true});
    }
    if(spider){
      const attached=!!s.anchor,ready=!!s.candidateAnchor;
      const pointBusy=['approach','perch'].includes(s.pointPhase);
      const releaseHint=attached?({entry:'接丝过渡',downswing:'下摆蓄速',bottom:'谷底 · 松丝前冲',upswing:'上摆 · 松丝腾高'}[s.swingPhase]||'松丝保留惯性'):'空格起跳 · E 接丝';
      const target=$('web-target-status');
      if(target)target.dataset.state=attached||s.zipActive?'attached':ready?'ready':'searching';
      let targetLabel=suitView?'移动鼠标环视':s.diving?'松开 X · E 接丝':s.zipActive?'蛛丝前冲 · WASD 控向':attached?`${releaseHint} · 松手后重按换点`:ready?'按 E / 左键挂丝':s.wallContact?'空格蹬墙跃出':s.grounded?'空格起跳 / WASD 移动后找挂点':'暂无可见挂点 · 调整方向后重按';
      if(!suitView&&pointBusy)targetLabel=s.pointPhase==='approach'?'接近屋沿时按空格弹射':'空格弹射 · E 接丝';
      else if(!suitView&&s.trickActive)targetLabel='松开 T 收招 · E 接丝';
      updateElement('web-target-label',{textContent:targetLabel});
    }
    const basics={
      walk:'WASD 移动 · Shift 快走',
      scooter:'WASD 骑行 · 空格刹车',
      roadster:'WASD 驾驶 · 按住 Q 喷气，松开下落',
      helicopter:'WASD 移动 · Q / E 升降 · 空格悬停',
      hoverboard:'WASD 移动 · Q / E 升降 · Shift 加速',
      spider:'WASD 控向 · 空格起跳\nE / 左键挂丝 · 松手后重按换点',
      boat:'WASD 航行 · 空格减速 · Shift 加速',
    };
    const escapeHint=pointerLock.locked?'Esc 释放，再按退出':'Esc 退出';
    const actionHint=!interaction?'':s.mode==='walk'?'靠近载具 / 战衣 · F 使用':s.mode==='spider'?'F 空中前冲 / 地面脱下战衣':s.mode==='boat'?'靠岸停稳 · F 下船':'停稳落地 · F 下车';
    updateElement('player-help',{textContent:`${basics[s.mode]}${actionHint?'\n'+actionHint:''}\n鼠标环视 · L 锁定 · V 切视角 · ${escapeHint}`});
    const nearby=active&&!suspended?interaction?.nearest():null;
    updateElement('transport-interact',{hidden:!nearby});
    updateElement('transport-interact-label',{textContent:nearby?`${nearby.item.mode==='spider'?'穿上':nearby.item.mode==='boat'?'登上':'驾驶'}${nearby.item.label}`:''});
    updateElement('resume-exploration',{hidden:active||suspended||!interaction});
  }
  function armRoadsterJet(){
    if(motion.state.mode!=='roadster')return false;
    if(!motion.state.flightEnabled){const result=motion.setFlightEnabled(true);if(result?.ok===false){notify(result.reason);return false;}}
    liftTarget=null;landing=false;return true;
  }
  function toggleFlight(){
    if(motion.state.mode!=='roadster')return;
    clearInput();const result=motion.setFlightEnabled(!motion.state.flightEnabled);
    if(result?.ok===false)notify(result.reason);
    updateUI();
  }
  function resetSpawn(mode=motion.state.mode){
    if(spawnPose){
      const placed=motion.placeWalker(spawnPose);
      return placed.ok?motion.setMode(mode):placed;
    }
    const spawn=motion.reset(0,mode);
    return {ok:spawn.mode===mode&&!spawn.blockedReason,reason:spawn.blockedReason};
  }
  function enter(mode){
    if(suspended)return {ok:false,reason:'活动已暂停'};
    if(!active){
      onEnter();
      if(!initialized){
        const spawn=resetSpawn(mode);
        if(!spawn.ok){notify(spawn.reason||'该位置没有足够净空');return;}
        initialized=true;
      }
      savedNear=camera.near;savedFov=camera.fov;
    }
    const result=motion.setMode(mode);
    if(result?.ok===false){notify(result.reason);return;}
    clearInput();active=true;suitView=false;controls.enabled=false;recenter();
    canvas.focus({preventScroll:true});$('player-hud').hidden=false;
    $('viewport').classList.add('playing');document.body.classList.toggle('campus-playing',!!interaction);$('viewport').classList.toggle('spider-playing',mode==='spider');$('viewport').classList.toggle('drive-playing',mode==='roadster'||mode==='hoverboard');setImmersive(immersive);models.group.visible=view==='third'||motion.state.mode==='spider';
    camera.near=view==='first'?.06:.12;camera.updateProjectionMatrix();
    models.update({...motion.state,view},0);cameraFrame(0,true);updateUI();invalidate();
  }
  function enterAt(pose){
    if(suspended)return {ok:false,reason:'活动已暂停'};
    const result=motion.placeWalker(pose);
    if(!result.ok)return result;
    initialized=true;view='first';enter('walk');
    if(Number.isFinite(pose.pitch)){pitch=Math.max(-.35,Math.min(.85,pose.pitch));manualPitch=true;cameraFrame(0,true);invalidate();}
    return result;
  }
  function exit(){
    if(!active)return;
    active=false;pointerLock.release();suitView=false;clearInput();setImmersive(immersive);motion.suspend?.();motion.state.speed=0;models.group.visible=false;
    controls.enabled=true;camera.near=savedNear;camera.fov=savedFov;camera.updateProjectionMatrix();
    // Clear OrbitControls' residual damping from before entering the player.
    controls.enableDamping=false;controls.update();controls.enableDamping=true;
    $('player-hud').hidden=true;document.body.classList.remove('campus-playing');$('viewport').classList.remove('playing','spider-playing','drive-playing');updateUI();invalidate();
  }
  on(window,'keydown',e=>{
    if(!active||e.metaKey||e.ctrlKey||e.altKey||editing(e.target)||inputBlocked()||!codes.has(e.code))return;
    // Ignore a key held across an administrative pause or focus loss.
    if(e.repeat&&!keys.has(e.code))return;
    // A focused toolbar/touch button owns Space; the canvas owns game actions.
    if(e.code==='Space'&&e.target?.closest?.('button'))return;
    e.preventDefault();
    if(suitView&&!['Escape','KeyV','KeyC'].includes(e.code))stopSuitView();
    if(e.code==='Escape'){if(e.repeat)return;if(pointerLock.locked||pointerLock.pending){pointerLock.release();return;}if(performance.now()<escapeReleaseUntil)return;exit();return;}
    if(e.code==='KeyL'){if(!e.repeat){pointerLock.toggle();updateUI();}return;}
    if(e.code==='KeyV'){if(!e.repeat)setView(view==='third'?'first':'third');return;}
    if(e.code==='KeyG'&&motion.state.mode==='spider'){if(!e.repeat){pulses.set('point',.12);}return;}
    if(e.code==='KeyF'){if(!e.repeat){if(interaction&&(motion.state.mode!=='spider'||motion.state.grounded)){interaction.interact();updateUI();}else if(motion.state.mode==='spider'){pulses.set('zip',.12);}else toggleFlight();}return;}
    if(e.code==='KeyC'){recenter(false,true);return;}
    if(e.code==='Space'){cruise=false;liftTarget=null;landing=false;if(motion.state.mode==='spider'){if(!e.repeat)queueJump();return;}}
    if(e.code==='KeyQ'||e.code==='KeyE'){
      liftTarget=null;landing=false;
      if(e.code==='KeyQ'&&motion.state.mode==='roadster'){
        if(e.repeat&&!keys.has('KeyQ'))return;
        if(!e.repeat&&!armRoadsterJet())return;
      }
    }
    if(['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))landing=false;
    keys.add(e.code);
  });
  on(window,'keyup',e=>{keys.delete(e.code);});
  const loseFocus=()=>{clearInput();pointerLock.release();};
  on(window,'blur',loseFocus);on(document,'visibilitychange',loseFocus);
  const seedMouse=e=>{mouseLook={id:e.pointerId,x:e.clientX,y:e.clientY,looking:false};lookHold=1.5;};
  on(canvas,'pointerenter',e=>{if(active&&!inputBlocked()&&!pointerLock.locked&&e.pointerType==='mouse')seedMouse(e);});
  on(canvas,'pointerdown',e=>{
    if(!active||inputBlocked())return;canvas.focus({preventScroll:true});
    if(e.pointerType==='mouse'){
      const wasLooking=!!mouseLook?.looking;seedMouse(e);mouseLook.looking=wasLooking;
      if(motion.state.mode==='spider'&&e.button===0&&!suitView){held.add('mouse-swing');}
      return;
    }
    if(drag&&drag.id!==e.pointerId)return;
    canvas.setPointerCapture(e.pointerId);
    drag={id:e.pointerId,x:e.clientX,y:e.clientY};lookHold=1.5;
  });
  function applyLook(deltaX,deltaY){
    const dx=deltaX*.0032*lookSensitivity,dy=deltaY*.0025*lookSensitivity;
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||(!dx&&!dy))return;
    if(suitView){suitAngle-=dx;suitPitch=Math.max(-.35,Math.min(.85,suitPitch+dy));}
    else{
      if(motion.state.mode==='spider')spiderCamera.rotate(-dx);else{yawOffset-=dx;vehicleCamera.rotate(-dx);}
      if(dy){pitch=Math.max(-.35,Math.min(.85,pitch+dy));manualPitch=true;}
    }
    lookHold=1.5;
  }
  // MouseEvent is used under pointer lock for engines that do not emit
  // PointerEvent movement there. Hover input is skipped to avoid double turns.
  on(document,'mousemove',e=>{
    if(active&&pointerLock.locked&&!inputBlocked())applyLook(e.movementX,e.movementY);
  });
  // Pointer Lock guarantees MouseEvents; some engines omit PointerEvents.
  on(document,'mousedown',e=>{if(pointerLock.locked&&active&&!inputBlocked()&&motion.state.mode==='spider'&&e.button===0&&!suitView){held.add('mouse-swing');}});
  on(document,'mouseup',e=>{if(e.button===0)held.delete('mouse-swing');});
  on(canvas,'pointermove',e=>{
    if(!active||inputBlocked()){mouseLook=null;return;}
    if(pointerLock.locked)return;
    const mouse=e.pointerType==='mouse';
    // Only a press on the canvas starts a web. Hovering from a HUD button
    // with a held mouse button must never initiate traversal.
    if(mouse&&!(e.buttons&1))held.delete('mouse-swing');
    if(mouse&&(!mouseLook||mouseLook.id!==e.pointerId)){seedMouse(e);return;}
    const pointer=mouse?mouseLook:drag;
    if(!pointer||pointer.id!==e.pointerId)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    pointer.x=e.clientX;pointer.y=e.clientY;
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||(!dx&&!dy))return;
    if(mouse)mouseLook.looking=true;
    applyLook(dx,dy);
  });
  const releasePointer=e=>{if(e.pointerType!=='mouse'&&drag&&drag.id!==e.pointerId)return;drag=null;mouseLook=null;held.delete('mouse-swing');};
  on(canvas,'pointerup',e=>{if(e.pointerType==='mouse')held.delete('mouse-swing');else releasePointer(e);});
  on(canvas,'pointercancel',releasePointer);on(canvas,'lostpointercapture',releasePointer);
  on(window,'pointerup',e=>{if(e.pointerType==='mouse')held.delete('mouse-swing');});
  on(canvas,'pointerleave',e=>{if(e.pointerType==='mouse'&&!pointerLock.locked){mouseLook=null;held.delete('mouse-swing');}});
  on(canvas,'wheel',e=>{if(!active)return;e.preventDefault();if(suitView){suitDistance=Math.max(1.8,Math.min(6,suitDistance*Math.exp(e.deltaY*.001)));return;}const base=motion.state.mode==='helicopter'?18:motion.state.mode==='roadster'?9.4:motion.state.mode==='hoverboard'?8.8:motion.state.mode==='spider'?6.6:motion.state.mode==='scooter'?8.8:6.4;distance=Math.max(2,Math.min(35,(distance??base)*Math.exp(e.deltaY*.001)));},{passive:false});
  on(canvas,'contextmenu',e=>{if(active)e.preventDefault();});
  on($('player-mouse-toggle'),'click',()=>{pointerLock.toggle();updateUI();});
  on($('look-sensitivity'),'input',e=>{const value=Number(e.target.value);if(Number.isFinite(value)){lookSensitivity=Math.max(.45,Math.min(1.8,value));updateElement('look-sensitivity-value',{textContent:`${lookSensitivity.toFixed(2)}×`});}});
  document.querySelectorAll('[data-player-mode]').forEach(b=>on(b,'click',()=>enter(b.dataset.playerMode)));
  on($('transport-interact'),'click',()=>{if(active){interaction?.interact();canvas.focus({preventScroll:true});updateUI();}});
  on($('resume-exploration'),'click',()=>enter(motion.state.mode));
  document.querySelectorAll('[data-player-camera]').forEach(b=>on(b,'click',()=>setView(b.dataset.playerCamera)));
  document.querySelectorAll('[data-player-input]').forEach(b=>{
    const key=b.dataset.playerInput;
    on(b,'pointerdown',e=>{e.preventDefault();stopSuitView();if(key==='up'&&motion.state.mode==='roadster'&&!armRoadsterJet())return;b.setPointerCapture(e.pointerId);if(key==='jump')queueJump();else if(key==='zip'||key==='point')pulses.set(key,.12);else held.add(key);if(['brake','back'].includes(key)){cruise=false;liftTarget=null;landing=false;}if(['forward','left','right'].includes(key))landing=false;if(['up','down'].includes(key)){liftTarget=null;landing=false;}});
    on(b,'pointerup',()=>{held.delete(key);});on(b,'pointercancel',()=>{held.delete(key);});on(b,'lostpointercapture',()=>{held.delete(key);});
    // Pointer release already ends a hold. Only keyboard/assistive activation
    // needs a short pulse; the synthetic click after release must not restart it.
    on(b,'click',e=>{if(e.detail===0){if(key==='up'&&motion.state.mode==='roadster'&&!armRoadsterJet())return;if(!['swing','reel','jump','zip','dive','point','trick'].includes(key))pulses.set(key,.28);else{if(key==='jump')queueJump();if(key==='zip'||key==='point')pulses.set(key,.12);if(key==='trick')pulses.set('trick',.78);}}if(['brake','back'].includes(key)){cruise=false;liftTarget=null;landing=false;}if(['forward','left','right'].includes(key))landing=false;if(['up','down'].includes(key)){liftTarget=null;landing=false;}});
  });
  on($('player-side-view'),'click',()=>{mouseLook=null;setView('third');yawOffset=.95;pitch=motion.state.mode==='hoverboard'?.22:.28;manualPitch=true;lookHold=4;spiderCamera.rotate(.95);const delta=motion.state.yaw+.95-vehicleCamera.heading;vehicleCamera.rotate(Math.atan2(Math.sin(delta),Math.cos(delta)));distance=motion.state.mode==='hoverboard'?8.8:motion.state.mode==='spider'?5.2:9.4;cameraFrame(0,motion.state.mode==='spider');});
  on($('exit-player'),'click',exit);on($('player-recenter'),'click',()=>{recenter(false,true);canvas.focus({preventScroll:true});});
  on($('walk-controls'),'click',()=>{const expanded=$('player-hud').classList.toggle('walk-controls-open');$('walk-controls').setAttribute('aria-expanded',String(expanded));$('walk-controls').textContent=expanded?'收起操作':'展开操作';});
  on($('player-cruise'),'click',()=>{cruise=!cruise;canvas.focus({preventScroll:true});updateUI();});
  on($('player-flight-toggle'),'click',toggleFlight);
  on($('web-immersive'),'click',()=>{setImmersive(!immersive);updateUI();});
  on($('web-controls'),'click',()=>{const open=$('player-hud').classList.toggle('controls-open');$('web-controls').setAttribute('aria-expanded',String(open));});
  on($('web-suit'),'click',()=>{const next=!suitView;clearInput();suitView=next;setView('third');suitAngle=motion.state.yaw+Math.PI+.28;suitPitch=.03;suitDistance=3.15;spiderCamera.reset(motion.state,suitView?suitAngle:motion.state.yaw);updateUI();cameraFrame(0,true);});
  on($('web-audio'),'click',async()=>{await webAudio.setEnabled(!webAudio.enabled);updateUI();});
  on($('web-comfort'),'click',()=>{comfortableCamera=!comfortableCamera;updateUI();invalidate();});
  on($('drive-immersive'),'click',()=>{driveImmersive=!driveImmersive;setImmersive(immersive);updateUI();});
  on($('drive-comfort'),'click',()=>{comfortableCamera=!comfortableCamera;updateUI();});
  on($('drive-controls'),'click',()=>{const open=$('player-hud').classList.toggle('controls-open');$('drive-controls').setAttribute('aria-expanded',String(open));});
  const takeoff=$('player-takeoff');let suppressJetKeyboardClick=false;
  on(takeoff,'pointerdown',e=>{
    if(motion.state.mode!=='roadster')return;e.preventDefault();
    if(!armRoadsterJet())return;takeoff.setPointerCapture(e.pointerId);held.add('roadster-jet');updateUI();
  });
  for(const event of['pointerup','pointercancel','lostpointercapture'])on(takeoff,event,()=>{held.delete('roadster-jet');});
  on(takeoff,'keydown',e=>{
    if(motion.state.mode!=='roadster'||!['Space','Enter'].includes(e.code))return;
    if(e.repeat&&!held.has('roadster-jet'))return;
    e.preventDefault();suppressJetKeyboardClick=true;if(armRoadsterJet())held.add('roadster-jet');
  });
  on(takeoff,'keyup',e=>{if(['Space','Enter'].includes(e.code)){held.delete('roadster-jet');e.preventDefault();}});
  on(takeoff,'blur',()=>{held.delete('roadster-jet');suppressJetKeyboardClick=false;});
  on(takeoff,'click',e=>{
    if(motion.state.mode==='roadster'){
      // Accessible activation gets one brief pulse, never a latched motor.
      if(e.detail===0&&!suppressJetKeyboardClick&&armRoadsterJet())pulses.set('roadster-jet',.28);
      suppressJetKeyboardClick=false;updateUI();return;
    }
    landing=false;cruise=false;liftTarget=liftTarget===null?Math.max(20.14,motion.state.y):null;canvas.focus({preventScroll:true});updateUI();
  });
  on($('player-land'),'click',()=>{
    if(motion.state.mode==='roadster'){clearInput();motion.setFlightEnabled(false);canvas.focus({preventScroll:true});updateUI();return;}
    const next=!landing;clearInput();landing=next;canvas.focus({preventScroll:true});updateUI();
  });
  on($('player-reset'),'click',()=>{clearInput();suitView=false;const result=resetSpawn();if(!result.ok)notify(result.reason);recenter();models.update({...motion.state,view},0);cameraFrame(0,true);updateUI();});
  function setSuspended(value){
    const next=!!value;if(next===suspended)return;
    suspended=next;
    // Keep the exact physical pose/velocity while paused. Internal action
    // buffers are discarded on resume, before the next physics step.
    clearInput();suppressJetKeyboardClick=false;
    if(suspended)pointerLock.release();
    updateUI();invalidate();
  }
  function tick(dt){
    if(!active||disposed||suspended)return false;
    if(inputBlocked()){clearInput();pointerLock.release();return false;}
    lookHold=Math.max(0,lookHold-dt);
    if(suitView){webAudio.setActive(false);models.update({...motion.state,view:'third',inspection:true,speed:0,vx:0,vz:0,verticalSpeed:0,pitch:0,lean:0,grounded:true,anchor:null,traversalPhase:'ground',landingImpact:0,releaseTime:10,zipActive:false,zipAnchors:[],zipStrength:0,diving:false,diveBlend:0,pointPhase:'idle',pointTarget:null,pointProgress:0,trickActive:false,trickPhase:'idle',trickBlend:0,trickRotation:{x:0,y:0,z:0}},dt);cameraFrame(dt);return true;}
    const pressed=(key,...code)=>held.has(key)||(pulses.get(key)||0)>0||code.some(c=>keys.has(c));
    const spider=motion.state.mode==='spider',board=motion.state.mode==='hoverboard',car=motion.state.mode==='roadster';
    const brake=!spider&&pressed('brake','Space');
    if(brake){cruise=false;liftTarget=null;landing=false;}
    let vertical=spider||brake?0:Number(pressed('up','KeyQ')||car&&pressed('roadster-jet'))-Number(pressed('down','KeyE'));
    if(car&&pressed('down','KeyE'))vertical=0;
    if(landing){if(motion.state.grounded)landing=false;else vertical=board?0:-.8;}
    if(liftTarget!==null){
      const remaining=liftTarget-motion.state.y;
      if(remaining<=.01&&Math.abs(motion.state.verticalSpeed)<.05)liftTarget=null;
      else if(motion.state.mode!=='roadster'&&!board)vertical=Math.min(1,remaining/4); // Other flight modes use a tapered climb rate.
    }
    const forward=Number(pressed('forward','KeyW','ArrowUp')||cruise)-Number(pressed('back','KeyS','ArrowDown'));
    const sideways=Number(pressed('right','KeyD','ArrowRight'))-Number(pressed('left','KeyA','ArrowLeft'));
    steeringSideways=spider&&(sideways!==0||forward<0);
    const heading=spiderCamera.heading,length=Math.max(1,Math.hypot(forward,sideways));
    const moveX=(Math.cos(heading)*sideways-Math.sin(heading)*forward)/length;
    const moveZ=(-Math.sin(heading)*sideways-Math.cos(heading)*forward)/length;
    motion.step(dt,{forward:board&&landing?0:forward,turn:board&&landing?0:-sideways,vertical,lift:car?Math.max(0,vertical):undefined,brake:brake||landing&&!board,
      altitudeTarget:board&&landing?motion.groundAt(motion.state.x,motion.state.z).height:board&&liftTarget!==null?liftTarget:undefined,fast:pressed('fast','ShiftLeft','ShiftRight'),
      ...(spider?{moveX,moveZ,aimYaw:heading}:{}),
      swing:spider&&(pressed('swing','KeyE')||held.has('mouse-swing')),jump:spider&&pressed('jump','Space'),zip:spider&&pressed('zip'),dive:spider&&pressed('dive','KeyX'),point:spider&&pressed('point'),trick:spider&&pressed('trick','KeyT'),trickX:sideways,trickY:forward,reel:spider&&pressed('reel','KeyQ')});
    webAudio.setActive(spider);if(spider)webAudio.tick(motion.state);
    pulses.forEach((v,k)=>{if(v<=dt)pulses.delete(k);else pulses.set(k,v-dt);});
    models.update({...motion.state,view},dt);models.group.visible=view==='third'||motion.state.mode==='spider';cameraFrame(dt);
    worldTransport?.update(dt,motion.state);
    uiElapsed+=dt;if(uiElapsed>.15){updateUI();uiElapsed=0;}invalidate();return true;
  }
  function captureActivityPose(){
    if(!active)return null;
    const fields=['x','y','z','yaw','vx','vz','speed','verticalSpeed','grounded','flightEnabled'];
    return {mode:motion.state.mode,transport:interaction?.capture(),view,pitch,distance:distance??null,yawOffset,manualPitch,state:Object.fromEntries(fields.map(k=>[k,motion.state[k]])),camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov}};
  }
  function restoreActivityPose(saved){
    if(suspended||!saved||!modeNames[saved.mode]||!['first','third'].includes(saved.view))return false;
    if(!['x','y','z','yaw'].every(k=>Number.isFinite(saved.state?.[k]))||Math.abs(saved.state.x)>6000||Math.abs(saved.state.z)>6000||saved.state.y< -10||saved.state.y>1000)return false;
    const newLease=interaction&&saved.transport&&!interaction.mounted;
    if(interaction&&saved.transport&&!interaction.restore(saved.transport))return false;
    // A refreshed return must claim its parked model and activate the vehicle
    // at its own safe footprint, not try to spawn a helicopter at the canteen.
    if(newLease){
      const initial=saved.state.grounded?saved.state:interaction.mounted.item;
      if(!motion.placeMode(initial,saved.mode).ok){interaction.cancelRestore();return false;}
      if(saved.mode==='scooter')models.setScooterAppearance(interaction.mounted.item.appearance);
    }else if(saved.mode==='boat'&&motion.state.mode!=='boat'&&!motion.placeMode(saved.state,'boat').ok)return false;
    enter(saved.mode);if(!active||motion.state.mode!==saved.mode)return false;
    for(const key of ['x','y','z','yaw','vx','vz','speed','verticalSpeed'])if(Number.isFinite(saved.state[key]))motion.state[key]=saved.state[key];
    for(const key of ['grounded','flightEnabled'])if(typeof saved.state[key]==='boolean')motion.state[key]=saved.state[key];
    view=saved.view;pitch=Number.isFinite(saved.pitch)?Math.max(-1.4,Math.min(1.4,saved.pitch)):.25;
    yawOffset=Number.isFinite(saved.yawOffset)?saved.yawOffset:0;manualPitch=!!saved.manualPitch;distance=Number.isFinite(saved.distance)?Math.max(1,Math.min(100,saved.distance)):undefined;
    clearInput();spiderCamera.reset(motion.state);vehicleCamera.reset(motion.state,motion.state.yaw);models.update({...motion.state,view},0);cameraFrame(0,true);
    if(saved.camera?.position?.length===3&&saved.camera.position.every(Number.isFinite)&&saved.camera?.quaternion?.length===4&&saved.camera.quaternion.every(Number.isFinite)){camera.position.fromArray(saved.camera.position);camera.quaternion.fromArray(saved.camera.quaternion);if(Number.isFinite(saved.camera.fov))camera.fov=Math.max(20,Math.min(100,saved.camera.fov));camera.updateProjectionMatrix();}
    updateUI();invalidate();return true;
  }
  return {get active(){return active;},get suspended(){return suspended;},state:motion.state,enter,enterAt,exit,tick,setSuspended,captureActivityPose,restoreActivityPose,
    dispose(){exit();disposed=true;pointerLock.dispose();listeners.forEach(remove=>remove());worldTransport?.dispose();models.dispose();webAudio.dispose();disposeReferences();disposeHoverboardReferences();}};
}
