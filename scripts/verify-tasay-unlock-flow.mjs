// Real story + campus admission/paused/return behavior, using an isolated local server.
// CAMPUS_ROOT points at the built release; no production writes or chat data are used.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm, realpath} from 'node:fs/promises';
import path from 'node:path';
import {homedir, tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
const project=fileURLToPath(new URL('..',import.meta.url));
const root=await realpath(process.env.CAMPUS_ROOT||project);
const out=path.join(project,'artifacts/tasay-unlock-2026-10-29/flow');
const {createLiveServer}=await import(pathToFileURL(path.join(root,'server/index.mjs')));
const {createDefaultLiveState}=await import(pathToFileURL(path.join(root,'src/live-state.js')));
const {ACTIVITY_WORKS,activityPortals}=await import(pathToFileURL(path.join(root,'src/activity-catalog.js')));
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const checks=[],errors=[],external=[],modelRequests=[];
const check=(name,passed,detail)=>{checks.push({name,passed:!!passed,detail});console.log(`${passed?'PASS':'FAIL'} ${name}`);assert.ok(passed,name+JSON.stringify(detail||''));};
const projectName='她不一样 · 恋情分析室';
const sessionKey='ta-say:original-story:session';
const password=randomBytes(20).toString('hex');
const dataDir=await mkdtemp(path.join(tmpdir(),'tasay-unlock-flow-'));
await mkdir(out,{recursive:true});
let app,browser,page,passed=false,failure;
try {
  const initialState={...createDefaultLiveState(),portals:activityPortals().map(p=>({...p,enabled:p.workId==='tasay'}))};
  app=await createLiveServer({rootDir:root,dataDir,password,initialState,works:ACTIVITY_WORKS,workEnv:{}});
  const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:850}});
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==origin&&['http:','https:'].includes(u.protocol)){
      external.push(u.href);
      if(u.href==='https://github.com/863401402/she-love-me')return route.fulfill({contentType:'text/html',body:'<title>Verified project destination</title>'});
      return route.abort();
    }
    if(u.pathname.startsWith('/api/works/')){modelRequests.push(u.href);return route.abort();}
    return route.continue();
  });
  page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  // Register only on the isolated server and restore the actual player beside its existing portal.
  await page.goto(origin);
  await page.getByLabel('你的昵称').fill('通关入口本地验收');
  await page.locator('.audience-welcome button').click();
  await page.waitForFunction(()=>document.querySelector('.audience-welcome')?.hidden===true);
  const identity=await page.evaluate(()=>fetch('/api/audience/me').then(r=>r.json()));
  const point=initialState.portals.find(p=>p.workId==='tasay');
  await page.evaluate(({audienceId,p})=>sessionStorage.setItem('campus-return-pose',JSON.stringify({audienceId,pose:{mode:'walk',view:'third',pitch:.2,manualPitch:false,state:{x:p.x,y:.1,z:p.z,yaw:0,vx:0,vz:0,speed:0,verticalSpeed:0,grounded:true,flightEnabled:false}}})),{audienceId:identity.audience.id,p:point});
  await page.reload();
  await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.locator('.live-portal-prompt').waitFor({state:'visible',timeout:45000});
  check('Existing map still contains exactly the original three works',ACTIVITY_WORKS.length===3&&initialState.portals.length===3);
  await page.locator('.live-portal-prompt').click();
  const iframe=page.locator('.live-portal-frame iframe');
  await iframe.waitFor();let frame=await iframe.elementHandle().then(h=>h.contentFrame());
  await frame.locator('.desktop-chat-input').waitFor();
  check('Tasay iframe permits deliberate external project links',(await iframe.getAttribute('sandbox')).includes('allow-popups-to-escape-sandbox'));
  check('Fresh story has no unlocked project entry',await frame.getByRole('button',{name:projectName,exact:true}).count()===0);
  await frame.goto(origin+'/works/tasay/truth');
  await frame.locator('.desktop-chat-input').waitFor();
  check('A direct truth URL cannot skip the story',new URL(frame.url()).pathname.endsWith('/chat')&&await frame.getByRole('button',{name:projectName,exact:true}).count()===0);
  const readSession=()=>frame.evaluate(key=>JSON.parse(localStorage.getItem(key)),sessionKey);
  let sends=0;
  // Drive the actual story UI; no completion/session fields are seeded.
  while(sends<22){
    const s=await readSession();
    if(['location_reveal','meta_break','truth_reveal','wake_up'].includes(s.stage))break;
    await frame.locator('.desktop-chat-input').fill(`今天在校园散步，第${sends+1}次和你说话。`);
    await frame.locator('.desktop-send-button').click();
    sends++;
    await frame.waitForFunction(key=>{
      const s=JSON.parse(localStorage.getItem(key));
      return ['location_reveal','meta_break','truth_reveal'].includes(s?.stage)||!document.querySelector('.desktop-chat-status')?.textContent?.includes('输入')&&!document.querySelector('.desktop-chat-title')?.textContent?.includes('正在输入')&&!!document.querySelector('.desktop-chat-input');
    },sessionKey,{timeout:25000});
    // The disabled story exit action tracks the real reply queue on desktop too.
    if((await readSession()).stage!=='location_reveal')await frame.locator('.windows-close-button').waitFor({state:'visible'});
    for(let i=0;i<25;i++){
      const s=await readSession();
      if(['location_reveal','meta_break','truth_reveal'].includes(s.stage)||!await frame.locator('.windows-close-button').isDisabled())break;
      await page.waitForTimeout(500);
    }
    console.log(`Story interaction ${sends}: ${(await readSession()).stage}`);
  }
  let s=await readSession();
  check('Actual story reaches the location beat through messages',s.stage==='location_reveal',{stage:s.stage,sends});
  const locationLink=frame.getByRole('button',{name:'打开定位',exact:true});
  await locationLink.click();
  await frame.getByRole('button',{name:'退出查看',exact:true}).click();
  await frame.getByRole('button',{name:'梦醒',exact:true}).waitFor({timeout:45000});
  check('Truth reveal alone does not mark completion',(await readSession()).hasFinishedGame===false);
  await frame.getByRole('button',{name:'梦醒',exact:true}).click();
  await frame.locator('.game-ending').waitFor();
  check('Dream wake-up unlocks the real post-completion entry',(await readSession()).hasFinishedGame===true&&await frame.locator('.game-ending').getByRole('button',{name:projectName,exact:true}).isVisible());
  await frame.locator('.game-ending').getByRole('button',{name:projectName,exact:true}).click();
  await frame.locator('dialog[open]').waitFor();
  await page.screenshot({path:path.join(out,'completed-project-in-campus.png')});
  const popupPromise=context.waitForEvent('page');
  await frame.getByRole('link',{name:'查看开源项目 ↗',exact:true}).click();
  const popup=await popupPromise;await popup.waitForLoadState();
  check('Project opens the correct repository from the actual sandbox',popup.url()==='https://github.com/863401402/she-love-me');await popup.close();
  // Pause and admission changes are exercised through the isolated authenticated admin API.
  const login=await context.request.post(origin+'/api/admin/login',{headers:{Origin:origin},data:{password}});
  const {csrfToken}=await login.json();
  const change=async patch=>{
    const prior=app.getState();
    const response=await context.request.put(origin+'/api/admin/state',{headers:{Origin:origin,'x-csrf-token':csrfToken},data:{expectedRevision:prior.revision,state:{...prior,...patch}}});
    assert.equal(response.status(),200,await response.text());
  };
  await change({paused:true});await page.locator('.live-pause').waitFor({state:'visible'});
  check('Host pause also freezes the unlocked experience',await page.locator('.live-portal-view').evaluate(el=>el.inert)&&await frame.locator('html').getAttribute('data-campus-paused')==='true');
  await change({paused:false});await page.locator('.live-pause').waitFor({state:'hidden'});
  await frame.getByRole('button',{name:'返回聊天',exact:true}).click();
  await frame.getByRole('button',{name:'重新开始这段故事',exact:true}).click();
  await frame.locator('.desktop-chat-input').waitFor();
  check('Replay retains the entry without forcing the ending',(await readSession()).hasFinishedGame===true&&(await readSession()).stage!=='wake_up'&&await frame.getByRole('button',{name:projectName,exact:true}).count()>0);
  await frame.goto(frame.url());await frame.locator('.desktop-chat-input').waitFor();
  check('Refresh retains the unlocked menu entry',await frame.getByRole('button',{name:projectName,exact:true}).count()>0);
  await page.getByRole('button',{name:'返回校园',exact:true}).click();
  await page.locator('.live-portal-view').waitFor({state:'hidden'});
  await page.locator('.live-portal-prompt').click();
  frame=await page.locator('.live-portal-frame iframe').elementHandle().then(h=>h.contentFrame());
  await frame.locator('.desktop-chat-input').waitFor();
  check('Returning to the same campus point retains completion',await frame.getByRole('button',{name:projectName,exact:true}).count()>0);
  await change({portals:app.getState().portals.map(p=>p.workId==='tasay'?{...p,enabled:false}:p)});
  await page.getByRole('button',{name:'返回校园',exact:true}).click();
  await page.locator('.live-portal-prompt').waitFor({state:'hidden'});
  check('Closing the existing tasay portal closes admission to both',app.getState().portals.length===3&&!app.getState().portals.find(p=>p.workId==='tasay').enabled&&await page.locator('.live-portal-frame iframe').count()===0);
  check('No model service was needed or called',modelRequests.length===0,modelRequests);
  check('No browser runtime errors',errors.length===0,errors);
  passed=true;
}catch(error){failure=error.stack||String(error);console.error(failure);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});await writeFile(path.join(out,'report.json'),JSON.stringify({passed,checks,errors,external,modelRequests,failure,scope:'Real UI story actions in actual campus iframe; isolated local server/data; no production writes.'},null,2));}
