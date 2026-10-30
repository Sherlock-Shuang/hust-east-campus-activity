// Read-only release check: no admin login, audience creation or host mutations.
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]),expected=process.argv[3];
assert.equal(origin.protocol,'https:');assert.equal(origin.pathname,'/');
assert.ok(!origin.username&&!origin.password&&!origin.search&&!origin.hash&&/^[a-f0-9]{40}$/.test(expected));
const base=origin.origin,out=path.resolve(process.env.CAMPUS_QA_OUTPUT||'artifacts/performance-phase2/public-release');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const report={passed:false,origin:base,expectedCommit:expected,startedAt:new Date().toISOString(),checks:[],errors:[],scope:'Read-only public Chrome and HTTP. No login, audience records, host changes, fake victory or model API calls. Existing optional proxy comes from CAMPUS_QA_PROXY.'};
let browser,context,page;
const record=(name,data)=>{report.checks.push({name,...data});console.log(JSON.stringify({name,...data}));};
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',...(process.env.CAMPUS_QA_PROXY?{proxy:{server:process.env.CAMPUS_QA_PROXY}}:{})});
 context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
 await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
 await context.route('**/api/works/**',route=>route.abort());
 const api=context.request;
 const state=await api.get(base+'/api/live/state');assert.equal(state.status(),200);const payload=await state.json();
 const denied=await api.get(base+'/api/admin/audience');assert.equal(denied.status(),401);
 record('public API and private statistics',{stateStatus:200,revision:payload.state.revision,privateStatsStatus:401});
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const campusRequests={state:0,streams:0};page.on('request',request=>{const p=new URL(request.url()).pathname;if(p==='/api/live/state')campusRequests.state++;if(p==='/api/live/events')campusRequests.streams++;});
 await page.goto(base+'/',{timeout:90000});await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
 await page.waitForFunction(()=>document.querySelector('#map-canvas')?.dataset.campusDetails==='ready',null,{timeout:90000});
 const campus=await page.locator('#map-canvas').evaluate(el=>({buildId:el.dataset.buildId,details:el.dataset.campusDetails,graphics:el.dataset.graphicsState}));
 assert.equal(campus.buildId,expected);assert.equal(campus.graphics,'ready');await page.screenshot({path:path.join(out,'campus.png')});record('deployed campus',campus);
 await page.waitForFunction(()=>document.querySelector('.live-connection')?.textContent==='活动已连接',null,{timeout:30000});
 assert.equal(campusRequests.state,1,'initial SSE open must not duplicate the initial state GET');assert.equal(campusRequests.streams,1);record('campus live connection',campusRequests);
 await page.goto(base+'/admin');assert.equal(await page.locator('input[type=password]').count(),1);record('admin login page',{passwordForm:true});
 const config=await api.get(base+'/works/library/performance-assets.json').then(r=>r.json());
 const unity=await api.get(base+'/works/wanyan/performance-builds.json').then(r=>r.json());
 for(const url of [config.library.url,config.hero.url,config.meshoptDecoder,unity.desktop.dataUrl,unity.mobile.dataUrl]){
   const head=await api.head(base+url),headers=head.headers();assert.equal(head.status(),200);assert.match(headers['cache-control'],/immutable/);
   const range=await api.get(base+url,{headers:{Range:'bytes=0-31'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,32);
   const cached=await api.get(base+url,{headers:{'If-None-Match':headers.etag}});assert.equal(cached.status(),304);
   record('versioned resource',{path:url,status:200,rangeStatus:206,revalidationStatus:304,cacheControl:headers['cache-control'],bytes:headers['content-length']});
 }
 let requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.goto(base+'/works/library/',{timeout:90000});
 await page.waitForFunction(()=>window.__libraryDebug?.ready,null,{timeout:120000});
 assert.equal(await page.evaluate(()=>window.__libraryDebug.heroReady),false);assert.equal(requests.some(p=>p.endsWith('/hero.glb')),false);
 await page.locator('#resume').click();await page.keyboard.down('KeyW');await page.waitForTimeout(500);await page.keyboard.up('KeyW');
 await page.screenshot({path:path.join(out,'library.png')});
 const library=await page.evaluate(()=>({ready:__libraryDebug.ready,heroReady:__libraryDebug.heroReady,variant:document.documentElement.dataset.libraryAssetVariant,model:__libraryDebug.assets.library.url}));
 assert.equal(library.variant,'optimized');record('actual library runtime',library);
 await page.goto(base+'/works/wanyan/',{timeout:90000});
 await page.waitForFunction(()=>document.documentElement.dataset.campusWorkStatus==='runtime_ready'&&window.bookrealmNativeControls,null,{timeout:180000});
 await page.locator('#unity-canvas').click();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.bookrealmNativeControls?.started,null,{timeout:30000});
 await page.waitForTimeout(1000);await page.screenshot({path:path.join(out,'wanyan-game.png')});
 record('actual Unity gameplay',await page.evaluate(()=>({started:bookrealmNativeControls.started,quality:document.documentElement.dataset.wanyanQuality,status:document.documentElement.dataset.campusWorkStatus})));
 await page.goto(base+'/works/tasay/',{timeout:90000});await page.waitForTimeout(1200);
 assert.ok((await page.locator('body').innerText()).length>20);await page.screenshot({path:path.join(out,'tasay.png')});
 const build=await api.get(base+'/works/tasay/activity-build.json').then(r=>r.json());assert.equal(build.adapterVersion,2);
 record('tasay activity runtime',{adapterVersion:build.adapterVersion,storyRevision:build.storyRevision,modelApiCalls:0});
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.message;process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await context?.close();await browser?.close();report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,report:path.join(out,'report.json')}));}
