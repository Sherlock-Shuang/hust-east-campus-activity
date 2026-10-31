// A private temporary production build exercises the actual instanced traffic
// and keyboard pickup path. No QA globals or temporary audience data ship.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/residential-traffic-20261031/browser'));
const mobile=arg('--profile','desktop')==='mobile',rate=Number(arg('--cpu','1'));
assert.ok(rate>=1&&rate<=8);
const work=await mkdtemp(path.join(tmpdir(),'campus-residential-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const injection=`
let residentialProbe=null,residentialProbeFrozen=false;
function installResidentialProbe(){const layer=commute?.residentialTraffic;if(!layer||layer===residentialProbe)return;residentialProbe=layer;const tick=layer.tick;layer.tick=function(dt,...args){return tick.call(this,residentialProbeFrozen?0:dt,...args);};}
globalThis.__residentialQA={
 ready(){installResidentialProbe();return !!commute?.residentialTraffic&&canvas.dataset.campusDetails==='ready';},
 read(){
  const residential=commute.residentialTraffic.getDiagnostics(),ids=new Set(residential.agents.map(a=>a.id)),rendered=new Set(),batches=[];
  commute.visual.group.traverse(o=>{if(o.isInstancedMesh){const branch=(o.userData.agentIds||[]).filter(id=>ids.has(id));if(commute.visual.group.visible&&o.visible)for(const id of branch)rendered.add(id);batches.push({name:o.name,component:o.userData.component,count:o.count,branchCount:branch.length,geometry:o.geometry.uuid});}});
  const p=commute.player.state;
  return {residential,air:commute.npcTransport.getDiagnostics(),renderedIds:[...rendered],batches,frame:frameMetrics.snapshot(),session:frameMetrics.session(),quality:{...qualityBudget},resources:{...renderer.info.memory},player:{x:p.x,y:p.y,z:p.z,yaw:p.yaw,speed:p.speed,mode:p.mode},transport:commute.player.captureActivityPose()?.transport??null,suspended:commute.suspended};
 },
 pause(value){commute.setSuspended(value);needsRender=true;},
 stopCamera(){commute.stopFollow();animation=null;controls.enabled=true;controls.minDistance=1;controls.maxDistance=20000;},
 viewCorridor(){this.stopCamera();const points=commute.residentialTraffic.plan.paths.flatMap(p=>p.points),xs=points.map(p=>p.x),zs=points.map(p=>p.z),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;camera.position.set(cx+28,17,cz+45);controls.target.set(cx,1,cz-14);camera.lookAt(controls.target);needsRender=true;},
 viewActor(id){this.stopCamera();const p=commute.residentialTraffic.agents.find(a=>a.id===id);if(!p)throw Error('Missing branch actor '+id);camera.position.set(p.x+3.5,p.y+2.3,p.z+4.5);controls.target.set(p.x,p.y+.9,p.z);camera.lookAt(controls.target);needsRender=true;},
 far(){this.stopCamera();camera.position.set(12000,200,12000);controls.target.set(12001,200,12000);camera.lookAt(controls.target);needsRender=true;},
 freezeBranch(value){installResidentialProbe();residentialProbeFrozen=!!value;},
 preparePickup(){
  installResidentialProbe();residentialProbeFrozen=true;commute.setSuspended(false);
  const candidates=commute.residentialTraffic.agents.filter(a=>a.kind==='scooter').slice().sort((a,b)=>Math.abs(a.z-15)-Math.abs(b.z-15));
  const failures=[];
  for(const a of candidates)for(const side of [1,-1])for(const offset of [1.25,1.6,2]){
   const r=commute.player.enterAt({x:a.x+Math.cos(a.yaw)*offset*side,y:a.y-.021,z:a.z-Math.sin(a.yaw)*offset*side,yaw:a.yaw});
   if(!r?.ok){failures.push(r?.reason);continue;}
   const candidate=commute.visual.scooterTransport.nearest(commute.player.state);
   if(candidate?.record===a){needsRender=true;return {id:a.id,itemId:candidate.id,pose:{x:a.x,y:a.y,z:a.z,yaw:a.yaw}};}
  }
  throw Error('No accessible branch scooter for real F pickup: '+failures.slice(0,5).join(', '));
 },
 parked(id){return commute.visual.scooterTransport.parkedAgents.filter(a=>a.id===id).map(a=>({id:a.id,x:a.x,y:a.y,z:a.z,phase:a.phase,active:a.active}));},
 layerVisible(value){commute.setVisible(value);needsRender=true;},
 reset(){frameMetrics.reset();frameMetrics.resetSession();}
};`;
const report={passed:false,root,mobileViewport:mobile,cpuThrottle:rate,startedAt:new Date().toISOString(),errors:[],screenshots:[],scope:'Isolated local production build and temporary audience; actual scene rendering and F keyboard pickup. Mobile viewport/touch capability and optional CPU throttle use desktop Chrome, not physical phone GPU or real-device touch latency. No production host changes.'};
let app,browser,context;
await mkdir(out,{recursive:true});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
try{
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'local-residential-probe',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\n'+injection;}}]});
 app=await createLiveServer({rootDir:root,distDir:dist,dataDir,password:'isolated-residential-test-only',workEnv:{},initialState:createDefaultLiveState()});
 const address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
 const join=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离生活区通行验收',tabId:'residential-verification'}});assert.equal(join.status(),200);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const cdp=await context.newCDPSession(page);
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});
 await page.waitForFunction(()=>globalThis.__residentialQA?.ready(),null,{timeout:90000});
 await page.waitForTimeout(1200);
 report.initial=await page.evaluate(()=>__residentialQA.read());
 assert.equal(report.initial.residential.total,12);assert.equal(report.initial.residential.counts.walk,6);assert.equal(report.initial.residential.counts.scooter,6);
 assert.equal(report.initial.air.total,5,'Existing aircraft/lake NPCs must remain');
 assert.equal(new Set(report.initial.residential.agents.map(a=>a.id)).size,12);assert.ok(report.initial.residential.agents.every(a=>a.id<0));
 await page.waitForTimeout(1000);report.moving=await page.evaluate(()=>__residentialQA.read());
 report.motion=report.initial.residential.agents.map(a=>({id:a.id,kind:a.kind,metres:distance(a,report.moving.residential.agents.find(b=>b.id===a.id))}));
 assert.ok(report.motion.filter(a=>a.metres>.1).length>=8,'Most sparse branch actors should be moving; a yielding actor may wait');
 await page.evaluate(()=>__residentialQA.pause(true));report.pauseBefore=await page.evaluate(()=>__residentialQA.read());
 await page.waitForTimeout(750);report.pauseAfter=await page.evaluate(()=>__residentialQA.read());
 assert.deepEqual(report.pauseAfter.residential.agents,report.pauseBefore.residential.agents);assert.equal(report.pauseAfter.residential.elapsedSeconds,report.pauseBefore.residential.elapsedSeconds);
 await page.evaluate(()=>__residentialQA.pause(false));await page.waitForTimeout(300);report.resumed=await page.evaluate(()=>__residentialQA.read());
 assert.ok(report.resumed.residential.elapsedSeconds>report.pauseAfter.residential.elapsedSeconds);assert.ok(report.resumed.residential.elapsedSeconds-report.pauseAfter.residential.elapsedSeconds<.8);
 await page.evaluate(()=>__residentialQA.far());await page.waitForTimeout(350);report.far=await page.evaluate(()=>__residentialQA.read());assert.equal(report.far.renderedIds.length,0);
 await page.evaluate(()=>__residentialQA.viewCorridor());await page.waitForTimeout(350);report.corridor=await page.evaluate(()=>__residentialQA.read());assert.ok(report.corridor.renderedIds.length>=4,'Approach view should show the added local traffic');
 await page.screenshot({path:path.join(out,'gate-approach.png')});report.screenshots.push('gate-approach.png');
 for(const kind of ['walk','scooter']){
  const actor=report.corridor.residential.agents.find(a=>a.kind===kind);
  await page.evaluate(id=>__residentialQA.viewActor(id),actor.id);await page.waitForTimeout(300);
  const visible=await page.evaluate(()=>__residentialQA.read());assert.ok(visible.renderedIds.includes(actor.id),'Close branch actor must be drawn in existing batches');
  await page.evaluate(()=>__residentialQA.pause(true));await page.waitForTimeout(70);await page.screenshot({path:path.join(out,kind+'.png')});report.screenshots.push(kind+'.png');await page.evaluate(()=>__residentialQA.pause(false));
 }
 await page.evaluate(()=>__residentialQA.layerVisible(false));await page.waitForTimeout(100);report.hidden=await page.evaluate(()=>__residentialQA.read());assert.equal(report.hidden.renderedIds.length,0);
 await page.evaluate(()=>__residentialQA.layerVisible(true));await page.waitForTimeout(250);report.reshown=await page.evaluate(()=>__residentialQA.read());assert.ok(report.reshown.renderedIds.length>0);
 report.pickup=await page.evaluate(()=>__residentialQA.preparePickup());await page.waitForTimeout(600);await page.locator('#map-canvas').focus();await page.keyboard.press('KeyF');
 await page.waitForFunction(()=>__residentialQA.read().player.mode==='scooter',null,{timeout:10000});
 report.mounted=await page.evaluate(()=>__residentialQA.read());assert.equal(report.mounted.transport?.id,report.pickup.itemId);assert.ok(!report.mounted.residential.agents.some(a=>a.id===report.pickup.id),'Taken NPC must disappear once');
 await page.keyboard.press('KeyV');await page.keyboard.down('KeyW');await page.waitForTimeout(800);await page.keyboard.up('KeyW');await page.keyboard.down('Space');await page.waitForTimeout(800);await page.keyboard.up('Space');
 await page.waitForFunction(()=>Math.abs(__residentialQA.read().player.speed)<2.4,null,{timeout:5000});report.ride=await page.evaluate(()=>__residentialQA.read());assert.ok(distance(report.mounted.player,report.ride.player)>.2,'Mounted scooter must respond to actual movement input');
 await page.keyboard.press('KeyF');await page.waitForFunction(()=>__residentialQA.read().player.mode==='walk',null,{timeout:10000});
 report.returned=await page.evaluate(()=>__residentialQA.read());report.parked=await page.evaluate(id=>__residentialQA.parked(id),report.pickup.id);
 assert.equal(report.parked.length,1);assert.ok(!report.returned.residential.agents.some(a=>a.id===report.pickup.id),'Dismount must leave one parked scooter, not respawn its rider');assert.equal(report.returned.transport,null);
 await page.screenshot({path:path.join(out,'pickup-return.png')});report.screenshots.push('pickup-return.png');await page.evaluate(()=>__residentialQA.freezeBranch(false));
 await page.evaluate(()=>__residentialQA.viewCorridor());await page.waitForTimeout(300);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate});await page.evaluate(()=>__residentialQA.reset());await page.waitForTimeout(5000);report.frameSample=await page.evaluate(()=>__residentialQA.read());await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 assert.equal(report.frameSample.batches.length,report.initial.batches.length,'Branch actors must reuse the existing traffic batches');assert.equal(report.frameSample.air.total,5);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack??error.message;process.exitCode=1;}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
