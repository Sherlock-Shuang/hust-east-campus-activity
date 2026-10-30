import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  createLocalFrame,
  geoToLocal,
  localToGeo,
  geodesicDistance,
} from "./geospatial.js";
import { createGeoScene,setCartographicLinesVisible } from "./geo-scene.js";
import { createWaterDetails } from "./water-details.js";
import { applyRiverTerrain } from "./river-terrain.js";
import { createCampus3D, createCampus3DProgressive } from "./campus-3d.js";
import {getCampusPlayerSpawn} from './player-experience.js';
import {mergeCampusExtension} from './campus-data-merge.js';
import {campusLandmarkArrival} from './campus-landmark-arrival.js';
import { createCommuteExperience } from "./commute-experience.js";
import { mountCampusReferenceAtlas } from './campus-reference-atlas.js';
import { createCampusSports } from './campus-sports.js';
import { cacheStaticTransforms } from './render-performance.js';
import { createSurfaceMaterials, createMorningEnvironment, applyWorldUV } from "./surface-materials.js";
import "./survey.css";
import "./transport-ui.css";
import { createLiveExperience } from './live-experience.js';
import { createMobileRenderProfile } from './mobile-render-profile.js';
import { createPerformanceQuality } from './performance-quality.js';
import { mountPerformanceUI,readQualityPreference,getQualityStorage } from './performance-ui.js';
import {preloadSpiderGeometry} from './spider-model.js';
import './mobile-controls.css';
import './performance-ui.css';
import {createFrameMetrics} from './frame-metrics.js';
import {createGraphicsRecovery} from './graphics-recovery.js';
import {mountRuntimeDiagnostics} from './runtime-diagnostics.js';
import {createRenderCadence} from './render-cadence.js';
import {createGpuFrameTimer} from './gpu-frame-timer.js';
// Rendering no longer depends on the removed sidebar controls.
const layerSettings = { symbolic: true, building: true, road: true, water: true };
const $ = (id) => document.getElementById(id),
  canvas = $("map-canvas"),
  container = $("viewport");
// Prepare the authored skin off the UI thread while map data and static campus
// geometry load. No extra multi-megabyte model download or first-pickup build.
const startupStarted=performance.now(),startupTimings={};
const frameMetrics=createFrameMetrics();
const yieldBrowserTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const spiderGeometryReady=preloadSpiderGeometry();
canvas.dataset.spiderPreparation='preparing';
spiderGeometryReady.then(ready=>{canvas.dataset.spiderPreparation=ready?'prepared':'on-demand';});
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: "high-performance",
});
const renderCadence=createRenderCadence();
const gpuTimer=createGpuFrameTimer(renderer,{enabled:new URLSearchParams(location.search).get('diagnostics')==='1'&&new URLSearchParams(location.search).get('gpu')==='1'});
renderer.info.autoReset=false;
let lastRenderedAt=NaN,renderCpuAccumulator=0,firstDrawPending=false,lastPasses={};
let inputObservation=null;
const renderProfile=createMobileRenderProfile({coarsePointer:window.matchMedia('(any-pointer: coarse)').matches,maxTouchPoints:navigator.maxTouchPoints,width:innerWidth,height:innerHeight,devicePixelRatio});
const performanceQuality=createPerformanceQuality({deviceRatio:devicePixelRatio,handheld:renderProfile.handheld,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,mode:readQualityPreference()});
performanceQuality.setViewport(innerWidth,innerHeight);
let qualityBudget=performanceQuality.budget, appliedBudget=null, lastShadowAt=-Infinity;
let renderPixelRatio = qualityBudget.pixelRatio;
renderer.setPixelRatio(renderPixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = qualityBudget.shadowEnabled;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const surfaces = createSurfaceMaterials(THREE);
const daylight = createMorningEnvironment(THREE, renderer);
scene.background = daylight.background;
scene.environment = daylight.environment;
scene.environmentIntensity = .65;
scene.fog = new THREE.Fog('#cbd6d6', 480, 2900);
const camera = new THREE.PerspectiveCamera(44, 1, 1, 12000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// Street-level inspection must be able to look upward at a building. The old
// <90° limit silently lifted every eye-level view above its target window row.
controls.maxPolarAngle = Math.PI * 0.66;
controls.minDistance = 8;
controls.maxDistance = 9000;
scene.add(new THREE.HemisphereLight("#dbe9f2", "#878b73", 1.3));
const sun = new THREE.DirectionalLight("#fff1d9", 2.25);
const sunOffset = new THREE.Vector3(650, 520, 420);
// Hold the shadow grid in world/light space so camera movement does not make
// asphalt and foliage shadows crawl. Sizes are render settings, not site data.
const shadowDirection=sunOffset.clone().normalize();
const shadowRight=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),shadowDirection).normalize();
const shadowUp=new THREE.Vector3().crossVectors(shadowDirection,shadowRight).normalize();
const shadowTarget=new THREE.Vector3();
sun.position.copy(sunOffset);
sun.castShadow = qualityBudget.shadowEnabled;
sun.shadow.mapSize.set(qualityBudget.shadowMapSize,qualityBudget.shadowMapSize);
Object.assign(sun.shadow.camera, {
  left: -1800,
  right: 1800,
  top: 1800,
  bottom: -1800,
  near: 1,
  far: 4000,
});
sun.shadow.normalBias = 0.035;
sun.shadow.bias = -0.00006;
scene.add(sun);
scene.add(sun.target);
const datum = new THREE.Mesh(
  applyWorldUV(new THREE.PlaneGeometry(12000, 12000), 1, 'xy'),
  surfaces.ground,
);
datum.rotation.x = -Math.PI / 2;
datum.position.y = -0.08;
datum.receiveShadow = true;
scene.add(datum);
const grid = new THREE.GridHelper(6000, 120, "#b5c6b5", "#cdd8c8");
grid.position.y = -0.02;
grid.material.transparent = true;
grid.material.opacity = 0.45;
scene.add(grid);
grid.material.transparent = false;
grid.material.opacity = 1;
grid.material.depthTest = false;
grid.material.depthWrite = false;
grid.renderOrder = 1;
datum.renderOrder = 0;
let fc,
  sourceManifest,
  frame,
  model,
  campus,
  campusSports,
  waterDetails,
  riverTerrain,
  commute,
  selected,
  selectedBox,
  measureOn = false,
  measurePoints = [],
  measureGroup = new THREE.Group(),
  noticeTimer,
  animation = null,
  needsRender = true,
  viewMode = "oblique";
