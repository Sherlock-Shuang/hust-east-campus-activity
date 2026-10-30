// Actual campus doorway -> report hall -> campus. Isolated state and Chromium;
// no production writes. Heap snapshots are browser JS metrics, never GPU bytes.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';

const quickGpu=process.argv.includes('--quick-gpu'),iterationsToRun=quickGpu?1:20;
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,`artifacts/performance-phase2/c118/${quickGpu?'browser-gpu':'browser'}`);
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const dataDir=await mkdtemp(path.join(tmpdir(),'c118-browser-')),password='isolated-c118-browser-check';
const result={passed:false,startedAt:new Date().toISOString(),iterations:[],errors:[],consoleErrors:[],networkErrors:[],scope:'Actual local production campus and C118 in desktop headless Chrome. Not a physical phone, thermal benchmark or GPU heap measurement. Other agent functional browsers may run concurrently; no CPU/GPU performance comparison claimed.'};
let app,browser,context,page,origin,admin;
await mkdir(out,{recursive:true});
try{
  app=await createLiveServer({rootDir:root,dataDir,password,initialState:createDefaultLiveState()});
  const address=await app.listen(0);origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1',localStorage.getItem('campus-quality-mode-v1')||'balanced'));
  const headers={Origin:origin};
  await context.request.post(origin+'/api/audience/join',{headers,data:{nickname:'C118生命周期隔离验收',tabId:'c118-browser-one'}});
  admin=await (await context.request.post(origin+'/api/admin/login',{headers,data:{password}})).json();
  const save=async patch=>{
    const state=(await (await context.request.get(origin+'/api/live/state')).json()).state;
    const response=await context.request.put(origin+'/api/admin/state',{headers:{...headers,'X-CSRF-Token':admin.csrfToken},data:{expectedRevision:state.revision,state:{...state,...patch}}});
    assert.equal(response.status(),200);return (await response.json()).state;
  };
  page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')result.consoleErrors.push({text:message.text(),location:message.location()});});
  page.on('response',response=>{if(response.status()>=400)result.networkErrors.push({status:response.status(),path:new URL(response.url()).pathname});});
  await page.goto(origin+'/?place=opto-east&diagnostics=1'+(quickGpu?'&gpu=1':''));
  await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#map-canvas')?.dataset.campusDetails==='ready',null,{timeout:90000});
  const cdp=await context.newCDPSession(page);
  const iframe=page.locator('.live-portal-frame iframe');
  const enter=async()=>{
    await page.locator('#map-canvas').focus();await page.keyboard.down('KeyW');
    try{await iframe.waitFor({state:'attached',timeout:10000});}finally{await page.keyboard.up('KeyW');}
    const hall=await (await iframe.elementHandle()).contentFrame();
    await hall.locator('#hall-status').waitFor({state:'hidden',timeout:30000});
    await hall.waitForFunction(()=>Number(document.querySelector('#hall-canvas')?.dataset.resourceOwners)>0,null,{timeout:15000});
    return hall;
  };
  const leave=async(hall)=>{
    await hall.evaluate(()=>window.addEventListener('pagehide',()=>sessionStorage.setItem('qa-c118-exit',JSON.stringify({owners:document.querySelector('#hall-canvas').dataset.resourceOwners,media:document.querySelectorAll('video,audio').length})),{once:true}));
    await hall.locator('#hall-return').click();await iframe.waitFor({state:'detached',timeout:15000});
    await page.waitForTimeout(500);await cdp.send('HeapProfiler.collectGarbage');
    const cleanup=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('qa-c118-exit')||'null'));
    assert.deepEqual(cleanup,{owners:'0',media:0});assert.equal(await page.locator('iframe').count(),0);
    assert.equal(await page.locator('#map-canvas').evaluate(el=>el.inert),false);
    return {cleanup,heapAfterExplicitGc:await cdp.send('Runtime.getHeapUsage'),campus:await page.locator('#map-canvas').evaluate(el=>({...el.dataset}))};
  };
  for(let iteration=1;iteration<=iterationsToRun;iteration++){
    if(iteration===2)await page.locator('#performance-mode').selectOption('smooth');
    const hall=await enter();
    if(iteration===1){
      await hall.locator('#seat-enter').click();
      await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.renderTargetFps==='30');
      await hall.waitForFunction(()=>{const video=document.querySelector('video');return video&&!video.paused&&video.currentTime>.25;},null,{timeout:20000});
      result.movie=await hall.locator('#hall-canvas').evaluate(el=>({...el.dataset}));
      await page.screenshot({path:path.join(out,'c118-dry-movie.png')});
      await hall.locator('#seat-look').click();await hall.locator('#seat-rise').click();
      await hall.locator('#hall-canvas').focus();await page.keyboard.down('KeyW');await page.waitForTimeout(180);await page.keyboard.up('KeyW');
      await hall.locator('#hall-canvas').evaluate(canvas=>{const extension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');if(!extension)throw new Error('Missing WEBGL_lose_context');window.__qaContext=extension;extension.loseContext();});
      await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.graphicsState==='lost');
      await page.waitForTimeout(350);await hall.evaluate(()=>window.__qaContext.restoreContext());
      await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.graphicsState==='restored');
      result.contextRestored=true;
    }
    if(iteration===iterationsToRun){
      if(quickGpu){await page.evaluate(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.qualityLevel==='流畅');}
      await save({c118Flood:{id:'qa-flood',startAt:Date.now(),pausedAt:null,pausedMs:0}});
      await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.swimming==='true',null,{timeout:35000});
      await page.waitForTimeout(1500);
      result.lowFlood=await hall.locator('#hall-canvas').evaluate(el=>({...el.dataset}));
      await page.screenshot({path:path.join(out,'c118-flood-low.png')});
      // A real same-origin storage change reaches the embedded hall listener.
      await page.evaluate(()=>localStorage.setItem('campus-quality-mode-v1','clear'));
      await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.qualityLevel==='清晰');
      await page.waitForTimeout(1200);result.highFlood=await hall.locator('#hall-canvas').evaluate(el=>({...el.dataset}));
      await page.screenshot({path:path.join(out,'c118-flood-high.png')});
      await hall.locator('#hall-canvas').focus();await page.keyboard.down('KeyC');await page.waitForTimeout(900);await page.keyboard.up('KeyC');
      await page.waitForTimeout(150);result.underwater=await hall.locator('#swim-depth').textContent();assert.match(result.underwater,/水下/);
      await page.screenshot({path:path.join(out,'c118-underwater.png')});
      await save({paused:true});await hall.locator('#hall-pause').waitFor({state:'visible'});
      const frozen=await hall.locator('#hall-canvas').getAttribute('data-flood-elapsed');await page.waitForTimeout(500);
      assert.equal(await hall.locator('#hall-canvas').getAttribute('data-flood-elapsed'),frozen);await save({paused:false});await hall.locator('#hall-pause').waitFor({state:'hidden'});
      await save({c118Flood:null});await hall.waitForFunction(()=>document.querySelector('#hall-canvas').dataset.swimming==='false');
    }
    const hallMetrics=await hall.locator('#hall-canvas').evaluate(el=>({...el.dataset}));
    const returned=await leave(hall);result.iterations.push({iteration,hall:hallMetrics,...returned});
    console.log(JSON.stringify({iteration,owners:returned.cleanup.owners,heap:returned.heapAfterExplicitGc.usedSize}));
  }
  // Fault after all owners have been created: ensure a render failure does not
  // strand its media or subscription and the real return action still works.
  await context.addInitScript(()=>{
    if(!location.pathname.includes('c118'))return;
    for(const name of['drawElements','drawElementsInstanced','drawArrays']){
      const original=WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name]=function(...args){if(this.canvas.id==='hall-canvas')throw new Error('QA injected C118 draw failure');return original.apply(this,args);};
    }
  });
  await page.locator('#map-canvas').focus();await page.keyboard.down('KeyW');try{await iframe.waitFor({state:'attached',timeout:10000});}finally{await page.keyboard.up('KeyW');}
  const failed=await (await iframe.elementHandle()).contentFrame();
  await failed.waitForFunction(()=>document.querySelector('#hall-canvas')?.dataset.graphicsState==='failed');
  assert.equal(await failed.locator('#hall-canvas').getAttribute('data-resource-owners'),'0');assert.equal(await failed.locator('video,audio').count(),0);
  await failed.locator('#hall-return').click();await iframe.waitFor({state:'detached'});result.partialFailureReturn=true;
  assert.deepEqual(result.errors,[]);
  result.finishedAt=new Date().toISOString();result.passed=true;
}catch(error){result.error=error.stack;process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,iterations:result.iterations.length,error:result.error,output:out}));}
