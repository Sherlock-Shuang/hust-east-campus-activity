// Real production viewer, isolated local activity data; no remote state writes.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';
const root=fileURLToPath(new URL('..',import.meta.url)),out=path.join(root,'artifacts/performance-phase2/c118/exterior-browser');
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const dataDir=await mkdtemp(path.join(tmpdir(),'exterior-flood-')),password='isolated-exterior-check';
const result={passed:false,errors:[],consoleErrors:[],networkErrors:[],states:[],scope:'Functional real Chrome production-build check. Concurrent browser work possible; not a CPU/GPU performance comparison.'};let app,browser,page;
await mkdir(out,{recursive:true});
try{
  app=await createLiveServer({rootDir:root,dataDir,password,initialState:createDefaultLiveState()});const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`,headers={Origin:origin};
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
  await context.request.post(origin+'/api/audience/join',{headers,data:{nickname:'室外水体验收',tabId:'exterior-one'}});
  const admin=await (await context.request.post(origin+'/api/admin/login',{headers,data:{password}})).json();
  const save=async patch=>{const state=(await (await context.request.get(origin+'/api/live/state')).json()).state;const response=await context.request.put(origin+'/api/admin/state',{headers:{...headers,'X-CSRF-Token':admin.csrfToken},data:{expectedRevision:state.revision,state:{...state,...patch}}});assert.equal(response.status(),200);};
  page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')result.consoleErrors.push({text:m.text(),location:m.location()});});page.on('response',r=>{if(r.status()>=400)result.networkErrors.push({status:r.status(),url:r.url()});});
  await page.goto(origin+'/?place=opto-exterior&diagnostics=1&gpu=1');await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#map-canvas')?.dataset.campusDetails==='ready',null,{timeout:90000});
  await page.locator('#map-canvas').focus();await page.mouse.move(100,360);await page.mouse.move(1150,360,{steps:24});
  for(const quality of['smooth','clear']){
    await page.locator('#performance-mode').selectOption(quality);await save({c118Flood:{id:'exterior-'+quality,startAt:Date.now(),pausedAt:null,pausedMs:0}});
    await page.waitForFunction(()=>document.querySelector('#live-experience')?.dataset.campusTsunami!=='hidden');
    await page.waitForTimeout(2200);await page.screenshot({path:path.join(out,`${quality}-approach.png`)});
    await page.waitForFunction(()=>document.querySelector('.campus-tsunami-wash')?.dataset.submerged==='true',null,{timeout:30000});
    await page.waitForTimeout(1200);await page.screenshot({path:path.join(out,`${quality}-underwater.png`)});
    result.states.push({quality,live:await page.locator('#live-experience').evaluate(el=>({...el.dataset})),canvas:await page.locator('#map-canvas').evaluate(el=>({...el.dataset})),notice:await page.locator('.campus-tsunami-notice').evaluate(el=>({...el.dataset}))});
    await save({c118Flood:null});await page.waitForFunction(()=>document.querySelector('.campus-tsunami-wash')?.hidden===true);
  }
  assert.deepEqual(result.errors,[]);assert.ok(!result.consoleErrors.some(e=>!/favicon\.ico/.test(e.location.url)),JSON.stringify(result.consoleErrors));result.passed=true;
}catch(error){result.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,error:result.error,output:out}));}
