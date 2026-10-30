// Public single-viewer network experiment. No audience/host/model API writes.
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]);assert.equal(origin.protocol,'https:');assert.equal(origin.pathname,'/');assert.ok(!origin.username&&!origin.password);
const out=path.resolve('artifacts/performance-phase2/library-network');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const result={passed:false,origin:origin.origin,startedAt:new Date().toISOString(),conditions:'One fresh browser context per variant, original then optimized, existing CDN cache may be warm. Chrome CDP 10 Mbps download/upload, 80 ms latency; simulated network, not physical mobile or onsite Wi-Fi. One trial each, not a statistical startup/FPS comparison. No hero download, model API or activity records.',runs:[],errors:[]};let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',...(process.env.CAMPUS_QA_PROXY?{proxy:{server:process.env.CAMPUS_QA_PROXY}}:{})});result.browser=browser.version();
 for(const variant of ['original','optimized']){
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  await context.route('**/api/works/**',r=>r.abort());const page=await context.newPage(),cdp=await context.newCDPSession(page),models=new Map();
  page.on('pageerror',e=>result.errors.push({variant,error:e.message}));
  await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:1250000,uploadThroughput:1250000,connectionType:'cellular4g'});
  cdp.on('Network.responseReceived',e=>{if(new URL(e.response.url).pathname.endsWith('/model.glb'))models.set(e.requestId,{url:e.response.url,status:e.response.status,headers:Object.fromEntries(Object.entries(e.response.headers).filter(([k])=>/^(content-encoding|content-length|cache-control|x-vercel-cache)$/i.test(k)))});});
  cdp.on('Network.loadingFinished',e=>{const record=models.get(e.requestId);if(record)record.encodedDataLength=e.encodedDataLength;});
  const started=performance.now();await page.goto(origin.origin+'/works/library/'+(variant==='original'?'?assets=original':''),{timeout:180000});
  await page.waitForFunction(()=>window.__libraryDebug?.ready,null,{timeout:240000});
  const readyWallMs=performance.now()-started;
  const data=await page.evaluate(()=>({heroReady:__libraryDebug.heroReady,model:__libraryDebug.assets.library,variant:document.documentElement.dataset.libraryAssetVariant,modelReadyMs:Number(document.documentElement.dataset.libraryModelReadyMs),resources:performance.getEntriesByType('resource').filter(e=>e.name.endsWith('.glb')).map(e=>({url:e.name,duration:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize,decodedBodySize:e.decodedBodySize}))}));
  assert.equal(data.variant,variant);assert.equal(data.heroReady,false);assert.equal(data.resources.some(e=>e.url.endsWith('/hero.glb')),false);
  await page.locator('#resume').click();await page.waitForTimeout(200);await page.screenshot({path:path.join(out,variant+'.png')});
  const run={variant,readyWallMs,...data,modelResponses:[...models.values()]};result.runs.push(run);console.log(JSON.stringify(run));await context.close();
 }
 assert.deepEqual(result.errors,[]);result.passed=true;
}catch(error){result.error=error.message;process.exitCode=1;}
finally{await browser?.close();result.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,error:result.error,out}));}
