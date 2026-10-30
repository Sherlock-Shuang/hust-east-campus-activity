/** Actual ASTC feature detection and native Unity runtime; never spoof GPU support. */
import {writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLibraryHandler} from './handler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'artifacts/performance-phase2-20261030/wanyan-browser');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const handler=await createLibraryHandler({assetsRoot:path.join(root,'work-assets')}),server=createServer((req,res)=>handler(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(e=>{res.writeHead(500);res.end(e.message);}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,results=[],errors=[];let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1}),page=await context.newPage(),requests=[],consoleMessages=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('console',m=>{if(m.type()==='error'||m.text().includes('GL_'))consoleMessages.push(m.text());});
 await page.goto(origin+'/works/wanyan/?quality=mobile');
 await page.waitForFunction(()=>document.documentElement.dataset.campusWorkStatus==='runtime_ready',null,{timeout:120000});
 await page.waitForFunction(()=>!!window.bookrealmNativeControls,null,{timeout:30000});
 const ready=await page.evaluate(()=>({dataset:{...document.documentElement.dataset},controls:window.bookrealmNativeControls,skill:window.bookrealmNativeSkill}));
 await page.screenshot({path:path.join(out,'mobile-menu.png')});await page.locator('#unity-canvas').click();await page.keyboard.press('Enter');await page.waitForTimeout(1600);
 await page.screenshot({path:path.join(out,'mobile-game.png')});
 const gameplay=await page.evaluate(()=>({dataset:{...document.documentElement.dataset},controls:window.bookrealmNativeControls,skill:window.bookrealmNativeSkill}));
 results.push({ready,gameplay,requests,consoleMessages});assert.equal(ready.dataset.wanyanQuality,'mobile-astc');assert.equal(ready.dataset.campusWorkStatus,'runtime_ready');assert.equal(gameplay.controls.started,true);
 await context.close();assert.deepEqual(errors,[]);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(path.join(out,'report.json'),JSON.stringify({results,errors,scope:'Actual Mac Chrome ASTC support, Mobile compiled runtime and gameplay screenshot; not physical phone, FPS, battery, thermal or CDN test.'},null,2));}
console.log(JSON.stringify({out,errors}));
