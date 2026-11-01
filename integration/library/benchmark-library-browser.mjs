/** Serial local A/B of the real library. Instrumentation is response-only. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createLibraryHandler} from './handler.mjs';
import {applyLibraryPerformance} from './library-performance.mjs';

const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const baselineRoot=path.resolve(option('--baseline-root',path.join(root,'../performance-20261101-baseline')));
const out=path.resolve(option('--output',path.join(root,'artifacts/performance-20261101/library-browser')));
const duration=Number(option('--duration','2500')),cpuRate=Number(option('--cpu','4'));
const layouts=option('--layouts','desktop,mobile').split(',');
const variants=option('--variants','baseline,optimized').split(',');
const source=await readFile(path.join(baselineRoot,'work-assets/library/hub/main.mjs'),'utf8');
assert(!source.includes('campus-library-render-v3'),'baseline must be the unchanged v2 runtime');
const candidate=applyLibraryPerformance(source),helper=await readFile(path.join(root,'integration/library/library-render-runtime.mjs'),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const sourceHashes={baseline:hash(source),optimized:hash(candidate),helper:hash(helper)};
const configurations={desktop:{viewport:{width:1280,height:720},deviceScaleFactor:1},mobile:{viewport:{width:844,height:390},deviceScaleFactor:1,isMobile:true,hasTouch:true}};
await mkdir(out,{recursive:true});

function instrument(code){
  code=`const libraryBench=window.__libraryBench={renders:[],raycasts:[],mixerUpdates:0,cameraUpdates:0,mode:'',panStart:0};\n`+code;
  const draw='renderer.render(scene,camera);';assert.equal(code.split(draw).length,2);
  code=code.replace(draw,`{const start=performance.now();renderer.render(scene,camera);libraryBench.renders.push({at:start,cpuMs:performance.now()-start,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles});}`);
  code=code.replace('if(!paused)mixer?.update(dt);','if(!paused&&mixer){libraryBench.mixerUpdates++;mixer.update(dt);}');
  code=code.replace('const p=cameraPose(', 'libraryBench.cameraUpdates++;const p=cameraPose(');
  const ray='const pointerLock=new PointerLockController(';assert.equal(code.split(ray).length,2);
  code=code.replace(ray,`const benchIntersect=raycaster.intersectObjects.bind(raycaster);raycaster.intersectObjects=(objects,...args)=>{const start=performance.now(),result=benchIntersect(objects,...args);libraryBench.raycasts.push({objects:objects.length,cpuMs:performance.now()-start});return result;};\n${ray}`);
  code=code.replace('pollController(now,dt);',`if(libraryBench.mode==='pan')yaw=Math.sin((now-libraryBench.panStart)/900)*.7;pollController(now,dt);`);
  return code;
}
const handler=await createLibraryHandler({assetsRoot:path.join(root,'work-assets')});
const server=createServer((req,res)=>{
  if(new URL(req.url,'http://local').pathname==='/works/library/library-render-runtime.mjs'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(helper);return;}
  handler(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(error=>{res.writeHead(500);res.end(error.message);});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const results=[],errors=[],badResponses=[];let browser,passed=false,browserVersion='';
const quantile=(list,q)=>{const values=[...list].sort((a,b)=>a-b);return values.length?values[Math.min(values.length-1,Math.floor(values.length*q))]:null;};
function summarize(raw){
  const frames=raw.renders,intervals=frames.slice(1).map((frame,i)=>frame.at-frames[i].at),ray=raw.raycasts;
  return {...raw,renders:undefined,raycasts:undefined,submittedFrames:frames.length,renderSubmissionHz:frames.length*1000/raw.elapsedMs,
    renderIntervalMedianMs:quantile(intervals,.5),renderIntervalP95Ms:quantile(intervals,.95),renderCpuMedianMs:quantile(frames.map(f=>f.cpuMs),.5),renderCpuP95Ms:quantile(frames.map(f=>f.cpuMs),.95),
    frameTrianglesMedian:quantile(frames.map(f=>f.triangles),.5),frameCallsMedian:quantile(frames.map(f=>f.calls),.5),
    raycastCalls:ray.length,raycastObjects:ray.reduce((sum,r)=>sum+r.objects,0),raycastCpuTotalMs:ray.reduce((sum,r)=>sum+r.cpuMs,0)};
}
try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  browserVersion=browser.version();
  for(const layout of layouts)for(const variant of variants){
    assert(['baseline','optimized'].includes(variant));
    assert(configurations[layout]);
    const context=await browser.newContext(configurations[layout]);
    // Returning-reader fixture prevents the timed opening chat covering the
    // measured scene. It grants no game victory, exit or fireworks state.
    await context.addInitScript(()=>localStorage.setItem('campus-library-save-v1',JSON.stringify({journey:{version:2,story:{intro:{status:'done',cursor:8,replies:['我准备好了。','记住了，I921 和 J921。']}}}})));
    const page=await context.newPage(),requests=[];
    page.on('pageerror',error=>errors.push({layout,variant,message:error.message}));
    page.on('response',response=>{if(response.status()>=400)badResponses.push({layout,variant,url:response.url(),status:response.status()});});
    page.on('request',request=>requests.push(request.url()));
    await page.route('**/works/library/hub/main.mjs*',route=>route.fulfill({status:200,contentType:'text/javascript',body:instrument(variant==='baseline'?source:candidate)}));
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuRate});
    await page.goto(origin+'/works/library/');await page.bringToFront();
    await page.waitForFunction(()=>window.__libraryDebug?.ready,null,{timeout:120000});
    assert.equal(await page.evaluate(()=>__libraryDebug.heroReady),false);
    assert.deepEqual(await page.evaluate(()=>__libraryDebug.story.journey.completed),{isaac:false,wanyan:false});
    const renderer=await page.evaluate(()=>{const gl=document.querySelector('#stage canvas').getContext('webgl2'),info=gl.getExtension('WEBGL_debug_renderer_info');return {version:gl.getParameter(gl.VERSION),vendor:info?gl.getParameter(info.UNMASKED_VENDOR_WEBGL):null,renderer:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):null};});
    const run={layout,variant,viewport:configurations[layout],cpuRate,renderer,samples:[],requests};results.push(run);
    const sample=async(name,{during,mode=''}={})=>{
      await page.evaluate(mode=>{const b=__libraryBench;b.renders=[];b.raycasts=[];b.mixerUpdates=0;b.cameraUpdates=0;b.mode=mode;b.panStart=b.start=performance.now();},mode);
      if(during)await during();else await page.waitForTimeout(duration);
      const raw=await page.evaluate(()=>{const b=__libraryBench;b.mode='';return {elapsedMs:performance.now()-b.start,renders:b.renders,raycasts:b.raycasts,mixerUpdates:b.mixerUpdates,cameraUpdates:b.cameraUpdates,pose:__libraryDebug.getPose(),stats:__libraryDebug.renderStats,runtime:__libraryDebug.runtimeStats||null,hover:document.querySelector('#stage canvas').dataset.hoverBook,heroReady:__libraryDebug.heroReady,actorVisible:__libraryDebug.actor.visible};});
      const result={name,...summarize(raw)};run.samples.push(result);console.log(JSON.stringify({layout,variant,...result}));return result;
    };
    await page.waitForTimeout(700);const paused=await sample('paused');
    if(variant==='optimized')assert(paused.submittedFrames<=Math.ceil(paused.elapsedMs/1000)+1,'unchanged pause background sleeps');
    await page.locator('#resume').click();await page.locator('#stage canvas').focus();await page.waitForTimeout(500);
    await sample('first-stationary');await page.screenshot({path:path.join(out,`${layout}-${variant}-first.png`)});
    await page.evaluate(()=>__libraryDebug.setPose(2.12,-.85,0,0));
    const before=await page.evaluate(()=>__libraryDebug.getPose());
    await page.keyboard.down('KeyW');const movement=await sample('first-walking');await page.keyboard.up('KeyW');
    assert(Math.hypot(movement.pose.x-before.x,movement.pose.z-before.z)>2,'real keyboard walking must move');
    await page.evaluate(()=>__libraryDebug.setPose(2.12,-12,0,0));await sample('first-camera-pan',{mode:'pan'});
    await page.evaluate(()=>__libraryDebug.setPose(-1.0689569245685826,-19.486767865129348,0,-.3006520715079661));
    await page.mouse.move(configurations[layout].viewport.width/2,configurations[layout].viewport.height/2);await page.waitForTimeout(250);
    const book=await sample('book-occlusion');assert.equal(book.hover,'wanyan','actual J921 remains readable with exact occlusion');
    await page.screenshot({path:path.join(out,`${layout}-${variant}-book.png`)});
    // The cached readable result must disappear when the real view changes,
    // then recover on the exact same book; this exercises memo invalidation.
    await page.evaluate(()=>__libraryDebug.setPose(-1.0689569245685826,-19.486767865129348,Math.PI,0));await page.waitForTimeout(250);
    assert.equal(await page.locator('#stage canvas').getAttribute('data-hover-book'),'');
    await page.evaluate(()=>__libraryDebug.setPose(-1.0689569245685826,-19.486767865129348,0,-.3006520715079661));await page.waitForTimeout(250);
    assert.equal(await page.locator('#stage canvas').getAttribute('data-hover-book'),'wanyan');
    await page.evaluate(()=>{__libraryDebug.setPose(2.12,-.85,0,0);__libraryDebug.setView('third');});
    await page.waitForFunction(()=>__libraryDebug.heroReady,null,{timeout:90000});await page.waitForTimeout(600);
    const third=await sample('third-animation');assert.equal(third.actorVisible,true);assert(third.mixerUpdates>0);
    await page.screenshot({path:path.join(out,`${layout}-${variant}-third.png`)});
    await page.evaluate(()=>__libraryDebug.setView('first'));const hidden=await sample('loaded-hero-hidden');assert.equal(hidden.actorVisible,false);
    if(variant==='optimized')assert.equal(hidden.mixerUpdates,0,'hidden first-person hero must stop animation updates');
    await page.evaluate(()=>__libraryDebug.setView('third'));await page.waitForTimeout(150);
    const restored=await sample('third-restored');assert.equal(restored.actorVisible,true);assert(restored.mixerUpdates>0);
    if(layout==='mobile'){
      await page.keyboard.press('KeyP');await page.waitForFunction(()=>__libraryDebug.story.phoneActive);
      const phone=await sample('mobile-fullscreen-phone');assert.equal(phone.submittedFrames,0);
      if(variant==='optimized')assert.equal(phone.mixerUpdates,0);
      await page.getByRole('button',{name:'收起手机'}).click();await page.waitForFunction(()=>!__libraryDebug.story.phoneActive);
    }
    const heroUrl=await page.evaluate(()=>new URL(__libraryDebug.assets.hero.url,location.href).href);
    assert.equal(requests.filter(url=>url===heroUrl).length,1,'hero loads once');
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);passed=true;
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(out,'report.json'),JSON.stringify({passed,browserVersion,sourceHashes,duration,cpuRate,results,errors,badResponses,
    scope:'Serial local Chrome WebGL. Same models/materials/assets and resolution; CPU emulation is not a real phone. Counts and intervals instrument actual renderer.render submissions, not rAF callbacks; submission Hz is not a claim of displayed/compositor FPS or GPU time. Walking uses real keyboard, camera pan uses identical test-only yaw drive; exact book pickup, lazy hero, hidden/resumed animation are exercised. A local returning-reader fixture has opening chat read and both game victories false. Instrumentation only overlays main.mjs HTTP responses and is never published.'},null,2));
}
console.log(JSON.stringify({passed,out,variants:results.length,errors}));
