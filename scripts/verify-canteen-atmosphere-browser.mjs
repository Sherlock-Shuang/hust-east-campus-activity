// Build an isolated production copy with a private probe. No QA globals,
// temporary audience data, or browser automation are published with the campus.
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const arg=(key,fallback)=>{const n=process.argv.indexOf(key);return n<0?fallback:process.argv[n+1];};
const root=path.resolve(arg('--root','.')),out=path.resolve(arg('--output','artifacts/canteen-atmosphere-20261031/browser'));
const mobile=arg('--profile','desktop')==='mobile',rate=Number(arg('--cpu','1'));
assert.ok(rate>=1&&rate<=8);
const work=await mkdtemp(path.join(tmpdir(),'campus-canteen-atmosphere-')),dist=path.join(work,'dist'),dataDir=path.join(work,'data');
const {build}=await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const modes=['day','sunset','night'],labels={day:'日间',sunset:'日落',night:'夜间'};

const injection=`
const qaPose=p=>({x:p.x,y:p.y,z:p.z,yaw:p.yaw});
const qaVisible=o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;};
const qaParkingKey=p=>String(p.activityId??p.id);
function qaStreetInventory(){
 const plan=campus.canteenStreetLife.plan,entries=commute.visual.scooterTransport.items,drawn=new Set();
 commute.visual.group.traverse(o=>{if(o.isInstancedMesh&&qaVisible(o))for(const id of o.userData.agentIds||[])drawn.add(id);});
 return plan.parking.map(p=>{
  const matches=entries.filter(i=>qaParkingKey(i.record)===String(p.id)),item=matches[0],record=item?.record;
  return {key:String(p.id),plan:p,present:!!item,copies:matches.length,itemId:item?.id,recordId:record?.id,mounted:item?.mounted,pose:item?qaPose(item):null,visible:!!record&&drawn.has(record.id),parkedCopies:commute.visual.scooterTransport.parkedAgents.filter(a=>qaParkingKey(a)===String(p.id)).length};
 });
}
function qaGraph(){
 const counts={objects:0,meshes:0,instanced:0,lights:0},geometries=new Set(),materials=new Set();
 scene.traverse(o=>{counts.objects++;if(o.isLight)counts.lights++;if(o.isMesh){counts.meshes++;if(o.isInstancedMesh)counts.instanced++;geometries.add(o.geometry.uuid);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m.uuid);}});
 return {...counts,geometries:geometries.size,materials:materials.size};
}
globalThis.__canteenQA={
 ready:()=>!!campus?.canteenStreetLife&&!!commute?.optoTransportPlan&&canvas.dataset.campusDetails==='ready'&&!!document.getElementById('campus-time-of-day'),
 read(){
  const saved=commute.player.captureActivityPose(),p=commute.player.state,life=campus.canteenStreetLife,select=document.getElementById('campus-time-of-day');
  return {mode:atmosphere.mode,atmosphere:atmosphere.getDiagnostics(),selected:select.value,stored:localStorage.getItem('campus-time-of-day-v1'),plan:{counts:life.plan.counts,viewpoints:life.plan.viewpoints,parking:life.plan.parking,trees:life.plan.trees?.length},street:{mode:life.group.userData.timeOfDay,counts:life.counts,dapple:(()=>{const o=life.group.getObjectByName('canteen-world-fixed-dapple');return{exists:!!o,visible:!!o&&qaVisible(o),worldFixed:o?.userData.worldFixed,worksWithoutShadows:o?.userData.worksWithoutShadows};})(),pools:(()=>{const o=life.group.getObjectByName('canteen-warm-ground-pools');return{exists:!!o,visible:!!o&&qaVisible(o)};})()},inventory:qaStreetInventory(),player:{...qaPose(p),mode:p.mode,speed:p.speed,grounded:p.grounded,active:commute.player.active,view:saved?.view},transport:saved?.transport??null,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov},graph:qaGraph(),resources:{...renderer.info.memory},render:{...renderer.info.render},frame:frameMetrics.snapshot(),session:frameMetrics.session(),quality:{...qualityBudget},residential:commute.residentialTraffic.getDiagnostics(),air:commute.npcTransport.getDiagnostics(),opto:commute.optoTransportPlan.items.map(i=>{const copies=i.mode==='scooter'?commute.visual.scooterTransport.items.filter(s=>s.record.activityId===i.id).length:(()=>{let n=0;scene.traverse(o=>{if(o.name===i.id)n++;});return n;})();return{id:i.id,mode:i.mode,copies};}),mobile:{visible:!document.getElementById('mobile-controls')?.hidden,mode:document.getElementById('mobile-controls')?.dataset.mode},suspended:commute.suspended};
 },
 view(key='canteenStreet'){
  const pose=campus.canteenStreetLife.plan.viewpoints[key];if(!pose)throw Error('Missing source-photo walking viewpoint '+key);
  commute.setSuspended(false);animation=null;const result=commute.player.enterAt({pitch:key==='canteenStreetGallery'?.08:-.06,...pose});if(!result?.ok)throw Error('Walking viewpoint is inaccessible: '+key+': '+result?.reason);needsRender=true;return {key,pose};
 },
 approach(key,attempt){
  const slot=qaStreetInventory().find(i=>i.key===key);if(!slot?.pose)throw Error('Missing canteen scooter '+key);
  const p=slot.pose,plan=slot.plan,provided=plan.boardingPose?{x:p.x+plan.boardingPose.x-plan.x,z:p.z+plan.boardingPose.z-plan.z}:null;
  const candidates=[...(provided?[provided]:[]),...[1.1,1.65,2.1].flatMap(r=>[Math.PI,0,Math.PI/2,-Math.PI/2,Math.PI/4,-Math.PI/4].map(a=>({x:p.x+Math.sin(p.yaw+a)*r,z:p.z+Math.cos(p.yaw+a)*r})))];
  const q=candidates[attempt];if(!q)return {exhausted:true};
  const at={...q,y:p.y,yaw:Math.atan2(q.x-p.x,q.z-p.z),pitch:.1};commute.setSuspended(false);animation=null;
  const result=commute.player.enterAt(at);if(!result?.ok)return{ok:false,reason:result?.reason};
  const nearest=commute.visual.scooterTransport.nearest(commute.player.state);needsRender=true;
  return{ok:nearest?.id===slot.itemId,reason:nearest?.id===slot.itemId?'':'A different parked scooter is closer',itemId:slot.itemId,at};
 },
 reset(){frameMetrics.reset();frameMetrics.resetSession();}
};`;

