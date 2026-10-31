// A private temporary production build exercises the actual instanced traffic
// and keyboard pickup path. No QA globals or temporary audience data ship.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/south-canteen-crowd-20261031/browser'));
const mobile=arg('--profile','desktop')==='mobile',rate=Number(arg('--cpu','1'));
assert.ok(rate>=1&&rate<=8);
const work=await mkdtemp(path.join(tmpdir(),'campus-residential-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const injection=`
import {planYunyuanSouthPrecinct as qaSouthPrecinct} from './yunyuan-south-precinct.js';
const qaApproachPaths=new Set(['residential-road','residential-east-walk','residential-west-walk']);
let residentialProbe=null,residentialProbeFrozen=false;
function installResidentialProbe(){const layer=commute?.residentialTraffic;if(!layer||layer===residentialProbe)return;residentialProbe=layer;const tick=layer.tick;layer.tick=function(dt,...args){return tick.call(this,residentialProbeFrozen?0:dt,...args);};}
globalThis.__residentialQA={
 ready(){installResidentialProbe();return !!commute?.residentialTraffic&&canvas.dataset.campusDetails==='ready';},
 read(){
  const residential=commute.residentialTraffic.getDiagnostics(),ids=new Set(residential.agents.map(a=>a.id)),rendered=new Set(),batches=[];
  const paths=commute.residentialTraffic.plan.paths.map(({id,kind,count,region,hallId,sourceIds,bounds})=>({id,kind,count,region,hallId,sourceIds,bounds})),byPath=new Map(paths.map(p=>[p.id,p]));
  const regions={approach:residential.agents.filter(a=>qaApproachPaths.has(a.pathId)),southCanteen:residential.agents.filter(a=>byPath.get(a.pathId)?.region==='south-canteen')};
  commute.visual.group.traverse(o=>{if(o.isInstancedMesh){const branch=(o.userData.agentIds||[]).filter(id=>ids.has(id));if(commute.visual.group.visible&&o.visible)for(const id of branch)rendered.add(id);batches.push({name:o.name,component:o.userData.component,count:o.count,branchCount:branch.length,geometry:o.geometry.uuid});}});
  const p=commute.player.state;
  const saved=commute.player.captureActivityPose();
  return {residential,paths,regions,air:commute.npcTransport.getDiagnostics(),renderedIds:[...rendered],batches,frame:frameMetrics.snapshot(),session:frameMetrics.session(),quality:{...qualityBudget},resources:{...renderer.info.memory},player:{x:p.x,y:p.y,z:p.z,yaw:p.yaw,speed:p.speed,mode:p.mode,active:commute.player.active,view:saved?.view},camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z},transport:saved?.transport??null,suspended:commute.suspended};
 },
 pause(value){commute.setSuspended(value);needsRender=true;},
 stopCamera(){commute.stopFollow();animation=null;controls.enabled=true;controls.minDistance=1;controls.maxDistance=20000;},
 viewCorridor(){this.stopCamera();const points=commute.residentialTraffic.plan.paths.filter(p=>qaApproachPaths.has(p.id)).flatMap(p=>p.points),xs=points.map(p=>p.x),zs=points.map(p=>p.z),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2;camera.position.set(cx+28,17,cz+45);controls.target.set(cx,1,cz-14);camera.lookAt(controls.target);needsRender=true;},
 viewCanteen(hallId){
  commute.setSuspended(false);animation=null;
  const south=qaSouthPrecinct(model,{frame,geoToLocal}),key=hallId==='xueyi'?'southCanteen':'southCanteenNorth',pose=south.viewpoints[key],stair=south.stairs.find(s=>s.id===(hallId==='xueyi'?'way/110398904':'way/110398907'));
  if(!south.accepted||!pose||!stair)throw Error('Missing source-backed canteen entrance '+hallId);
  const paths=commute.residentialTraffic.plan.paths.filter(p=>p.region==='south-canteen'&&p.hallId===hallId),points=paths.flatMap(p=>p.points);if(!points.length)throw Error('No entrance crowd path for '+hallId);
  const target={x:points.reduce((n,p)=>n+p.x,0)/points.length,z:points.reduce((n,p)=>n+p.z,0)/points.length};
  const failures=[];for(const dz of [0,1.5,-1.5,3,-3]){const at={...pose,z:pose.z+dz,pitch:-.08};at.yaw=Math.atan2(at.x-target.x,at.z-target.z);const result=commute.player.enterAt(at);if(result?.ok){needsRender=true;return {hallId,sourceId:south.sourceId,viewpoint:at,target,entranceFoot:{...stair.a},upperEntrance:{...stair.b},sourceStairId:stair.id};}failures.push(result?.reason);}
  throw Error('No walking approach to '+hallId+': '+failures.join(', '));
 },
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
const report={passed:false,root,mobileViewport:mobile,cpuThrottle:rate,startedAt:new Date().toISOString(),errors:[],screenshots:[],scope:'Isolated local production build and temporary audience; original gate-approach traffic, southern canteen walkers from actual first-person walking height, and F keyboard pickup. Mobile viewport/touch capability and optional CPU throttle use desktop Chrome, not physical phone GPU or real-device touch latency. No production host changes.'};
let app,browser,context,page;
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
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const cdp=await context.newCDPSession(page);
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});
 await page.waitForFunction(()=>globalThis.__residentialQA?.ready(),null,{timeout:90000});
 await page.waitForTimeout(1200);
 report.initial=await page.evaluate(()=>__residentialQA.read());
 const approach=report.initial.regions.approach,south=report.initial.regions.southCanteen;
 assert.equal(approach.length,12,'Keep the original residential approach population');assert.equal(approach.filter(a=>a.kind==='walk').length,6);assert.equal(approach.filter(a=>a.kind==='scooter').length,6);
 assert.deepEqual(approach.map(a=>a.id).sort((a,b)=>b-a),Array.from({length:12},(_,i)=>-100001-i),'Original route actor identities must remain stable');
 assert.ok(south.length>=6&&south.length<=10,'Add a modest separate group at the southern canteens');assert.ok(south.every(a=>a.kind==='walk'));
 assert.equal(report.initial.residential.total,approach.length+south.length);assert.equal(report.initial.residential.counts.walk,6+south.length);assert.equal(report.initial.residential.counts.scooter,6);
 const southPaths=report.initial.paths.filter(p=>p.region==='south-canteen');
 for(const hallId of ['xueyi','xueer'])assert.ok(southPaths.some(p=>p.hallId===hallId&&p.sourceIds.includes('way/103757021')),'Missing source-backed '+hallId+' path');
 assert.equal(report.initial.air.total,5,'Existing aircraft/lake NPCs must remain');
 assert.equal(new Set(report.initial.residential.agents.map(a=>a.id)).size,report.initial.residential.total);assert.ok(report.initial.residential.agents.every(a=>a.id<0));
 await page.waitForTimeout(1000);report.moving=await page.evaluate(()=>__residentialQA.read());
 report.motion=report.initial.residential.agents.map(a=>({id:a.id,kind:a.kind,pathId:a.pathId,metres:distance(a,report.moving.residential.agents.find(b=>b.id===a.id))}));
 const approachIds=new Set(approach.map(a=>a.id));assert.ok(report.motion.filter(a=>approachIds.has(a.id)&&a.metres>.1).length>=8,'Most original approach actors should move; a yielding actor may wait');
 for(const hallId of ['xueyi','xueer']){const pathIds=new Set(southPaths.filter(p=>p.hallId===hallId).map(p=>p.id));assert.ok(report.motion.some(a=>pathIds.has(a.pathId)&&a.metres>.1),'New '+hallId+' walkers must really move');}
 await page.evaluate(()=>__residentialQA.pause(true));report.pauseBefore=await page.evaluate(()=>__residentialQA.read());
 await page.waitForTimeout(750);report.pauseAfter=await page.evaluate(()=>__residentialQA.read());
 assert.deepEqual(report.pauseAfter.residential.agents,report.pauseBefore.residential.agents);assert.equal(report.pauseAfter.residential.elapsedSeconds,report.pauseBefore.residential.elapsedSeconds);
 await page.evaluate(()=>__residentialQA.pause(false));await page.waitForTimeout(300);report.resumed=await page.evaluate(()=>__residentialQA.read());
 assert.ok(report.resumed.residential.elapsedSeconds>report.pauseAfter.residential.elapsedSeconds);assert.ok(report.resumed.residential.elapsedSeconds-report.pauseAfter.residential.elapsedSeconds<.8);
 await page.evaluate(()=>__residentialQA.far());await page.waitForTimeout(350);report.far=await page.evaluate(()=>__residentialQA.read());assert.equal(report.far.renderedIds.length,0);
 await page.evaluate(()=>__residentialQA.viewCorridor());await page.waitForTimeout(350);report.corridor=await page.evaluate(()=>__residentialQA.read());assert.ok(report.corridor.renderedIds.filter(id=>approachIds.has(id)).length>=4,'Original approach view must still show its own traffic');
 await page.screenshot({path:path.join(out,'gate-approach.png')});report.screenshots.push('gate-approach.png');
 for(const kind of ['walk','scooter']){
  const actor=report.corridor.regions.approach.find(a=>a.kind===kind);
  await page.evaluate(id=>__residentialQA.viewActor(id),actor.id);await page.waitForTimeout(300);
  const visible=await page.evaluate(()=>__residentialQA.read());assert.ok(visible.renderedIds.includes(actor.id),'Close branch actor must be drawn in existing batches');
  await page.evaluate(()=>__residentialQA.pause(true));await page.waitForTimeout(70);await page.screenshot({path:path.join(out,kind+'.png')});report.screenshots.push(kind+'.png');await page.evaluate(()=>__residentialQA.pause(false));
 }
 report.canteens=[];
 for(const hallId of ['xueyi','xueer']){
  const entrance=await page.evaluate(hall=>__residentialQA.viewCanteen(hall),hallId);await page.waitForTimeout(700);
  const before=await page.evaluate(()=>__residentialQA.read()),pathIds=new Set(southPaths.filter(p=>p.hallId===hallId).map(p=>p.id)),actors=before.regions.southCanteen.filter(a=>pathIds.has(a.pathId)),ids=new Set(actors.map(a=>a.id));
  assert.ok(actors.length>=2,'Each canteen entrance needs its own walkers');assert.ok(actors.every(a=>Math.hypot(a.x-entrance.entranceFoot.x,a.z-entrance.entranceFoot.z)<25),'Walkers must be by the mapped canteen stair entrance, not the original road');
  assert.equal(before.player.mode,'walk');assert.equal(before.player.active,true);assert.equal(before.player.view,'first');assert.ok(before.camera.y-before.player.y>1.3&&before.camera.y-before.player.y<1.9,'Use normal walking eye height');
  const visible=before.renderedIds.filter(id=>ids.has(id));assert.ok(visible.length>0,'At least one '+hallId+' walker must be visible from its normal walking approach');
  const filename='canteen-'+hallId+'-walking.png';await page.screenshot({path:path.join(out,filename)});report.screenshots.push(filename);
  await page.waitForTimeout(800);const moving=await page.evaluate(()=>__residentialQA.read());assert.ok(actors.some(a=>distance(a,moving.residential.agents.find(b=>b.id===a.id))>.1),'Visible entrance crowd must not be a static prop');
  await page.evaluate(()=>__residentialQA.pause(true));const pausedBefore=await page.evaluate(()=>__residentialQA.read());await page.waitForTimeout(500);const pausedAfter=await page.evaluate(()=>__residentialQA.read());
  assert.deepEqual(pausedAfter.regions.southCanteen,pausedBefore.regions.southCanteen,'Host pause must include the southern entrance walkers');
  await page.evaluate(()=>__residentialQA.pause(false));await page.waitForTimeout(300);const resumed=await page.evaluate(()=>__residentialQA.read());assert.ok(resumed.residential.elapsedSeconds>pausedAfter.residential.elapsedSeconds);assert.ok(resumed.residential.elapsedSeconds-pausedAfter.residential.elapsedSeconds<.8);
  report.canteens.push({hallId,entrance,visibleIds:visible,before,moving,pausedBefore,pausedAfter,resumed});
 }
 await page.evaluate(()=>__residentialQA.far());await page.waitForTimeout(350);report.southFar=await page.evaluate(()=>__residentialQA.read());assert.equal(report.southFar.renderedIds.length,0,'Southern entrance walkers must also cull at distance');
 await page.evaluate(()=>__residentialQA.viewCorridor());await page.waitForTimeout(300);
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
}catch(error){report.failure=error.stack??error.message;process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
