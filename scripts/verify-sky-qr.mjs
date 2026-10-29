// Run after npm run build. Uses the real dist campus/admin with isolated data.
// Optional PLAYWRIGHT_MODULE and CHROME_EXECUTABLE select local installations.
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';
import {LEARNING_BOARD} from '../src/activity-catalog.js';
import {access, mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=path.join(root,'artifacts/sky-qr-world-2026-10-29');
const exists=file=>access(file).then(()=>true,()=>false);
const bundledPlaywright=path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const moduleName=process.env.PLAYWRIGHT_MODULE||(await exists(bundledPlaywright)?pathToFileURL(bundledPlaywright).href:'playwright');
const {chromium}=await import(moduleName);
const macChrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath=process.env.CHROME_EXECUTABLE||(await exists(macChrome)?macChrome:undefined);
const checks=[],errors=[],blockedRequests=[],qrRequests=[];
const skyPose={mode:'walk',view:'first',pitch:-1.5,manualPitch:true,state:{x:LEARNING_BOARD.x+25,y:.066,z:LEARNING_BOARD.z+25,yaw:0,vx:0,vz:0,speed:0,verticalSpeed:0,grounded:true,flightEnabled:false}};
let app,browser,activePage,origin,dataDir,passed=false,failure;
await mkdir(out,{recursive:true});

function check(name,condition,detail){
  checks.push({name,passed:!!condition,...(detail===undefined?{}:{detail})});
  console.log(`${condition?'PASS':'FAIL'} ${name}`);
  assert.ok(condition,`${name}${detail===undefined?'':`: ${JSON.stringify(detail)}`}`);
}
async function newContext(options={}){
  const context=await browser.newContext({deviceScaleFactor:1,...options});
  // Never allow an accidental absolute app URL to touch another server.
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==origin){
      blockedRequests.push({url:url.href,method:route.request().method()});
      return route.abort('blockedbyclient');
    }
    if(/\/assets\/campus-[^/]+\.js$/.test(url.pathname)){
      // Read-only snapshots injected solely into this isolated test response.
      const response=await route.fetch();let body=await response.text();
      const group=/([\w$]+)\.name="activity-sky-qr"/,camera=/new [\w$.]+\(44,1,1,(?:12e3|12000)\)/;
      assert.ok(group.test(body)&&camera.test(body),'Expected scene/camera anchors in built campus bundle');
      body=body.replace(group,(match,name)=>`(${match},Object.defineProperty(globalThis,'__readSkyQrWorld',{value:()=>({position:${name}.position.toArray(),matrix:${name}.matrixWorld.toArray(),meshes:${name}.children.map(m=>({matrix:m.matrixWorld.toArray(),depthTest:m.material.depthTest}))})}))`);
      body=body.replace(camera,match=>`(c=>{Object.defineProperty(globalThis,'__readSkyQrCamera',{value:()=>({position:c.position.toArray(),quaternion:c.quaternion.toArray(),forwardY:-c.matrixWorld.elements[9]})});return c})(${match})`);
      return route.fulfill({response,body});
    }
    return route.continue();
  });
  return context;
}
async function newPage(context,label){
  const page=await context.newPage();page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push({page:label,message:error.message}));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/images/activity/wechat-qr-cutout.png')qrRequests.push({page:label,url:request.url()});});
  activePage=page;return page;
}
async function openCampus(page,nickname){
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  if(nickname){
    await page.getByLabel('你的昵称').fill(nickname);
    await page.locator('.audience-welcome button').click();
  }
  await page.waitForFunction(()=>document.querySelector('.audience-welcome')?.hidden===true,null,{timeout:45000});
  await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('.live-connection')?.dataset.connected==='true',null,{timeout:45000});
}
async function expectQr(page,visible){
  await page.waitForFunction(expected=>{
    const data=document.querySelector('#live-experience')?.dataset;
    return data?.skyQrVisible===String(expected)&&data?.skyQrState===(expected?'ready':'hidden');
  },visible,{timeout:45000});
  await page.locator('.sky-qr-open').waitFor({state:visible?'visible':'hidden'});
  if(!visible)await page.locator('.sky-qr-overlay').waitFor({state:'hidden'});
}
async function snapshot(page,name){
  activePage=page;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.screenshot({path:path.join(out,`${name}.png`)});
}
async function imageMetrics(page){
  await page.waitForFunction(()=>{const image=document.querySelector('.sky-qr-image');return image?.complete&&image.naturalWidth>0&&image.naturalHeight>0;});
  return page.locator('.sky-qr-image').evaluate(image=>{
    const rect=image.getBoundingClientRect(),style=getComputedStyle(image);
    const overlay=document.querySelector('.sky-qr-overlay').getBoundingClientRect();
    return {naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,
      width:rect.width,height:rect.height,x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,
      fit:style.objectFit,transform:style.transform,filter:style.filter,
      overlay:{x:overlay.x,y:overlay.y,right:overlay.right,bottom:overlay.bottom},
      viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth};
  });
}
const worldSnapshot=page=>page.evaluate(()=>globalThis.__readSkyQrWorld());
const cameraSnapshot=page=>page.evaluate(()=>globalThis.__readSkyQrCamera());
async function verifyWorldPlacement(page){
  const fixed=await worldSnapshot(page);
  check('QR has the fixed 2,400m world position and normal depth testing',JSON.stringify(fixed.position)===JSON.stringify([LEARNING_BOARD.x,2400,LEARNING_BOARD.z])&&fixed.meshes.every(mesh=>mesh.depthTest),fixed);
  await page.locator('#map-canvas').focus();await page.keyboard.press('KeyC');
  await page.waitForFunction(()=>globalThis.__readSkyQrCamera().forwardY<.1);await snapshot(page,'desktop-level');
  await page.mouse.move(600,500);await page.waitForTimeout(100);const beforeTurn=await cameraSnapshot(page);
  await page.mouse.move(900,500,{steps:12});await page.waitForTimeout(150);
  const turned=await cameraSnapshot(page),dot=beforeTurn.quaternion.reduce((sum,value,index)=>sum+value*turned.quaternion[index],0),rotationAngle=2*Math.acos(Math.min(1,Math.abs(dot)));
  check('Real horizontal mouse turn leaves QR world matrices unchanged',JSON.stringify(await worldSnapshot(page))===JSON.stringify(fixed)&&rotationAngle>.2,{beforeTurn,turned,rotationAngle});
  await snapshot(page,'desktop-turned');
  await page.mouse.move(700,750);await page.keyboard.press('KeyC');
  await page.mouse.down();await page.mouse.move(700,100,{steps:24});await page.mouse.up();
  await page.waitForFunction(()=>globalThis.__readSkyQrCamera().forwardY>.98);
  check('Real mouse look reaches overhead without moving the QR',JSON.stringify(await worldSnapshot(page))===JSON.stringify(fixed),await cameraSnapshot(page));
  await snapshot(page,'desktop-look-up');
  const beforeMove=await cameraSnapshot(page);await page.keyboard.down('KeyD');await page.waitForTimeout(900);await page.keyboard.up('KeyD');
  const afterMove=await cameraSnapshot(page),distance=Math.hypot(...afterMove.position.map((value,i)=>value-beforeMove.position[i]));
  check('Walking changes camera position but not QR world matrices',distance>1&&JSON.stringify(await worldSnapshot(page))===JSON.stringify(fixed),{distance,beforeMove,afterMove});
  await snapshot(page,'desktop-side-step');
  await page.setViewportSize({width:1100,height:700});await snapshot(page,'desktop-resized');
  check('Resize never changes the QR world size or pose',JSON.stringify(await worldSnapshot(page))===JSON.stringify(fixed));
  await page.setViewportSize({width:1440,height:960});
}
function checkImage(name,metrics){
  const ratio=metrics.width/metrics.height,natural=metrics.naturalWidth/metrics.naturalHeight;
  const uncropped=['contain','scale-down'].includes(metrics.fit)||metrics.fit!=='cover'&&Math.abs(ratio-natural)<.01;
  const fits=metrics.x>=-1&&metrics.y>=-1&&metrics.right<=metrics.viewport.width+1&&metrics.bottom<=metrics.viewport.height+1;
  const overlayFits=metrics.overlay.x>=-1&&metrics.overlay.y>=-1&&metrics.overlay.right<=metrics.viewport.width+1&&metrics.overlay.bottom<=metrics.viewport.height+1;
  check(`${name}: complete original image fits without cropping or stretching`,uncropped&&fits&&overlayFits&&metrics.documentWidth<=metrics.viewport.width+1&&metrics.width>0&&metrics.height>0,metrics);
}
async function checkPauseClear(page,name){
  await page.locator('.live-pause').waitFor({state:'visible'});
  const filters=await page.locator('.live-pause').evaluate(el=>{const style=getComputedStyle(el);return {backdrop:style.backdropFilter||style.webkitBackdropFilter||'none',filter:style.filter};});
  check(`${name}: paused campus does not blur the QR`,[filters.backdrop,filters.filter].every(value=>value==='none'||!value.includes('blur(')),filters);
}
async function checkOpenButtonFits(page,name){
  const bounds=await page.locator('.sky-qr-open').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};});
  check(`${name}: original-image button stays on screen`,bounds.x>=-1&&bounds.y>=-1&&bounds.right<=bounds.width+1&&bounds.bottom<=bounds.height+1,bounds);
}
async function checkViewerControls(page,name){
  const controls=await page.locator('.sky-qr-close').evaluate(button=>{
    const dialog=button.closest('[role="dialog"]').getBoundingClientRect(),rect=button.getBoundingClientRect();
    return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,
      dialog:{x:dialog.x,y:dialog.y,right:dialog.right,bottom:dialog.bottom},
      headingPosition:getComputedStyle(button.parentElement).position};
  });
  const inside=controls.x>=controls.dialog.x-1&&controls.y>=controls.dialog.y-1&&controls.right<=controls.dialog.right+1&&controls.bottom<=controls.dialog.bottom+1;
  const linkVisible=await page.locator('.sky-qr-overlay a').isVisible();
  check(`${name}: close control and original-image link remain visible inside the dialog`,inside&&controls.headingPosition!=='fixed'&&linkVisible,{...controls,linkVisible});
}

