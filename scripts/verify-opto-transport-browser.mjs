// Temporary production-build probe only. All boarding, driving, flight and
// dismount actions use real keyboard events; no activity data or QA global ships.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/opto-road-transport-20261031/browser'));
const mobile=arg('--profile','desktop')==='mobile',rate=Number(arg('--cpu','1'));
assert.ok(rate>=1&&rate<=8);
const work=await mkdtemp(path.join(tmpdir(),'campus-opto-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const expected=[
 ['opto-scooter-south-canteen','scooter'],['opto-hoverboard-qiming-south','hoverboard'],
 ['opto-roadster-huxi-turn','roadster'],['opto-scooter-huxi-north','scooter'],
 ['opto-hoverboard-building-north','hoverboard'],['opto-scooter-building-west','scooter'],
];

const injection=`
const qaPose=p=>({x:p.x,y:p.y,z:p.z,yaw:p.yaw});
const qaVisible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
function qaOptoItems(){
 const scooters=commute.visual.scooterTransport.items,drawn=new Set();
 commute.visual.group.traverse(o=>{if(o.isInstancedMesh&&qaVisible(o))for(const id of o.userData.agentIds||[])drawn.add(id);});
 return commute.optoTransportPlan.items.map(plan=>{
  const copies=[];scene.traverse(o=>{if(o.name===plan.id)copies.push(o);});
  if(plan.mode==='scooter'){
   const entries=scooters.filter(i=>i.record.activityId===plan.id),item=entries[0],record=item?.record;
   return {id:plan.id,mode:plan.mode,present:!!item,copies:entries.length,itemId:item?.id,recordId:record?.id,mounted:item?.mounted,pose:item?qaPose(item):null,visible:!!record&&drawn.has(record.id),parkedCopies:commute.visual.scooterTransport.parkedAgents.filter(a=>a.activityId===plan.id).length,geometryIds:[]};
  }
  const object=copies[0],geometries=new Set();object?.traverse(o=>{if(o.isMesh)geometries.add(o.geometry.uuid);});
  return {id:plan.id,mode:plan.mode,present:!!object,copies:copies.length,itemId:plan.id,pose:object?{x:object.position.x,y:object.position.y,z:object.position.z,yaw:object.rotation.y}:null,visible:!!object&&qaVisible(object),geometryIds:[...geometries].sort()};
 });
}
function qaOptoPlace(pose){commute.setSuspended(false);animation=null;const r=commute.player.enterAt(pose);if(r?.ok)needsRender=true;return r;}
globalThis.__optoQA={
 ready:()=>!!commute?.optoTransportPlan&&canvas.dataset.campusDetails==='ready',
 read(){const pose=commute.player.captureActivityPose(),p=commute.player.state;return {plan:commute.optoTransportPlan,items:qaOptoItems(),player:{...qaPose(p),mode:p.mode,speed:p.speed,verticalSpeed:p.verticalSpeed,grounded:p.grounded,active:commute.player.active,view:pose?.view,blockedReason:p.blockedReason},transport:pose?.transport??null,camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z},residential:commute.residentialTraffic.getDiagnostics(),air:commute.npcTransport.getDiagnostics(),frame:frameMetrics.snapshot(),session:frameMetrics.session(),quality:{...qualityBudget},resources:{...renderer.info.memory},mobile:{visible:!document.getElementById('mobile-controls')?.hidden,mode:document.getElementById('mobile-controls')?.dataset.mode},hint:document.getElementById('transport-interact-label')?.textContent,suspended:commute.suspended};},
 view(id){
  const p=commute.optoTransportPlan.items.find(p=>p.id===id),item=qaOptoItems().find(p=>p.id===id);if(!p||!item?.pose)throw Error('Missing opto item '+id);
  const target=item.pose,origin=p.approachPose||p.roadPose||target,failures=[];
  for(const offset of [6,-6,4,-4,8,-8,2,-2,0]){
   const x=origin.x+Math.sin(p.yaw)*offset,z=origin.z+Math.cos(p.yaw)*offset,d=Math.hypot(x-target.x,z-target.z);
   const at={x,y:origin.y??.14,z,yaw:Math.atan2(x-target.x,z-target.z),pitch:Math.atan2(.9,Math.max(1,d))},result=qaOptoPlace(at);
   if(result?.ok)return {id,sourceId:p.sourceId,at,target,approachPose:p.approachPose,roadPose:p.roadPose};failures.push(result?.reason);
  }
  throw Error('No real walking view at '+id+': '+failures.join(', '));
 },
 projected(id){const p=qaOptoItems().find(i=>i.id===id)?.pose;if(!p)return null;const v=new THREE.Vector3(p.x,p.y+.65,p.z).project(camera);return{x:v.x,y:v.y,z:v.z};},
 approach(id,attempt){
  const plan=commute.optoTransportPlan.items.find(p=>p.id===id),item=qaOptoItems().find(p=>p.id===id);if(!plan||!item?.pose)throw Error('Missing pickup '+id);
  const p=item.pose,r=plan.mode==='roadster'?2.3:plan.mode==='hoverboard'?2.3:1.65;
  // First try the planner's verified boarding point. On a later pickup the
  // parked vehicle has moved, so translate that same relative approach.
  const supplied=plan.boardingPose?{x:p.x+plan.boardingPose.x-plan.x,z:p.z+plan.boardingPose.z-plan.z}:null;
  const positions=[...(supplied?[supplied]:[]),...[Math.PI/2,-Math.PI/2,Math.PI,0,Math.PI/4,-Math.PI/4,Math.PI*.75,-Math.PI*.75].map(a=>({x:p.x+Math.sin(p.yaw+a)*r,z:p.z+Math.cos(p.yaw+a)*r}))];
  const q=positions[attempt];if(!q)return {exhausted:true};
  const at={...q,y:p.y,yaw:Math.atan2(q.x-p.x,q.z-p.z),pitch:.12},result=qaOptoPlace(at);
  return {ok:result?.ok===true,reason:result?.reason,attempt,itemId:item.itemId,at,target:p};
 },
 far(){
  const items=qaOptoItems(),candidates=commute.route.points.map(p=>({...p,separation:Math.min(...items.map(i=>Math.hypot(p.x-i.pose.x,p.z-i.pose.z)))})).filter(p=>p.separation>260).sort((a,b)=>b.separation-a.separation),failures=[];
  for(const p of candidates){const at={x:p.x,y:.14,z:p.z,yaw:0,pitch:0},result=qaOptoPlace(at);if(result?.ok)return {at,separation:p.separation};failures.push(result?.reason);}
  throw Error('No legal distant walking point for culling: '+failures.slice(0,5).join(', '));
 },
 pause(value){commute.setSuspended(value);needsRender=true;},
 reset(){frameMetrics.reset();frameMetrics.resetSession();}
};`;

const report={passed:false,root,mobileViewport:mobile,cpuThrottle:rate,startedAt:new Date().toISOString(),errors:[],screenshots:[],scope:'Isolated local production build with temporary audience. Six opto-road placements, first-person walking screenshots, real F/W/Space vehicle controls and Q/E hoverboard flight, repeated pickup/return, distance culling and existing NPC preservation. Mobile is desktop Chrome touch/viewport emulation with keyboard driving; no physical-phone, public-network or multi-player claim.'};
let app,browser,context,page;
await mkdir(out,{recursive:true});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const read=()=>page.evaluate(()=>__optoQA.read());
const item=(state,id)=>state.items.find(i=>i.id===id);
const assertSingle=(state,id)=>{const p=item(state,id);assert.ok(p?.present,'Missing '+id);assert.equal(p.copies,1,'Duplicate inventory/object '+id);if(p.mode==='scooter')assert.equal(p.parkedCopies,p.mounted?0:1,'Duplicate parked scooter '+id);};
async function shot(filename){await page.screenshot({path:path.join(out,filename)});report.screenshots.push(filename);}
async function pressFor(key,ms){await page.keyboard.down(key);try{await page.waitForTimeout(ms);}finally{await page.keyboard.up(key);}}
async function board(id,mode){
 const attempts=[];
 for(let n=0;n<9;n++){
  const approach=await page.evaluate(({id,n})=>__optoQA.approach(id,n),{id,n});if(approach.exhausted)break;
  if(!approach.ok){attempts.push(approach);continue;}
  await page.waitForTimeout(170);await page.locator('#map-canvas').focus();await page.keyboard.press('KeyF');await page.waitForTimeout(220);
  const mounted=await read();attempts.push({approach,mode:mounted.player.mode,transport:mounted.transport,blockedReason:mounted.player.blockedReason,hint:mounted.hint});
  if(mounted.player.mode==='walk')continue;
  assert.equal(mounted.player.mode,mode,'F boarded the wrong vehicle mode');assert.equal(mounted.transport?.id,approach.itemId,'F boarded a neighboring object');
  assertSingle(mounted,id);assert.equal(item(mounted,id).visible,false,'The parked copy must hide when mounted');
  return {attempts,mounted};
 }
 throw Error('All real F approaches failed for '+id+': '+JSON.stringify(attempts));
}
async function dismount(id){
 await page.waitForFunction(()=>{const p=__optoQA.read().player;return p.grounded&&Math.abs(p.speed)<2.4;},null,{timeout:10000});
 const before=await read();await page.keyboard.press('KeyF');await page.waitForFunction(()=>__optoQA.read().player.mode==='walk',null,{timeout:10000});await page.waitForTimeout(200);
 const returned=await read();assert.equal(returned.transport,null);assertSingle(returned,id);assert.ok(distance(item(returned,id).pose,before.player)<.12,'Returned vehicle must park at actual dismount position');
 return {before,returned};
}

try{
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'local-opto-transport-probe',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\n'+injection;}}]});
 app=await createLiveServer({rootDir:root,distDir:dist,dataDir,password:'isolated-opto-test-only',workEnv:{},initialState:createDefaultLiveState()});
 const address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
 const join=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离光电沿路载具验收',tabId:'opto-transport-verification'}});assert.equal(join.status(),200);
 page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));const cdp=await context.newCDPSession(page);
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});await page.waitForFunction(()=>globalThis.__optoQA?.ready(),null,{timeout:90000});await page.waitForTimeout(1000);
 report.initial=await read();assert.deepEqual(report.initial.plan.rejected,[]);assert.deepEqual(report.initial.plan.items.map(i=>[i.id,i.mode]),expected);
 assert.deepEqual(report.initial.plan.counts,{scooter:3,roadster:1,hoverboard:2});
 for(const [id]of expected){assertSingle(report.initial,id);const placed=report.initial.plan.items.find(i=>i.id===id);assert.ok(distance(item(report.initial,id).pose,placed)<.03,'Runtime placement must match verified plan');assert.ok(placed.sourceId&&placed.boardingPose&&placed.approachPose&&placed.roadPose);}
 assert.equal(report.initial.residential.total,20,'Preserve original approach and southern canteen population');assert.equal(report.initial.residential.counts.walk,14);assert.equal(report.initial.residential.counts.scooter,6);assert.equal(report.initial.air.total,5);
 await page.waitForTimeout(800);report.npcMoving=await read();assert.ok(report.npcMoving.residential.elapsedSeconds>report.initial.residential.elapsedSeconds);assert.ok(report.npcMoving.air.elapsedSeconds>report.initial.air.elapsedSeconds);

 report.views=[];
 for(const [id]of expected){
  const viewpoint=await page.evaluate(id=>__optoQA.view(id),id);await page.waitForTimeout(350);const visible=await read(),projection=await page.evaluate(id=>__optoQA.projected(id),id);
  assert.equal(visible.player.mode,'walk');assert.equal(visible.player.view,'first');assert.equal(visible.player.active,true);assert.ok(visible.camera.y-visible.player.y>1.3&&visible.camera.y-visible.player.y<1.9,'Use normal walking eye height');
  assert.equal(item(visible,id).visible,true,'Nearby parked transport must be drawn');assert.ok(projection&&Math.abs(projection.x)<.95&&Math.abs(projection.y)<.95&&projection.z>-1&&projection.z<1,'Vehicle must be in the walking camera viewport');
  if(mobile)assert.equal(visible.mobile.visible,true,'Mobile control layout must remain available');
  const filename=id+'-walking.png';await shot(filename);report.views.push({id,viewpoint,projection,snapshot:visible});
 }
 report.farPose=await page.evaluate(()=>__optoQA.far());await page.waitForTimeout(400);report.far=await read();assert.ok(report.far.items.every(i=>!i.visible),'Both instanced scooters and world vehicle props must cull at distance');

 await page.evaluate(id=>__optoQA.view(id),'opto-roadster-huxi-turn');await page.waitForTimeout(200);
 await page.evaluate(()=>__optoQA.pause(true));report.pausedBefore=await read();await page.waitForTimeout(500);report.pausedAfter=await read();
 assert.deepEqual(report.pausedAfter.player,report.pausedBefore.player);assert.deepEqual(report.pausedAfter.residential.agents,report.pausedBefore.residential.agents);assert.deepEqual(report.pausedAfter.air.poses,report.pausedBefore.air.poses);
 await page.evaluate(()=>__optoQA.pause(false));await page.waitForTimeout(250);report.resumed=await read();assert.ok(report.resumed.residential.elapsedSeconds>report.pausedAfter.residential.elapsedSeconds);

 report.rides=[];
 for(const mode of ['scooter','roadster','hoverboard']){
  const id=expected.find(i=>i[1]===mode)[0],first=await board(id,mode),ride={id,mode,first};report.rides.push(ride);
  await page.keyboard.press('KeyV');
  if(mode==='hoverboard'){
   // Wait for the simulated flight state, not a short wall-clock tap: rotor
   // startup and a low render rate can consume most of a 750 ms key hold.
   await page.keyboard.down('KeyQ');
   try{await page.waitForFunction(y=>{const p=__optoQA.read().player;return !p.grounded&&p.y>y+.35;},first.mounted.player.y,{timeout:8000});}
   finally{await page.keyboard.up('KeyQ');}
   ride.airborne=await read();assert.equal(ride.airborne.player.grounded,false);assert.ok(ride.airborne.player.y-first.mounted.player.y>.35,'Q must actually lift the board');
  }
  ride.beforeMovement=await read();await pressFor('KeyW',650);await pressFor('Space',800);ride.afterMovement=await read();
  assert.ok(Math.hypot(ride.afterMovement.player.x-ride.beforeMovement.player.x,ride.afterMovement.player.z-ride.beforeMovement.player.z)>.2,'Actual W movement failed for '+mode);
  if(mode==='hoverboard'){
   await page.keyboard.down('KeyE');try{await page.waitForFunction(()=>__optoQA.read().player.grounded,null,{timeout:10000});}finally{await page.keyboard.up('KeyE');}
   await pressFor('Space',350);
  }
  ride.firstReturn=await dismount(id);await shot(mode+'-returned.png');
  // Reclaim the same object at its new position, then return it a second time.
  // This catches duplicate original props, stale inventory and cloned parking.
  ride.second=await board(id,mode);ride.secondReturn=await dismount(id);
  assert.equal(item(ride.secondReturn.returned,id).itemId,item(first.mounted,id).itemId,'Repeated use must preserve the inventory ID');
  for(const [other]of expected)assertSingle(ride.secondReturn.returned,other);
 }

 await page.evaluate(id=>__optoQA.view(id),'opto-scooter-building-west');await page.waitForTimeout(300);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate});await page.evaluate(()=>__optoQA.reset());await page.waitForTimeout(5000);report.frameSample=await read();await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 for(const [id]of expected){assertSingle(report.frameSample,id);assert.deepEqual(item(report.frameSample,id).geometryIds,item(report.initial,id).geometryIds,'Returning transport must reuse its geometry');}
 assert.equal(report.frameSample.residential.total,20);assert.equal(report.frameSample.residential.counts.scooter,6,'Placed scooters must not consume residential riders');assert.equal(report.frameSample.air.total,5);assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.failure=error.stack??error.message;process.exitCode=1;if(page){report.failureSnapshot=await read().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
