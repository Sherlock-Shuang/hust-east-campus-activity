/** Real PC Unity player; verifies lifecycle, actual native frame boundaries and input. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLibraryHandler} from './handler.mjs';
import {applyWanyanPerformance} from './wanyan-performance.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const out=path.join(root,'artifacts/performance-20261101/wanyan-lifecycle');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const html=applyWanyanPerformance(await readFile(path.join(root,'work-assets/wanyan/index.html'),'utf8'));
const runtime=await readFile(new URL('./wanyan-performance.js',import.meta.url));
const handler=await createLibraryHandler({assetsRoot:path.join(root,'work-assets')});
const host=`<!doctype html><html><body style="margin:0"><iframe id="work" style="border:0;width:100vw;height:100vh" allow="gamepad;autoplay;fullscreen" src="/works/wanyan/?campusAttempt=perf-lifecycle"></iframe><script>
window.activityMessages=[];window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==work.contentWindow)return;activityMessages.push(e.data);if(e.data.type==='campus:ready'&&e.data.level==='page_opened')sendPause(true);});
window.sendPause=value=>work.contentWindow.postMessage({type:'campus:activity',attemptId:'perf-lifecycle',paused:value},location.origin);
window.sendLibrary=value=>work.contentWindow.postMessage({type:'bookrealm:controls',suspended:value},location.origin);
window.disposeWork=()=>work.contentWindow.postMessage({type:'campus:dispose',attemptId:'perf-lifecycle'},location.origin);
</script></body></html>`;
const server=createServer((req,res)=>{
  const p=new URL(req.url,'http://localhost').pathname;
  if(p==='/'||p==='/works/wanyan/'||p==='/works/wanyan/wanyan-performance.js'){
    res.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html','Cache-Control':'no-store'});res.end(p==='/'?host:p.endsWith('.js')?runtime:html);return;
  }
  handler(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(error=>{res.writeHead(500);res.end(error.message);});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,checks=[],errors=[],consoleErrors=[],failedResponses=[];let browser;
const record=(name,value)=>{checks.push({name,...value});console.log(name);};
try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:2}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('response',response=>{if(response.status()>=400)failedResponses.push({status:response.status(),url:response.url()});});
  await page.goto(origin+'/');
  const frame=page.frames().find(f=>f.url().includes('/works/wanyan/'));
  await frame.waitForFunction(()=>document.documentElement.dataset.campusWorkStatus==='runtime_ready'&&window.campusWanyanPerformance?.snapshot().enginePaused,null,{timeout:120000});
  record('host pause arriving before engine startup is retained',{snapshot:await frame.evaluate(()=>window.campusWanyanPerformance.snapshot())});
  await page.evaluate(()=>sendPause(false));
  await frame.waitForFunction(()=>!window.bookrealmControlsSuspended&&!window.campusWanyanPerformance.snapshot().resuming,null,{timeout:30000});
  await frame.locator('#unity-canvas').click();await page.keyboard.press('Enter');
  await frame.waitForFunction(()=>window.bookrealmNativeControls?.started&&!window.bookrealmNativeControls?.paused,null,{timeout:30000});
  await page.keyboard.down('KeyW');await page.waitForTimeout(250);await page.keyboard.up('KeyW');
  await page.evaluate(()=>sendPause(true));
  await frame.waitForFunction(()=>window.campusWanyanPerformance.snapshot().enginePaused);
  const before=await frame.evaluate(()=>{window.__pauseState=window.bookrealmNativeControls;return {state:window.__pauseState,quality:window.campusWanyanPerformance.snapshot(),canvas:[document.getElementById('unity-canvas').width,document.getElementById('unity-canvas').height]};});
  await page.waitForTimeout(600);
  const frozen=await frame.evaluate(()=>({sameNativeFrame:window.__pauseState===window.bookrealmNativeControls,state:window.bookrealmNativeControls}));
  assert.equal(frozen.sameNativeFrame,true);assert.deepEqual(frozen.state,before.state);
  record('real Unity LateUpdate stops completely during host pause',{before,frozen});
  await page.evaluate(()=>sendLibrary(true));await page.evaluate(()=>sendPause(false));
  await page.waitForTimeout(150);assert.equal(await frame.evaluate(()=>window.campusWanyanPerformance.snapshot().enginePaused),true);
  await page.evaluate(()=>sendLibrary(false));
  await frame.waitForFunction(()=>!window.bookrealmControlsSuspended&&!window.bookrealmNativeControls.suspended);
  const resumed=await frame.evaluate(()=>({state:window.bookrealmNativeControls,quality:window.campusWanyanPerformance.snapshot()}));
  const displacement=Math.hypot(resumed.state.playerX-before.state.playerX,resumed.state.playerZ-before.state.playerZ);
  assert.ok(displacement<.15,`Unexpected resume displacement ${displacement}`);record('nested reasons and resume without movement catch-up',{displacement,resumed});
  await frame.locator('#unity-canvas').focus();await page.keyboard.press('Escape');
  await frame.waitForFunction(()=>window.bookrealmNativeControls?.paused&&!window.bookrealmNativeControls?.suspended);
  await page.evaluate(()=>sendPause(true));await page.waitForTimeout(100);await page.evaluate(()=>sendPause(false));
  await frame.waitForFunction(()=>!window.bookrealmControlsSuspended&&!window.bookrealmNativeControls.suspended);
  assert.equal(await frame.evaluate(()=>window.bookrealmNativeControls.paused),true);record('host resume preserves an existing native pause menu',{});
  await frame.locator('#unity-canvas').focus();await page.keyboard.press('Escape');
  await frame.waitForFunction(()=>!window.bookrealmNativeControls?.paused);
  const position=await frame.evaluate(()=>({x:window.bookrealmNativeControls.playerX,z:window.bookrealmNativeControls.playerZ}));
  await page.keyboard.down('KeyD');await page.waitForTimeout(300);await page.keyboard.up('KeyD');
  const after=await frame.evaluate(()=>({x:window.bookrealmNativeControls.playerX,z:window.bookrealmNativeControls.playerZ}));
  assert.ok(Math.hypot(after.x-position.x,after.z-position.z)>.15);record('keyboard locomotion resumes normally',{position,after});
  await page.screenshot({path:path.join(out,'actual-pc-gameplay.png')});
  await page.evaluate(()=>sendPause(true));await page.waitForTimeout(80);await page.evaluate(()=>disposeWork());
  await frame.waitForFunction(()=>window.campusWanyanPerformance.snapshot().disposed);
  record('paused iframe disposal requests real Unity Quit',{snapshot:await frame.evaluate(()=>window.campusWanyanPerformance.snapshot())});
  const messages=await page.evaluate(()=>activityMessages);assert.equal(messages.some(m=>m.type==='bookrealm:game-complete'||m.type==='campus:completed'),false);
  await context.close();assert.deepEqual(errors,[]);
}finally{
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,consoleErrors,failedResponses,scope:'Actual Mac Chrome desktop PC Unity build and activity-only wrapper. Functional lifecycle/input verification; not physical mobile FPS, native Unity rebuild, victory or CDN verification.'},null,2));
}
console.log(JSON.stringify({out,checks:checks.length,errors}));
