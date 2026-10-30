// Builds a private, temporary QA copy. No diagnostics global is shipped.
// Chrome touch emulation exercises a mobile layout, not a physical phone GPU.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/npc-transport-20261031/browser'));
const mobile=arg('--profile','desktop')==='mobile',rate=Number(arg('--cpu','1'));
assert.ok(rate>=1&&rate<=8);
const work=await mkdtemp(path.join(tmpdir(),'campus-npc-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const injection=`
globalThis.__npcQA={
 ready:()=>!!commute?.npcTransport&&canvas.dataset.campusDetails==='ready',
 read(){return {npc:commute.npcTransport.getDiagnostics(),frame:frameMetrics.snapshot(),session:frameMetrics.session(),quality:{...qualityBudget},resources:{...renderer.info.memory},passes:{...lastPasses},suspended:commute.suspended,errors:[]};},
 pause(value){commute.setSuspended(value);needsRender=true;},
 view(id){commute.stopFollow();animation=null;controls.enabled=true;controls.minDistance=1;controls.maxDistance=20000;const p=commute.npcTransport.getDiagnostics().poses.find(p=>p.id===id);if(!p)throw Error('Missing NPC '+id);const size=p.mode==='helicopter'?18:p.mode==='roadster'?9:p.mode==='boat'?9:5;camera.position.set(p.x+size*.7,p.y+size*.32+1,p.z+size);controls.target.set(p.x,p.y+(p.mode==='hoverboard'?1.1:1),p.z);camera.lookAt(controls.target);needsRender=true;return p;},
 far(){commute.stopFollow();animation=null;controls.enabled=true;controls.maxDistance=20000;camera.position.set(12000,200,12000);controls.target.set(12001,200,12000);camera.lookAt(controls.target);needsRender=true;},
 reset(){frameMetrics.reset();frameMetrics.resetSession();},
 layerVisible(value){commute.setVisible(value);needsRender=true;},
 inspect(id){const object=scene.getObjectByName(id);if(!object)return null;const box=new THREE.Box3().setFromObject(object),meshes=[];object.traverse(o=>{if(o.isMesh)meshes.push({name:o.name,visible:o.visible,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3});});return {name:object.name,matrixAutoUpdate:object.matrixAutoUpdate,matrixWorldAutoUpdate:object.matrixWorldAutoUpdate,box:{min:box.min.toArray(),max:box.max.toArray()},meshes};}
};`;
const report={passed:false,root,mobileViewport:mobile,cpuThrottle:rate,startedAt:new Date().toISOString(),errors:[],screenshots:[],scope:'Temporary local production build, installed desktop Chrome; actual scene rendering and lifecycle. Touch viewport and optional CPU throttle are synthetic; no physical-phone, public-network or multiplayer claim.'};
let app,browser,context;
await mkdir(out,{recursive:true});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
try{
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'local-npc-probe',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\n'+injection;}}]});
 app=await createLiveServer({rootDir:root,distDir:dist,dataDir,password:'isolated-npc-test-only',workEnv:{},initialState:createDefaultLiveState()});
 const address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
 const join=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离 NPC 运行验收',tabId:'npc-verification'}});assert.equal(join.status(),200);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const cdp=await context.newCDPSession(page);
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});
 await page.waitForFunction(()=>globalThis.__npcQA?.ready(),null,{timeout:90000});
 await page.waitForTimeout(1500);
 report.initial=await page.evaluate(()=>__npcQA.read());
 assert.ok(report.initial.npc.total>=4&&report.initial.npc.total<=8,'Fleet must be modest but contain varied vehicles');
 for(const mode of ['helicopter','hoverboard','roadster','boat'])assert.ok(report.initial.npc.counts[mode]>0,'Missing '+mode);
 await page.waitForTimeout(1000);report.afterMoving=await page.evaluate(()=>__npcQA.read());
 report.motion=report.initial.npc.poses.map(before=>{const after=report.afterMoving.npc.poses.find(p=>p.id===before.id);assert.ok(after);const metres=distance(before,after);assert.ok(metres>.1,'NPC did not move: '+before.id);return {id:before.id,metres};});
 await page.evaluate(()=>__npcQA.pause(true));report.pauseBefore=await page.evaluate(()=>__npcQA.read());
 await page.waitForTimeout(800);report.pauseAfter=await page.evaluate(()=>__npcQA.read());
 assert.deepEqual(report.pauseAfter.npc.poses,report.pauseBefore.npc.poses,'Activity pause must freeze NPCs');
 assert.equal(report.pauseAfter.npc.elapsedSeconds,report.pauseBefore.npc.elapsedSeconds);
 await page.evaluate(()=>__npcQA.pause(false));await page.waitForTimeout(250);report.resumed=await page.evaluate(()=>__npcQA.read());
 assert.ok(report.resumed.npc.elapsedSeconds>report.pauseAfter.npc.elapsedSeconds,'NPCs failed to resume');
 assert.ok(report.resumed.npc.elapsedSeconds-report.pauseAfter.npc.elapsedSeconds<.8,'Resume must not simulate suspended time');
 await page.evaluate(()=>__npcQA.far());await page.waitForTimeout(350);report.far=await page.evaluate(()=>__npcQA.read());
 assert.equal(report.far.npc.visibleCount,0,'Far-away NPC models must be culled');
 report.models=[];
 for(const mode of ['hoverboard','roadster','helicopter','boat']){
  const item=report.initial.npc.poses.find(p=>p.mode===mode);
  await page.evaluate(id=>__npcQA.view(id),item.id);await page.waitForTimeout(200);
  const visible=await page.evaluate(()=>__npcQA.read());assert.ok(visible.npc.poses.find(p=>p.id===item.id)?.visible,'Close NPC should be rendered: '+item.id);
  await page.evaluate(()=>__npcQA.pause(true));await page.waitForTimeout(80);
  const filename=mode+'.png';await page.screenshot({path:path.join(out,filename)});report.screenshots.push(filename);
  report.models.push({id:item.id,mode,inspection:await page.evaluate(id=>__npcQA.inspect(id),item.id),snapshot:await page.evaluate(()=>__npcQA.read())});
  await page.evaluate(()=>__npcQA.pause(false));
 }
 await page.evaluate(()=>__npcQA.layerVisible(false));await page.waitForTimeout(100);report.hidden=await page.evaluate(()=>__npcQA.read());
 assert.equal(report.hidden.npc.visibleCount,0,'Disabling 3D traffic must hide fleet');
 await page.evaluate(()=>__npcQA.layerVisible(true));await page.waitForTimeout(100);report.reshown=await page.evaluate(()=>__npcQA.read());assert.ok(report.reshown.npc.visibleCount>0);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate});
 await page.evaluate(()=>__npcQA.reset());await page.waitForTimeout(5000);report.frameSample=await page.evaluate(()=>__npcQA.read());
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 assert.ok(report.frameSample.npc.drawCalls<=50,'NPC fleet exceeded its draw budget');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack??error.message;process.exitCode=1;}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