const report={passed:false,root,mobileViewport:mobile,cpuThrottle:rate,startedAt:new Date().toISOString(),errors:[],consoleErrors:[],shaderErrors:[],resourceErrors:[],screenshots:[],scope:'Isolated local production build and temporary audience. Same first-person street camera across actual day/sunset/night UI switches, persistence, scene-resource stability, source-photo gallery inspection, and real F/W/Space scooter pickup/return. Smooth quality and optional CPU throttling use desktop Chrome; mobile is touch/viewport emulation with keyboard vehicle input, not physical-phone GPU or real-device touch validation.'};
let app,browser,context,page;
await mkdir(out,{recursive:true});
const read=()=>page.evaluate(()=>__canteenQA.read());
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const arrayDistance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const inventory=(state,key)=>state.inventory.find(i=>i.key===key);
const assertInventory=state=>{for(const p of state.inventory){assert.ok(p.present,'Missing scooter '+p.key);assert.equal(p.copies,1,'Duplicate inventory '+p.key);assert.equal(p.parkedCopies,p.mounted?0:1,'Duplicate parked copy '+p.key);}};
const assertPreserved=state=>{assert.equal(state.residential.total,20);assert.equal(state.residential.counts.walk,14);assert.equal(state.residential.counts.scooter,6);assert.equal(state.air.total,5);assert.equal(state.opto.length,6);assert.equal(new Set(state.opto.map(i=>i.id)).size,6);assert.ok(state.opto.every(i=>i.copies===1),'All six existing opto vehicles must remain in the runtime');};
function assertPose(before,after){assert.equal(after.player.mode,before.player.mode);assert.equal(after.player.active,before.player.active);assert.equal(after.player.view,before.player.view);assert.ok(distance(before.player,after.player)<1e-5,'Time switch must preserve player position');assert.ok(Math.abs(before.player.yaw-after.player.yaw)<1e-5,'Time switch must preserve player heading');assert.ok(arrayDistance(before.camera.position,after.camera.position)<.035,'Time switch must preserve camera position');assert.ok(arrayDistance(before.camera.quaternion,after.camera.quaternion)<.003,'Time switch must preserve camera direction');assert.equal(before.camera.fov,after.camera.fov);}
async function shot(filename){await page.screenshot({path:path.join(out,filename)});report.screenshots.push(filename);}
async function switchMode(mode){const before=await read();await page.locator('#campus-time-of-day').selectOption(mode);await page.waitForFunction(mode=>__canteenQA.read().mode===mode,mode,{timeout:5000});await page.waitForTimeout(250);const after=await read();assert.equal(after.selected,mode);if(before.mode!==mode)assert.equal(after.stored,mode);assertPose(before,after);return{before,after};}
async function board(key){
 const attempts=[];
 for(let attempt=0;attempt<19;attempt++){
  const approach=await page.evaluate(({key,attempt})=>__canteenQA.approach(key,attempt),{key,attempt});if(approach.exhausted)break;if(!approach.ok){attempts.push(approach);continue;}
  await page.waitForTimeout(170);await page.locator('#map-canvas').focus();await page.keyboard.press('KeyF');await page.waitForTimeout(250);const mounted=await read();attempts.push({approach,mode:mounted.player.mode,transport:mounted.transport});
  if(mounted.player.mode==='walk')continue;
  assert.equal(mounted.player.mode,'scooter');assert.equal(mounted.transport?.id,approach.itemId,'F must claim the selected new canteen scooter');assertInventory(mounted);assert.equal(inventory(mounted,key).visible,false);return{attempts,mounted};
 }
 throw Error('No real F approach succeeded for '+key+': '+JSON.stringify(attempts));
}
async function dismount(key){
 await page.waitForFunction(()=>Math.abs(__canteenQA.read().player.speed)<2.4,null,{timeout:8000});const before=await read();await page.keyboard.press('KeyF');await page.waitForFunction(()=>__canteenQA.read().player.mode==='walk',null,{timeout:10000});await page.waitForTimeout(200);
 const returned=await read();assert.equal(returned.transport,null);assertInventory(returned);assert.ok(distance(inventory(returned,key).pose,before.player)<.12,'Park at actual dismount position');return{before,returned};
}

