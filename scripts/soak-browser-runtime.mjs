// Real 30-minute wall-clock run. No virtual clock, reload, GPU-memory inference
// or physical-phone claim. Only a local production build and isolated data.
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';

assert.equal(Number(process.versions.node.split('.')[0]),24,'Use the bundled Node 24 runtime for this run');
const root=fileURLToPath(new URL('..',import.meta.url));
const out=path.join(root,'artifacts/performance-phase2/browser-soak-30m');
const durationMs=30*60*1000;
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const dataDir=await mkdtemp(path.join(tmpdir(),'campus-browser-soak-'));
const result={passed:false,node:process.version,durationTargetMs:durationMs,quality:'smooth',viewport:{width:1280,height:720},deviceScaleFactor:1,
  conditions:'Actual installed desktop Google Chrome, headless, fixed smooth quality, default Yunyuan canteen spawn, stationary continuous mouse look. Same page/session throughout. No physical phone, full-campus route, GPU VRAM, external CDN or 100-player-render test. No forced GC. Root deployment/build activity may overlap the first five minutes and is not a controlled CPU/GPU A/B.',
  minutes:[],exports:[],errors:[],consoleErrors:[],networkErrors:[],navigationCount:0};
let app,browser,context,page,cdp,stopRequested=false,started=0;
const stop=()=>{stopRequested=true;};process.once('SIGINT',stop);process.once('SIGTERM',stop);
const remember=(name,value)=>{if(result[name].length<200)result[name].push(value);};
await mkdir(out,{recursive:true});
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2)+'\n');
try{
  app=await createLiveServer({rootDir:root,dataDir,password:'isolated-soak-runtime-only',initialState:createDefaultLiveState()});
  const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  result.browser=browser.version();
  context=await browser.newContext({viewport:result.viewport,deviceScaleFactor:1});
  await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
  const joined=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'30分钟帧会话隔离验收',tabId:'soak-one'}});assert.equal(joined.status(),200);
  page=await context.newPage();cdp=await context.newCDPSession(page);
  page.on('pageerror',error=>remember('errors',error.message));
  page.on('console',message=>{if(message.type()==='error')remember('consoleErrors',{message:message.text(),location:message.location()});});
  page.on('response',response=>{if(response.status()>=400)remember('networkErrors',{status:response.status(),path:new URL(response.url()).pathname});});
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())result.navigationCount++;});
  await page.goto(origin+'/?diagnostics=1');
  await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.waitForFunction(()=>document.querySelector('#map-canvas')?.dataset.campusDetails==='ready',null,{timeout:90000});
  await page.waitForFunction(()=>Number(document.querySelector('#map-canvas')?.dataset.frameSamples)>10,null,{timeout:30000});
  const navigationBaseline=result.navigationCount;
  await page.locator('#map-canvas').focus();await page.mouse.move(640,360);
  async function captureMinute(minute){
    const [dataset,heap,dom]=await Promise.all([
      page.locator('#map-canvas').evaluate(el=>({...el.dataset})),
      cdp.send('Runtime.getHeapUsage'),cdp.send('Memory.getDOMCounters'),
    ]);
    const sample={minute,elapsedMs:performance.now()-started,capturedAt:new Date().toISOString(),dataset,heap,dom,
      actualDrawRateRecentWindow:Number(dataset.frameRate),activeDrawRateLast1800:Number(dataset.frameSamples)*1000/Number(dataset.frameWindowMs),
      sampleWindowMs:Number(dataset.frameWindowMs),note:'Recent actual draw rate is the canvas ~1.2-second counter. Last1800 is rolling admitted-draw intervals; full nonrolling minute histograms are exported every five minutes.'};
    assert.equal(dataset.qualityMode,'smooth');assert.equal(dataset.graphicsState,'ready');
    assert.equal(result.navigationCount,navigationBaseline,'The session must not refresh or navigate');
    assert.ok(sample.actualDrawRateRecentWindow>0,'The scene must continue rendering');
    result.minutes.push(sample);return sample;
  }
  async function exportSession(minute){
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出性能报告',exact:true}).click();
    const download=await pending,report=JSON.parse(await readFile(await download.path(),'utf8'));
    assert.ok(report.frameSession?.sampleCount>0,'A long-session report is required, not just a rolling frame window');
    const filename=`session-${String(minute).padStart(2,'0')}m.json`;await writeFile(path.join(out,filename),JSON.stringify(report,null,2)+'\n');
    result.exports.push({minute,filename,capturedAt:report.capturedAt,frameSession:report.frameSession,frame:report.frame,resources:report.resourceObjects});
    await page.locator('#map-canvas').focus();return report;
  }
  started=performance.now();result.startedAt=new Date().toISOString();result.initialHeap=await cdp.send('Runtime.getHeapUsage');result.initialDom=await cdp.send('Memory.getDOMCounters');
  result.initialDataset=await page.locator('#map-canvas').evaluate(el=>({...el.dataset}));
  await page.screenshot({path:path.join(out,'start.png')});await save();console.log(JSON.stringify({event:'started',at:result.startedAt,browser:result.browser,node:process.version,minutes:30}));
  let nextMinute=1;
  while(performance.now()-started<durationMs){
    if(stopRequested)throw new Error('Interrupted before the actual 30-minute duration');
    const elapsed=performance.now()-started,t=elapsed/1000;
    // Native input dispatch, 10 Hz smooth back-and-forth yaw/pitch arcs. No
    // player-state mutation, simulated time advance or synthetic RAF patch.
    await page.mouse.move(640+440*Math.sin(t*Math.PI/14),360+55*Math.sin(t*Math.PI/23));
    if(nextMinute<30&&elapsed>=nextMinute*60000){
      const sample=await captureMinute(nextMinute);
      if(nextMinute%5===0){const full=await exportSession(nextMinute);console.log(JSON.stringify({event:'five-minute',minute:nextMinute,elapsedMs:sample.elapsedMs,drawRate:sample.actualDrawRateRecentWindow,heapUsed:sample.heap.usedSize,documents:sample.dom.documents,sessionSamples:full.frameSession.sampleCount,p95UpperMs:full.frameSession.p95UpperMs,p99UpperMs:full.frameSession.p99UpperMs,long100:full.frameSession.longFrames100,errors:result.errors.length}));}
      await save();nextMinute++;
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const final=await captureMinute(30),session=await exportSession(30);result.durationActualMs=performance.now()-started;
  assert.ok(result.durationActualMs>=durationMs);assert.equal(result.minutes.length,30);assert.equal(result.exports.length,6);
  assert.ok(session.frameSession.activeMs>=durationMs*.95,'At least 95% of wall time must appear in active frame intervals');
  assert.deepEqual(result.errors,[]);assert.ok(!result.consoleErrors.some(error=>!/favicon\.ico/.test(error.location.url)),JSON.stringify(result.consoleErrors));
  result.finishedAt=new Date().toISOString();result.passed=true;await page.screenshot({path:path.join(out,'final.png')});
  console.log(JSON.stringify({event:'complete',passed:true,durationActualMs:result.durationActualMs,drawRate:final.actualDrawRateRecentWindow,heapUsed:final.heap.usedSize,documents:final.dom.documents,session:session.frameSession}));
}catch(error){result.error=error.stack;result.durationActualMs=started?performance.now()-started:0;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.log(JSON.stringify({event:'failed',error:error.message,elapsedMs:result.durationActualMs}));}
finally{await context?.close();await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});result.resourcesClosed=true;await save();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
