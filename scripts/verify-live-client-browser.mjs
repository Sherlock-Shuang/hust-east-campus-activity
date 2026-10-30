// Isolated native Chrome/EventSource lifecycle check. No audience, host,
// production service, model API or WebGL world is opened.
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import {homedir} from 'node:os';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createDefaultLiveState} from '../src/live-state.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'artifacts/performance-200/live-client-browser');await mkdir(out,{recursive:true});
const {chromium}=await import(pathToFileURL(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')));
let revision=1,gets=0,opens=0;const active=new Set(),requests=[],errors=[];
const snapshot=()=>({state:{...createDefaultLiveState(),revision},serverTime:Date.now()});
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');requests.push({path:url.pathname,at:Date.now()});
    if(url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Isolated live client verification</title>');return;}
    if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if(url.pathname==='/api/live/state'){gets++;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(snapshot()));return;}
    if(url.pathname==='/api/live/events'){
      opens++;active.add(res);res.on('close',()=>active.delete(res));
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\n`);return;
    }
    const file=path.resolve(root,'.'+url.pathname);
    if(url.pathname.startsWith('/src/')&&file.startsWith(path.join(root,'src')+path.sep)&&file.endsWith('.js')){
      res.writeHead(200,{'Content-Type':'text/javascript'});res.end(await readFile(file));return;
    }
    res.writeHead(404);res.end();
  }catch(error){res.writeHead(500);res.end();errors.push(error.message);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,context,page;const report={passed:false,startedAt:new Date().toISOString(),checks:[],scope:'Actual localhost HTTP and native Chrome EventSource. Network disconnect uses browser offline emulation. Visibility branch uses an injected hidden document target; no WebGL, physical background-tab scheduling or production traffic.'};
const record=(name,data)=>{report.checks.push({name,...data});console.log(JSON.stringify({name,...data}));};
try{
  browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  context=await browser.newContext();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async()=>{
    const {createLiveClient}=await import('/src/live-client.js');
    window.testDocument=new EventTarget();testDocument.hidden=false;window.events=[];window.connections=[];
    const listenerSets={visibilitychange:new Set(),online:new Set(),offline:new Set()};window.listenerCounts=()=>Object.fromEntries(Object.entries(listenerSets).map(([k,s])=>[k,s.size]));
    for(const target of [testDocument,window]){
      const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
      target.addEventListener=(name,handler,...args)=>{listenerSets[name]?.add(handler);return add(name,handler,...args);};
      target.removeEventListener=(name,handler,...args)=>{listenerSets[name]?.delete(handler);return remove(name,handler,...args);};
    }
    window.client=createLiveClient({documentImpl:testDocument,onState:state=>events.push(state.revision),onConnection:value=>connections.push(value)});
  });
  await page.waitForFunction(()=>client.connected);await page.waitForTimeout(300);
  assert.equal(gets,1);assert.equal(opens,1);assert.equal(active.size,1);record('initial native SSE without duplicate GET',{gets,opens,active:active.size});
  revision=2;const brokenAt=Date.now();for(const stream of active)stream.end();
  await page.waitForFunction(()=>client.connected&&client.state.revision===2);
  assert.equal(opens,2);assert.equal(gets,1);assert.equal(active.size,1);record('server closes stream and current snapshot reconnects',{gets,opens,active:active.size,reconnectedMs:Date.now()-brokenAt});
  await page.evaluate(()=>{testDocument.hidden=true;testDocument.dispatchEvent(new Event('visibilitychange'));});
  await context.setOffline(true);await page.waitForFunction(()=>!navigator.onLine&&!client.connected);
  await page.waitForTimeout(1800);assert.equal(opens,2);assert.equal(active.size,0);record('browser offline stops retries',{gets,opens,active:active.size});
  revision=3;await context.setOffline(false);await page.waitForFunction(()=>navigator.onLine&&client.connected&&client.state.revision===3);
  assert.equal(opens,3);assert.equal(active.size,1);record('online restores stream with hidden document target',{gets,opens,active:active.size,revision:3});
  const listenersBefore=await page.evaluate(()=>listenerCounts());assert.deepEqual(listenersBefore,{visibilitychange:1,online:1,offline:1});
  await page.evaluate(()=>client.dispose());await page.waitForTimeout(100);assert.equal(active.size,0);
  const requestCount=requests.length;
  await page.evaluate(()=>{testDocument.hidden=false;testDocument.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
  await page.waitForTimeout(2200);
  assert.equal(requests.length,requestCount);assert.deepEqual(await page.evaluate(()=>listenerCounts()),{visibilitychange:0,online:0,offline:0});
  record('dispose releases native connection, timers and listeners',{active:active.size,newRequests:requests.length-requestCount,listeners:await page.evaluate(()=>listenerCounts())});
  assert.deepEqual(errors,[]);report.passed=true;
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{
  await context?.close();await browser?.close();for(const stream of active)stream.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  report.errors=errors;report.finishedAt=new Date().toISOString();report.requests=requests;await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,failure:report.failure,report:path.join(out,'report.json')}));
}
