// Isolated real Chromium run. A resized/coarse-pointer desktop is NOT a phone
// or a thermal test. --root permits the same harness against an unchanged build.
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root',fileURLToPath(new URL('..',import.meta.url))));
const out=path.resolve(arg('--output','artifacts/performance-phase2/browser'));
const seconds=Math.max(5,Number(arg('--seconds','20'))),runs=Math.max(1,Number(arg('--runs','3'))),quality=arg('--quality','balanced');
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const dataDir=await mkdtemp(path.join(tmpdir(),'phase2-browser-')),results=[],errors=[];let app,browser;
await mkdir(out,{recursive:true});
try{
  app=await createLiveServer({rootDir:root,dataDir,password:'isolated-browser-performance-only',initialState:createDefaultLiveState()});
  const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  for(let run=0;run<runs;run++){
    const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
    await context.addInitScript(q=>localStorage.setItem('campus-quality-mode-v1',q),quality);
    await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'性能隔离验收',tabId:`run-${run}`}});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    for(const cache of ['cold','warm']){
      const started=performance.now();await page.goto(origin+'/?diagnostics=1');
      await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
      await page.waitForFunction(()=>document.querySelector('#map-canvas')?.dataset.frameSamples>5,null,{timeout:60000});
      const readyWallMs=performance.now()-started;
      await page.locator('#map-canvas').focus();await page.keyboard.down('KeyW');await page.waitForTimeout(700);await page.keyboard.up('KeyW');
      const samples=[];for(let i=0;i<seconds;i++){await page.waitForTimeout(1000);samples.push(await page.locator('#map-canvas').evaluate(el=>({...el.dataset})));}
      const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出性能报告'}).click();
      const download=await downloadPromise,report=JSON.parse(await readFile(await download.path(),'utf8'));
      await page.screenshot({path:path.join(out,`${quality}-${run}-${cache}.png`)});
      results.push({run,cache,readyWallMs,report,samples});console.log(JSON.stringify({run,cache,readyWallMs,frame:report.frame,startup:report.startup}));
    }
    await context.close();
  }
  assert.deepEqual(errors,[]);
}finally{
  await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});
  await writeFile(path.join(out,'report.json'),JSON.stringify({root,quality,runs,seconds,errors,results,scope:'Real headless Chrome on this Mac; isolated local production build and activity data. No physical phone, remote CDN, thermal or 100-device GPU claim.'},null,2));
}
