// Cold browser network/CPU experiment; not a physical phone or CDN latency test.
import {mkdtemp,mkdir,writeFile,rm,readdir,copyFile} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/mobile-loading'));
const profile=process.argv.includes('--cpu-profile');
const cpu=Number(arg('--cpu','6')),mbps=Number(arg('--mbps','10')),trials=Number(arg('--trials','2'));
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const work=await mkdtemp(path.join(tmpdir(),'campus-cold-mobile-'));await mkdir(out,{recursive:true});
const report={passed:false,root,cpu,mbps,trials,conditions:'Chrome desktop touch viewport 844x390 DPR2, CPU throttle, cold browser cache, 80ms/10Mbps synthetic network. Local production HTTP server sends uncompressed JS, unlike CDN compression. No physical-device/GPU/thermal or production startup-time guarantee.',runs:[],errors:[]};
let browser,app;
try{
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:path.join(work,'dist'),emptyOutDir:true,sourcemap:profile,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'isolated-startup-observer',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\nglobalThis.__loadingQA={read:()=>({x:commute?.player.state.x,z:commute?.player.state.z,frame:frameMetrics.snapshot()})};';}}]});
 if(profile){const maps=path.join(out,'cpu-assets');await mkdir(maps,{recursive:true});for(const file of await readdir(path.join(work,'dist/assets')))if(file.endsWith('.js.map'))await copyFile(path.join(work,'dist/assets',file),path.join(maps,file));}
 app=await createLiveServer({rootDir:root,distDir:path.join(work,'dist'),dataDir:path.join(work,'data'),password:'isolated-loading-only',workEnv:{}});
 const address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(let trial=0;trial<trials;trial++){
  const context=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离冷启动测试',tabId:'loading-'+trial}});
  await context.addInitScript(()=>{
   localStorage.setItem('campus-quality-mode-v1','smooth');
   window.__coldQA={longTasks:[],readyMs:null,enteredMs:null};
   new PerformanceObserver(list=>{for(const e of list.getEntries())window.__coldQA.longTasks.push({start:e.startTime,ms:e.duration});}).observe({type:'longtask',buffered:true});
   window.addEventListener('campus:ready',()=>window.__coldQA.readyMs=performance.now());
   window.addEventListener('campus:entry-entered',()=>window.__coldQA.enteredMs=performance.now());
  });
  const page=await context.newPage(),cdp=await context.newCDPSession(page),requests=new Map();
  page.on('pageerror',e=>report.errors.push(e.message));
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpu});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:mbps*125000,uploadThroughput:mbps*125000,connectionType:'cellular4g'});
  cdp.on('Network.requestWillBeSent',e=>requests.set(e.requestId,{url:e.request.url,type:e.type,bytes:0}));
  cdp.on('Network.dataReceived',e=>{const r=requests.get(e.requestId);if(r)r.bytes+=e.encodedDataLength;});
  cdp.on('Network.loadingFinished',e=>{const r=requests.get(e.requestId);if(r)r.bytes=e.encodedDataLength;});
  if(profile){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:180000});
  await page.waitForFunction(()=>document.documentElement.dataset.campusReady==='true',null,{timeout:180000});
  if(profile){const p=await cdp.send('Profiler.stop');await writeFile(path.join(out,`startup-${trial}.cpuprofile`),JSON.stringify(p.profile));}
  const readyRequests=[...requests.values()].map(r=>({...r}));
  await page.locator('#entry-cover-start').click();
  await page.waitForFunction(()=>!document.body.classList.contains('entry-cover-open'));
  const before=await page.evaluate(()=>__loadingQA.read());
  // Real floating joystick movement immediately after entering, while deferred
  // decorations may still be preparing. Do not wait for all details to finish.
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:170,y:260}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:170,y:185}]});
  await page.waitForTimeout(5000);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const result=await page.evaluate(()=>({timings:__coldQA,startup:JSON.parse(document.getElementById('map-canvas').dataset.startupTimings||'{}'),after:__loadingQA.read(),details:document.getElementById('map-canvas').dataset.campusDetails,resources:performance.getEntriesByType('resource').map(e=>({url:e.name,start:e.startTime,ms:e.duration,bytes:e.transferSize}))}));
  result.before=before;result.distance=Math.hypot(result.after.x-before.x,result.after.z-before.z);result.readyRequests=readyRequests;result.readyBytes=readyRequests.reduce((n,r)=>n+r.bytes,0);
  result.readyMediaBytes=readyRequests.filter(r=>/\.(mp4|mp3|m4a|ogg)(\?|$)/.test(r.url)).reduce((n,r)=>n+r.bytes,0);
  assert.ok(result.distance>1,'Immediate touch movement failed');
  await page.screenshot({path:path.join(out,`trial-${trial}.png`)});
  report.runs.push(result);console.log(JSON.stringify({trial,readyMs:result.timings.readyMs,readyBytes:result.readyBytes,readyMediaBytes:result.readyMediaBytes,distance:result.distance,startup:result.startup}));
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,error:report.error,out}));}
