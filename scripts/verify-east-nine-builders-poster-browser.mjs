// A private probe is appended only to an isolated production build. The
// published application gets no QA globals, audience records or test controls.
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const arg=(key,fallback)=>{const index=process.argv.indexOf(key);return index<0?fallback:process.argv[index+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/eastnine-builders-card/browser'));
const mobile=arg('--profile','desktop')==='mobile';
const requireFromRoot=createRequire(path.join(root,'package.json'));
const {build}=await import(pathToFileURL(requireFromRoot.resolve('vite')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const imagePath='/images/activity/hust-ai-builders-xiaohongshu.jpg';
const expectedHash='f8f3922bef8c7d6f6705b9c6a5561c61f2ebea67d5366dcb6782be2c8ba12779';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const work=await mkdtemp(path.join(tmpdir(),'east-nine-builders-poster-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');

const injection=`
const posterQaVisible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
const posterQaRect=element=>{const r=element?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null;};
const posterQaPose=p=>({x:p.x,y:p.y,z:p.z,yaw:p.yaw});
function posterQaObject(name){
 const matches=[];scene.traverse(object=>{if(object.name===name)matches.push(object);});
 const object=matches[0];if(!object)return{count:0};object.updateWorldMatrix(true,false);
 return{count:matches.length,uuid:object.uuid,visible:posterQaVisible(object),matrix:object.matrixWorld.toArray(),sourceId:object.userData.sourceId};
}
globalThis.__eastNinePosterQA={
 ready:()=>!!eastNineBuildersPoster?.placement&&!!commute?.player&&canvas.dataset.campusDetails==='ready'&&!liveControl?.frozen,
 view(kind='approach'){
  const pose=kind==='far'?{...getCampusPlayerSpawn(model),y:.14,pitch:0}:eastNineBuildersPoster.placement[kind];
  if(!pose)throw Error('Missing real walking viewpoint: '+kind);
  commute.setSuspended(false);animation=null;const result=commute.player.enterAt(pose);
  if(!result?.ok)throw Error('Walking viewpoint is inaccessible: '+kind+': '+result?.reason);
  needsRender=true;return{kind,pose,result};
 },
 turnAway(){const pose={...posterQaPose(commute.player.state),yaw:commute.player.state.yaw+Math.PI,pitch:0};const result=commute.player.enterAt(pose);if(!result?.ok)throw Error(result?.reason);needsRender=true;return pose;},
 read(){
  const experience=eastNineBuildersPoster,item=experience.placement,group=experience.group,panel=group.getObjectByName('east-nine-builders-original-image'),texture=panel?.material?.map;
  group.updateWorldMatrix(true,true);camera.updateMatrixWorld(true);
  const link=experience.link,rect=posterQaRect(link),saved=commute.player.captureActivityPose(),point=(u,v)=>new THREE.Vector3(item.x+item.nz*item.width*u,item.y+item.height*v,item.z-item.nx*item.width*u);
  const screen=[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]].map(([u,v])=>point(u,v).project(camera).toArray());
  const qrScreen=[[680,1040],[900,1040],[900,1260],[680,1260]].map(([x,y])=>point(x/987-.5,.5-y/1347).project(camera).toArray());
  const mobileRoot=document.getElementById('mobile-controls');
  const controls=[...document.querySelectorAll('#mobile-joystick, #mobile-controls button, .transport-selector button')].filter(element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return !element.hidden&&r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none';}).map(element=>({id:element.id||element.dataset.mobileAction||element.dataset.mobileHold||element.textContent.trim(),rect:posterQaRect(element)}));
  const center=rect&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
  return{placement:item,state:experience.state,nearby:experience.nearby,group:posterQaObject(group.name),panel:{uuid:panel?.uuid,side:panel?.material?.side,texture:!!texture,width:texture?.image?.naturalWidth??texture?.image?.width,height:texture?.image?.naturalHeight??texture?.image?.height,repeat:texture?.repeat.toArray(),offset:texture?.offset.toArray(),src:texture?.image?.currentSrc||texture?.image?.src},screen,qrScreen,
   front:(camera.position.x-item.x)*item.nx+(camera.position.z-item.z)*item.nz,link:{exists:!!link,hidden:link?.hidden,href:link?.href,target:link?.target,rel:link?.rel,text:link?.textContent,rect,topmost:!!link&&(center===link||link.contains(center)),count:document.querySelectorAll('.east-nine-builders-original').length},
   player:{...posterQaPose(commute.player.state),active:commute.player.active,mode:commute.player.state.mode,view:saved?.view},camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov},portalOpen:!!liveControl?.portalOpen,host:{paused:liveControl?.state?.paused,skyQrVisible:liveControl?.state?.skyQrVisible,phase:liveControl?.state?.phase},
   legacy:{field:posterQaObject('yunyuan16-group-qr'),sky:posterQaObject('activity-sky-qr')},mobile:{visible:!!mobileRoot&&!mobileRoot.hidden,view:mobileRoot?.dataset.view,coarse:matchMedia('(any-pointer: coarse)').matches,controls},viewport:{width:innerWidth,height:innerHeight},mode:atmosphere.mode};
 },
 probes(){
  const item=eastNineBuildersPoster.placement,n=new THREE.Vector3(item.nx,0,item.nz),eye=camera.position.clone(),support=[],blocked=[];
  campus.group.updateMatrixWorld(true);
  for(const u of[-.5,-.25,0,.25,.5])for(const v of[-.5,-.25,0,.25,.5]){
   const target=new THREE.Vector3(item.x+item.nz*u*item.width,item.y+v*item.height,item.z-item.nx*u*item.width);
   const backing=new THREE.Raycaster(target.clone().addScaledVector(n,.65),n.clone().negate(),0,1.3).intersectObject(campus.group,true)[0];
   support.push({u,v,component:backing?.object.userData.component,featureId:backing?.object.userData.featureId,distance:backing?.distance});
   const delta=target.clone().sub(eye),distance=delta.length(),hit=new THREE.Raycaster(eye,delta.normalize(),0,distance-.005).intersectObject(campus.group,true)[0];
   if(hit)blocked.push({u,v,component:hit.object.userData.component,name:hit.object.name});
  }
  return{support,blocked};
 }
};`;

const report={passed:false,root,mobileViewport:mobile,startedAt:new Date().toISOString(),errors:[],consoleErrors:[],shaderErrors:[],resourceErrors:[],screenshots:[],scope:'Isolated production build and temporary audience. Real first-person walking viewpoints, a building-height north-wall wrap with reversible window-detail masking, original unmodified portrait texture and native image-tab link, popup return, static wall transform, existing QR objects, distance gates, day/night screenshots, and optional touch/viewport emulation. Mobile results are browser emulation, not a physical-phone GPU test or an assertion that an external Xiaohongshu app opens.'};
let app,browser,context,page;
await mkdir(out,{recursive:true});
const read=()=>page.evaluate(()=>__eastNinePosterQA.read());
async function shot(name){await page.screenshot({path:path.join(out,name)});report.screenshots.push(name);}
const arraysClose=(a,b,tolerance)=>a.length===b.length&&a.every((value,index)=>Math.abs(value-b[index])<=tolerance);
function assertPose(before,after){
  assert.equal(after.player.active,before.player.active);assert.equal(after.player.mode,before.player.mode);assert.equal(after.player.view,before.player.view);
  for(const key of ['x','y','z','yaw'])assert.ok(Math.abs(before.player[key]-after.player[key])<1e-5,'Opening the original image changed player '+key);
  assert.ok(arraysClose(before.camera.position,after.camera.position,.035));assert.ok(arraysClose(before.camera.quaternion,after.camera.quaternion,.003));
  assert.equal(after.portalOpen,false,'The image link must not activate an activity portal');
}
function assertStatic(before,after){
  assert.equal(after.group.count,1);assert.equal(after.group.uuid,before.group.uuid);assert.equal(after.panel.uuid,before.panel.uuid);
  assert.ok(arraysClose(before.group.matrix,after.group.matrix,1e-10),'A wall poster must not turn or move to face the viewer');
  for(const key of ['field','sky']){assert.equal(after.legacy[key].count,1);assert.equal(after.legacy[key].uuid,before.legacy[key].uuid);assert.deepEqual(after.legacy[key].matrix,before.legacy[key].matrix);}
  assert.deepEqual(after.host,before.host,'Opening the card must not alter host/activity state');
}
function assertCard(state,{full=false}={}){
  assert.equal(state.state,'ready');assert.equal(state.group.visible,true);assert.equal(state.group.count,1);assert.equal(state.panel.side,0,'The wall uses a front-facing plane');
  assert.equal(state.panel.width,987);assert.equal(state.panel.height,1347);assert.deepEqual(state.panel.repeat,[1,1]);assert.deepEqual(state.panel.offset,[0,0]);
  assert.ok(state.front>0&&state.placement.nz<-.98);assert.equal(state.player.mode,'walk');assert.equal(state.player.view,'first');
  assert.ok(state.camera.position[1]-state.player.y>1.3&&state.camera.position[1]-state.player.y<1.9,'The camera remains at a real first-person eye height');
  assert.ok((full?state.screen:state.qrScreen).every(([x,y,z])=>Math.abs(x)<1&&Math.abs(y)<1&&z>-1&&z<1),full?'The full building-height poster fits in the road viewpoint':'The complete QR region fits in the near viewing position');
  assert.equal(state.link.count,1);assert.equal(state.link.hidden,false);assert.equal(state.link.target,'_blank');assert.match(state.link.rel,/(^|\s)noopener(\s|$)/);assert.equal(state.link.topmost,true);
  const r=state.link.rect;assert.ok(r.x>=0&&r.y>=0&&r.right<=state.viewport.width&&r.bottom<=state.viewport.height,'The original-image link fits the viewport');
  if(mobile){
    assert.equal(state.mobile.coarse,true);assert.equal(state.mobile.visible,true);assert.equal(state.mobile.view,'first');assert.ok(r.height>=44,'The touch target must be at least44px tall');
    for(const control of state.mobile.controls){const c=control.rect,overlap=Math.max(0,Math.min(r.right,c.right)-Math.max(r.x,c.x))*Math.max(0,Math.min(r.bottom,c.bottom)-Math.max(r.y,c.y));assert.equal(overlap,0,'The link overlaps touch control '+control.id);}
  }
}
async function view(kind){
  await page.evaluate(kind=>__eastNinePosterQA.view(kind),kind);
  await page.waitForFunction(()=>__eastNinePosterQA.read().state==='ready',null,{timeout:30000});
  await page.waitForTimeout(450);const state=await read();assertCard(state,{full:kind==='approach'});
  const probes=await page.evaluate(()=>__eastNinePosterQA.probes());assert.deepEqual(probes.blocked,[],kind+' must have clear whole-card sightlines');
  assert.ok(probes.support.every(hit=>hit.component==='teaching-wing'&&hit.featureId==='way/1023544717'&&Math.abs(hit.distance-.662)<.002),'The full card must stay flush to the original north wall after local facade covering');
  return{state,probes};
}

try{
 const original=await readFile(path.join(root,'public',imagePath));assert.equal(original.length,85529);assert.equal(hash(original),expectedHash);report.original={bytes:original.length,sha256:hash(original),width:987,height:1347};
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'isolated-east-nine-poster-probe',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\n'+injection;}}]});
 const initialState=createDefaultLiveState();app=await createLiveServer({rootDir:root,distDir:dist,dataDir,password:'isolated-east-nine-poster-only',workEnv:{},initialState});const hostState=app.getState(),address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(()=>{localStorage.setItem('campus-quality-mode-v1','smooth');localStorage.setItem('campus-time-of-day-v1','day');});
 const joined=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离东九北墙名片验收',tabId:'east-nine-builders-card-'+(mobile?'mobile':'desktop')}});assert.equal(joined.status(),200);
 page=await context.newPage();page.on('pageerror',error=>report.errors.push(error.message));page.on('response',response=>{if(response.status()>=400)report.resourceErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
 page.on('console',message=>{const text=message.text();if(message.type()==='error')report.consoleErrors.push(text);if(/THREE[.]WebGLProgram|shader.{0,40}(error|fail)|VALIDATE_STATUS.*false/i.test(text))report.shaderErrors.push(text);});
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});await page.waitForFunction(()=>globalThis.__eastNinePosterQA?.ready(),null,{timeout:90000});await page.waitForTimeout(500);
 report.initial=await read();assert.equal(report.initial.group.count,1);assert.equal(report.initial.legacy.field.count,1);assert.equal(report.initial.legacy.sky.count,1);
 if(Math.hypot(report.initial.player.x-report.initial.placement.x,report.initial.player.z-report.initial.placement.z)>245){assert.equal(report.initial.group.visible,false);assert.equal(report.initial.state,'idle','The far spawn must not fetch a new wall texture');}
 report.approach=await view('approach');assertStatic(report.initial,report.approach.state);await shot('north-road-approach-day.png');
 report.inspection=await view('inspection');assertStatic(report.approach.state,report.inspection.state);await shot('north-wall-card-close-day.png');

 // Use the same real link as a visitor. With noopener the new tab is observed
 // through the browser context; no application callback is invoked by QA.
 const beforeOpen=await read(),popupPromise=context.waitForEvent('page',{timeout:15000}),r=beforeOpen.link.rect;
 if(mobile)await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);else await page.mouse.click(r.x+r.width/2,r.y+r.height/2);
 const popup=await popupPromise;await popup.waitForLoadState('domcontentloaded',{timeout:30000});
 await popup.waitForFunction(()=>document.images.length===1&&document.images[0].complete&&document.images[0].naturalWidth>0,null,{timeout:30000});
 const opened=await popup.evaluate(()=>({url:location.href,openerNull:window.opener===null,width:document.images[0].naturalWidth,height:document.images[0].naturalHeight}));
 assert.equal(new URL(opened.url).pathname,imagePath);assert.equal(opened.openerNull,true);assert.equal(opened.width,987);assert.equal(opened.height,1347);
 const imageResponse=await context.request.get(opened.url);assert.equal(imageResponse.status(),200);const imageBytes=await imageResponse.body();assert.equal(hash(imageBytes),expectedHash,'The opened image must be byte-identical to the original card');
 report.openedOriginal={...opened,bytes:imageBytes.length,sha256:hash(imageBytes)};await popup.screenshot({path:path.join(out,'original-image-tab.png')});report.screenshots.push('original-image-tab.png');
 await popup.close();await page.bringToFront();await page.waitForTimeout(500);report.afterPopup=await read();assertPose(beforeOpen,report.afterPopup);assertStatic(beforeOpen,report.afterPopup);assertCard(report.afterPopup);

 await page.locator('#campus-time-of-day').selectOption('night');await page.waitForFunction(()=>__eastNinePosterQA.read().mode==='night',null,{timeout:5000});await page.waitForTimeout(350);
 report.night=await read();assertPose(report.afterPopup,report.night);assertStatic(report.afterPopup,report.night);assertCard(report.night);await shot('north-wall-card-close-night.png');
 await page.locator('#campus-time-of-day').selectOption('day');await page.waitForTimeout(250);
 await page.evaluate(()=>__eastNinePosterQA.turnAway());await page.waitForTimeout(300);report.turnedAway=await read();assert.equal(report.turnedAway.nearby,false);assert.equal(report.turnedAway.link.hidden,true);assertStatic(report.inspection.state,report.turnedAway);
 await page.evaluate(()=>__eastNinePosterQA.view('far'));await page.waitForTimeout(400);report.far=await read();
 assert.ok(Math.hypot(report.far.player.x-report.far.placement.x,report.far.player.z-report.far.placement.z)>245,'The normal spawn is outside the wall texture distance gate');assert.equal(report.far.group.visible,false);assert.equal(report.far.link.hidden,true);assertStatic(report.inspection.state,report.far);
 report.revisited=await view('inspection');assertStatic(report.inspection.state,report.revisited.state);assertPose(report.inspection.state,report.revisited.state);
 assert.deepEqual(app.getState(),hostState,'The test only joins a temporary audience and never changes host/activity state');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[],'Shaders must compile in real Chrome WebGL');assert.ok(!report.resourceErrors.some(error=>error.path===imagePath),'The original card must load without resource errors');
 report.passed=true;
}catch(error){report.failure=error.stack??error.message;process.exitCode=1;if(page){report.failureSnapshot=await read().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
