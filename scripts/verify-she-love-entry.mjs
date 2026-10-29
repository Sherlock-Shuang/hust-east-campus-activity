// Exercise the real built campus with an old three-point configuration and fresh visitors.
// All audience/admin writes use a temporary local server; external/API model requests are blocked.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';
import {activityPortals,ACTIVITY_WORKS} from '../src/activity-catalog.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=process.env.QA_OUTPUT_DIR||path.join(root,'artifacts/she-love-einstein-2026-10-30');
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const dataDir=await mkdtemp(path.join(tmpdir(),'einstein-project-qa-'));
const password=randomBytes(18).toString('hex'),checks=[],errors=[],outside=[],apiCalls=[];
let app,browser,page,passed=false,failure;
await mkdir(out,{recursive:true});
const check=(name,value,detail)=>{checks.push({name,passed:!!value,detail});console.log(`${value?'PASS':'FAIL'} ${name}`);assert.ok(value,name+JSON.stringify(detail||''));};
try{
  const oldPortals=activityPortals().filter(p=>p.workId!=='she-love-me').map(p=>({...p,enabled:p.workId==='tasay'}));
  app=await createLiveServer({rootDir:root,dataDir,password,initialState:{...createDefaultLiveState(),portals:oldPortals},works:ACTIVITY_WORKS,workEnv:{}});
  const {port}=await app.listen(0),origin=`http://127.0.0.1:${port}`;
  const state=app.getState(),point=state.portals.find(p=>p.workId==='she-love-me');
  check('Old three-point state gains the linked Einstein entry',point?.enabled&&state.portals.length===4);
  check('Existing point coordinates and settings are preserved',isDeepStrictEqual(state.portals.filter(p=>p.workId!=='she-love-me'),oldPortals));
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  const context=await browser.newContext({viewport:{width:1280,height:850}});
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin&&['http:','https:'].includes(url.protocol)){
      outside.push(url.href);
      if(url.href==='https://github.com/863401402/she-love-me')return route.fulfill({contentType:'text/html',body:'<title>Verified repository destination</title>'});
      return route.abort();
    }
    if(url.pathname.startsWith('/api/works/')){apiCalls.push(url.href);return route.abort();}
    return route.continue();
  });
  page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/?place=einstein');
  await page.getByLabel('你的昵称').fill('广场独立入口本地验收');await page.locator('.audience-welcome button').click();
  await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
  await page.locator('.live-portal-prompt').waitFor({state:'visible',timeout:60000});
  check('Einstein walking arrival is within reach of the new entry',(await page.locator('.live-portal-prompt').innerText()).includes('她不一样'));
  await page.screenshot({path:path.join(out,'einstein-entry.png')});
  check('New visitor has no tasay completion requirement',await page.evaluate(()=>localStorage.getItem('ta-say:persisted')===null&&localStorage.getItem('ta-say:original-story:persisted')===null));
  await page.locator('.live-portal-prompt').click();
  const iframe=page.locator('.live-portal-frame iframe');await iframe.waitFor();
  let frame=await iframe.elementHandle().then(h=>h.contentFrame());await frame.locator('#project').waitFor();
  await page.locator('.live-portal-loading').waitFor({state:'hidden'});
  check('Fresh visitor opens the standalone project directly',new URL(frame.url()).pathname==='/works/she-love-me/');
  check('Standalone project has its own deliberate-link sandbox',(await iframe.getAttribute('sandbox')).includes('allow-popups-to-escape-sandbox'));
  const popupWait=context.waitForEvent('page');await frame.getByRole('link',{name:'查看开源项目 ↗',exact:true}).click();
  const popup=await popupWait;await popup.waitForLoadState();check('Repository link works inside campus',popup.url()==='https://github.com/863401402/she-love-me');await popup.close();
  await frame.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied in test');}}}));
  await frame.locator('#copy-instruction').click();
  check('Denied clipboard selects the entire instruction',await frame.locator('#ai-instruction').evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length));
  for(const [name,width,height]of [['320',320,568],['390',390,844],['landscape',844,390],['desktop',1280,850]]){
    await page.setViewportSize({width,height});
    await page.waitForTimeout(200);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await frame.evaluate(()=>scrollTo(0,0));
    const m=await frame.evaluate(()=>({width:innerWidth,page:document.documentElement.scrollWidth,main:document.querySelector('main').getBoundingClientRect().width}));
    check(`${name}: embedded guide fits without horizontal stretch`,m.page<=m.width&&m.main<=m.width,m);
    const bounds=await iframe.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight};});
    check(`${name}: frame stays inside the host viewport`,bounds.top>=0&&bounds.bottom<=bounds.height+1,bounds);
    await page.screenshot({path:path.join(out,`${name}-project.png`)});
  }
  const login=await context.request.post(origin+'/api/admin/login',{headers:{Origin:origin},data:{password}}),{csrfToken}=await login.json();
  const change=async patch=>{const prior=app.getState();const r=await context.request.put(origin+'/api/admin/state',{headers:{Origin:origin,'x-csrf-token':csrfToken},data:{expectedRevision:prior.revision,state:{...prior,...patch}}});assert.equal(r.status(),200,await r.text());};
  await change({paused:true});await page.locator('.live-pause').waitFor({state:'visible'});
  await frame.waitForFunction(()=>document.querySelector('main').inert);
  check('Host pause freezes the standalone guide',await page.locator('.live-portal-view').evaluate(el=>el.inert)&&await frame.locator('main').evaluate(el=>el.inert));
  await change({paused:false});await page.locator('.live-pause').waitFor({state:'hidden'});
  await frame.locator('#return-to-campus').click();await page.locator('.live-portal-view').waitFor({state:'hidden'});
  await page.locator('.live-portal-prompt').waitFor({state:'visible'});
  check('Child return brings visitor back to the same square',await page.locator('.live-portal-frame iframe').count()===0);
  await change({portals:app.getState().portals.map(p=>p.workId==='tasay'?{...p,enabled:false}:p)});
  await page.locator('.live-portal-prompt').waitFor({state:'hidden'});
  check('Closing tasay synchronously closes the square entry',app.getState().portals.filter(p=>['tasay','she-love-me'].includes(p.workId)).every(p=>p.enabled===false));
  const start=Date.now()+3600000,end=start+1800000;
  await change({portals:app.getState().portals.map(p=>p.workId==='tasay'?{...p,enabled:true,startAt:start,endAt:end}:p)});
  check('Future schedule is identical on both entries',app.getState().portals.filter(p=>['tasay','she-love-me'].includes(p.workId)).every(p=>p.startAt===start&&p.endAt===end));
  await change({portals:app.getState().portals.map(p=>p.workId==='tasay'?{...p,enabled:true,startAt:null,endAt:null}:p)});
  await page.locator('.live-portal-prompt').waitFor({state:'visible'});
  check('Reopening tasay restores the independent entry',app.getState().portals.find(p=>p.workId==='she-love-me').enabled);
  // Use a separate page for the former chat entry; never seed a real player's progress.
  const chat=await context.newPage();chat.on('pageerror',e=>errors.push(e.message));
  await chat.goto(origin+'/works/tasay/chat');await chat.locator('.desktop-chat-input').waitFor();
  check('Tasay no longer contains the project entry for a new player',await chat.getByRole('button',{name:'她不一样 · 恋情分析室',exact:true}).count()===0);
  await chat.evaluate(()=>{const key='ta-say:original-story:session',s=JSON.parse(localStorage.getItem(key));s.hasFinishedGame=true;s.stage='wake_up';localStorage.setItem(key,JSON.stringify(s));localStorage.setItem('ta-say:original-story:persisted',JSON.stringify({version:2,hasFinishedGame:true,loadCount:0,metaMemory:[]}));});
  await chat.reload();await chat.locator('.game-ending').waitFor();
  check('The old post-completion project entry is also removed',await chat.getByRole('button',{name:'她不一样 · 恋情分析室',exact:true}).count()===0);
  const admin=await context.newPage();await admin.goto(origin+'/admin');await admin.locator('#dashboard').waitFor({state:'visible'});
  const linked=admin.locator('#activity-choices input[value="point-she-love-me"]');
  check('Admin shows linked entry with no independent launch switch',await linked.isDisabled());
  await admin.screenshot({path:path.join(out,'admin-linked-entry.png')});
  check('No model calls or browser runtime errors',!apiCalls.length&&!errors.length,{apiCalls,errors});
  passed=true;
}catch(error){failure=error.stack||String(error);console.error(failure);process.exitCode=1;if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});await writeFile(path.join(out,'browser-verification.json'),JSON.stringify({passed,checks,errors,outside,apiCalls,failure,scope:'Actual built campus/iframe; legacy state and fresh visitor; isolated local server/data; no production writes.'},null,2));}