async function makeComparison(){
 const images=await Promise.all(modes.map(async mode=>({mode,label:labels[mode],src:'data:image/png;base64,'+(await readFile(path.join(out,mode+'.png'))).toString('base64')})));
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>食堂街景 · 时段对比</title><style>*{box-sizing:border-box}body{margin:0;background:#18221f;color:#f1efe5;font:16px system-ui,-apple-system,sans-serif}main{padding:36px}h1{margin:0 0 8px;font-size:30px;font-weight:600}p{margin:0 0 24px;color:#b5c0b8;font-size:14px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}figure{margin:0;overflow:hidden;border:1px solid #435048;border-radius:12px;background:#25302a}img{width:100%;height:auto;display:block}figcaption{padding:13px 16px;font-size:18px}footer{margin-top:20px;color:#a8b6ab;font-size:13px}</style><main><h1>食堂街景 · 三种光照</h1><p>同一街道、同一步行视角。食堂、林荫与可骑行电动车。</p><div class="grid">'+images.map(i=>'<figure><img alt="'+i.label+'食堂街景" src="'+i.src+'"><figcaption>'+i.label+'</figcaption></figure>').join('')+'</div><footer>本地生产构建验收 · '+(mobile?'手机横屏布局模拟':'桌面浏览器')+' · 流畅画质。树位、停车及光照为照片参考的游戏表达。</footer></main></html>';
 await writeFile(path.join(out,'comparison.html'),html);
 const comparisonPage=await context.newPage();await comparisonPage.setViewportSize({width:1920,height:900});await comparisonPage.setContent(html);await comparisonPage.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
 report.imageStats=await comparisonPage.evaluate(()=>[...document.images].map(img=>{
  const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,160,90);const data=ctx.getImageData(16,23,128,55).data,values=[];
  for(let n=0;n<data.length;n+=4)values.push(.2126*data[n]+.7152*data[n+1]+.0722*data[n+2]);const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const full=document.createElement('canvas');full.width=img.naturalWidth;full.height=img.naturalHeight;const fc=full.getContext('2d',{willReadFrequently:true});fc.drawImage(img,0,0);const leaves=fc.getImageData(Math.floor(full.width*.25),Math.floor(full.height*.10),Math.floor(full.width*.38),Math.floor(full.height*.28)).data;
  let bright=0;for(let n=0;n<leaves.length;n+=4)if(Math.min(leaves[n],leaves[n+1],leaves[n+2])>150&&Math.max(leaves[n],leaves[n+1],leaves[n+2])>180)bright++;
  return{label:img.alt,canopyBrightFraction:bright/(leaves.length/4),meanLuminance:mean,luminanceDeviation:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length),nonBlackFraction:values.filter(v=>v>5).length/values.length};
 }));
 await comparisonPage.locator('main').screenshot({path:path.join(out,'comparison.png')});report.screenshots.push('comparison.png');await comparisonPage.close();
}