try{
  for(const filename of['dist/index.html','dist/admin.html','dist/images/activity/wechat-qr-cutout.png']){
    assert.ok(await exists(path.join(root,filename)),`Build required: ${filename} is missing.`);
  }
  dataDir=await mkdtemp(path.join(tmpdir(),'sky-qr-test-'));
  const password=randomBytes(24).toString('hex');
  app=await createLiveServer({rootDir:root,dataDir,password,initialState:createDefaultLiveState(),workRouter:async()=>false});
  const address=await app.listen(0);origin=`http://127.0.0.1:${address.port}`;
  check('All server writes use a temporary directory',app.dataDir===dataDir&&dataDir!==path.join(root,'server-data'),{dataDir});
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});

  const context=await newContext({viewport:{width:1440,height:960}}),page=await newPage(context,'desktop-one');
  await openCampus(page,'天空二维码验收甲');await expectQr(page,false);
  const identity=await page.evaluate(()=>fetch('/api/audience/me').then(response=>response.json()));
  await page.evaluate(({audienceId,pose})=>sessionStorage.setItem('campus-return-pose',JSON.stringify({audienceId,pose})),{audienceId:identity.audience.id,pose:skyPose});
  await openCampus(page);await expectQr(page,false);
  const secondContext=await newContext({viewport:{width:1280,height:800}}),second=await newPage(secondContext,'desktop-two');
  await openCampus(second,'天空二维码验收乙');await expectQr(second,false);
  check('Default hidden state does not fetch the QR artwork',qrRequests.length===0,{requests:qrRequests.length});

  const adminContext=await newContext({viewport:{width:1440,height:960}}),admin=await newPage(adminContext,'admin');
  await admin.goto(origin+'/admin');await admin.locator('#admin-password').fill(password);await admin.locator('#login-button').click();await admin.locator('#dashboard').waitFor({state:'visible'});
  check('Admin initially reports the QR as hidden',(await admin.locator('#sky-qr-status').innerText()).includes('已收起'));
  await admin.locator('#show-sky-qr').click();
  await Promise.all([expectQr(page,true),expectQr(second,true)]);
  check('Admin show reaches two independent live clients',app.getState().skyQrVisible===true);
  await snapshot(page,'desktop-sky');await snapshot(admin,'admin-shown');
  await verifyWorldPlacement(page);

  await admin.locator('#toggle-pause').click();
  await checkPauseClear(page,'Desktop');await checkPauseClear(second,'Second client');
  await snapshot(page,'desktop-paused-sky');
  await page.locator('.sky-qr-open').click();await page.locator('.sky-qr-overlay').waitFor({state:'visible'});
  checkImage('Desktop paused viewer',await imageMetrics(page));await checkViewerControls(page,'Desktop paused viewer');
  await snapshot(page,'desktop-original');
  await page.locator('.sky-qr-close').click();await page.locator('.sky-qr-overlay').waitFor({state:'hidden'});
  check('Closing the viewer preserves the host pause',app.getState().paused&&await page.locator('#map-canvas').evaluate(el=>el.inert));
  await page.locator('.sky-qr-open').click();await page.locator('.sky-qr-overlay').waitFor({state:'visible'});
  await admin.locator('#hide-sky-qr').click();await Promise.all([expectQr(page,false),expectQr(second,false)]);
  check('Admin hide closes an already-open original viewer',await page.locator('.sky-qr-overlay').evaluate(el=>el.hidden));

  await admin.locator('#show-sky-qr').click();await Promise.all([expectQr(page,true),expectQr(second,true)]);
  await checkPauseClear(page,'Paused redisplay');
  await second.reload({waitUntil:'domcontentloaded'});await expectQr(second,true);
  check('Reload receives the visible and paused snapshot',await second.locator('#live-experience').evaluate(el=>el.dataset.paused==='true'));
  await secondContext.setOffline(true);
  await admin.locator('#hide-sky-qr').click();await expectQr(page,false);
  await secondContext.setOffline(false);await expectQr(second,false);
  check('Reconnection receives a hide missed while offline',await second.locator('.sky-qr-open').isHidden());
  await admin.locator('#show-sky-qr').click();await Promise.all([expectQr(page,true),expectQr(second,true)]);

  // Restore the real player pose before pausing: suspended players defer restore.
  await admin.locator('#toggle-pause').click();await page.locator('.live-pause').waitFor({state:'hidden'});
  const mobileContext=await newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:await context.storageState()});
  await mobileContext.addInitScript(({audienceId,pose})=>sessionStorage.setItem('campus-return-pose',JSON.stringify({audienceId,pose})),{audienceId:identity.audience.id,pose:skyPose});
  const phone=await newPage(mobileContext,'phone');await openCampus(phone);await expectQr(phone,true);
  await admin.locator('#toggle-pause').click();
  await checkPauseClear(phone,'Phone portrait');await checkOpenButtonFits(phone,'Phone portrait');
  await snapshot(phone,'mobile-portrait-sky');
  await phone.locator('.sky-qr-open').tap();await phone.locator('.sky-qr-overlay').waitFor({state:'visible'});
  checkImage('Phone portrait viewer',await imageMetrics(phone));await checkViewerControls(phone,'Phone portrait viewer');await snapshot(phone,'mobile-portrait-original');
  await phone.setViewportSize({width:844,height:390});
  await phone.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  checkImage('Phone landscape viewer',await imageMetrics(phone));await checkViewerControls(phone,'Phone landscape viewer');await snapshot(phone,'mobile-landscape-original');
  await phone.locator('.sky-qr-close').tap();await phone.locator('.sky-qr-overlay').waitFor({state:'hidden'});
  await checkOpenButtonFits(phone,'Phone landscape');await snapshot(phone,'mobile-landscape-sky');
  await phone.locator('.sky-qr-open').tap();await phone.locator('.sky-qr-overlay').waitFor({state:'visible'});
  await admin.locator('#hide-sky-qr').click();await Promise.all([expectQr(page,false),expectQr(second,false),expectQr(phone,false)]);
  check('Host hide closes the mobile viewer too',await phone.locator('.sky-qr-overlay').evaluate(el=>el.hidden));
  const beforeReload=qrRequests.filter(request=>request.page==='desktop-one').length;
  await page.reload({waitUntil:'domcontentloaded'});await expectQr(page,false);
  check('Hidden reload does not load the original image',qrRequests.filter(request=>request.page==='desktop-one').length===beforeReload);
  await admin.locator('#toggle-pause').click();await page.locator('.live-pause').waitFor({state:'hidden'});
  check('No browser runtime errors',errors.length===0,errors);
  check('No browser request reached another origin',blockedRequests.length===0,blockedRequests);
  passed=true;
}catch(error){
  failure=error.stack||error.message;console.error(failure);process.exitCode=1;
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
}finally{
  await browser?.close();await app?.close();
  if(dataDir)await rm(dataDir,{recursive:true,force:true});
  await writeFile(path.join(out,'browser-verification.json'),JSON.stringify({passed,checks,errors,blockedRequests,qrRequests,...(failure?{failure}:{}),scope:'Real built campus/admin in isolated browser contexts against a random-port server; temporary data directory removed; no production state or credentials used.'},null,2));
}
