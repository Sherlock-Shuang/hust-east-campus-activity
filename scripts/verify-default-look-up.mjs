// Real default third-person controls, with no return pose or first-person switch.
// Run --expect-blocked to capture the regression; otherwise expect overhead look.
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState} from '../src/live-state.js';
import {mkdtemp,mkdir,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url)),expectBlocked=process.argv.includes('--expect-blocked');
const out=path.join(root,'artifacts/third-person-look-up-2026-10-29',expectBlocked?'baseline':'fixed');
const bundled=path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||await access(bundled).then(()=>pathToFileURL(bundled).href,()=> 'playwright'));
const dataDir=await mkdtemp(path.join(tmpdir(),'default-look-')),errors=[],results=[];
await mkdir(out,{recursive:true});let app,browser,activePage;
try{
  app=await createLiveServer({rootDir:root,dataDir,password:randomBytes(24).toString('hex'),initialState:{...createDefaultLiveState(),skyQrVisible:true},workRouter:async()=>false});
  const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  async function create(mobile){
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:960},deviceScaleFactor:1,isMobile:mobile,hasTouch:mobile});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());assert.equal(url.origin,origin,'No real-service requests');
      if(/\/assets\/campus-[^/]+\.js$/.test(url.pathname)){
        const response=await route.fetch();let body=await response.text();
        const anchor=/new [\w$.]+\(44,1,1,(?:12e3|12000)\)/;assert.ok(anchor.test(body));
        // Read-only copies; this response patch never changes the built file.
        body=body.replace(anchor,match=>`(c=>{globalThis.__readDefaultCamera=()=>({position:c.position.toArray(),quaternion:c.quaternion.toArray(),forwardY:-c.matrixWorld.elements[9]});return c})(${match})`);
        const sky=/([\w$]+)\.name="activity-sky-qr"/;assert.ok(sky.test(body));
        body=body.replace(sky,(match,name)=>`(${match},globalThis.__readDefaultSky=()=>({matrix:${name}.matrixWorld.toArray(),children:${name}.children.map(m=>m.matrixWorld.toArray())}))`);
        return route.fulfill({response,body});
      }
      return route.continue();
    });
    const page=await context.newPage();activePage=page;page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin);await page.getByLabel('你的昵称').fill(mobile?'默认第三人称手机验收':'默认第三人称鼠标验收');await page.locator('.audience-welcome button').click();
    await page.waitForFunction(()=>document.querySelector('.audience-welcome')?.hidden===true);
    await page.locator('#load-screen').waitFor({state:'hidden',timeout:90000});
    await page.waitForFunction(()=>document.querySelector('#live-experience')?.dataset.skyQrState==='ready',null,{timeout:45000});
    if(mobile){const button=page.locator('[data-mobile-action="continue-portrait"]');if(await button.isVisible())await button.tap();}
    return {context,page};
  }
  const sample=page=>page.evaluate(()=>({camera:globalThis.__readDefaultCamera(),sky:globalThis.__readDefaultSky(),view:document.querySelector('#mobile-controls')?.dataset.view,paused:document.querySelector('#live-experience')?.dataset.paused,canvasInert:document.querySelector('#map-canvas').inert}));
  for(const mobile of [false,true]){
    const {context,page}=await create(mobile),label=mobile?'mobile':'desktop';
    const before=await sample(page);assert.equal(before.view,'third');assert.equal(before.paused,'false');assert.equal(before.canvasInert,false);
    await page.screenshot({path:path.join(out,`${label}-default.png`)});
    if(mobile){
      const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:290,y:680,id:1}]});
      for(let step=1;step<=20;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:290,y:680-step*28,id:1}]});await page.waitForTimeout(16);}
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    }else{
      await page.mouse.move(-10,-10);await page.mouse.move(700,850);await page.mouse.down();await page.mouse.move(700,100,{steps:28});await page.mouse.up();
    }
    await page.waitForTimeout(500);const after=await sample(page);
    await page.screenshot({path:path.join(out,`${label}-look-up.png`)});
    const passed=after.view==='third'&&after.paused==='false'&&!after.canvasInert&&JSON.stringify(before.sky)===JSON.stringify(after.sky)&&(expectBlocked?after.camera.forwardY<.8:after.camera.forwardY>.98);
    const result={label,passed,before,after,expectBlocked,elevationDegrees:Math.asin(Math.max(-1,Math.min(1,after.camera.forwardY)))*180/Math.PI};results.push(result);
    console.log(`${passed?'PASS':'FAIL'} ${label}: default third-person up gesture reaches ${result.elevationDegrees.toFixed(2)} degrees`);
    await context.close();
  }
  assert.ok(results.every(result=>result.passed));assert.deepEqual(errors,[]);
}catch(error){console.error(error);errors.push(error.message);process.exitCode=1;if(activePage&&!activePage.isClosed())await activePage.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{await browser?.close();await app?.close();await rm(dataDir,{recursive:true,force:true});await writeFile(path.join(out,'verification.json'),JSON.stringify({passed:results.length===2&&results.every(result=>result.passed)&&errors.length===0,expectBlocked,results,errors,scope:'Fresh default third-person spawn, real input, no pre-set pose/pitch, no first-person switch, isolated temporary server/data.'},null,2));}
