// Real Chromium traversal A/B. Instrumentation is injected only into a temporary
// local build; it is never a production global or public route. CPU throttling
// and a touch viewport are reproducible stress conditions, not physical phones.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/movement-performance-20261031/browser'));
const seconds=Number(arg('--seconds','20')),rate=Number(arg('--cpu','4')),mobile=arg('--profile','desktop')==='mobile';
const modes=arg('--modes','walk,hoverboard').split(','),quality=arg('--quality','smooth'),interactionSmoke=process.argv.includes('--interaction-smoke');
assert.ok(seconds>=5&&seconds<=120&&rate>=1&&rate<=8&&modes.every(m=>['walk','hoverboard','spider','helicopter'].includes(m)));
const work=await mkdtemp(path.join(tmpdir(),'campus-traversal-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const injection=`
// Isolated benchmark build only.
const qaCosts={};
function qaWrap(object,key,label){const fn=object?.[key];if(!fn)return;object[key]=function(...args){const t=performance.now();try{return fn.apply(this,args);}finally{const c=qaCosts[label]??={calls:0,ms:0,maxMs:0};const d=performance.now()-t;c.calls++;c.ms+=d;c.maxMs=Math.max(c.maxMs,d);}};}
qaWrap(campus,'update','campus');qaWrap(commute,'tick','simulationAndPlayer');qaWrap(renderer,'render','renderer');
globalThis.__campusTraversalQA={
  ready:()=>!!commute?.player.active&&canvas.dataset.campusDetails==='ready',
  place(mode){const r=commute.route,at=r.points.findIndex(p=>p.progress>=347.7),a=r.points[at],b=r.points[at+1];const p={x:a.x,z:a.z,yaw:Math.atan2(a.x-b.x,a.z-b.z)};const result=commute.player.enterAt(p);if(!result?.ok)throw Error('Route spawn blocked: '+result?.reason);commute.player.enter(mode);return {...p,mode:commute.player.state.mode};},
  pickup(){const object=scene.getObjectByName('world-hoverboard-1');if(!object)throw Error('Missing placed board');const p=new THREE.Vector3();object.getWorldPosition(p);for(const [x,z]of [[2,0],[-2,0],[0,2],[0,-2]]){const r=commute.player.enterAt({x:p.x+x,y:p.y,z:p.z+z,yaw:object.rotation.y});if(r?.ok)return;}throw Error('No clear pickup approach');},
  reset(){frameMetrics.reset();frameMetrics.resetSession();for(const k of Object.keys(qaCosts))delete qaCosts[k];},
  read(){const p=commute.player.state;return {state:{x:p.x,y:p.y,z:p.z,yaw:p.yaw,mode:p.mode,speed:p.speed,grounded:p.grounded,blockedReason:p.blockedReason},frame:frameMetrics.snapshot(),session:frameMetrics.session(),costs:structuredClone(qaCosts),quality:{...qualityBudget},passes:{...lastPasses},dataset:{...canvas.dataset},resources:{...renderer.info.memory},decorations:campus.decorationStats};}
};`;
const report={passed:false,root,seconds,cpuThrottle:rate,mobileViewport:mobile,quality,modes,startedAt:new Date().toISOString(),results:[],errors:[],scope:'Installed desktop Chrome, production-mode local temporary build with identical timing probes; synthetic CPU throttle and touch viewport. Real movement keys, original simulation. No physical-phone/GPU-throttle/thermal/remote-network claim.'};
let app,browser,context;
await mkdir(out,{recursive:true});
try{
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'local-traversal-probe',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\n'+injection;}}]});
 app=await createLiveServer({rootDir:root,distDir:dist,dataDir,password:'local-traversal-only',workEnv:{},initialState:createDefaultLiveState()});
 const address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(q=>localStorage.setItem('campus-quality-mode-v1',q),quality);
 const join=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离移动性能验收',tabId:'traversal'}});assert.equal(join.status(),200);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});
 await page.waitForFunction(()=>globalThis.__campusTraversalQA?.ready(),null,{timeout:90000});
 await page.waitForTimeout(2500);
 for(const mode of modes){
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
   await page.evaluate(mode=>__campusTraversalQA.place(mode),mode);await page.locator('#map-canvas').focus();await page.keyboard.press('KeyV');await page.waitForTimeout(600);await page.locator('#map-canvas').focus();
   if(mode==='hoverboard'||mode==='helicopter'){await page.keyboard.down('KeyQ');await page.waitForTimeout(9500);await page.keyboard.up('KeyQ');assert.ok((await page.evaluate(()=>__campusTraversalQA.read())).state.y>35,'Flight did not take off');}
   await page.keyboard.down('KeyW');if(mode!=='walk')await page.keyboard.down('ShiftLeft');await page.waitForTimeout(1500);
   await cdp.send('Emulation.setCPUThrottlingRate',{rate});await page.waitForTimeout(1200);
   const start=await page.evaluate(()=>{__campusTraversalQA.reset();return __campusTraversalQA.read();}),samples=[];
   const started=performance.now();
   for(let i=0;i<seconds;i++){await page.waitForTimeout(Math.max(0,started+(i+1)*1000-performance.now()));samples.push(await page.evaluate(()=>{const r=__campusTraversalQA.read();return {state:r.state,frame:r.frame,costs:r.costs,quality:r.quality,dataset:r.dataset};}));}
   const finish=await page.evaluate(()=>__campusTraversalQA.read()),durationMs=performance.now()-started;
   await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
   const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   const distance=Math.hypot(finish.state.x-start.state.x,finish.state.z-start.state.z),result={mode,durationMs,distance,start,finish,samples,metrics};
   report.results.push(result);await page.screenshot({path:path.join(out,mode+'.png')});
   console.log(JSON.stringify({mode,distance,durationMs,frame:finish.frame,costs:finish.costs,quality:finish.quality}));
   assert.equal(finish.state.mode,mode);assert.ok(distance>(mode==='walk'?10:60),'Traversal was blocked; do not use stationary result as movement benchmark');
 }
 if(interactionSmoke){
   assert.ok(mobile,'Touch interaction smoke needs --profile mobile');
   await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await page.evaluate(()=>__campusTraversalQA.pickup());await page.waitForTimeout(600);await page.locator('#map-canvas').focus();
   await page.keyboard.press('KeyF');await page.waitForFunction(()=>__campusTraversalQA.read().state.mode==='hoverboard');
   await page.waitForTimeout(600);const before=await page.evaluate(()=>__campusTraversalQA.read().state);
   const button=await page.locator('#mobile-controls [data-mobile-hold=up]').boundingBox();assert.ok(button);
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:button.x+button.width/2,y:button.y+button.height/2}]});await page.waitForTimeout(2500);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   const airborne=await page.evaluate(()=>__campusTraversalQA.read().state);assert.ok(airborne.y>before.y+2,'Touch climb failed');
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:2,x:180,y:260}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:2,x:180,y:185}]});await page.waitForTimeout(2200);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   const moved=await page.evaluate(()=>__campusTraversalQA.read().state);assert.ok(Math.hypot(moved.x-airborne.x,moved.z-airborne.z)>2,'Floating touch joystick did not move the board');
   await page.screenshot({path:path.join(out,'touch-flight.png')});report.touchInteraction={placedBoardPickedUp:true,touchClimbMetres:airborne.y-before.y,touchMoveMetres:Math.hypot(moved.x-airborne.x,moved.z-airborne.z)};
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.message;process.exitCode=1;}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
