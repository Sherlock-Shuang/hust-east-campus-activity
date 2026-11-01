/** Transform only the already-anonymized activity copy, never the gift source. */
const replace=(source,from,to,label)=>{
  if(source.split(from).length!==2)throw new Error('Unexpected library runtime: '+label);
  return source.replace(from,to);
};
export function applyLibraryPerformance(source){
  if(source.includes('campus-library-assets-v2'))return applyLibraryRenderPerformance(source);
  let text="import {createLazyAsset,fetchGltf,disposeGltf} from '../library-asset-runtime.mjs';\n"+source;
  text=replace(text,'let mixer,idle,walk,walkWeight=0,cameraDistance=0,viewMode=\'first\';',"let mixer,idle,walk,walkWeight=0,cameraDistance=0,viewMode='first',heroReady=false,heroAssets=null,libraryAssets=null,assetsDisposed=false;",'character readiness');
  text=replace(text,'cameraPose(player,yaw,pitch,viewMode)','cameraPose(player,yaw,pitch,heroReady?viewMode:\'first\')','loading camera');
  text=replace(text,"actor.visible=viewMode==='third'&&cameraDistance>.60;","actor.visible=heroReady&&viewMode==='third'&&cameraDistance>.60;",'character visibility');
  text=replace(text,'setView(value){viewMode=normalizeView(value);',"setView(value){viewMode=normalizeView(value);if(ready&&viewMode==='third'&&!heroReady)ensureHero();",'lazy third person');
  const begin=text.indexOf('const loader=new GLTFLoader(),progresses='),end=text.indexOf('// Integration QA uses the exact production camera',begin);
  if(begin<0||end<0)throw new Error('Unexpected library runtime: asset block');
  const old=text.slice(begin,end),setup=old.slice(old.indexOf('scene.add(g.scene);'),old.indexOf('\n const hero=character.scene;'));
  const character=old.slice(old.indexOf(' const hero=character.scene;'),old.indexOf('\n ready=true;'));
  const ready=old.slice(old.indexOf(' ready=true;'),old.indexOf('}).catch(err=>'));
  const block=`// campus-library-assets-v2: first-person admission depends on the building only.
const assetStart=performance.now(),assetsController=new AbortController();
let assetConfig,loader;
function ensureHero(){
 if(assetsDisposed||!heroAssets)return;
 if(!heroReady)notice('第三人称角色准备中，仍可继续第一人称探索。','character-loading');
 void heroAssets.ensure();
}
(async()=>{
 const response=await fetch('/works/library/performance-assets.json',{cache:'no-cache',signal:assetsController.signal});
 if(!response.ok)throw new Error('活动模型配置载入失败');
 assetConfig=await response.json();
 const original=new URLSearchParams(location.search).get('assets')==='original';
 loader=new GLTFLoader();
 if(!original&&assetConfig.meshoptDecoder){const {MeshoptDecoder}=await import(assetConfig.meshoptDecoder);loader.setMeshoptDecoder(MeshoptDecoder);}
 if(assetsDisposed)return;
 heroAssets=createLazyAsset({
  load:signal=>fetchGltf(original?assetConfig.hero.original:assetConfig.hero.url,loader,{signal}),
  apply(character){${character}
   heroReady=true;updateCamera();
  },
  onState(state,error){document.documentElement.dataset.libraryHero=state;if(state==='failed'){setView('first');notice('角色未能加载，请再次切换第三人称重试。','character-failed');}if(state==='ready')notice('第三人称角色已就绪。');}
 });
 document.documentElement.dataset.libraryHero='idle';
 const g=await fetchGltf(original?assetConfig.library.original:assetConfig.library.url,loader,{signal:assetsController.signal,onProgress:e=>{$('#progress').style.width='92%';$('#load-status').textContent='模型已下载，正在准备画面…';}});
 if(assetsDisposed){disposeGltf(g);return;}libraryAssets=g;
 ${setup}
 ${ready}
 document.documentElement.dataset.libraryModelReadyMs=(performance.now()-assetStart).toFixed(1);
 document.documentElement.dataset.libraryAssetVariant=original?'original':'optimized';
 if(viewMode==='third')ensureHero();
})().catch(err=>{if(assetsDisposed)return;window.campusWorkAdapter?.fail('图书馆模型未能载入');$('#load-status').textContent='图书馆未能载入，请重试或返回校园。';$('#retry-load').hidden=false;});
`;
  text=text.slice(0,begin)+block+text.slice(end);
  text=replace(text,'get ready(){return ready;},get viewMode()',"get ready(){return ready;},get heroReady(){return heroReady;},get assets(){return assetConfig;},get viewMode()",'asset diagnostics');
  text=replace(text,'dispose(){\n    campusSuspended=true;',"dispose(){\n    assetsDisposed=true;assetsController.abort();heroAssets?.dispose();mixer?.stopAllAction();if(libraryAssets){disposeGltf(libraryAssets);libraryAssets=null;}\n    campusSuspended=true;",'asset disposal');
  return applyLibraryRenderPerformance(text);
}

