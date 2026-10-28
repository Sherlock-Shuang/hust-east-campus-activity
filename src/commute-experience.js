import { createCommuteRoute, COMMUTE_DORMS } from './commute-route.js';
import { createCommuteSimulation } from './commute-simulation.js';
import { createCommuteScene } from './commute-scene.js';
import { createTrafficVisualCadence } from './traffic-visual-cadence.js';
import { mountPhotoReferences } from './photo-references.js';
import { EXPANDED_PHOTO_REFERENCES } from './photo-expanded-references.js';
import { createPlayerExperience, getCampusPlayerSpawn } from './player-experience.js';

/** Connect the sourced route, traffic model and camera to the visible controls. */
export function createCommuteExperience({ THREE, scene, camera, controls, canvas, model, fc, frame,
  geoToLocal, focusBox, notify, invalidate, cancelCameraAnimation, enable3D, onRouteChange=()=>{} }) {
  const $ = id => document.getElementById(id);
  // Optional inspection controls may be absent in the compact transport UI.
  const updateElement = (id, properties) => {
    const element = $(id);
    if (element) Object.assign(element, properties);
  };
  let route = createCommuteRoute(fc, { frame, geoToLocal });
  let simulation = createCommuteSimulation(route, {
    seed: 943108, startMinutes: 478, density: 1, scooterShare: .86,
    vehicleLanes: 3, signals: true,
  });
  let visual = createCommuteScene(THREE, scene, route, simulation,{model});
  onRouteChange(route);
  let player, suspended = false, running = true, visible = true, timeScale = 1, followId = null,
    lastFollow = null, followStartedAt = 0, followWaitedAt = 0, uiElapsed = 0, disposed = false, observationProgress = 0, observationMode = 'route';
  const visualCadence=createTrafficVisualCadence();
  let detailDistanceScale=1;
  const previousCamera = new THREE.Vector3(Infinity, Infinity, Infinity);
  const previousDirection = new THREE.Quaternion();
  const listeners = [];
  function on(element, type, fn) {
    if (!element) return;
    const handler=event=>{if(!suspended)fn(event);};
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  }
  function period(minutes) {
    return minutes < 462 ? '提前出门' : minutes < 475 ? '上课前高峰' :
      minutes < 480 ? '临近上课' : '上课之后';
  }
  function stage(progress) {
    if (progress >= route.dismountProgress) return route.options.destination==='a-north'?'下车步行 · 东九 A 座':'东九湖畔前场 · 到达停车区';
    const junction = route.trafficSignals[0]?.progress ?? route.length * .5;
    if (Math.abs(progress - junction) < 50) return '喻家路与启明路交会';
    if (progress < junction - 160) return '韵苑宿舍区';
    if (progress < junction) return '食堂西侧道路';
    const segment=route.segments.find(s=>progress>=s.startProgress&&progress<=s.endProgress);
    return segment?.sourceId==='way/97080595'?'左转入东九 · 沿湖前往 B/C 前场':'沿喻家路前往东九';
  }
  function updateUI() {
    const clock = simulation.state.clockMinutes, whole = Math.floor(clock);
    updateElement('commute-clock', { textContent: `${String(Math.floor(whole / 60) % 24).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}` });
    updateElement('commute-period', { textContent: period(clock) });
    updateElement('traffic-count', { textContent: simulation.stats.activeCount });
    updateElement('queue-count', { textContent: simulation.stats.waitingCount });
    const signal = simulation.signals.reduce((nearest,s)=>!nearest||Math.abs(s.progress-observationProgress)<Math.abs(nearest.progress-observationProgress)?s:nearest,null);
    updateElement('signal-state', { textContent: signal?.enabled
      ? `${{ red: '红', amber: '黄', green: '绿' }[signal.state]} ${Math.ceil(signal.remaining)}s`
      : '关闭' });
    if ($('signal-state')) $('signal-state').dataset.phase = signal?.state || 'off';
    updateElement('signal-state', { title: signal?.id==='user-confirmed/dongjiu-lakeside-turn'?'过桥后左转 · 东九湖畔路口（情景配时）':'喻家路与启明路交会（情景配时）' });
    updateElement('pause-commute', { textContent: running ? '暂停车流' : '继续车流' });
    // These attributes describe the same user-visible scenario, for UI checks.
    const local=simulation.agents.filter(a=>Math.abs(a.progress-observationProgress)<35);
    const waiting=local.filter(a=>a.waiting).length, changing=local.filter(a=>a.laneChange).length;
    const mean=local.length?local.reduce((n,a)=>n+a.speed,0)/local.length*3.6:0;
    updateElement('local-traffic-status', { textContent: observationMode==='lake'?'湖岸步道 · 水生植物簇 · 灯具日间关闭':`前后 35 m · 去向 ${local.filter(a=>a.direction!==-1).length} / 回向 ${local.filter(a=>a.direction===-1).length} 人 · ${waiting} 人等候 · ${changing} 人穿插 · ${mean.toFixed(1)} km/h` });
    const panel = $('commute-panel');
    if (panel) Object.assign(panel.dataset, {
      arrivals: simulation.stats.arrivals,
      scooters: simulation.stats.scooterCount,
      routeMetres: route.length.toFixed(1),
      sourceSignals: route.trafficSignals.length,
      opposing: simulation.stats.opposingCount ?? 0,
      origins: route.trafficOrigins?.length ?? 1,
      originBuilding: route.start.buildingId,
      destination: route.options.destination,
    });
  }
  function stopFollow() {
    player?.exit();
    followId = null; lastFollow = null;
    updateElement('journey-hud', { hidden: true });
    updateElement('start-commute', { innerHTML: '跟随早八车流 <span>→</span>' });
  }
  function prepareView() {
    cancelCameraAnimation();
    enable3D();
    controls.minDistance = 8;
    updateElement('inspect', { hidden: true });
  }
  function cameraAt(pose, { height = 12, behind = 24, side = 8, snap = true, blend = .12 } = {}) {
    const dx = pose.dx ?? -Math.sin(pose.yaw), dz = pose.dz ?? -Math.cos(pose.yaw);
    // Follow the road around bends instead of extending a tangent into trees
    // or a building on the outside of the corner.
    const back = simulation.getPoseAt(Math.max(0, pose.progress - behind), pose.lane ?? 1, pose.type || 'scooter');
    const ahead = simulation.getPoseAt(Math.min(route.length, pose.progress + 8), pose.lane ?? 1, pose.type || 'scooter');
    const startOffset = Math.max(0, behind - pose.progress);
    const target = new THREE.Vector3(ahead.x, (ahead.y || 0) + 1.2, ahead.z);
    const position = new THREE.Vector3(back.x - dx * startOffset - dz * side,
      (back.y || 0) + height, back.z - dz * startOffset + dx * side);
    if (snap) { camera.position.copy(position); controls.target.copy(target); }
    else { camera.position.lerp(position, blend); controls.target.lerp(target, blend); }
    invalidate();
  }
  function observe(progress) {
    observationProgress=progress; observationMode='route';
    stopFollow(); prepareView();
    const pose = simulation.getPoseAt(progress, 1);
    cameraAt(pose, { height: 2.8, behind: 15, side: 0 });
    updateElement('route-position-slider', { value: progress / route.length * 100 });
    updateElement('route-position', { textContent: stage(progress) });
  }
  function junctionView() {
    const progress = Math.max(0, (route.trafficSignals[0]?.progress ?? route.length * .5) - 16);
    observe(progress);
  }
  function spawnView() {
    const pose=getCampusPlayerSpawn(model);
    if(!pose){junctionView();return;}
    stopFollow();prepareView();
    const dx=-Math.sin(pose.yaw),dz=-Math.cos(pose.yaw);
    camera.position.set(pose.x-dx*10,7.5,pose.z-dz*10);
    controls.target.set(pose.x+dx*7,2.6,pose.z+dz*7);
    camera.lookAt(controls.target);invalidate();
  }
  function routeView() {
    stopFollow(); prepareView();
    const box = new THREE.Box3();
    route.points.forEach(p => box.expandByPoint(new THREE.Vector3(p.x, p.y || 0, p.z)));
    focusBox(box.expandByScalar(45), 'oblique');
  }
  function riderDetail() {
    stopFollow(); prepareView();
    const progress = observationProgress;
    const rider = simulation.agents.filter(a => a.type === 'scooter'&&a.direction!==-1)
      .reduce((best, a) => !best || Math.abs(a.progress - progress) < Math.abs(best.progress - progress) ? a : best, null);
    if (!rider) { notify('当前路段没有骑行者，可切换时间段后查看。'); return; }
    observationProgress=rider.progress; observationMode='route';
    running = false;
    controls.minDistance = 2.5;
    const dx = -Math.sin(rider.yaw), dz = -Math.cos(rider.yaw);
    controls.target.set(rider.x, rider.y + .95, rider.z);
    camera.position.set(rider.x - dx * 2.3 - dz * 2.7, rider.y + 1.9, rider.z - dz * 2.3 + dx * 2.7);
    updateElement('route-position', { textContent: '骑手近距离观察 · 已暂停' });
    updateUI(); visual.update(camera); invalidate();
  }
  function queueSideView() {
    stopFollow(); prepareView();
    const progress = Math.max(0, (route.trafficSignals[0]?.progress ?? route.length * .5) - 10);
    observationProgress=progress; observationMode='route';
    const p = simulation.getPoseAt(progress, 1);
    cameraAt(p, { height: 3.2, behind: 8, side: -5.5 });
    updateElement('route-position-slider', { value: progress / route.length * 100 });
    updateElement('route-position', { textContent: '路口侧面 · 观察错位排队' });
  }
  function detailView(name) {
    stopFollow(); prepareView();
    const bridge = route.segments.find(s => s.bridge);
    const crossing = route.crossings.find(c => c.tags?.crossing === 'marked');
    const lakeTurn = route.trafficSignals.find(s=>s.id==='user-confirmed/dongjiu-lakeside-turn');
    const progress = name === 'bridge' && bridge ? (bridge.startProgress + bridge.endProgress) / 2
      : name === 'lake-turn' && lakeTurn ? lakeTurn.progress - 10
      : name === 'crossing' && crossing ? crossing.progress : route.length * .84;
    const p = simulation.getPoseAt(progress, 1);
    observationProgress = progress; observationMode=(name==='lake'||name==='plants')?'lake':'route';
    if (name === 'bridge') cameraAt(p, { height: 5.5, behind: 23, side: 3.5 });
    else if (name === 'lake-turn') cameraAt(p,{height:9,behind:24,side:-5});
    else if (name === 'crossing') {
      const dx=p.dx,dz=p.dz;
      camera.position.set(p.x-dx*7-dz*6,p.y+4,p.z-dz*7+dx*6);
      controls.target.set(p.x,p.y+.3,p.z);
    } else if(name==='plants') {
      camera.position.set(82,1.75,11);
      controls.target.set(89.5,.25,17.8);
    } else {
      // From the mapped north-shore road toward the source lake and A wing.
      camera.position.set(69,3.3,4);
      controls.target.set(122,.7,55);
    }
    updateElement('route-position-slider', { value: progress/route.length*100 });
    updateElement('route-position', { textContent: {bridge:'桥面 · 接缝与栏杆','lake-turn':'过桥后红绿灯 · 左转入湖边弯道',crossing:'过街 · 路缘与标线',lake:'东九湖 · 水生植物与路灯',plants:'近岸圆叶 · 形态与分布为估计'}[name] });
    updateUI(); visual.update(camera); invalidate();
  }
  function startFollow() {
    observationMode='route';
    stopFollow(); prepareView();
    visible = true; updateElement('show-commute', { checked: true }); visual.setVisible(true);
    running = true;
    // Start with an actual commuter, so the camera waits and queues with traffic.
    const rider = simulation.agents.filter(a => a.type === 'scooter'&&a.direction!==-1)
      .reduce((best, a) => !best || a.progress < best.progress ? a : best, null);
    if (!rider) { notify('当前没有骑行者；调高车流或切换时间段后再出发。'); return; }
    followId = rider.id; lastFollow = { ...rider };
    followStartedAt=simulation.state.elapsed;followWaitedAt=rider.waitingTime||0;
    updateElement('journey-hud', { hidden: false });
    updateElement('start-commute', { innerHTML: '跟随骑行中 <span>●</span>' });
    cameraAt(rider, { height: 2.8, behind: 9, side: 0 });
    updateUI();
  }
  function changedScenario() {
    stopFollow(); visual.update(camera); updateUI(); invalidate();
  }
  function updateRouteLabels(){
    updateElement('route-dorm', { value: route.options.dormId });updateElement('route-access', { value: route.options.startAccess });updateElement('route-destination', { value: route.options.destination });
    const name=COMMUTE_DORMS.find(d=>d.id===route.options.dormId)?.name||route.start.name;
    const itineraryHeading = document.querySelector('.commute-itinerary>strong');
    if (itineraryHeading) itineraryHeading.textContent=`${name}出发 · ${route.options.destination==='bc-plaza'?'东九湖畔前场':'东九 A 区北侧'}`;
    updateElement('route-itinerary', { textContent: route.options.destination==='bc-plaza'?'宿舍区 → 十字路口 → 喻岱桥 → 左转进入东九':'宿舍区 → 十字路口 → 喻岱桥 → A 北步道' });
    updateElement('route-end-label', { textContent: route.options.destination==='bc-plaza'?'东九前场':'东九 A 座' });
    const walk=route.length-route.dismountProgress;
    updateElement('route-summary', { textContent: `地图路线约 ${(route.length/1000).toFixed(2)} km${walk>.5?` · 末段 ${Math.round(walk)} m 下车步行`:''}。${route.start.name}出发；${route.options.destination==='bc-plaza'?'到达湖畔停车区旁。':'到达 A 北步道。'}` });
    const exterior=document.querySelector('[data-exterior^="韵苑"]');
    if(exterior)exterior.dataset.exterior=fc.features.find(f=>f.id===route.start.buildingId)?.properties?.name||name;
  }
  function createPlayer(){const next=createPlayerExperience({THREE,scene,camera,controls,canvas,model,route,simulation,scooterTransport:visual.scooterTransport,onEnter:()=>{stopFollow();prepareView();},notify,invalidate});next.setSuspended(suspended);return next;}
  function changeRoute(){
    // Build the next source route before disposing a playable existing scene.
    let next;try{next=createCommuteRoute(fc,{frame,geoToLocal,dormId:$('route-dorm')?.value ?? route.options.dormId,startAccess:$('route-access')?.value ?? route.options.startAccess,destination:$('route-destination')?.value ?? route.options.destination});}catch(error){notify(error.message);updateRouteLabels();return;}
    const settings={...simulation.state.settings,startMinutes:simulation.state.clockMinutes,seed:943108};
    stopFollow();player.dispose();visual.dispose();route=next;
    simulation=createCommuteSimulation(route,settings);visual=createCommuteScene(THREE,scene,route,simulation,{model});visual.setDetailDistanceScale(detailDistanceScale);visualCadence.invalidate();onRouteChange(route);player=createPlayer();
    observationProgress=0;observationMode='route';previousCamera.set(Infinity,Infinity,Infinity);
    updateElement('route-position-slider', { value: 0 });updateElement('route-position', { textContent: route.start.name });
    updateRouteLabels();visual.setVisible(visible);updateUI();routeView();
  }
  for(const dorm of COMMUTE_DORMS){if(!fc.features.some(f=>f.id===dorm.id))continue;const option=document.createElement('option');option.value=dorm.id;option.textContent=dorm.name;$('route-dorm')?.append(option);}
  for(const id of['route-dorm','route-access','route-destination'])on($(id),'change',changeRoute);
  document.querySelectorAll('[data-detail-view]').forEach(button=>on(button,'click',()=>detailView(button.dataset.detailView)));
  on($('start-commute'), 'click', startFollow);
  on($('stop-follow'), 'click', stopFollow);
  on($('junction-view'), 'click', junctionView);
  on($('route-view'), 'click', routeView);
  on($('rider-detail'), 'click', riderDetail);
  on($('queue-side-view'), 'click', queueSideView);
  on($('pause-commute'), 'click', () => { running = !running; updateUI(); });
  on($('route-position-slider'), 'input', e => observe(Number(e.target.value) / 100 * route.length));
  on($('traffic-density'), 'change', e => {
    simulation.setDensity(Number(e.target.value)); changedScenario();
  });
  on($('traffic-density'), 'input', e => { updateElement('density-value', { textContent: Math.round(Number(e.target.value) * 100) + '%' }); });
  on($('scooter-share'), 'change', e => {
    simulation.setScooterShare(Number(e.target.value)); changedScenario();
  });
  on($('scooter-share'), 'input', e => { updateElement('scooter-value', { textContent: Math.round(Number(e.target.value) * 100) + '%' }); });
  on($('commute-speed'), 'change', e => { timeScale = Number(e.target.value); });
  on($('commute-signals'), 'change', e => { simulation.setSignals(e.target.checked); changedScenario(); });
  on($('show-commute'), 'change', e => {
    visible = e.target.checked; visual.setVisible(visible && ($('symbolic')?.checked ?? true));
    if (!visible) stopFollow(); invalidate();
  });
  document.querySelectorAll('[data-time]').forEach(button => on(button, 'click', () => {
    simulation.setTime(Number(button.dataset.time));
    document.querySelectorAll('[data-time]').forEach(b => b.classList.toggle('active', b === button));
    changedScenario();
  }));
  const loadPhotos = mountPhotoReferences($('photo-reference-grid'), EXPANDED_PHOTO_REFERENCES);
  on($('commute-evidence'), 'click', () => { loadPhotos(); $('commute-reference-dialog').showModal(); });
  on($('close-commute-reference'), 'click', () => $('commute-reference-dialog').close());
  updateElement('commute-panel', { hidden: false });
  updateRouteLabels();
  player = createPlayer();
  updateUI(); visual.update(camera);
  return {
    get route(){return route;},get simulation(){return simulation;},get visual(){return visual;},get player(){return player;}, junctionView, spawnView, routeView, stopFollow,
    get running() { return running; },
    get suspended() { return suspended; },
    setPerformanceBudget({trafficHz=60,detailDistanceScale:scale=1}={}) {
      visualCadence.setHz(trafficHz);
      if(scale!==detailDistanceScale){detailDistanceScale=scale;visual.setDetailDistanceScale(scale);visualCadence.invalidate();}
    },
    setSuspended(value) { suspended=!!value;player.setSuspended(suspended);invalidate(); },
    setVisible(threeD) { visual.setVisible(visible && threeD); visual.staticGroup.visible=threeD; if (!threeD) stopFollow(); },
    tick(dt) {
      if (disposed || suspended || !($('symbolic')?.checked ?? true) || document.hidden) return false;
      const playerChanged = player.tick(dt);
      simulation.setPlayerObstacle(player.active && player.state.mode!=='boat' ? player.state : null);
      if(player.active){observationProgress=player.state.progress;observationMode='route';}
      if (!visible) {
        const moved=camera.position.distanceToSquared(previousCamera)>.0001 || camera.quaternion.angleTo(previousDirection)>.001;
        if(moved){visual.updateStatic(camera);previousCamera.copy(camera.position);previousDirection.copy(camera.quaternion);}
        return moved || playerChanged;
      }
      visualCadence.advance(dt);
      let changed = playerChanged;
      if (running) { simulation.step(dt * timeScale); changed = true; }
      if (followId !== null) {
        const rider = simulation.getAgent(followId);
        if (rider && rider.phase !== 'arrived') {
          lastFollow = { ...rider }; observationProgress=rider.progress;
          cameraAt(rider, { height: 2.8, behind: 9, side: 0, snap: false, blend: 1 - Math.exp(-9 * dt * timeScale) });
          updateElement('journey-stage', { textContent: stage(rider.progress) });
          updateElement('journey-progress', { textContent: `${Math.round(rider.progress)} / ${Math.round(route.length)} m` });
          updateElement('journey-detail', { textContent: rider.waiting ? '等候放行 · 随队列前进' : rider.dismounted ? '已下车，步行通过入口台阶' : `电动车 · ${(rider.speed * 3.6).toFixed(1)} km/h` });
          updateElement('route-position-slider', { value: rider.progress / route.length * 100 });
          updateElement('route-position', { textContent: stage(rider.progress) });
          changed = true;
        } else if (lastFollow) {
          const duration=seconds=>{const total=Math.round(Math.max(0,seconds));return `${Math.floor(total/60)}分${total%60}秒`;};
          const elapsed=(rider?.arrivedAt??simulation.state.elapsed)-followStartedAt;
          const waited=(rider?.waitingTime??lastFollow.waitingTime??0)-followWaitedAt;
          const end = simulation.getPoseAt(route.length, 0, 'walk');
          cameraAt(end, { height: 6, behind: 12, side: 4 });
          followId = null; lastFollow = null;
          updateElement('journey-stage', { textContent: route.options.destination==='bc-plaza'?'抵达东九湖畔前场':'抵达东九 A 座入口' });
          updateElement('journey-progress', { textContent: `${Math.round(route.length)} m · 已到达` });
          updateElement('journey-detail', { textContent: `本次跟随 ${duration(elapsed)} · 等候 ${duration(waited)}（模拟时间）` });
          updateElement('start-commute', { innerHTML: '再次从宿舍出发 <span>→</span>' });
          changed = true;
        }
      }
      uiElapsed += dt;
      if (uiElapsed > .25) { updateUI(); uiElapsed = 0; }
      if ((running || camera.position.distanceToSquared(previousCamera) > .0001 ||
        camera.quaternion.angleTo(previousDirection) > .001) && visualCadence.take()) {
        visual.update(camera);
        previousCamera.copy(camera.position); previousDirection.copy(camera.quaternion);
        changed = true;
      }
      return changed;
    },
    dispose() { disposed = true; stopFollow(); player.dispose(); listeners.forEach(remove => remove()); visual.dispose();$('route-dorm')?.replaceChildren(); updateElement('commute-panel', { hidden: true }); },
  };
}
