import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createLibraryHandler} from './handler.mjs';
import {rebaseLibraryText} from './build.mjs';
import {WANYAN_PUBLIC_TEXT} from './wanyan-public-text.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),assets=path.resolve(here,'../../work-assets');

test('runtime URLs retain their original route hierarchy under activity prefixes',()=>{
  assert.equal(rebaseLibraryText(`fetch('/api/games'); import('/hub/main.mjs'); "/games/wanyan/"; url("/vendor/font.otf"); '/hero.glb'`),`fetch('/works/library/api/games'); import('/works/library/hub/main.mjs'); "/works/wanyan/"; url("/works/library/vendor/font.otf"); '/works/library/hero.glb'`);
});
test('public conversation retains 8/4 steps, reply counts, and original flow node IDs',async()=>{
  const config=JSON.parse(await readFile(path.join(here,'public-story.json'),'utf8'));
  assert.deepEqual(config.conversations.intro.map(s=>s.type),['incoming','reply','incoming','reply','incoming','incoming','incoming','close']);
  assert.deepEqual(config.conversations.birthday.map(s=>s.type),['incoming','reply','incoming','close']);
  assert.equal(config.self.avatar,'');assert.equal(config.contact.avatar,'');
});
test('generated manifest only contains runtime files with matching byte/hash metadata',async()=>{
  const manifest=JSON.parse(await readFile(path.join(assets,'library-manifest.json'),'utf8'));
  assert(manifest.entries.length>60);
  for(const entry of manifest.entries){
    assert(!/(?:avatars|archive|private|\.blend|\.fbx|\.git|\.map$|tests\/|qa\.html|serve\.py)/i.test(entry.file),entry.file);
    const bytes=await readFile(path.join(assets,entry.file));assert.equal(bytes.length,entry.bytes,entry.file);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,entry.file);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(assets,'library/story/config.json'),'utf8')),JSON.parse(await readFile(path.join(here,'public-story.json'),'utf8')));
  const main=await readFile(path.join(assets,'library/hub/main.mjs'),'utf8');
  assert(main.includes("campus-library-save-v1"));assert(main.includes("last=now;if(campusSuspended)return;pollController"));
  assert(main.includes('suspended=suspended||campusSuspended;'));
  assert(!main.includes("fetch('/story/config.json')"));
  // Original victory/door implementation is copied unchanged; no synthetic completion added.
  const original=await readFile(path.join(assets,'library/hub/journey.mjs'),'utf8');
  assert(original.includes("state.completed.isaac&&state.completed.wanyan&&state.story.birthday.status==='done'"));
});
test('mounted handler serves real models, Unity, nested games, routes, MIME and range requests',async(t)=>{
  const handler=await createLibraryHandler({assetsRoot:assets});
  const server=createServer((req,res)=>handler(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}}).catch(()=>{res.writeHead(500);res.end();}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const url of ['/works/library/','/works/wanyan/','/works/library/games/isaac/','/works/library/hub/main.mjs','/works/library/story/config.json'])assert.equal((await fetch(origin+url,{method:'HEAD'})).status,200,url);
  const status=await (await fetch(origin+'/works/library/api/games')).json();assert.equal(status.isaacReady,true);assert.equal(status.wanyanReady,true);
  for(const [url,mime] of [['/works/library/model.glb','model/gltf-binary'],['/works/wanyan/Build/wanyan.wasm','application/wasm'],['/works/wanyan/Build/wanyan.data','application/octet-stream']]){
    const r=await fetch(origin+url,{headers:{Range:'bytes=0-31'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-type'),mime);assert.equal((await r.arrayBuffer()).byteLength,32);
  }
  assert.equal((await fetch(origin+'/works/library/story/avatars/contact.jpg')).status,404);
  assert.equal((await fetch(origin+'/works/library/serve.py')).status,404);
  assert.equal((await fetch(origin+'/works/library/',{method:'POST'})).status,405);
  assert.equal((await fetch(origin+'/works/library/model.glb',{headers:{Range:'bytes=999999999-'}})).status,416);
});
test('activity Unity data and cache URL contain the public sanctuary wording',async()=>{
  const bytes=await readFile(path.join(assets,'wanyan/Build/wanyan.data'));
  assert(!bytes.includes(Buffer.from('归心')));
  for(const text of WANYAN_PUBLIC_TEXT.values())assert(bytes.includes(Buffer.from(text)));
  const html=await readFile(path.join(assets,'wanyan/index.html'),'utf8');
  assert(html.includes('/wanyan.data?campus-text=sanctum-v1'));
});
test('adapter authenticates parent/attempt, reports real readiness once and respects game-owned keys',async()=>{
  const messages=[],events=new Map(),parent={postMessage:(...args)=>messages.push(args)};
  const doc={currentScript:{dataset:{work:'wanyan'}},documentElement:{dataset:{}},exitPointerLock(){},activeElement:{blur(){}}};
  const sandbox={URL,URLSearchParams,location:{origin:'https://campus.example',search:'?campusAttempt=attempt-one&campusParentOrigin=https%3A%2F%2Fcampus.example'},parent,document:doc,addEventListener:(name,fn)=>events.set(name,fn)};
  sandbox.window=sandbox;vm.runInNewContext(await readFile(path.join(here,'activity-adapter.js'),'utf8'),sandbox);
  const states=[];let disposed=0;sandbox.campusWorkAdapter.register({setPaused:value=>states.push(value),dispose:()=>disposed++});
  assert.deepEqual(states,[],'registration must not overwrite native nested-game pause before host handshake');
  events.get('message')({source:{},origin:'https://campus.example',data:{type:'campus:activity',paused:true}});assert.deepEqual(states,[]);
  events.get('message')({source:parent,origin:'https://evil.example',data:{type:'campus:activity',paused:true}});assert.deepEqual(states,[]);
  events.get('message')({source:parent,origin:'https://campus.example',data:{type:'campus:activity',attemptId:'wrong',paused:true}});assert.deepEqual(states,[]);
  events.get('message')({source:parent,origin:'https://campus.example',data:{type:'campus:activity',attemptId:'attempt-one',paused:true}});assert.deepEqual(states,[true]);
  sandbox.campusWorkAdapter.ready('runtime_ready');sandbox.campusWorkAdapter.ready('runtime_ready');
  assert.equal(messages.length,1);assert.equal(messages[0][0].attemptId,'attempt-one');assert.equal(messages[0][0].level,'runtime_ready');assert.equal(messages[0][1],'https://campus.example');
  let prevented=false;events.get('keydown')({key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,true);
  assert.equal(events.has('keyup'),false,'key releases still reach paused runtime');
  assert.equal(events.has('pointerup'),false,'pointer releases still reach paused runtime');
  events.get('message')({source:parent,origin:'https://campus.example',data:{type:'campus:activity',paused:false}});assert.equal(states.at(-1),true,'attempt ID is mandatory');
  events.get('message')({source:parent,origin:'https://campus.example',data:{type:'campus:activity',attemptId:'attempt-one',paused:false}});prevented=false;
  events.get('keydown')({key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,false,'Escape is left to original game');
  events.get('message')({source:parent,origin:'https://campus.example',data:{type:'campus:dispose',attemptId:'attempt-one'}});assert.equal(disposed,1);
  events.get('message')({source:parent,origin:'https://campus.example',data:{type:'campus:activity',attemptId:'attempt-one',paused:false}});assert.equal(states.at(-1),true);
});

function sdkFixture(search='?campusAttempt=attempt-one&campusParentOrigin=https%3A%2F%2Fcampus.example'){
  const messages=[],events=new Map(),domEvents=new Map(),dispatched=[],parent={postMessage:(...args)=>messages.push(args)};
  const document={readyState:'loading',currentScript:{dataset:{work:'example'}},documentElement:{dataset:{}},exitPointerLock(){},activeElement:{blur(){}},addEventListener:(name,fn)=>domEvents.set(name,fn)};
  const sandbox={URL,URLSearchParams,console,Date,location:{origin:'https://campus.example',search},parent,document,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name),dispatchEvent:event=>dispatched.push(event),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}};
  sandbox.window=sandbox;return {sandbox,messages,events,domEvents,dispatched,parent};
}
test('neither bridge accepts a query-supplied cross-origin controller',async()=>{
  for(const [file,property] of [[path.join(here,'activity-adapter.js'),'campusWorkAdapter'],[path.join(here,'../../public/experiences/activity-bridge.js'),'campusActivity']]){
    const fixture=sdkFixture('?campusAttempt=attempt-one&campusParentOrigin=https%3A%2F%2Fevil.example');
    vm.runInNewContext(await readFile(file,'utf8'),fixture.sandbox);
    assert.equal(fixture.sandbox[property],undefined);assert.equal(fixture.events.size,0);assert.equal(fixture.messages.length,0);
  }
});
test('example SDK reports page and actual runtime separately, authenticates commands and disposes once',async()=>{
  const {sandbox,messages,events,domEvents,dispatched,parent}=sdkFixture();
  vm.runInNewContext(await readFile(path.join(here,'../../public/experiences/activity-bridge.js'),'utf8'),sandbox);
  const api=sandbox.campusActivity,states=[];api.subscribe(state=>states.push(state));assert.equal(messages.length,0);
  domEvents.get('DOMContentLoaded')();assert.equal(messages.length,1);assert.equal(messages[0][0].level,'page_opened');
  assert.equal(messages[0][0].attemptId,'attempt-one');assert.equal(messages[0][1],'https://campus.example');
  assert.equal(api.ready('completed'),false);assert.equal(api.ready('runtime_ready'),true);assert.equal(api.ready('runtime_ready'),false);
  const command=(data,source=parent,origin='https://campus.example')=>({source,origin,data});
  const receive=events.get('message');
  for(const event of [command({type:'campus:activity',paused:true}),command({type:'campus:activity',attemptId:'stale',paused:true}),command({type:'campus:activity',attemptId:'attempt-one',paused:true},{}),command({type:'campus:activity',attemptId:'attempt-one',paused:true},parent,'https://evil.example')])receive(event);
  assert.equal(states.length,1);assert.equal(api.paused,false);
  receive(command({type:'campus:activity',attemptId:'attempt-one',paused:true,announcement:{title:'集合'},serverTime:1234}));
  assert.equal(api.paused,true);assert.equal(api.state.serverTime,1234);assert.equal(api.exit(),false);
  receive(command({type:'campus:activity',attemptId:'attempt-one',paused:false,serverTime:1235}));assert.equal(api.exit(),true);assert.equal(messages.at(-1)[0].type,'campus:exit');
  assert.equal(events.has('keydown'),false,'SDK does not hijack original Escape behavior');
  receive(command({type:'campus:dispose',attemptId:'attempt-one'}));assert.equal(api.state.disposed,true);assert.equal(events.has('message'),false);
  const count=states.length;receive(command({type:'campus:activity',attemptId:'attempt-one',paused:false}));assert.equal(states.length,count);assert.equal(api.ready(),false);assert.equal(api.fail('late'),false);
  assert.equal(dispatched.filter(event=>event.type==='campus:dispose').length,1);
});
test('same-origin nested Wanyan and Isaac retain their original control messages',async()=>{
  const html=await readFile(path.join(assets,'wanyan/index.html'),'utf8'),controls=html.match(/<script id="bookrealm-controls">([\s\S]*?)<\/script>/)?.[1];assert(controls);
  const listeners=[],parent={postMessage(){}},document={hidden:false,hasFocus:()=>true,documentElement:{dataset:{}},getElementById:()=>({focus(){}}),currentScript:{dataset:{work:'wanyan'}},exitPointerLock(){}};
  const sandbox={URL,URLSearchParams,location:{origin:'https://campus.example',search:''},parent,document,performance:{now:()=>0},focus(){},addEventListener:(name,fn)=>{if(name==='message')listeners.push(fn);}};sandbox.window=sandbox;
  vm.runInNewContext(controls,sandbox);vm.runInNewContext(await readFile(path.join(here,'activity-adapter.js'),'utf8'),sandbox);
  const events=[{source:parent,origin:'https://campus.example',data:{type:'bookrealm:controls',suspended:true}},{source:parent,origin:'https://evil.example',data:{type:'bookrealm:controls',suspended:false}},{source:parent,origin:'https://campus.example',data:{type:'bookrealm:controls',suspended:false}}];
  for(const [index,event] of events.entries()){listeners.forEach(fn=>fn(event));assert.equal(sandbox.bookrealmControlsSuspended,index!==2);}
  const isaac=await readFile(path.join(assets,'library/isaac-source/运行验证/gamepad-controller.mjs'),'utf8');
  const onMessage=isaac.match(/this\.onMessage = event => \{[\s\S]*?\n    \};/)?.[0];assert(onMessage);
  const changes=[],context={win:{parent,location:{origin:'https://campus.example'}},pause:{reasons:new Set()},setSuspended:(...args)=>changes.push(args)};
  vm.runInNewContext(onMessage,context);events.forEach(event=>context.onMessage(event));
  assert.deepEqual(changes,[['parent',true],['parent',false]]);
});
test('Unity pointer-lock platform failures are non-fatal, unrelated errors remain fatal',async()=>{
  const source=await readFile(path.join(here,'wanyan-pointer-lock.js'),'utf8');
  function fixture(native){
    const target={requestPointerLock:native},document={documentElement:{dataset:{}},getElementById:()=>({focus(){}})};
    const context={document,console:{info(){}},WeakSet,Set,DOMException};context.window=context;vm.runInNewContext(source,context);context.campusPointerLock.install(target);return {context,target,document};
  }
  let requests=0;const refusal=Object.assign(new Error('The root document of this element is not valid for pointer lock.'),{name:'WrongDocumentError'});
  const sync=fixture(()=>{requests++;throw refusal;});assert.doesNotThrow(()=>sync.target.requestPointerLock());assert.equal(sync.document.documentElement.dataset.campusPointerLock,'unavailable');
  sync.target.requestPointerLock();assert.equal(requests,1,'permanent platform refusal does not retry every Unity frame');
  const asyncFailure=fixture(()=>Promise.reject(Object.assign(new Error('Pointer lock rejected'),{name:'NotAllowedError'})));
  await assert.doesNotReject(()=>asyncFailure.target.requestPointerLock());assert.equal(asyncFailure.document.documentElement.dataset.campusPointerLock,'unavailable');
  const chromiumMessage='If you see this error we have a bug. Please report this bug to chromium.';
  const unknown=fixture(()=>{throw new DOMException(chromiumMessage,'UnknownError');});assert.doesNotThrow(()=>unknown.target.requestPointerLock());assert.equal(unknown.document.documentElement.dataset.campusPointerLock,'unavailable');
  const unknownAsync=fixture(()=>Promise.reject(new DOMException(chromiumMessage,'UnknownError')));await assert.doesNotReject(()=>unknownAsync.target.requestPointerLock());assert.equal(unknownAsync.document.documentElement.dataset.campusPointerLock,'unavailable');
  const ordinaryUnknown=fixture(()=>{throw Object.assign(new Error('Application error'),{name:'UnknownError'});});assert.throws(()=>ordinaryUnknown.target.requestPointerLock(),/Application error/);
  const real=fixture(()=>{throw new TypeError('Bad Unity pointer target');});assert.throws(()=>real.target.requestPointerLock(),/Bad Unity pointer target/);
  const realAsync=fixture(()=>Promise.reject(new Error('Unity internal failure')));await assert.rejects(()=>realAsync.target.requestPointerLock(),/Unity internal failure/);
  const ok=fixture(()=>Promise.resolve('native-success'));assert.equal(await ok.target.requestPointerLock(),'native-success');assert.equal(ok.document.documentElement.dataset.campusPointerLock,undefined);
  assert.equal(ok.context.campusPointerLock.handleRuntimeError('WrongDocumentError: The root document of this element is not valid for pointer lock.'),true);
  for(const message of ['RuntimeError: memory access out of bounds','TypeError: requestPointerLock internal code bug','WrongDocumentError: unrelated DOM operation','Could not download wanyan.data',`UnknownError: ${chromiumMessage}`,`UnknownError: ${chromiumMessage} at requestPointerLock`])assert.equal(ok.context.campusPointerLock.handleRuntimeError(message),false,message);
  const html=await readFile(path.join(assets,'wanyan/index.html'),'utf8');
  assert(html.indexOf('campusPointerLock?.install(canvas)')<html.indexOf('createUnityInstance(canvas, config'));
  const handler=html.match(/errorHandler: (function\(message\) \{[^\n]+\}),/)?.[1];assert(handler);
  const failures=[],banners=[];const context={window:{campusPointerLock:ok.context.campusPointerLock,campusWorkAdapter:{fail:message=>failures.push(message)}},unityShowBanner:message=>banners.push(message)};
  const handle=vm.runInNewContext('('+handler+')',context);handle(String(refusal));assert.equal(failures.length,0);assert.equal(banners.length,0);
  handle('RuntimeError: memory access out of bounds');assert.equal(failures.length,1);assert.equal(banners.length,1);
});
