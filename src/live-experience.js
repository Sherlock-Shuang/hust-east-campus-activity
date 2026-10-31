import {createClientId} from './browser-compat.js';
import {preflightExperience} from './experience-preflight.js';
import {createLiveClient} from './live-client.js';
import {mountAnnouncementNotice} from './live-announcement.js';
import {projectWallTextRects,avoidWallText} from './activity-label-layout.js';
import {isEventActive} from './live-state.js';
import {mountAudienceUI} from './audience-ui.js';
import {ACTIVITY_WORKS} from './activity-catalog.js';
import {mountMobileViewport} from './mobile-viewport.js';
import {createSkyQrExperience} from './sky-qr.js';
import {nearbyInterior,crossedInteriorDoor,interiorReturnSnapshot,interiorExitEntry} from './building-interiors.js';
import {createActivityBridgeMessage} from './activity-bridge-state.js';
import {createCampusTsunami,mountCampusTsunamiNotice} from './campus-tsunami.js';
import {campusEffectBudget} from './campus-effect-budget.js';
import {getC118FloodElapsed} from './c118-flood-state.js';
import {createCivilizationPause,CIVILIZATION_PAUSE_MESSAGE,CIVILIZATION_CONTINUE_LABEL} from './civilization-pause.js';
import './civilization-pause.css';
import './live-experience.css';
import './campus-tsunami.css';