let liveControl, liveFrozen = false, graphicsSuspended=false,datasetLoading=false,campusBuildAbort;
const recoveryPanel=document.createElement('div');recoveryPanel.className='graphics-recovery';recoveryPanel.hidden=true;recoveryPanel.setAttribute('role','status');
const recoveryText=document.createElement('p'),recoveryButton=document.createElement('button');recoveryButton.textContent='重新载入校园';recoveryButton.type='button';recoveryPanel.append(recoveryText,recoveryButton);container.append(recoveryPanel);
const RECOVERY_POSE_KEY='campus-graphics-recovery-pose-v1';
let recoveryPose=null;
function suspendCampus(){const frozen=liveFrozen||graphicsSuspended||datasetLoading;commute?.setSuspended(frozen);controls.enabled=!frozen&&!commute?.player.active;needsRender=true;}
function observeFirstInput(event){
  if(startupTimings.firstVisibleInputObservedMs||liveFrozen||datasetLoading||!commute?.player.active)return;
  if(event.type==='keydown'&&!['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))return;
  if(event.target?.closest?.('input,textarea,button,select'))return;
  inputObservation={at:performance.now(),position:camera.position.clone(),quaternion:camera.quaternion.clone()};
}
canvas.addEventListener('pointermove',observeFirstInput);document.addEventListener('keydown',observeFirstInput);
recoveryButton.addEventListener('click',()=>{
  try{if(recoveryPose)sessionStorage.setItem(RECOVERY_POSE_KEY,JSON.stringify({createdAt:Date.now(),pose:recoveryPose}));}catch{}
  location.reload();
});
const graphicsRecovery=createGraphicsRecovery({canvas,
  onLost(){recoveryPose=commute?.player?.captureActivityPose?.();graphicsSuspended=true;suspendCampus();frameMetrics.reset();},
  onRestored(){
    scene.environment=daylight.rebuildEnvironment();
    appliedBudget=null;applyPerformanceBudget();renderer.resetState();resize();lastShadowAt=-Infinity;previous=performance.now();lastFrameRendered=false;
    graphicsSuspended=false;suspendCampus();frameMetrics.reset();gpuTimer.restore();renderer.info.autoReset=false;renderCadence.reset();lastRenderedAt=NaN;
  },
  onStatus(status){canvas.dataset.graphicsState=status;canvas.dataset.graphicsLosses=String(graphicsRecovery.lossCount);recoveryPanel.hidden=status==='ready';recoveryButton.hidden=status!=='reload-available';recoveryText.textContent=status==='reload-available'?'画面恢复暂未完成，可重新载入并保留活动身份与当前位置。':'正在恢复校园画面…';},
});
canvas.dataset.graphicsState='ready';
const buildId=typeof __CAMPUS_BUILD__==='string'?__CAMPUS_BUILD__:'local';canvas.dataset.buildId=buildId;
const diagnostics=mountRuntimeDiagnostics({document,window,canvas,renderer,scene,getReport:()=>({
  buildId,frame:frameMetrics.snapshot(),frameSession:frameMetrics.session(),gpu:gpuTimer.snapshot(),passes:{...lastPasses},startup:{...startupTimings},quality:{...qualityBudget},
  resourceObjects:{geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures},decorations:campus?.decorationStats,
  graphicsLosses:graphicsRecovery.lossCount,graphicsState:canvas.dataset.graphicsState,
  note:'Actual drawn frame intervals and CPU samples. Pass totals include shadow/reflection work unlike legacy final-render counters; mainCalls includes shadows. Resource counts are not GPU memory bytes. First-frame observations use the next RAF, not hardware presentation timestamps. GPU queries require diagnostics=1&gpu=1.',
})});
let pendingLandmark=new URLSearchParams(location.search).get('place');
const qualityUI=mountPerformanceUI({document,storage:getQualityStorage(),mode:qualityBudget.mode,onChange(mode){performanceQuality.setMode(mode);applyPerformanceBudget();canvas.focus({preventScroll:true});}});
function applyPerformanceBudget(){
  qualityBudget=performanceQuality.budget;
  if(qualityBudget===appliedBudget)return;
  appliedBudget=qualityBudget;
  if(renderPixelRatio!==qualityBudget.pixelRatio){renderPixelRatio=qualityBudget.pixelRatio;renderer.setPixelRatio(renderPixelRatio);}
  if(sun.shadow.mapSize.x!==qualityBudget.shadowMapSize){
    sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapPass?.dispose();sun.shadow.mapPass=null;
    sun.shadow.mapSize.set(qualityBudget.shadowMapSize,qualityBudget.shadowMapSize);
  }
  renderer.shadowMap.enabled=qualityBudget.shadowEnabled;
  sun.castShadow=qualityBudget.shadowEnabled;
  renderer.shadowMap.needsUpdate=true;lastShadowAt=-Infinity;
  waterDetails?.setReflectionBudget({enabled:qualityBudget.reflectionEnabled,intervalMs:qualityBudget.reflectionIntervalMs});
  commute?.setPerformanceBudget?.({trafficHz:qualityBudget.trafficHz,detailDistanceScale:qualityBudget.detailDistanceScale});
  liveControl?.setPerformanceBudget?.(qualityBudget);
  frameMetrics.mark('quality',{level:qualityBudget.level,pixelRatio:qualityBudget.pixelRatio,maxFps:qualityBudget.maxFps});
  qualityUI.update(qualityBudget);canvas.dataset.qualityMode=qualityBudget.mode;canvas.dataset.qualityLevel=qualityBudget.name;
  needsRender=true;
}
scene.add(measureGroup);
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 2;
const mouse = new THREE.Vector2(),
  plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const mapSurfaceMaterials = new WeakMap();
function toast(text) {
  $("notice").textContent = text;
  $("notice").classList.add("visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $("notice").classList.remove("visible"), 4200);
}
let viewportHeight = 800, viewportWidth = 1200;
function resize() {
  const r = container.getBoundingClientRect();
  viewportHeight = Math.max(1,r.height);
  viewportWidth = Math.max(1,r.width);
  performanceQuality.setViewport(viewportWidth,viewportHeight);
  applyPerformanceBudget();
  renderer.setSize(viewportWidth, viewportHeight);
  camera.aspect = viewportWidth / viewportHeight;
  camera.updateProjectionMatrix();
  needsRender = true;
}
window.addEventListener("resize", resize);
window.visualViewport?.addEventListener('resize',resize);
if(typeof ResizeObserver==='function')new ResizeObserver(resize).observe(container);
resize();
function updateScale() {
  const distance = camera.position.distanceTo(controls.target),
    height = viewportHeight;
  const mpp =
    (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) /
    height;
  let units = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].reduce(
    (best, v) =>
      Math.abs(v / mpp - 80) < Math.abs(best / mpp - 80) ? v : best,
    100,
  );
  const width = Math.max(10, units / mpp).toFixed(1) + "px";
  const label = (units >= 1000 ? units / 1000 + " km" : units + " m") + "（中心比例）";
  if ($("scale-bar").style.width !== width) $("scale-bar").style.width = width;
  if ($("scale-label").textContent !== label) $("scale-label").textContent = label;
}
function geometryBounds(record) {
  const object = layerSettings.symbolic && campus?.records.get(record.id)?.group;
  return new THREE.Box3().setFromObject(object || record.group);
}
function fitBox(box, mode = viewMode) {
  commute?.stopFollow();
  const center = box.getCenter(new THREE.Vector3()),
    size = box.getSize(new THREE.Vector3());
  center.y = mode === "top" ? 0 : Math.min(12, size.y * 0.45);
  const extent = Math.max(65, size.x / Math.max(camera.aspect, 0.55), size.z);
  const distance = extent * (mode === "top" ? 1.55 : 1.5);
  const pos =
    mode === "top"
      ? new THREE.Vector3(center.x, Math.max(80, distance), center.z + 0.001)
      : new THREE.Vector3(
          center.x + distance * 0.61,
          center.y + distance * 0.53,
          center.z + distance * 0.64,
        );
  animation = {
    from: camera.position.clone(),
    to: pos,
    targetFrom: controls.target.clone(),
    target: center,
    time: 0,
  };
}
function focusLawnLandmark(key,withReference=false){
  const view=campus?.lawnLandmarkPlan?.inspections[key];if(!view)return;
  commute?.player?.exit();commute?.stopFollow();
  layerSettings.symbolic=true;applyLayers();syncStats();clearSelected();$("inspect").hidden=true;
  const target=new THREE.Vector3(...view.target),position=new THREE.Vector3(...view.position);
  // Keep both shelters in frame on a narrow canvas beside the campus sidebar.
  if(key==='lake')position.sub(target).multiplyScalar(Math.max(1,1.15/Math.max(.55,camera.aspect))).add(target);
  if(withReference){
    const direction=position.clone().sub(target),right=new THREE.Vector3(direction.z,0,-direction.x).normalize();
    const panelWidth=container.querySelector('.campus-atlas')?.getBoundingClientRect().width||304;
    const shift=direction.length()*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)*camera.aspect*panelWidth/viewportWidth;
    target.addScaledVector(right,shift);position.addScaledVector(right,shift);
  }
  animation={from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),target,time:0};
  viewMode='oblique';$("oblique").classList.add('active');$("top").classList.remove('active');needsRender=true;
}
document.querySelectorAll('[data-landmark-view]').forEach(button=>button.addEventListener('click',()=>focusLawnLandmark(button.dataset.landmarkView)));
document.querySelectorAll('[data-sports-view]').forEach(button=>button.addEventListener('click',()=>{
  const view=campusSports?.inspections[button.dataset.sportsView];if(!view)return;
  commute?.player?.exit();commute?.stopFollow();layerSettings.symbolic=true;layerSettings.water=true;applyLayers();syncStats();clearSelected();$("inspect").hidden=true;
  const target=new THREE.Vector3(...view.target),position=new THREE.Vector3(...view.position);
  position.sub(target).multiplyScalar(Math.max(1,.9/Math.max(.55,camera.aspect))).add(target);
  animation={from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),target,time:0};
  viewMode='oblique';$("oblique").classList.add('active');$("top").classList.remove('active');needsRender=true;
  toast('东操场细节 · 围栏高度、台阶级数和入口为照片与地图推定');
}));
mountCampusReferenceAtlas({container,button:$("campus-reference-toggle"),onFocus(view){
  if(!model)return;
  if(view.landmarkView){focusLawnLandmark(view.landmarkView,true);return;}
  commute?.stopFollow();
  layerSettings.symbolic=true;applyLayers();syncStats();clearSelected();$("inspect").hidden=true;
  const box=new THREE.Box3();
  for(const id of view.ids){const record=model.records.find(r=>r.id===id);if(record)box.union(geometryBounds(record));}
  if(box.isEmpty())return;
  box.expandByScalar(view.padding||0);
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());center.y=5;
  let distance=Math.max(80,size.x/Math.max(.65,camera.aspect),size.z)*(view.scale||1);
  if(view.id==='lake'){const primary=model.records.find(r=>r.id===view.ids[0]);if(primary){const anchor=geometryBounds(primary).getCenter(new THREE.Vector3());center.lerp(anchor,.5);center.y=5;}}
  // Place the subject in the unobscured two thirds next to the photo panel.
  const right=new THREE.Vector3(view.direction[2],0,-view.direction[0]).normalize();
  const direction=new THREE.Vector3(...view.direction);
  if(view.fitAvailable){
    // Fit the actual building into the free space beside the reference photo,
    // including depth foreshortening. A fixed pan cropped the canteen on narrow
    // windows and moved the camera behind its neighbouring dormitory.
    direction.normalize();
    const up=new THREE.Vector3().crossVectors(direction,right).normalize();
    const panelWidth=container.querySelector('.campus-atlas')?.getBoundingClientRect().width||304;
    const freeFraction=THREE.MathUtils.clamp((viewportWidth-panelWidth-28)/viewportWidth,.35,.85);
    const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2),tanH=tanV*camera.aspect;
    let halfW=0,halfH=0,halfD=0;
    for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){
      const p=new THREE.Vector3(x,y,z).sub(center);halfW=Math.max(halfW,Math.abs(p.dot(right)));halfH=Math.max(halfH,Math.abs(p.dot(up)));halfD=Math.max(halfD,Math.abs(p.dot(direction)));
    }
    distance=Math.max(halfW/(tanH*freeFraction*.92),halfH/(tanV*.8))+halfD;
    center.addScaledVector(right,distance*tanH*(1-freeFraction));
  }else center.addScaledVector(right,distance*.27);
  const to=center.clone().add(direction.multiplyScalar(distance));
  animation={from:camera.position.clone(),to,targetFrom:controls.target.clone(),target:center,time:0};
  viewMode='oblique';$("oblique").classList.add('active');$("top").classList.remove('active');needsRender=true;
}});
function globalBox() {
  const bbox = fc.viewBbox || sourceManifest.scope?.recommendedViewBbox || fc.requestedBbox;
  if (bbox?.length === 4) {
    const b = new THREE.Box3();
    for (const longitude of [bbox[0], bbox[2]])
      for (const latitude of [bbox[1], bbox[3]]) {
        const p = geoToLocal(
          { longitude, latitude, coordinateSystem: "EPSG:4326" },
          frame,
        );
        b.expandByPoint(new THREE.Vector3(p.x, 0, p.z));
      }
    return b;
  }
  const b = model.bounds;
  return new THREE.Box3(
    new THREE.Vector3(b.minX, 0, b.minZ),
    new THREE.Vector3(b.maxX, b.maxY, b.maxZ),
  );
}
function fullView() {
  selected = null;
  $("inspect").hidden = true;
  clearSelected();
  const box = new THREE.Box3();
  for (const record of model.buildings.filter((r) =>
    /东九|韵苑/.test(r.feature.properties.name || ""),
  ))
    box.union(geometryBounds(record));
  fitBox(box.isEmpty() ? globalBox() : box.expandByScalar(45));
}
function homeView() {
  selected = null;
  clearSelected();
  $("inspect").hidden = true;
  const eastNine = model.buildings.find((r) => r.id === "way/1023544717");
  if (eastNine) fitBox(geometryBounds(eastNine).expandByScalar(30), "oblique");
  else fullView();
  viewMode = "oblique";
  $("oblique").classList.add("active");
  $("top").classList.remove("active");
}
function clearSelected() {
  if (selectedBox) {
    scene.remove(selectedBox);
    selectedBox.geometry.dispose();
    selectedBox.material.dispose();
    selectedBox = null;
  }
  needsRender = true;
}
const labelLayer = document.createElement("div");
labelLayer.className = "landmark-labels";
container.append(labelLayer);
let labels = [];
function createLabels() {
  labels = [];
  labelLayer.replaceChildren();
  for (const name of [
    "东九教学楼",
    "韵苑二十七栋",
    "韵苑学生食堂",
    "东校区图书馆",
    "韵苑体育馆",
    "东操场",
    "东九湖",
    "计算机与人工智能大楼",
  ]) {
    const record = model.records.find(
      (r) => r.feature.properties.name === name,
    );
    if (!record) continue;
    const el = document.createElement("button");
    el.className = "landmark";
    el.textContent = name;
    el.onclick = () => selectRecord(record, true);
    labelLayer.append(el);
    labels.push({
      record,
      el,
      point: geometryBounds(record).getCenter(new THREE.Vector3()),
    });
  }
}
function updateLabels() {
  // At player camera distances all landmark labels are hidden. Avoid reading
  // layout or projecting their geometry on every flight frame in this case.
  if (camera.position.distanceTo(controls.target) <= 95) {
    for (const {el} of labels) if (!el.hidden) el.hidden = true;
    return;
  }
  const occupied = [];
  for (const { record, el, point } of labels) {
    const displayObject =
      layerSettings.symbolic && campus?.records.get(record.id)?.group;
    const worldPoint = point.clone();
    worldPoint.y = layerSettings.symbolic
      ? (campus?.records.get(record.id)?.height || 0) + 5
      : 0;
    const p = worldPoint.project(camera),
      x = (p.x * 0.5 + 0.5) * viewportWidth,
      y = (-p.y * 0.5 + 0.5) * viewportHeight;
    let visible =
      camera.position.distanceTo(controls.target) > 95 &&
      p.z > -1 &&
      p.z < 1 &&
      x > 55 &&
      x < viewportWidth - 55 &&
      y > 108 &&
      y < viewportHeight - 65 &&
      (displayObject
        ? displayObject.parent.visible
        : record.group.parent.visible);
    if (occupied.some((o) => Math.abs(o.x - x) < 120 && Math.abs(o.y - y) < 28))
      visible = false;
    el.hidden = !visible;
    if (visible) {
      el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      occupied.push({ x, y });
    }
  }
}
function categoryName(c) {
  return (
    {
      building: "建筑轮廓",
      road: "道路",
      water: "水域",
      green: "绿地 / 土地利用",
      sports: "运动场地",
      boundary: "边界",
    }[c] || "地图要素"
  );
}
function field(label, value) {
  const row = document.createElement("div"),
    dt = document.createElement("dt"),
    dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  row.append(dt, dd);
  return row;
}
function selectRecord(record, focus = false) {
  selected = record;
  clearSelected();
  const volume = layerSettings.symbolic && campus?.records.get(record.id);
  selectedBox = new THREE.BoxHelper(volume?.group || record.group, 0x2e8a78);
  selectedBox.material.depthTest = false;
  selectedBox.renderOrder = 500;
  scene.add(selectedBox);
  $("inspect").hidden = false;
  $("inspect-category").textContent = categoryName(record.category);
  $("inspect-name").textContent =
    record.feature.properties.name || "未命名要素";
  const p = record.feature.properties,
    rows = $("inspect-fields");
  rows.replaceChildren();
  rows.append(field("来源 ID", p.osmId || record.feature.id || record.id));
  rows.append(field("平面位置", "公开源坐标 · 精度未实测"));
  if (record.category === "building") {
    if (volume?.profile) {
      rows.append(
        field(
          "模型高度",
          volume.profile.roofRidgeHeight
            ? `檐口 ${volume.profile.height.toFixed(1)} m / 屋脊 ${volume.profile.roofRidgeHeight.toFixed(1)} m · 估算`
            : `${volume.profile.height.toFixed(1)} m${volume.profile.heightEvidence === "source-height" ? "" : " · 估算"}`,
        ),
      );
      rows.append(field("高度依据", volume.profile.heightDescription));
    }
    rows.append(
      field(
        "源高度标签",
        record.sourceHeight
          ? record.sourceHeight.toFixed(1) + " m（源标签）"
          : "未提供",
      ),
    );
    rows.append(
      field("源数据楼层", record.levels ? record.levels + " 层" : "未提供"),
    );
    rows.append(
      field(
        "显示方式",
        volume
          ? "建筑实体 / 屋顶 / 立面细节"
          : record.heightMode === "part-outline"
            ? "建筑部件源轮廓"
            : record.heightMode === "symbolic-levels-times-3.2"
              ? "估算体量（非实测）"
              : record.sourceHeight
                ? "来源高度"
                : "仅平面轮廓",
      ),
    );
  }
  if (record.category === "road")
    rows.append(
      field(
        "道路宽度",
        volume?.profile?.width
          ? `${volume.profile.width.toFixed(1)} m · ${volume.profile.estimated ? "估算路宽" : "源标签"}`
          : record.widthMeters
            ? record.widthMeters + " m"
            : record.widthMode === "source-area-footprint"
              ? "源道路面边界；宽度标签未知"
              : "未知，仅显示中线",
      ),
    );
  if (p.sourceTimestamp || p.updatedAt || p.timestamp)
    rows.append(
      field(
        "源要素更新",
        (p.sourceTimestamp || p.updatedAt || p.timestamp).slice(0, 10),
      ),
    );
  const center = geometryBounds(record).getCenter(new THREE.Vector3()),
    ll = localToGeo({ x: center.x, y: 0, z: center.z }, frame);
  rows.append(
    field(
      "中心经纬度",
      `${ll.longitude.toFixed(6)}, ${ll.latitude.toFixed(6)}`,
    ),
  );
  const url = p.sourceUrl || p.source?.url || "";
  $("inspect-source").hidden = !url;
  if (url) $("inspect-source").href = url;
  if (focus) fitBox(geometryBounds(record).expandByScalar(25));
}
function syncStats() {
  const c = model.counts;
  $("data-status").textContent = layerSettings.symbolic
    ? "三维校园 · 建筑实体、立面与道路"
    : "源地图轮廓 · 平面校核模式";
  $("height-status").textContent = layerSettings.symbolic
    ? "平面位置源自地图；楼高、立面与路宽含估算"
    : `${c.unknownHeight} 个建筑要素缺高度 · 含 ${sourceManifest.counts?.buildingParts ?? 0} 个部件`;
}
function applyLayers() {
  if (!model) return;
  const threeD = layerSettings.symbolic;
  riverTerrain?.setEnabled(threeD);
  campus?.setVisible(threeD);
  if(campusSports)campusSports.group.visible=threeD&&layerSettings.water;
  waterDetails?.setVisible(threeD && layerSettings.water);
  commute?.setVisible(threeD);
  grid.visible = !threeD;
  setCartographicLinesVisible(model.group,!threeD);
  model.setLayerVisible("building", layerSettings.building && !threeD);
  model.setLayerVisible("road", layerSettings.road && !threeD);
  model.setLayerVisible("poi", !threeD);
  campus?.setLayerVisible("building", layerSettings.building);
  campus?.setLayerVisible("road", layerSettings.road);
  campus?.setLayerVisible("environment", layerSettings.water);
  model.setLayerVisible('sports',!threeD&&layerSettings.water);
  for (const n of ["water", "green", "other"])
    model.setLayerVisible(n, layerSettings.water);
  const coveredGreen=new Set(campus?.landcoverPlan?.coverages.map(c=>c.featureId)||[]);
  // Plan view retains the source map styling; the walkable scene uses surfaces
  // that receive tree/building shadows rather than unlit cartographic fills.
  for (const record of model.records) {
    if (!record.mesh?.isMesh || !['green', 'water', 'other'].includes(record.category)) continue;
    if (!mapSurfaceMaterials.has(record.mesh)) mapSurfaceMaterials.set(record.mesh, record.mesh.material);
    const tags = record.feature.properties?.tags || {};
    record.mesh.visible=!(threeD&&record.category==='green'&&coveredGreen.has(record.id));
    record.mesh.material = threeD
      ? record.category === 'water' ? waterDetails?.materialFor(record) || surfaces.water
        : record.category === 'green' ? surfaces.ground
        : tags.place === 'square' ? surfaces.paving : surfaces.ground
      : mapSurfaceMaterials.get(record.mesh);
    if (record.outline) record.outline.visible = !threeD;
  }
  needsRender = true;
}
function normalizeImport(data) {
  if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
    throw new Error("需要 GeoJSON FeatureCollection。");
  const crs =
    data.coordinateSystem ||
    data.metadata?.coordinateSystem ||
    data.crs?.properties?.name;
  if (
    ![
      "EPSG:4326",
      "WGS84",
      "urn:ogc:def:crs:OGC:1.3:CRS84",
      "urn:ogc:def:crs:EPSG::4326",
    ].includes(crs)
  )
    throw new Error(
      '请在文件顶层声明 coordinateSystem: "EPSG:4326"，确认坐标是 WGS 84 经纬度。',
    );
  data.coordinateSystem = "EPSG:4326";
  return data;
}
async function loadDataset(data, manifest = {}) {
  if(datasetLoading)throw new Error('地图正在加载，请完成后再导入。');
  datasetLoading=true;$("load-screen").hidden=false;suspendCampus();
  try{
  fc = normalizeImport(data);
  sourceManifest = manifest;
  const focus = fc.features.find((f) =>
    /东九教学楼/.test(f.properties?.name || ""),
  );
  let origin =
    manifest.origin || manifest.suggestedLocalOrigin || fc.metadata?.origin;
  if (origin?.coordinates)
    origin = {
      longitude: origin.coordinates[0],
      latitude: origin.coordinates[1],
    };
  if (Array.isArray(origin))
    origin = { longitude: origin[0], latitude: origin[1] };
  if (!origin) {
    const coords = focus?.geometry?.coordinates?.[0] || [114.424, 30.519];
    origin = Array.isArray(coords[0])
      ? { longitude: coords[0][0], latitude: coords[0][1] }
      : { longitude: 114.424, latitude: 30.519 };
  }
  frame = createLocalFrame({
    longitude: origin.longitude ?? origin.lng,
    latitude: origin.latitude ?? origin.lat,
    height: 0,
    coordinateSystem: "EPSG:4326",
  });
  commute?.dispose();
  commute = null;
  campusBuildAbort?.abort();campusBuildAbort=new AbortController();
  campus?.dispose();
  campusSports?.dispose();
  waterDetails?.dispose();
  riverTerrain?.dispose();
  model?.dispose();
  const geometryStarted=performance.now();
  $('load-screen').querySelector('small').textContent='准备地面与道路数据…';
  await yieldBrowserTask();
  model = createGeoScene(THREE, scene, fc, frame, geoToLocal);
  startupTimings.sourceSceneMs=performance.now()-geometryStarted;
  await yieldBrowserTask();
  campusSports=createCampusSports(THREE,model,{surfaces});model.sportsInfrastructure=campusSports.infrastructure;scene.add(campusSports.group);
  const campusStarted=performance.now();
  const initialPosition=getCampusPlayerSpawn(model)||{x:0,z:0};
  campus = await createCampus3DProgressive(THREE, model, { frame, geoToLocal },{initialPosition,getPosition:()=>commute?.player?.state||initialPosition,signal:campusBuildAbort.signal,yieldTask:yieldBrowserTask,onProgress:({stage})=>{if(datasetLoading)$('load-screen').querySelector('small').textContent=stage;needsRender=true;}});
  startupTimings.campusBuildMs=performance.now()-campusStarted;
  canvas.dataset.campusDetails='preparing';
  const buildingCampus=campus;
  campus.whenDetailedReady.then(result=>{
    if(campus!==buildingCampus||result.cancelled)return;
    canvas.dataset.campusDetails=result.error?'partial':'ready';startupTimings.detailsReadyMs=performance.now()-startupStarted;
    canvas.dataset.startupTimings=JSON.stringify(startupTimings);needsRender=true;
    if(result.error)console.warn('Campus detail preparation:',result.error);else syncStats();
  });
  await yieldBrowserTask();
  scene.add(campus.group);
  riverTerrain=applyRiverTerrain(THREE,{model,datum,surfaces});
  scene.add(riverTerrain.group);
  waterDetails=createWaterDetails(THREE,{records:model.water,reflection:true});
  waterDetails.setReflectionBudget({enabled:qualityBudget.reflectionEnabled,intervalMs:qualityBudget.reflectionIntervalMs});
  scene.add(waterDetails.group);
  applyLayers();
  canvas.dataset.staticTransformCount = String([campus.group,campusSports.group,riverTerrain.group]
    .reduce((count, group) => count + cacheStaticTransforms(group), 0));
  for(const group of campus.dynamicGroups||[])group.traverse(o=>{o.matrixAutoUpdate=true;o.matrixWorldAutoUpdate=true;});
  syncStats();
  clearMeasurements();
  createLabels();
  homeView();
  $('load-screen').querySelector('small').textContent='准备步行与交通…';
  await yieldBrowserTask();
  const playerStarted=performance.now();
  try {
    commute = createCommuteExperience({
      THREE, scene, camera, controls, canvas, model, fc, frame, geoToLocal,
      focusBox: fitBox, notify: toast,
      onRouteChange: route => campus.setDetailedRoadIds(route.segments.map(segment=>segment.sourceId)),
      invalidate: () => { needsRender = true; },
      cancelCameraAnimation: () => { animation = null; },
      enable3D: () => {
        layerSettings.symbolic = true;
        viewMode = "oblique";
        $("oblique").classList.add("active");
        $("top").classList.remove("active");
        clearSelected();
        applyLayers(); syncStats();
      },
    });
    const selector = document.querySelector('.transport-selector');
    if (selector) selector.hidden = false;
    commute.player.enter('walk');
    try{
      const saved=JSON.parse(sessionStorage.getItem(RECOVERY_POSE_KEY)||'null');
      if(saved&&Date.now()-saved.createdAt<300000&&Date.now()>=saved.createdAt){
        if(await commute.player.restorePreparedActivityPose(saved.pose))sessionStorage.removeItem(RECOVERY_POSE_KEY);
      }else sessionStorage.removeItem(RECOVERY_POSE_KEY);
    }catch{}
    commute.setPerformanceBudget?.({trafficHz:qualityBudget.trafficHz,detailDistanceScale:qualityBudget.detailDistanceScale});
  } catch (error) {
    const selector = document.querySelector('.transport-selector') || $("commute-panel");
    if (selector) selector.hidden = true;
    console.warn("This dataset has no supported commute route:", error);
  }
  startupTimings.playerBuildMs=performance.now()-playerStarted;
  startupTimings.worldReadyMs=performance.now()-startupStarted;
  // Kept for old reports; this is preparation, not a presented/input frame.
  startupTimings.interactiveMs=startupTimings.worldReadyMs;
  firstDrawPending=true;
  canvas.dataset.startupTimings=JSON.stringify(startupTimings);
  $("load-screen").hidden = true;
  liveControl?.sync();
  if (model.warnings.length)
    console.warn("Data layer warnings:", model.warnings);
  if(campus.warnings?.length)console.warn("Reconstruction warnings:",campus.warnings);
  }finally{datasetLoading=false;$("load-screen").hidden=true;suspendCampus();}
}
function exteriorView(name) {
  const r = model?.buildings.find(r => r.feature.properties.name?.includes(name));
  if (!r) return;
  commute?.player?.exit();commute?.stopFollow(); selected = null; clearSelected(); $("inspect").hidden = true;
  layerSettings.symbolic = true; applyLayers(); syncStats();
  if (name.includes('东九')) {
    const arcade=model.records.find(record=>record.id==='way/1528957937');
    if(!arcade){homeView();return;}
    const center=new THREE.Box3().setFromObject(arcade.group).getCenter(new THREE.Vector3());
    const target=center.clone();target.y=8.4;
    const position=center.clone().add(new THREE.Vector3(41,0,27));position.y=1.75;
    animation={from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),target,time:0};
    viewMode='oblique';$("oblique").classList.add('active');$("top").classList.remove('active');needsRender=true;
    toast('东九地面视角 · 五层主体与三排弧廊窗带，尺寸含估计');return;
  }
  if (r.id === 'way/103814566') {
    // Ground-level southeast view reveals both curved wings and the single
    // chamfered main tower. Fit the real projected width on narrow windows.
    const box=geometryBounds(r),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    // Stand near the open southeast crossroads: a distant bounding-box fit
    // flattened the curve and hid the entrance behind the adjacent dorm.
    center.x+=size.x*.20;center.z+=size.z*.31;center.y=5.1;
    const distance=74*Math.max(1,.73/camera.aspect);
    const position=center.clone().add(new THREE.Vector3(distance*.62,0,distance));position.y=4.2;
    animation={from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),target:center,time:0};
    toast('韵苑食堂 · 弧廊、主次门塔与柱廊后的教育超市');
    return;
  }
  // Inspect the photo-informed south facade at building scale. This is a
  // viewing aid, not a claim that its doorway has been surveyed here.
  const edges = [];
  for (const shape of r.shapes || []) {
    const ring = shape.getPoints();
    const sign = THREE.ShapeUtils.area(ring) < 0 ? -1 : 1;
    for (let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=-(b.y-a.y),length=Math.hypot(dx,dz);
      if(length<4)continue;
      edges.push({x:(a.x+b.x)/2,z:-(a.y+b.y)/2,tx:dx/length,tz:dz/length,nx:-dz/length*sign,nz:dx/length*sign,length});
    }
  }
  function inRing(x,z,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a.y>-z)!==(b.y>-z)&&x<(b.x-a.x)*(-z-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }return inside;}
  const blocked=(x,z)=>model.buildings.some(b=>b.shapes?.some(s=>inRing(x,z,s.getPoints())&&!s.holes.some(h=>inRing(x,z,h.getPoints()))));
  let chosen=null;
  const inspectionDistances=r.id==='way/103814566'?[54,48,42,36,28,22,16,12]:[36,28,22,16,12];
  for(const edge of edges.filter(e=>e.length>12)) for(const distance of inspectionDistances) {
    const vx=edge.nx+edge.tx*.2,vz=edge.nz+edge.tz*.2;
    let clear=true;
    for(let t=.5;t<=distance;t+=.75)if(blocked(edge.x+vx*t,edge.z+vz*t)){clear=false;break;}
    if(!clear)continue;
    const score=distance*2+Math.min(edge.length,80)*.5+(edge.nz>.5?18:0);
    if(!chosen||score>chosen.score)chosen={edge,distance,score};
    break;
  }
  if(!chosen){fitBox(geometryBounds(r).expandByScalar(4));return;}
  const {edge,distance}=chosen;
  const height=campus.records.get(r.id)?.height||14;
  const target=new THREE.Vector3(edge.x,Math.min(9,height*.46),edge.z);
  const position=new THREE.Vector3(edge.x+edge.nx*distance+edge.tx*distance*.2,Math.min(11,height*.65+1),edge.z+edge.nz*distance+edge.tz*distance*.2);
  animation={from:camera.position.clone(),to:position,targetFrom:controls.target.clone(),target,time:0};
  toast(`${r.feature.properties.name} · 照片参考外观，细节尺寸含估计`);
}
document.querySelectorAll('[data-exterior]').forEach(b=>b.onclick=()=>exteriorView(b.dataset.exterior));
document.querySelectorAll('[data-east-nine-walk]').forEach(button=>button.onclick=()=>{
  const pose=model?.architectureInfrastructure?.viewpoints[button.dataset.eastNineWalk];
  if(!pose||!commute?.player)return;
  // The nearest candidate is checked against the live traffic and architecture.
  let result;
  for(const offset of[0,.8,-.8,1.6,-1.6,2.4,-2.4]){
    result=commute.player.enterAt({...pose,z:pose.z+offset});if(result.ok)break;
  }
  if(result.ok)toast('楼下步行 · 鼠标环视，WASD 移动，L 锁定鼠标，V 切换视角');
  else toast(result.reason);
});
document.querySelectorAll("[data-focus]").forEach(
  (b) =>
    (b.onclick = () => {
      const r = model.buildings.find((r) =>
        (r.feature.properties.name || "").includes(b.dataset.focus),
      );
      if (r) selectRecord(r, true);
      else toast("当前数据中未找到该要素。");
    }),
);
$("focus-selected").onclick = () =>
  selected && fitBox(geometryBounds(selected).expandByScalar(25));