/** Upgrade both a fresh activity build and an existing assets-v2 derivative. */
export function applyLibraryRenderPerformance(source){
  if(source.includes('campus-library-render-v3'))return source;
  let text=`import {freezeStaticLibrary,createLibraryRaycastIndex,createLibraryRayMemo,createLibraryDrawGate} from '../library-render-runtime.mjs';
// campus-library-render-v3: static work sleeps; movement and story keep their cadence.
const libraryDrawGate=createLibraryDrawGate(),libraryPickMemo=createLibraryRayMemo(),libraryCameraCache={x:NaN,z:NaN,yaw:NaN,pitch:NaN,view:null};
let libraryDirty=true,libraryLastNight=NaN,libraryStatic=null,libraryPickIndex=null,libraryPickCacheEnabled=false,libraryCameraUpdates=0;
`+source;
  text=replace(text,'hovered=book;for(const [id,mats]','hovered=book;libraryDirty=true;for(const [id,mats]','highlight redraw');
  text=replace(text,"function updateCamera(){const p=cameraPose(player,yaw,pitch,heroReady?viewMode:'first');",`function updateCamera(){
 const effectiveView=heroReady?viewMode:'first',c=libraryCameraCache;
 if(c.x===player.x&&c.z===player.z&&c.yaw===yaw&&c.pitch===pitch&&c.view===effectiveView)return;
 c.x=player.x;c.z=player.z;c.yaw=yaw;c.pitch=pitch;c.view=effectiveView;libraryCameraUpdates++;libraryDirty=true;
 const p=cameraPose(player,yaw,pitch,effectiveView);`,'unchanged camera');
  text=replace(text,'setView(value){viewMode=normalizeView(value);','setView(value){libraryDirty=true;viewMode=normalizeView(value);','view redraw');
  text=replace(text,'function updateActor(dt){','function updateActor(dt){\n if(!heroReady||!actor.visible||(isTouchLayout()&&phone.active))return;','hidden animation');
  text=replace(text,'const block=raycaster.intersectObjects(occluders,false)[0];','const block=libraryPickIndex?libraryPickIndex.nearest(raycaster):raycaster.intersectObjects(occluders,false)[0];','exact pick broadphase');
  const inspectStart=text.indexOf('function inspectBook(){'),inspectEnd=text.indexOf('\nfunction updateAim()',inspectStart);
  if(inspectStart<0||inspectEnd<0)throw new Error('Unexpected library runtime: book inspection');
  let inspect=text.slice(inspectStart,inspectEnd);
  // Snapshot near/far before the occlusion ray narrows far to the book surface.
  inspect=replace(inspect,' const hit=raycaster.intersectObjects(portals,false)[0];',` if(libraryPickMemo.reuse(raycaster,player.x,player.z,libraryPickCacheEnabled)){highlight(libraryPickMemo.value);return;}
 const hit=raycaster.intersectObjects(portals,false)[0];`,'static book memo');
  inspect=inspect.replaceAll('highlight(null);return;','libraryPickMemo.invalidate();highlight(null);return;');
  inspect=replace(inspect,'highlight(!block||block.distance>=hit.distance-.003?book:null);','const readable=!block||block.distance>=hit.distance-.003?book:null;libraryPickMemo.commit(readable);highlight(readable);','exact book result');
  text=text.slice(0,inspectStart)+inspect+text.slice(inspectEnd);
  text=replace(text,'  ready=true;loading.hidden=true;',`  libraryStatic=freezeStaticLibrary(g.scene,{animations:g.animations});
 libraryPickIndex=createLibraryRaycastIndex(THREE,occluders,libraryStatic.isStatic);libraryPickCacheEnabled=libraryPickIndex.staticOnly&&portals.every(libraryStatic.isStatic);libraryDirty=true;
  ready=true;loading.hidden=true;`,'static building setup');
  text=replace(text,'heroReady=true;updateCamera();','heroReady=true;libraryDirty=true;updateCamera();','character redraw');
  text=replace(text,'fireworks.setPixelRatio(renderer.getPixelRatio());});','fireworks.setPixelRatio(renderer.getPixelRatio());libraryDirty=true;});','resize redraw');
  text=replace(text,'function updateNight(dt){\n fireworks.update(dt);',`function updateNight(dt){
 if(!fireworks.active&&fireworks.night===0&&libraryLastNight===0)return;
 libraryDirty=true;fireworks.update(dt);libraryLastNight=fireworks.night;`,'constant daylight');
  text=replace(text,'if(!isTouchLayout()||!phone.active)renderer.render(scene,camera);',`if((!isTouchLayout()||!phone.active)&&libraryDrawGate.shouldDraw(now,libraryDirty,active&&(actor.visible||fireworks.active))){renderer.render(scene,camera);libraryDirty=false;}`,'unchanged frame rendering');
  text=replace(text,'get renderStats(){return {calls:',`get runtimeStats(){return {draw:libraryDrawGate.stats,cameraUpdates:libraryCameraUpdates,frozenNodes:libraryStatic?.count||0,pick:libraryPickIndex?.stats||null,pickMemoHits:libraryPickMemo.hits};},get renderStats(){return {calls:`,'read-only runtime diagnostics');
  text=replace(text,'assetsDisposed=true;assetsController.abort();','libraryPickIndex?.dispose();libraryStatic?.dispose();assetsDisposed=true;assetsController.abort();','render index disposal');
  return text;
}