export function createLiveExperience({THREE,scene,camera,canvas,container,getPlayer,onFloodState=()=>{},getInteriors=()=>[],getWallText=()=>[],setSuspended,invalidate,notify,tsunamiQuality='desktop',handheld=false,onRuntimeBudgetChange=()=>{},onMusicStateChange=()=>{}}) {
  const disposeMobileViewport=mountMobileViewport();
  const root=document.createElement('div');root.id='live-experience';
  root.innerHTML=`
    <div class="live-connection" role="status">正在连接活动</div>
    <div class="live-marker-labels" aria-label="活动地点"></div>
    <div class="live-pause" tabindex="-1" hidden><div class="live-pause-symbol" aria-hidden="true"><i></i><i></i></div><span>校园暂时静止</span><p></p><small>请留意活动公告，恢复后可继续探索</small></div>
    <section class="civilization-pause" role="dialog" aria-modal="true" aria-labelledby="civilization-pause-message" hidden><p id="civilization-pause-message">${CIVILIZATION_PAUSE_MESSAGE}</p><button type="button">${CIVILIZATION_CONTINUE_LABEL}</button></section>
    <section class="live-announcement" role="status" aria-live="polite" aria-atomic="true" hidden></section>
    <button class="live-portal-prompt" hidden><span>体验入口</span><strong></strong><small>Enter 进入</small></button>
    <section class="live-portal-view" aria-label="体验程序" hidden><div class="live-portal-bar"><span></span><small>校园位置已保留</small><button type="button">返回校园</button></div><div class="live-portal-loading" role="status" hidden></div><div class="live-portal-frame"></div></section>`;
  container.append(root);
  const $=selector=>root.querySelector(selector),pause=$('.live-pause'),announcement=$('.live-announcement'),portalView=$('.live-portal-view'),prompt=$('.live-portal-prompt'),labels=$('.live-marker-labels');
  const worldGroup=new THREE.Group();worldGroup.name='activity-beacons';scene.add(worldGroup);
  let client,audienceUI,skyQr,items=[],visualSignature='',uiSignature='',nearest=null,opened=null,frame=null,frameOrigin=null,lastPaint=0,lastUpdate=0,lastFrozen=false,connectedOnce=false,disposed=false;
  let loadingTimer,returnPose=null,restorePending=true,previousInteriorPosition=null,pendingInteriorReturn=null;
  const visited=new Set(),visiting=new Set(),visitRetry=new Map();
  let restoreFocus=null,wasPaused=false;
  const announcementNotice=mountAnnouncementNotice(announcement,{onDismiss({automatic,hadFocus}){
    // Automatic expiry must not take focus from chat, forms or other controls.
    if(!automatic||hadFocus){
      if(opened)frame?.focus();else if(!lastFrozen)canvas.focus({preventScroll:true});
    }
    invalidate();
  }});
  const projected=new THREE.Vector3();
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  let civilizationStorage=null;try{civilizationStorage=window.sessionStorage;}catch{}
  const civilization=createCivilizationPause({storage:civilizationStorage});
  const civilizationPanel=$('.civilization-pause'),civilizationContinue=civilizationPanel.querySelector('button');
  const campusTsunami=createCampusTsunami({THREE,scene,quality:tsunamiQuality});
  const tsunamiNotice=mountCampusTsunamiNotice({THREE,root,camera,effect:campusTsunami,scene});
  let visualBudget=campusEffectBudget(),lastForeground='';
  function runtimeBudget(){return {foreground:!opened,experience:opened?(opened.workId||opened.kind||opened.id):null,level:visualBudget.level,releaseDecorativeResources:!!opened&&visualBudget.level===0,exteriorEffectsResident:campusTsunami.resident};}
  function updateRuntimeBudget(){
    if(disposed)return;
    const next=runtimeBudget(),signature=`${next.experience||'campus'}:${next.level}`;if(signature===lastForeground)return;
    lastForeground=signature;
    // The campus remains available as the return destination. Its optional
    // exterior flood mesh need not coexist with another heavy WebGL runtime;
    // returning reconstructs it at the authoritative current event time.
    if(opened)campusTsunami.releaseResources();
    root.dataset.runtimeForeground=next.experience||'campus';root.dataset.effectQuality=String(next.level);
    onRuntimeBudgetChange({...next,exteriorEffectsResident:campusTsunami.resident});
  }
  function updateTsunami(){
    if(!client||disposed)return false;
    const wasPaused=civilization.active,player=getPlayer();
    civilization.update({eventId:client.state.c118Flood?.id,elapsed:getC118FloodElapsed(client.state.c118Flood,client.now()),
      position:player?.state,outdoors:!opened,eligible:!!player?.active&&!!audienceUI?.registered&&!document.hidden,hostPaused:client.state.paused});
    civilizationPanel.hidden=!civilization.active;civilizationPanel.inert=!!client.state.paused;
    civilizationContinue.disabled=!!client.state.paused;
    root.classList.toggle('is-civilization-paused',civilization.active);
    root.dataset.civilizationPaused=String(civilization.active);
    const pauseChanged=wasPaused!==civilization.active;
    if(pauseChanged){updateFrozen();bridge();invalidate();if(civilization.active)civilizationContinue.focus({preventScroll:true});}
    const changed=campusTsunami.update({event:client.state.c118Flood,now:client.now(),
      visible:!opened&&!document.hidden&&!!audienceUI?.registered,paused:client.state.paused,locallyPaused:civilization.active,reducedMotion:reduced?.matches});
    const flood=client.state.c118Flood&&campusTsunami.sample?{id:client.state.c118Flood.id,...campusTsunami.sample,paused:!!client.state.paused||civilization.active,reducedMotion:!!reduced?.matches}:null;
    onFloodState(flood);
    getPlayer()?.setFloodState?.(flood);
    // Keep the frozen spray/fog frame under the civilization card. Its banner
    // is hidden by CSS; only a host pause suppresses the exterior wash.
    tsunamiNotice.update({paused:!!client.state.paused,reducedMotion:reduced?.matches});
    root.dataset.campusTsunami=campusTsunami.active?campusTsunami.sample.phase:'hidden';
    return changed||pauseChanged;
  }
  civilizationContinue.addEventListener('click',()=>{
    if(client?.state.paused||!civilization.continueExploring())return;
    civilizationPanel.hidden=true;root.classList.remove('is-civilization-paused');
    updateFrozen();refresh(true);bridge();canvas.focus({preventScroll:true});invalidate();
  });
  const interactionRoots=[document.querySelector('body > header'),document.querySelector('.transport-selector'),canvas,...container.querySelectorAll('.view-toolbar,#inspect,#measurement,#mobile-controls,#mobile-orientation-hint,#mobile-enable-touch,#transport-interact,#resume-exploration')].filter(Boolean);
  const setInert=frozen=>interactionRoots.forEach(el=>{el.inert=frozen;});
  function updateFrozen(){
    const frozen=!!client?.state.paused||civilization.active||!!opened||!!skyQr?.isOpen||!audienceUI?.registered;
    onMusicStateChange({registered:!!audienceUI?.registered,experience:opened?(opened.workId||opened.kind||opened.id):null,
      paused:!!client?.state.paused||civilization.active,foregroundAudio:!!opened?.foregroundAudio});
    if(frozen!==lastFrozen){
      lastFrozen=frozen;
      if(frozen){restoreFocus=document.activeElement;document.exitPointerLock?.();}
      setInert(frozen);setSuspended(frozen);
      if(!frozen&&restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});
    }
    if(!frozen&&pendingInteriorReturn&&getPlayer()?.restoreActivityPose?.(pendingInteriorReturn)){
      pendingInteriorReturn=null;previousInteriorPosition=null;
    }
    updateRuntimeBudget();
  }
  function bridge(){
    if(frame?.contentWindow&&frameOrigin)frame.contentWindow.postMessage(createActivityBridgeMessage({opened,state:client.state,serverTime:client.now(),locallyPaused:!!skyQr?.isOpen||civilization.active}),frameOrigin);
  }
  function loading(message,status='loading'){
    const el=$('.live-portal-loading');el.hidden=!message;el.dataset.status=status;el.textContent=message;
    if(status==='error'){const retry=document.createElement('button');retry.type='button';retry.textContent='重试';retry.onclick=()=>{const portal=opened;closePortal(undefined,{restoreInterior:false});openPortal(portal);};el.append(retry);}
  }
  function record(type,details={},options={}){return audienceUI.client.event(type,details,options);}
  const position=()=>{const s=getPlayer()?.state;return s?{x:s.x,y:s.y,z:s.z}:null;};
  function rememberPose(){returnPose=getPlayer()?.captureActivityPose?.();if(returnPose)try{sessionStorage.setItem('campus-return-pose',JSON.stringify({audienceId:audienceUI.client.identity.id,pose:returnPose}));}catch{}}
  function attemptEvent(type,details={},options={}){if(!opened?.openingStarted)return Promise.resolve();return record(type,{pointId:opened.id,workId:opened.workId||opened.id,attemptId:opened.attemptId,...details},options);}
  function closePortal(reason,{restoreInterior=true,returnEntryId}={}){
    if(!opened)return;
    const buildingReturn=restoreInterior&&opened.kind==='building-interior'?interiorReturnSnapshot(returnPose,interiorExitEntry(opened,getInteriors(),returnEntryId)):null;
    attemptEvent('returned');opened.loadController?.abort();clearTimeout(loadingTimer);
    try{sessionStorage.removeItem('campus-return-pose');}catch{}
    frame?.contentWindow?.postMessage({type:'campus:dispose',attemptId:opened.attemptId},frameOrigin);
    $('.live-portal-frame').replaceChildren();portalView.hidden=true;frame=null;frameOrigin=null;opened=null;
    pendingInteriorReturn=buildingReturn;loading('');updateFrozen();previousInteriorPosition=null;
    invalidate();if(!client.state.paused)canvas.focus({preventScroll:true});if(reason)notify(reason);
  }
  async function openPortal(portal){
    if(portal.kind==='building-interior')return openInterior(portal);
    if(client.state.paused||civilization.active||opened)return;
    if(!audienceUI.registered)return notify('请先填写昵称参与活动');
    if(!client.connected)return notify('活动连接恢复后再进入');
    const current=client.state.portals.find(p=>p.id===portal.id);
    if(!current||!isEventActive(current,client.now()))return notify('这个入口暂未开放');
    const player=getPlayer();
    if(!player?.active||Math.hypot(player.state.x-current.x,player.state.z-current.z)>current.radius||player.state.y>12)return notify('请先靠近这个入口');
    const url=new URL(current.url,location.href);
    if(!['http:','https:'].includes(url.protocol))return;
    const attemptId=createClientId();opened={...current,attemptId,openingStarted:false,registeredAttempt:false,ready:false,loadController:new AbortController()};frameOrigin=url.origin;rememberPose();updateFrozen();
    $('.live-portal-bar > span').textContent=current.label;portalView.hidden=false;prompt.hidden=true;loading('正在连接作品，首次进入需要加载模型与游戏资源…');
    try{
      await record('visit',{pointId:current.id,position:position()},{required:true});visited.add(current.id);
      if(opened?.attemptId!==attemptId)return;
      opened.openingStarted=true;
      await record('opening',{pointId:current.id,workId:current.workId||current.id,attemptId,position:position()},{required:true});
      if(opened?.attemptId!==attemptId){
        // A close can race the server's opening response. Settle the accepted
        // attempt even if the earlier return arrived before it existed.
        record('returned',{pointId:current.id,workId:current.workId||current.id,attemptId});return;
      }
      opened.registeredAttempt=true;
      if(url.origin===location.origin)await preflightExperience(url,{signal:opened.loadController.signal});
    }catch(error){if(opened?.attemptId===attemptId){opened.failed=true;attemptEvent('open_failed');loading(error.message,'error');}return;}
    if(opened?.attemptId!==attemptId)return;
    // The host may close admission while the entry requests are in flight.
    // Once a frame has been admitted, closing its portal does not evict it.
    const admitted=client.state.portals.find(p=>p.id===current.id);
    if(!admitted||!isEventActive(admitted,client.now())||admitted.url!==current.url){closePortal('活动入口已关闭，请留意主持人通知');return;}
    url.searchParams.set('campusParentOrigin',location.origin);url.searchParams.set('campusAttempt',attemptId);
    frame=document.createElement('iframe');frame.title=current.label;frame.referrerPolicy='same-origin';
    // The chat observation app supports deliberate source links and report downloads.
    const projectLinks=current.workId==='she-love-me'?' allow-popups allow-popups-to-escape-sandbox allow-downloads':'';
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-pointer-lock'+projectLinks);
    // Keep the host's announcement/pause layer above every experience.
    frame.setAttribute('allow','fullscreen \'none\'');frame.src=url.href;
    frame.addEventListener('load',()=>{if(disposed||opened?.attemptId!==attemptId)return;bridge();if(!ACTIVITY_WORKS.some(w=>w.id===opened?.workId))loading('页面已载入，等待作品确认就绪；此时尚未计为已打开。');});
    frame.addEventListener('error',()=>{if(opened?.attemptId!==attemptId)return;opened.failed=true;clearTimeout(loadingTimer);attemptEvent('open_failed');loading('作品加载失败，请重试或返回校园。','error');});
    $('.live-portal-frame').replaceChildren(frame);portalView.hidden=false;prompt.hidden=true;
    loadingTimer=setTimeout(()=>{if(opened?.attemptId===attemptId&&!opened.ready)loading('资源仍在加载。可继续等待，或返回后重试；尚未计为已打开。');},90000);
    updateFrozen();$('.live-portal-bar button').focus();invalidate();
  }
  function openInterior(requested,crossedFrom=null){
    if(client.state.paused||civilization.active||opened||skyQr?.isOpen||!audienceUI.registered)return;
    const player=getPlayer(),current=player?.active&&(crossedFrom?crossedInteriorDoor(getInteriors(),crossedFrom,player.state):nearbyInterior(getInteriors(),player.state));
    if(!current||current.id!==requested.id)return notify('请步行靠近光电楼开启的玻璃门');
    const attemptId=createClientId(),url=new URL(current.url,location.href);
    opened={...current,attemptId,openingStarted:false,ready:false};frameOrigin=url.origin;rememberPose();updateFrozen();
    $('.live-portal-bar > span').textContent=current.label;prompt.hidden=true;portalView.hidden=false;
    loading('正在准备 C118 报告厅…');
    url.searchParams.set('campusParentOrigin',location.origin);url.searchParams.set('campusAttempt',attemptId);
    if(new URLSearchParams(location.search).get('diagnostics')==='1'){
      url.searchParams.set('diagnostics','1');
      if(new URLSearchParams(location.search).get('gpu')==='1')url.searchParams.set('gpu','1');
    }
    frame=document.createElement('iframe');frame.title=current.label;frame.referrerPolicy='same-origin';
    frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-pointer-lock');frame.setAttribute('allow',"fullscreen 'none'");frame.src=url.href;
    frame.addEventListener('load',()=>{if(!disposed&&opened?.attemptId===attemptId)bridge();});
    frame.addEventListener('error',()=>{if(opened?.attemptId!==attemptId)return;opened.failed=true;loading('报告厅加载失败，可以重试或返回校园。','error');});
    $('.live-portal-frame').replaceChildren(frame);$('.live-portal-bar button').focus();
    loadingTimer=setTimeout(()=>{if(opened?.attemptId===attemptId&&!opened.ready)loading('报告厅仍在加载，可返回校园后重试。');},30000);
    invalidate();
  }
  $('.live-portal-bar button').addEventListener('click',()=>closePortal());
  prompt.addEventListener('click',()=>nearest&&openPortal(nearest));
  function keyboard(event){
    if(civilization.active){
      if(event.code==='Tab'&&!client.state.paused){event.preventDefault();civilizationContinue.focus({preventScroll:true});}
      return;
    }
    if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey)return;
    if(event.code==='Enter'&&nearest&&!client.state.paused&&!opened&&event.target===canvas){event.preventDefault();openPortal(nearest);}
  }
  window.addEventListener('keydown',keyboard);
  function message(event){
    if(!frame||event.source!==frame.contentWindow||event.origin!==frameOrigin)return;
    if(event.data?.attemptId!==opened?.attemptId)return;
    if(event.data?.type==='campus:audio-focus'&&opened.workId==='opto-c118'&&typeof event.data.active==='boolean'){
      opened.foregroundAudio=event.data.active;updateFrozen();
    }
    if(event.data?.type==='campus:ready'){
      if(opened.failed)return;
      const work=ACTIVITY_WORKS.find(w=>w.id===opened.workId);
      if(event.data.workId&&event.data.workId!==opened.workId)return;
      bridge();
      if(!opened.ready&&['page_opened','runtime_ready'].includes(event.data.level)&&(event.data.level==='runtime_ready'||(work?.ready!=='runtime_ready'&&opened.kind!=='building-interior'))){
        opened.ready=true;clearTimeout(loadingTimer);loading('');attemptEvent('opened',{readyLevel:event.data.level});
      }
    }
    if(event.data?.type==='campus:error'){opened.failed=true;clearTimeout(loadingTimer);attemptEvent('open_failed');loading('作品未能完成加载，请重试或返回校园。','error');}
    if(event.data?.type==='campus:exit'&&!client.state.paused&&(!event.data.workId||event.data.workId===opened.workId))closePortal(undefined,{returnEntryId:event.data.returnEntryId});
  }
  window.addEventListener('message',message);
  function clearBeacons(){
    for(const item of items){item.group.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});item.label.remove();}
    worldGroup.clear();items=[];
  }
  function rebuild(markers,portals){
    clearBeacons();
    for(const data of [...markers.map(m=>({...m,kind:'marker'})),...portals.map(p=>({...p,kind:'portal',height:120,color:'#28efcf',beamRadius:2.6}))]){
      const group=new THREE.Group(),height=data.height,radius=data.kind==='portal'?data.beamRadius:data.radius;
      group.position.set(data.x,.3,data.z);worldGroup.add(group);
      // Match the campus logarithmic depth buffer so the glow shares building
      // occlusion. Unlit layers keep their brightness without extra render passes.
      const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
        uniforms:{color:{value:new THREE.Color(data.color)},intensity:{value:1.3}},
        vertexShader:`#include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec2 vUv;
          void main(){
            vUv=uv;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
            #include <logdepthbuf_vertex>
          }`,
        fragmentShader:`#include <logdepthbuf_pars_fragment>
          varying vec2 vUv;
          uniform vec3 color;
          uniform float intensity;
          void main(){
            #include <logdepthbuf_fragment>
            float edge=pow(sin(vUv.x*3.14159265),2.0);
            float fade=1.0-smoothstep(0.72,1.0,vUv.y);
            gl_FragColor=vec4(color,fade*(0.22+edge*0.48)*intensity);
            #include <colorspace_fragment>
          }`});
      const column=new THREE.Mesh(new THREE.CylinderGeometry(radius*.55,radius,height,24,1,true),material);column.position.y=height/2;group.add(column);
      const coreRadius=Math.max(.22,Math.min(radius*.17,.65));
      const core=new THREE.Mesh(new THREE.CylinderGeometry(coreRadius*.55,coreRadius,height*.96,8,1,true),new THREE.MeshBasicMaterial({color:new THREE.Color(data.color).lerp(new THREE.Color('#ffffff'),.65),transparent:true,opacity:.92,depthWrite:false,toneMapped:false,blending:THREE.AdditiveBlending}));core.position.y=height*.48;group.add(core);
      const ring=new THREE.Mesh(new THREE.RingGeometry(radius*.88,radius*1.2,48),new THREE.MeshBasicMaterial({color:data.color,side:THREE.DoubleSide,transparent:true,opacity:1,depthWrite:false,toneMapped:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.03;group.add(ring);
      const inner=new THREE.Mesh(new THREE.CircleGeometry(radius*.82,32),new THREE.MeshBasicMaterial({color:data.color,transparent:true,opacity:.26,depthWrite:false,toneMapped:false}));inner.rotation.x=-Math.PI/2;inner.position.y=.015;group.add(inner);
      const label=document.createElement(data.kind==='portal'?'button':'span');label.className=`live-map-label ${data.kind==='portal'?'is-portal':''}`;label.textContent=data.kind==='portal'?`${data.label} · 体验入口`:data.label;label.style.setProperty('--beacon-color',data.color);labels.append(label);
      if(data.kind==='portal')label.addEventListener('click',()=>openPortal(data));
      items.push({group,material,core,ring,label,data});
    }
    invalidate();
  }
  function refresh(force=false){
    if(!client||disposed)return;
    const state=client.state,now=client.now(),activeAnnouncement=isEventActive(state.announcement,now)?state.announcement:null;
    const markers=state.markers.filter(m=>isEventActive(m,now)),portals=state.portals.filter(p=>isEventActive(p,now));
    const signature=JSON.stringify([markers,portals]);
    if(signature!==visualSignature){visualSignature=signature;rebuild(markers,portals);}
    if(opened&&!frame&&opened.kind!=='building-interior'){const current=portals.find(p=>p.id===opened.id);if(!current||current.url!==opened.url)closePortal('活动入口已关闭，请留意主持人通知');}
    skyQr?.refresh({visible:state.skyQrVisible===true,portalOpen:!!opened,blocked:!audienceUI?.registered});
    if(updateTsunami())invalidate();
    portalView.inert=state.paused||!!skyQr?.isOpen;
    const nextUI=JSON.stringify([state.paused,state.pauseMessage,activeAnnouncement,state.phase,state.skyQrVisible,state.c118Flood,state.c118Screen]);
    if(nextUI!==uiSignature||force){
      uiSignature=nextUI;pause.hidden=!state.paused;pause.querySelector('p').textContent=state.pauseMessage||'请稍候，活动即将继续';
      announcementNotice.update(activeAnnouncement);
      root.classList.toggle('is-paused',state.paused);updateFrozen();bridge();invalidate();
      audienceUI?.phase(state.phase);
      portalView.inert=state.paused||!!skyQr?.isOpen;
      if(state.paused&&!wasPaused){document.exitPointerLock?.();pause.focus({preventScroll:true});}
      else if(!state.paused&&wasPaused&&civilization.active)civilizationContinue.focus({preventScroll:true});
      wasPaused=state.paused;
    }
    const player=getPlayer();nearest=null;
    if(restorePending&&audienceUI?.registered&&!lastFrozen&&player){
      restorePending=false;try{const stored=JSON.parse(sessionStorage.getItem('campus-return-pose'));if(stored?.audienceId===audienceUI.client.identity.id)player.restoreActivityPose?.(stored.pose);}catch{}
    }
    if(player?.active&&audienceUI?.registered&&client.connected&&!state.paused&&!civilization.active&&!opened){
      let distance=Infinity;
      for(const portal of portals){const d=Math.hypot(player.state.x-portal.x,player.state.z-portal.z);if(d<=portal.radius&&player.state.y<12){
        if(d<distance){distance=d;nearest=portal;}
        if(!visited.has(portal.id)&&!visiting.has(portal.id)&&Date.now()>(visitRetry.get(portal.id)||0)){visiting.add(portal.id);record('visit',{pointId:portal.id,position:position()},{required:true}).then(()=>{visited.add(portal.id);visitRetry.delete(portal.id);}).catch(()=>{visitRetry.set(portal.id,Date.now()+15000);}).finally(()=>visiting.delete(portal.id));}
      }}
    }
    const interiorEnabled=!document.hidden&&player?.active&&audienceUI?.registered&&!state.paused&&!civilization.active&&!opened&&!skyQr?.isOpen;
    if(interiorEnabled){
      const interiors=getInteriors(),currentPosition={...player.state};
      const previousPosition=previousInteriorPosition,crossed=crossedInteriorDoor(interiors,previousPosition,currentPosition);
      previousInteriorPosition=currentPosition;
      if(crossed){openInterior(crossed,previousPosition);nearest=null;previousInteriorPosition=null;}
      else if(!nearest)nearest=nearbyInterior(interiors,player.state);
    }else previousInteriorPosition=null;
    prompt.hidden=!nearest;if(nearest){prompt.querySelector('strong').textContent=nearest.label;prompt.querySelector('span').textContent=nearest.kind==='building-interior'?'室内参观':'体验入口';prompt.querySelector('small').textContent=nearest.kind==='building-interior'?'走进门内 / Enter / 点击进入':'Enter 进入';}
    root.dataset.paused=String(state.paused);root.dataset.revision=String(state.revision);root.dataset.markerCount=String(markers.length);root.dataset.portalCount=String(portals.length);
  }
  client=createLiveClient({onState:()=>{queueMicrotask(()=>refresh(true));},onConnection(connected){
    if(connected)connectedOnce=true;
    $('.live-connection').textContent=connected?'活动已连接':connectedOnce?'活动连接中断 · 正在重连':'本地探索 · 活动服务未连接';
    $('.live-connection').dataset.connected=String(connected);
  }});
  audienceUI=mountAudienceUI(root,{onChange(){queueMicrotask(()=>{updateFrozen();refresh(true);});}});
  skyQr=createSkyQrExperience({THREE,scene,root,invalidate,onOpenChange(){updateFrozen();refresh(true);}});
  updateFrozen();
  const pagehide=()=>{if(opened?.openingStarted)attemptEvent('returned',{}, {keepalive:true});};window.addEventListener('pagehide',pagehide);
  const timer=setInterval(()=>refresh(),200);
  const visibility=()=>refresh(true);document.addEventListener('visibilitychange',visibility);
  return {
    get frozen(){return lastFrozen;},get portalOpen(){return !!opened;},get state(){return client.state;},
    get runtimeBudget(){return runtimeBudget();},
    setPerformanceBudget(next){visualBudget=campusEffectBudget(next);const changed=campusTsunami.setQuality(visualBudget.level===0?'low':handheld?'mobile':'desktop');if(changed)invalidate();updateRuntimeBudget();return changed;},
    sync(){refresh(true);setSuspended(lastFrozen);if(restorePending&&audienceUI.registered&&!lastFrozen&&getPlayer()){
      restorePending=false;try{const stored=JSON.parse(sessionStorage.getItem('campus-return-pose'));if(stored?.audienceId===audienceUI.client.identity.id)getPlayer().restoreActivityPose?.(stored.pose);}catch{}
    }},
    tick(now){
      // The shared catastrophe animates even when the host has no map markers.
      // A hidden/embedded campus submits no wave work while C118 renders itself.
      let tsunamiChanged=false;
      if(client.state.c118Flood||campusTsunami.active)tsunamiChanged=updateTsunami();
      if(!items.length||document.hidden||opened)return tsunamiChanged;
      if(now-lastUpdate<66)return tsunamiChanged;lastUpdate=now;
      camera.updateMatrixWorld();
      const width=canvas.clientWidth,height=canvas.clientHeight;
      const textRects=projectWallTextRects(THREE,camera,getWallText(),width,height);
      for(const item of items){
        const {data,group,label}=item;projected.set(data.x,Math.min(data.height*.65,22),data.z).project(camera);
        label.hidden=client.state.paused||civilization.active||projected.z>1||projected.z< -1||Math.abs(projected.x)>1||Math.abs(projected.y)>1;
        const x=(projected.x*.5+.5)*width,y=(-projected.y*.5+.5)*height;
        let labelY=y;
        if(!label.hidden&&textRects.length){const size=item.labelSize??={width:label.offsetWidth,height:label.offsetHeight};labelY=avoidWallText(x,y,size.width,size.height,textRects,height);}
        label.style.left=`${x}px`;label.style.top=`${labelY}px`;
        // Keep the skyline beacon strong, but soften it inside the approach.
        // Distance still updates when reduced motion disables the slow pulse.
        const distance=Math.hypot(camera.position.x-data.x,camera.position.z-data.z);
        const emphasis=THREE.MathUtils.smoothstep(distance,12,48);
        const pulse=client.state.paused||civilization.active||reduced?.matches?0:Math.sin(client.now()/1300+group.position.x*.01);
        item.material.uniforms.intensity.value=(1.3+pulse*.08)*(.18+emphasis*.82);
        item.core.material.opacity=.48+emphasis*.44;
        item.ring.scale.setScalar(1+pulse*.045);
      }
      if(client.state.paused||civilization.active||reduced?.matches)return tsunamiChanged;
      if(now-lastPaint>=100){lastPaint=now;return true;}return tsunamiChanged;
    },
    dispose(){disposed=true;announcementNotice.dispose();disposeMobileViewport();clearInterval(timer);client.dispose();closePortal();skyQr.dispose();tsunamiNotice.dispose();campusTsunami.dispose();audienceUI.dispose();setInert(false);setSuspended(false);window.removeEventListener('keydown',keyboard);window.removeEventListener('message',message);window.removeEventListener('pagehide',pagehide);document.removeEventListener('visibilitychange',visibility);clearBeacons();worldGroup.removeFromParent();root.remove();},
  };
}