$("close-inspect").onclick = () => {
  selected = null;
  $("inspect").hidden = true;
  clearSelected();
};
$("reset-view").onclick = fullView;
$("home-view").onclick = homeView;
function changeView(mode) {
  commute?.stopFollow();
  viewMode = mode;
  $("top").classList.toggle("active", mode === "top");
  $("oblique").classList.toggle("active", mode === "oblique");
  const center = controls.target.clone(),
    distance = camera.position.distanceTo(center);
  animation = {
    from: camera.position.clone(),
    to:
      mode === "top"
        ? new THREE.Vector3(center.x, distance, center.z + 0.001)
        : new THREE.Vector3(
            center.x + distance * 0.61,
            center.y + distance * 0.53,
            center.z + distance * 0.64,
          ),
    targetFrom: center,
    target: center,
    time: 0,
  };
}
$("top").classList.remove("active");
$("oblique").classList.add("active");
$("top").onclick = () => changeView("top");
$("oblique").onclick = () => changeView("oblique");
$("help").onclick = () => $("precision-dialog").showModal();
$("close-help").onclick = () => $("precision-dialog").close();
$("precision-dialog").addEventListener("click", (e) => {
  if (e.target === $("precision-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
$("export").onclick = () => {
  if (!fc) return;
  const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "hust-east-campus-source.geojson";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    normalizeImport(data);
    await loadDataset(data);
    toast("已导入坐标数据；推定尺寸仅用于三维显示，不写回源数据。");
  } catch (error) {
    toast(error.message);
  }
  e.target.value = "";
};
function clearMeasurements() {
  measurePoints = [];
  for (const child of [...measureGroup.children]) {
    measureGroup.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
  $("measure-value").textContent = "点击第一个位置";
  $("measure-description").textContent = "再点击第二个位置，读取局部平面距离";
  needsRender = true;
}
$("clear-measure").onclick = clearMeasurements;
$("measure").onclick = () => {
  measureOn = !measureOn;
  $("measure").classList.toggle("active", measureOn);
  $("measurement").hidden = !measureOn;
  canvas.style.cursor = measureOn ? "crosshair" : "grab";
  if (measureOn) toast("点击两个地面位置进行量距；拖动仍可旋转。");
};
function addMeasure(point) {
  needsRender = true;
  if (measurePoints.length === 2) clearMeasurements();
  measurePoints.push(point.clone());
  const size = Math.max(
    0.6,
    camera.position.distanceTo(controls.target) * 0.0025,
  );
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(size, 12, 8),
    new THREE.MeshBasicMaterial({ color: "#b6863f", depthTest: false }),
  );
  dot.position.copy(point);
  dot.position.y = 0.6;
  dot.renderOrder = 15;
  measureGroup.add(dot);
  if (measurePoints.length === 1) {
    $("measure-value").textContent = "已选第一个位置";
    return;
  }
  const [a, b] = measurePoints,
    dist = Math.hypot(a.x - b.x, a.z - b.z),
    llA = localToGeo({ x: a.x, y: 0, z: a.z }, frame),
    llB = localToGeo({ x: b.x, y: 0, z: b.z }, frame);
  const geo = geodesicDistance(llA, llB);
  $("measure-value").textContent = dist.toFixed(2) + " m";
  $("measure-description").textContent =
    `椭球面距离 ${geo.toFixed(2)} m · 地面高程未纳入`;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, 0.8, a.z),
      new THREE.Vector3(b.x, 0.8, b.z),
    ]),
    new THREE.LineBasicMaterial({ color: "#b6863f", depthTest: false }),
  );
  line.renderOrder = 14;
  measureGroup.add(line);
}
let down;
canvas.addEventListener("pointerdown", (e) => {
  if (liveFrozen) { down = null; return; }
  if (commute?.player.active) { down = null; return; }
  animation = null;
  commute?.stopFollow();
  down = [e.clientX, e.clientY];
});
canvas.addEventListener("pointerup", (e) => {
  if (liveFrozen) return;
  if (commute?.player.active) return;
  if (
    !down ||
    Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 ||
    e.button !== 0 ||
    !model
  )
    return;
  const r = canvas.getBoundingClientRect();
  mouse.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    (-(e.clientY - r.top) / r.height) * 2 + 1,
  );
  raycaster.setFromCamera(mouse, camera);
  if (measureOn) {
    const p = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (p) addMeasure(p);
    return;
  }
  const hits = raycaster
    .intersectObjects([model.group, ...(campus ? [campus.group] : [])], true)
    .map((h) => {
      let o = h.object;
      let feature = h.object.userData.feature;
      const instanceId = h.object.userData.instanceFeatureIds?.[h.instanceId];
      if (instanceId) feature = campus?.records.get(instanceId)?.feature;
      while (o) {
        if (!o.visible) return null;
        feature ||= o.userData.feature;
        o = o.parent;
      }
      return feature ? { ...h, feature } : null;
    })
    .filter(Boolean);
  if (hits.length) {
    const feature = hits[0].feature,
      r = model.records.find((r) => r.feature === feature);
    if (r) selectRecord(r);
  }
});
controls.addEventListener("start", () => {
  animation = null;
  commute?.stopFollow();
});
let viewMetricsDirty = true, lastViewMetricsAt = -Infinity, shadowSpan = 1800;
const compassNeedle = document.querySelector(".compass svg");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
controls.addEventListener("change", () => {
  needsRender = true;
  viewMetricsDirty = true;
});
function updateShadowCamera(){
  const span = commute?.player.active ? 80 : Math.max(
    48,
    Math.min(1200, camera.position.distanceTo(controls.target) * 0.7),
  );
  const texel=span*2/sun.shadow.mapSize.x;
  shadowTarget.copy(controls.target);
  for(const axis of [shadowRight,shadowUp]){const coordinate=shadowTarget.dot(axis);shadowTarget.addScaledVector(axis,Math.round(coordinate/texel)*texel-coordinate);}
  sun.target.position.copy(shadowTarget);
  sun.position.copy(shadowTarget).add(sunOffset);
  if (span !== shadowSpan) {
    shadowSpan = span;
    Object.assign(sun.shadow.camera, {
      left: -span, right: span, top: span, bottom: -span, near: 1, far: 2400,
    });
    sun.shadow.camera.updateProjectionMatrix();
  }
}
let previous = performance.now();
let frameWindow=0,frameSamples=0,renderedSamples=0,renderWork=0,tickWork=0,sceneWork=0,drawWork=0;
let drawCalls=0,triangles=0,lastFrameCpu=0,lastFrameRendered=false,wasHidden=false,lastLabelAt=-Infinity;
function render(now) {
  requestAnimationFrame(render);
  const frameStart=performance.now(),elapsed=Math.max(0,now-previous),frozen=liveFrozen||graphicsSuspended||datasetLoading;
  const dt = wasHidden?0:Math.min(elapsed/1000,0.1);
  previous = now;
  if(document.hidden){renderCadence.reset();lastRenderedAt=NaN;renderCpuAccumulator=0;wasHidden=true;lastFrameRendered=false;frameWindow=frameSamples=renderedSamples=renderWork=tickWork=sceneWork=drawWork=0;return;}
  if(wasHidden){needsRender=true;lastShadowAt=-Infinity;}wasHidden=false;
  if(graphicsSuspended){renderCadence.reset();lastRenderedAt=NaN;renderCpuAccumulator=0;lastFrameRendered=false;return;}
  if(!$('load-screen').hidden){lastRenderedAt=NaN;lastFrameRendered=false;return;}
  applyPerformanceBudget();lastFrameRendered=false;
  if (animation && !frozen) {
    needsRender = true;
    animation.time += dt;
    const t = Math.min(1, animation.time / 0.65),
      u = t * t * (3 - 2 * t);
    camera.position.lerpVectors(animation.from, animation.to, u);
    controls.target.lerpVectors(animation.targetFrom, animation.target, u);
    if (t >= 1) animation = null;
  }
  const tickStart=performance.now();
  if(pendingLandmark&&!frozen&&commute?.player){
    const pose=campusLandmarkArrival(campus,pendingLandmark);pendingLandmark=null;
    if(pose){const arrived=commute.player.enterAt(pose);if(!arrived?.ok)toast('该导览位置暂不可达，请从校园步行前往');}
  }
  if (!frozen && commute?.tick(dt)) needsRender = true;
  if(!frozen&&!document.hidden&&layerSettings.symbolic&&commute?.running&&campus?.tick?.(dt,camera))needsRender=true;
  tickWork+=performance.now()-tickStart;
  if (waterDetails?.update(dt,{paused:frozen || (commute ? !commute.running : false),enabled:layerSettings.symbolic && layerSettings.water && !document.hidden && !reducedMotion.matches})) needsRender=true;
  if (!frozen && !commute?.player.active) {
    controls.update();
    if(camera.position.y<.6){camera.position.y=.6;camera.lookAt(controls.target);}
  }
  if (viewMetricsDirty && now-lastViewMetricsAt>=100) {
    updateScale();
    const angle=Math.atan2(camera.position.x-controls.target.x,camera.position.z-controls.target.z);
    compassNeedle.style.transform=`rotate(${angle}rad)`;
    viewMetricsDirty=false;lastViewMetricsAt=now;
  }
  if (liveControl?.tick(now)) needsRender = true;
  if(!needsRender||frozen){lastRenderedAt=NaN;renderCpuAccumulator=0;}
  if (needsRender && renderCadence.shouldRender(now,qualityBudget.maxFps)) {
    const sceneStart=performance.now();
    renderer.info.reset();gpuTimer.begin();
    // A ground-scale fog cutoff hid the far half of the campus in overview.
    // Keep normal street haze while retaining spatial context at aerial scale.
    const overviewLift=Math.max(0,camera.position.y-120);
    if(scene.fog.name!=='campus-tsunami-immersion'){scene.fog.near=480+overviewLift*.9;scene.fog.far=2900+overviewLift*1.3;}
    campus?.update?.(camera, { viewportHeight,detailDistanceScale:qualityBudget.detailDistanceScale });
    if(now-lastLabelAt>=100){updateLabels();lastLabelAt=now;}
    if(!frozen)waterDetails?.renderReflection(renderer,scene,camera,now);
    lastPasses.reflectionCalls=renderer.info.render.calls;lastPasses.reflectionTriangles=renderer.info.render.triangles;
    sceneWork+=performance.now()-sceneStart;
    const drawStart=performance.now();
    if(renderer.shadowMap.enabled&&(renderer.shadowMap.needsUpdate||now-lastShadowAt>=qualityBudget.shadowIntervalMs)){
      updateShadowCamera();renderer.shadowMap.needsUpdate=true;lastShadowAt=now;
    }
    renderer.render(scene, camera);gpuTimer.end();
    lastPasses.mainCalls=renderer.info.render.calls-lastPasses.reflectionCalls;
    lastPasses.mainTriangles=renderer.info.render.triangles-lastPasses.reflectionTriangles;
    drawWork+=performance.now()-drawStart;
    drawCalls=renderer.info.render.calls;
    triangles=renderer.info.render.triangles;
    lastFrameRendered=true;renderedSamples++;
    if(firstDrawPending){
      firstDrawPending=false;startupTimings.firstDrawSubmittedMs=performance.now()-startupStarted;
      requestAnimationFrame(()=>{startupTimings.firstFrameObservedMs=performance.now()-startupStarted;canvas.dataset.startupTimings=JSON.stringify(startupTimings);});
    }
    if(inputObservation&&(camera.position.distanceToSquared(inputObservation.position)>.0001||camera.quaternion.angleTo(inputObservation.quaternion)>.0001)){
      const inputAt=inputObservation.at;inputObservation=null;
      requestAnimationFrame(()=>{if(startupTimings.firstVisibleInputObservedMs)return;startupTimings.firstVisibleInputObservedMs=performance.now()-startupStarted;startupTimings.inputToObservedFrameMs=performance.now()-inputAt;canvas.dataset.startupTimings=JSON.stringify(startupTimings);});
    }
    needsRender = false;
  }
  lastFrameCpu=performance.now()-frameStart;
  renderCpuAccumulator+=lastFrameCpu;
  if(lastFrameRendered){
    const drawnInterval=now-lastRenderedAt;
    frameMetrics.sample({frameMs:drawnInterval,cpuMs:renderCpuAccumulator,drawCalls,triangles,active:!frozen&&Number.isFinite(lastRenderedAt)});
    performanceQuality.update({elapsedMs:drawnInterval,cpuMs:renderCpuAccumulator,active:!frozen&&Number.isFinite(lastRenderedAt),targetFrameMs:1000/qualityBudget.maxFps});
    lastRenderedAt=frozen?NaN:now;renderCpuAccumulator=0;
  }
  if(!document.hidden){
    frameWindow+=elapsed;frameSamples++;renderWork+=performance.now()-frameStart;
    if(frameWindow>=1200){const distribution=frameMetrics.snapshot();canvas.dataset.frameP50Ms=distribution.p50Ms.toFixed(2);canvas.dataset.frameP95Ms=distribution.p95Ms.toFixed(2);canvas.dataset.frameP99Ms=distribution.p99Ms.toFixed(2);canvas.dataset.frameLong100=String(distribution.longFrames100);canvas.dataset.frameSamples=String(distribution.sampleCount);canvas.dataset.frameWindowMs=distribution.windowMs.toFixed(1);canvas.dataset.frameRate=(renderedSamples*1000/frameWindow).toFixed(1);canvas.dataset.rafRate=(frameSamples*1000/frameWindow).toFixed(1);canvas.dataset.frameCpuMs=(renderWork/frameSamples).toFixed(1);canvas.dataset.tickMs=(tickWork/frameSamples).toFixed(1);canvas.dataset.sceneMs=(sceneWork/frameSamples).toFixed(1);canvas.dataset.drawMs=(drawWork/frameSamples).toFixed(1);canvas.dataset.drawCalls=String(drawCalls);canvas.dataset.triangles=String(triangles);canvas.dataset.renderPixelRatio=String(renderPixelRatio);canvas.dataset.gpuGeometries=String(renderer.info.memory.geometries);canvas.dataset.gpuTextures=String(renderer.info.memory.textures);frameWindow=frameSamples=renderedSamples=renderWork=tickWork=sceneWork=drawWork=0;}
  }else{frameWindow=frameSamples=renderedSamples=renderWork=tickWork=sceneWork=drawWork=0;}
}
camera.position.set(500, 1600, 900);
liveControl = createLiveExperience({THREE,scene,camera,canvas,container,
  tsunamiQuality:qualityBudget.level===0?'low':renderProfile.handheld?'mobile':'desktop',handheld:renderProfile.handheld,
  getPlayer:()=>commute?.player,
  getInteriors:()=>campus?.optoEntries||[],
  getWallText:()=>campus?.group.visible&&campus.layers.get('building')?.visible?campus.aiMuralPlan:[],
  onRuntimeBudgetChange({foreground,releaseDecorativeResources}){
    if(foreground)campus?.resumeDecorativeResources?.();
    else if(releaseDecorativeResources)campus?.releaseDecorativeResources?.();
    if(!foreground)renderer.renderLists.dispose();
    renderCadence.reset();lastRenderedAt=NaN;needsRender=true;
    frameMetrics.mark('foreground',{campus:foreground});
  },
  setSuspended(value){liveFrozen=value;suspendCampus();},
  invalidate:()=>{needsRender=true;},notify:toast,
});
liveControl.setPerformanceBudget?.(qualityBudget);
requestAnimationFrame(render);
try {
  const [data, manifest, extension] = await Promise.all([
    fetch("./data/east-campus.geojson").then((r) => {
      if (!r.ok) throw new Error("建筑数据尚未就绪");
      return r.json();
    }),
    fetch("./data/source-manifest.json").then((r) => (r.ok ? r.json() : {})),
    fetch('./data/opto-southeast.geojson').then(r=>{if(!r.ok)throw new Error('光电大楼补充地图未能载入');return r.json();}),
  ]);
  await loadDataset(mergeCampusExtension(data,extension), manifest);
} catch (error) {
  $("load-screen").querySelector("span").textContent = "数据尚未加载";
  $("load-screen").querySelector("small").textContent = error.message;
  console.error(error);
}

