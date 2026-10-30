// Real works in the actual campus iframe lifecycle. All writes are confined to
// a temporary local scene. No dialogue/model API is called and no win is faked.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';
import {activityPortals,ACTIVITY_WORKS} from '../src/activity-catalog.js';
import {createGeoScene} from '../src/geo-scene.js';
import {createLocalFrame,geoToLocal} from '../src/geospatial.js';
import {getCampusPlayerSpawn} from '../src/player-experience.js';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const workIds=option('--works','library,wanyan,tasay').split(',');
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.resolve(option('--output',path.join(root,'artifacts/performance-phase2/works-browser')));
const read=name=>readFile(path.join(root,'public/data',name),'utf8').then(JSON.parse);
const fc=await read('east-campus.geojson'),manifest=await read('source-manifest.json'),coordinates=manifest.suggestedLocalOrigin.coordinates;
const model=createGeoScene(THREE,new THREE.Scene(),fc,createLocalFrame({longitude:coordinates[0],latitude:coordinates[1],coordinateSystem:"EPSG:4326"}),geoToLocal),spawn=getCampusPlayerSpawn(model);model.dispose();
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const dataDir=await mkdtemp(path.join(tmpdir(),'phase2-works-')),password='local-works-performance-verification';
const errors=[],loops=[],failedRequests=[];let app,browser,page,passed=false;
await mkdir(out,{recursive:true});
try{
  app=await createLiveServer({rootDir:root,dataDir,password,workEnv:{},works:ACTIVITY_WORKS,initialState:{...createDefaultLiveState(),portals:activityPortals().map(p=>({...p,enabled:false,x:spawn.x,z:spawn.z,radius:20}))}});
  const {port}=await app.listen(0),origin=`http://127.0.0.1:${port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:720}});
  await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
  await context.route('**/api/works/**',route=>route.abort());
  await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'作品反复进出验收',tabId:'works'}});
  const login=await context.request.post(origin+'/api/admin/login',{headers:{Origin:origin},data:{password}}),{csrfToken}=await login.json();
  const change=async patch=>{const state=app.getState(),r=await context.request.put(origin+'/api/admin/state',{headers:{Origin:origin,'X-CSRF-Token':csrfToken},data:{state:{...state,...patch},expectedRevision:state.revision}});assert.equal(r.status(),200);};
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failedRequests.push({path:new URL(r.url()).pathname,status:r.status()});});
  await page.goto(origin+'/?diagnostics=1');await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#map-canvas')?.dataset.campusDetails==='ready',null,{timeout:90000});
  const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  for(const work of workIds){
    await change({portals:app.getState().portals.map(p=>({...p,enabled:p.workId===work}))});
    for(let iteration=0;iteration<10;iteration++){
      await page.locator('.live-portal-prompt').waitFor({state:'visible',timeout:30000});await page.locator('.live-portal-prompt').click();
      const el=page.locator('.live-portal-frame iframe');await el.waitFor({timeout:30000});const frame=await el.elementHandle().then(h=>h.contentFrame());
      await page.locator('.live-portal-loading').waitFor({state:'hidden',timeout:120000});
      if(work==='library'){
        await frame.waitForFunction(()=>window.__libraryDebug?.ready);assert.equal(await frame.evaluate(()=>window.__libraryDebug.heroReady),false);
        await frame.locator('canvas').focus();await page.keyboard.press('KeyW');
      }else if(work==='wanyan'){
        await frame.waitForFunction(()=>document.documentElement.dataset.wanyanRenderPixelRatio&&getComputedStyle(document.querySelector('#unity-loading-container')).display==='none',null,{timeout:120000});
        await frame.locator('#unity-canvas').focus();await page.keyboard.press('Space');await page.waitForTimeout(1200);
      }else{assert.ok((await frame.locator('body').innerText()).trim().length>20);}
      if(iteration===0)await page.screenshot({path:path.join(out,`${work}-actual-runtime.png`)});
      await page.getByRole('button',{name:'返回校园',exact:true}).click();await el.waitFor({state:'detached'});
      await page.waitForFunction(()=>document.querySelector('#player-hud')?.dataset.suspended==='false');
      await page.waitForTimeout(400);await cdp.send('HeapProfiler.collectGarbage');
      const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
      loops.push({work,iteration,frames:page.frames().length,jsHeapUsed:metrics.JSHeapUsedSize,nodes:metrics.Nodes,documents:metrics.Documents});
      assert.equal(page.frames().length,1);console.log(JSON.stringify(loops.at(-1)));
    }
  }
  for(const work of workIds){const warm=loops.filter(r=>r.work===work&&r.iteration>=3);assert.ok(Math.max(...warm.map(r=>r.documents))<=2,work+' retains detached documents');assert.ok(warm.at(-1).jsHeapUsed<=warm[0].jsHeapUsed*1.10,work+' heap does not plateau');}
  const stats=await context.request.get(origin+'/api/admin/audience').then(r=>r.json());
  for(const work of workIds)assert.equal(stats.summary.works.find(w=>w.workId===work||w.id===work)?.openedParticipants,1);
  assert.equal(stats.summary.currentParticipants,0);assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);passed=true;
}finally{
  if(!passed&&page&&!page.isClosed())await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});
  await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});
  await writeFile(path.join(out,'report.json'),JSON.stringify({passed,loops,errors,failedRequests,scope:'Real desktop Chrome, 10 actual load/return cycles per work in isolated campus. JS heap is instrumented after forced GC, not physical GPU memory. Tasay page/interactions only; model API blocked. No synthetic game-completion events.'},null,2));
}
