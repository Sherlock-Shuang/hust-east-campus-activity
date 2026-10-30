/** Real Chrome functional visual comparison. Not a phone/FPS benchmark. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLibraryHandler} from './handler.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=path.join(root,'artifacts/performance-phase2-20261030/library-browser');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
const handler=await createLibraryHandler({assetsRoot:path.join(root,'work-assets')}),server=createServer((req,res)=>handler(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(e=>{res.writeHead(500);res.end(e.message);}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,results=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 for(const variant of ['optimized','original']){
  const context=await browser.newContext({viewport:{width:1280,height:800},deviceScaleFactor:1}),page=await context.newPage(),requests=[];
  page.on('pageerror',e=>errors.push({variant,error:e.message}));page.on('request',r=>requests.push(r.url()));
  await page.goto(origin+'/works/library/'+(variant==='original'?'?assets=original':''));
  await page.waitForFunction(()=>window.__libraryDebug?.ready,null,{timeout:90000});
  assert.equal(await page.evaluate(()=>window.__libraryDebug.heroReady),false);assert.equal(requests.some(url=>/hero\.glb/.test(url)),false);
  const before=await page.evaluate(()=>({pose:__libraryDebug.getPose(),stats:__libraryDebug.renderStats,portals:__libraryDebug.portals.map(p=>p.userData.portal_id),dataset:{...document.documentElement.dataset}}));
  await page.locator('#resume').click();await page.waitForTimeout(150);await page.screenshot({path:path.join(out,variant+'-first.png')});
  await page.evaluate(()=>{__libraryDebug.setView('third');__libraryDebug.setView('third');});await page.waitForFunction(()=>__libraryDebug.heroReady,null,{timeout:60000});
  assert.equal(requests.filter(url=>/hero\.glb/.test(url)).length,1);await page.waitForTimeout(200);await page.screenshot({path:path.join(out,variant+'-third.png')});
  const after=await page.evaluate(()=>({pose:__libraryDebug.getPose(),stats:__libraryDebug.renderStats,heroReady:__libraryDebug.heroReady,assets:__libraryDebug.assets}));
  results.push({variant,before,after,requests});await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(results[0].before.portals,results[1].before.portals);assert.deepEqual([...new Set(results[0].before.portals)].sort(),['isaac','wanyan']);assert.equal(results[0].before.portals.length,10);
}finally{await browser?.close();await new Promise(r=>server.close(r));await writeFile(path.join(out,'report.json'),JSON.stringify({results,errors,scope:'Real Chrome on this Mac, first/third-person screenshots and request assertions; concurrent Unity build. No timing, real-phone FPS or thermal claim.'},null,2));}
console.log(JSON.stringify({out,variants:results.length,errors}));