$("export-model").onclick = async () => {
  if (!model) return;
  const button = $("export-model");
  button.disabled = true;
  let snapshot, volumeSnapshot, waterSnapshot, fixtureSnapshot, terrainSnapshot, sportsSnapshot;
  try {
    const { GLTFExporter } = await import(
      "three/addons/exporters/GLTFExporter.js"
    );
    const exportScene = new THREE.Scene();
    snapshot = createGeoScene(THREE, exportScene, fc, frame, geoToLocal);
    sportsSnapshot=createCampusSports(THREE,snapshot,{surfaces});snapshot.sportsInfrastructure=sportsSnapshot.infrastructure;exportScene.add(sportsSnapshot.group);
    volumeSnapshot = createCampus3D(THREE, snapshot, { frame, geoToLocal });
    if(commute)volumeSnapshot.setDetailedRoadIds(commute.route.segments.map(segment=>segment.sourceId));
    volumeSnapshot.update(null);
    exportScene.add(volumeSnapshot.group);
    terrainSnapshot=applyRiverTerrain(THREE,{model:snapshot,surfaces});
    exportScene.add(terrainSnapshot.group);
    waterSnapshot=createWaterDetails(THREE,{records:snapshot.water,reflection:false});
    exportScene.add(waterSnapshot.group);
    for(const record of snapshot.records){
      if(!record.mesh?.isMesh)continue;
      if(record.category==='water')record.mesh.material=waterSnapshot.materialFor(record)||surfaces.water;
      if(record.category==='green'){record.mesh.material=surfaces.ground;if(volumeSnapshot.landcoverPlan?.coverages.some(c=>c.featureId===record.id))record.mesh.visible=false;}
      if(record.category==='other')record.mesh.material=surfaces.ground;
      if(record.outline)record.outline.visible=false;
    }
    if(commute){commute.visual.updateStatic(null);fixtureSnapshot=commute.visual.staticGroup.clone(true);fixtureSnapshot.visible=true;exportScene.add(fixtureSnapshot);commute.visual.updateStatic(camera);}
    snapshot.setLayerVisible("building", false);
    snapshot.setLayerVisible("road", false);
    snapshot.setLayerVisible("poi", false);
    snapshot.setLayerVisible("sports", false);
    setCartographicLinesVisible(snapshot.group,false);
    snapshot.group.userData = {
      description:
        "3D campus reconstructed from OpenStreetMap footprints. Heights, facade details and road widths include explicit estimates; not a measured digital twin.",
      units: "metres",
      coordinateSystem: "LOCAL_ENU",
      axes: frame.axes,
      origin: frame.origin,
      attribution: fc.attribution || "See source metadata",
      sourceScope: sourceManifest.scope,
    };
    volumeSnapshot.group.userData = {
      ...volumeSnapshot.group.userData,
      ...snapshot.group.userData,
    };
    const result = await new GLTFExporter().parseAsync(exportScene, {
      binary: true,
      onlyVisible: true,
    });
    const url = URL.createObjectURL(
      new Blob([result], { type: "model/gltf-binary" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "hust-east-campus-3d.glb";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(
      "已导出三维校园 GLB，含建筑、道路、桥梁、湖岸与沿途设施；估算依据保留在模型元数据中。",
    );
  } catch (error) {
    toast("导出失败：" + error.message);
  } finally {
    fixtureSnapshot?.traverse(o=>{if(o.isInstancedMesh)o.dispose();});
    waterSnapshot?.dispose();
    sportsSnapshot?.dispose();
    volumeSnapshot?.dispose();
    terrainSnapshot?.dispose();
    snapshot?.dispose();
    button.disabled = false;
  }
};