try{
 await build({root,configFile:path.join(root,'vite.config.js'),logLevel:'warn',build:{outDir:dist,emptyOutDir:true,rollupOptions:{input:{campus:path.join(root,'index.html'),admin:path.join(root,'admin.html'),c118:path.join(root,'c118.html')}}},plugins:[{name:'local-canteen-atmosphere-probe',transform(code,id){if(id===path.join(root,'src/survey.js'))return code+'\n'+injection;}}]});
 app=await createLiveServer({rootDir:root,distDir:dist,dataDir,password:'isolated-canteen-atmosphere-only',workEnv:{},initialState:createDefaultLiveState()});const address=await app.listen(0),origin='http://127.0.0.1:'+address.port;
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});context=await browser.newContext({viewport:mobile?{width:844,height:390}:{width:1280,height:720},deviceScaleFactor:mobile?2:1,isMobile:mobile,hasTouch:mobile});
 await context.addInitScript(()=>localStorage.setItem('campus-quality-mode-v1','smooth'));
 const join=await context.request.post(origin+'/api/audience/join',{headers:{Origin:origin},data:{nickname:'隔离食堂街景验收',tabId:'canteen-atmosphere-verification'}});assert.equal(join.status(),200);
 page=await context.newPage();page.on('response',r=>{if(r.status()>=400)report.resourceErrors.push({path:new URL(r.url()).pathname,status:r.status()});});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',message=>{const text=message.text();if(message.type()==='error')report.consoleErrors.push(text);if(/THREE[.]WebGLProgram|shader.{0,40}(error|fail)|VALIDATE_STATUS.*false/i.test(text))report.shaderErrors.push(text);});const cdp=await context.newCDPSession(page);
 await page.goto(origin+'/?diagnostics=1',{timeout:90000});await page.waitForFunction(()=>globalThis.__canteenQA?.ready(),null,{timeout:90000});await page.waitForTimeout(1000);
 report.initial=await read();assert.equal(report.initial.mode,'day');assert.ok(report.initial.inventory.length>=6,'Need a visible group of individually usable parked scooters');assertInventory(report.initial);assertPreserved(report.initial);
 report.viewpoint=await page.evaluate(()=>__canteenQA.view('canteenStreet'));await page.waitForTimeout(850);report.street=await read();assert.equal(report.street.player.view,'first');assert.equal(report.street.player.mode,'walk');assert.ok(report.street.camera.position[1]-report.street.player.y>1.3&&report.street.camera.position[1]-report.street.player.y<1.9);assert.ok(report.street.inventory.some(i=>i.visible),'Street walking view must show parked scooters');if(mobile)assert.equal(report.street.mobile.visible,true);
 report.modes=[];
 for(const mode of modes){
  const switched=await switchMode(mode);await cdp.send('Emulation.setCPUThrottlingRate',{rate});await page.evaluate(()=>__canteenQA.reset());await page.waitForTimeout(3000);const sample=await read();await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
  assertPose(report.street,sample);assertPreserved(sample);assert.equal(sample.street.mode,mode);assert.equal(sample.street.dapple.exists,true);assert.equal(sample.street.dapple.worldFixed,true);assert.equal(sample.street.dapple.worksWithoutShadows,true);assert.equal(sample.street.dapple.visible,mode!=='night','Night must not retain sun-dapple marks');assert.equal(sample.street.pools.exists,true);assert.equal(sample.street.pools.visible,mode!=='day','Night and sunset must enable the local warm pools');assert.equal(sample.atmosphere.extraLights,0,'Time presets must not add runtime lights');await shot(mode+'.png');report.modes.push({mode,switched,sample});
 }
 const stableGraph=report.modes.at(-1).sample.graph;for(const m of report.modes)assert.deepEqual(m.sample.graph,stableGraph,'Each preset must reuse the existing scene');report.repeatedSwitches=[];
 for(const mode of ['day','night','sunset','day','sunset','night']){const switched=await switchMode(mode);assert.deepEqual(switched.after.graph,stableGraph,'Switches must reuse the same scene objects, materials and lights');report.repeatedSwitches.push({mode,graph:switched.after.graph,resources:switched.after.resources});}

 await makeComparison();const night=report.imageStats.find(s=>s.label.startsWith('夜间'));assert.ok(night.nonBlackFraction>.5&&night.luminanceDeviation>5,'Night screenshot must retain non-black, differentiated scene detail; inspect the saved image for visual readability');

 assert.ok(night.canopyBrightFraction<.025,'Night canopies must not contain white alpha-coverage halos when MSAA is disabled');

 // Persist the user-selected night setting through a real document reload.
 await page.reload({timeout:90000});await page.waitForFunction(()=>globalThis.__canteenQA?.ready(),null,{timeout:90000});await page.waitForTimeout(850);report.reloaded=await read();assert.equal(report.reloaded.mode,'night');assert.equal(report.reloaded.selected,'night');assert.equal(report.reloaded.stored,'night');assertInventory(report.reloaded);assertPreserved(report.reloaded);
 await page.evaluate(()=>__canteenQA.view('canteenStreet'));await page.waitForTimeout(350);await switchMode('day');
 report.gallery=await page.evaluate(()=>__canteenQA.view('canteenStreetGallery'));await page.waitForTimeout(400);report.gallerySnapshot=await read();assert.equal(report.gallerySnapshot.player.view,'first');await shot('gallery-day.png');

 const parked=report.reloaded.inventory,chosen=[parked[0],parked[Math.floor(parked.length/2)],parked.at(-1)];report.rides=[];
 for(const slot of chosen){
  const ride={key:slot.key,first:await board(slot.key)};report.rides.push(ride);await page.keyboard.press('KeyV');const before=await read();
  await page.keyboard.down('KeyW');try{await page.waitForFunction(p=>{const q=__canteenQA.read().player;return Math.hypot(q.x-p.x,q.z-p.z)>.35;},before.player,{timeout:5000});}finally{await page.keyboard.up('KeyW');}
  await page.keyboard.down('Space');try{await page.waitForFunction(()=>Math.abs(__canteenQA.read().player.speed)<.2,null,{timeout:5000});}finally{await page.keyboard.up('Space');}
  ride.afterMovement=await read();ride.returned=await dismount(slot.key);await shot('scooter-'+report.rides.length+'-returned.png');
 }
 const key=chosen[0].key;report.repeatedPickup={key,mounted:await board(key),returned:await dismount(key)};report.final=await read();assertPreserved(report.final);assertInventory(report.final);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.shaderErrors,[],'Atmosphere shaders must compile in actual Chrome WebGL');report.passed=true;
}catch(error){report.failure=error.stack??error.message;process.exitCode=1;if(page){report.failureSnapshot=await read().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}}
finally{await context?.close();await browser?.close();await app?.close();await rm(work,{recursive:true,force:true});report.finishedAt=new Date().toISOString();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:out}));}
