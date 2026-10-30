import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createLazyAsset,fetchGltf,disposeGltf} from './library-asset-runtime.mjs';
import {isVersionedWorkAsset} from './versioned-assets.mjs';
import {createLibraryHandler} from './handler.mjs';
const assets=new URL('../../work-assets/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('first-person work does not request character; requested third-person preparation is deduplicated',async()=>{
 const request=deferred();let loads=0,applied=0;const states=[];
 const lazy=createLazyAsset({load:()=>{loads++;return request.promise;},apply:()=>applied++,onState:s=>states.push(s),disposeAsset(){}});
 assert.equal(loads,0);assert.equal(lazy.ready,false);
 const first=lazy.ensure(),second=lazy.ensure();assert.equal(first,second);await Promise.resolve();assert.equal(loads,1);
 request.resolve({});assert.equal(await first,true);assert.equal(applied,1);assert.equal(lazy.ready,true);
 assert.equal(await lazy.ensure(),true);assert.equal(loads,1);assert.deepEqual(states,['loading','ready']);lazy.dispose();
});
test('leaving during character preparation aborts and disposes late result without attaching',async()=>{
 const request=deferred();let signal,applied=0,released=0;const lazy=createLazyAsset({load:s=>{signal=s;return request.promise;},apply:()=>applied++,disposeAsset:()=>released++});
 const pending=lazy.ensure();await Promise.resolve();lazy.dispose();assert.equal(signal.aborted,true);request.resolve({});assert.equal(await pending,false);
 assert.equal(applied,0);assert.equal(released,1);assert.equal(await lazy.ensure(),false);lazy.dispose();assert.equal(released,1);
});
test('failed character can retry without turning building readiness into failure',async()=>{
 let attempts=0,applied=0;const states=[];const lazy=createLazyAsset({load:async()=>{if(++attempts===1)throw new Error('offline');return {};},apply:()=>applied++,onState:s=>states.push(s),disposeAsset(){}});
 assert.equal(await lazy.ensure(),false);assert.equal(lazy.ready,false);assert.equal(await lazy.ensure(),true);assert.equal(applied,1);assert.deepEqual(states,['loading','failed','loading','ready']);lazy.dispose();
});
test('model fetch preserves HTTP failure, abort and parse boundaries',async()=>{
 let parses=0;const loader={parseAsync:async()=>{parses++;return {scene:{traverse(){},removeFromParent(){}}};}};
 await assert.rejects(fetchGltf('/missing',loader,{fetchImpl:async()=>({ok:false,status:404})}),/404/);assert.equal(parses,0);
 const controller=new AbortController();controller.abort();await assert.rejects(fetchGltf('/model',loader,{signal:controller.signal,fetchImpl:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})}),{name:'AbortError'});assert.equal(parses,0);
 await fetchGltf('/model',loader,{fetchImpl:async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)})});assert.equal(parses,1);
});
test('shared geometry/material/texture disposal releases each owner once',()=>{
 const calls={geometry:0,material:0,texture:0,image:0};const image={close:()=>calls.image++},texture={isTexture:true,source:{data:image},dispose:()=>calls.texture++},material={map:texture,normalMap:texture,dispose:()=>calls.material++},geometry={dispose:()=>calls.geometry++};
 disposeGltf({scene:{traverse(fn){fn({geometry,material});fn({geometry,material:[material]});},removeFromParent(){}}});assert.deepEqual(calls,{geometry:1,material:1,texture:1,image:1});
});
function glbJson(bytes){assert.equal(bytes.readUInt32LE(0),0x46546c67);return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());}
test('actual derivative preserves all node IDs, portal extras, graph relationships and character animation names',async()=>{
 const config=JSON.parse(await readFile(new URL('library/performance-assets.json',assets),'utf8'));
 for(const name of ['library','hero']){
  const c=config[name],original=glbJson(await readFile(new URL(c.original.slice('/works/'.length),assets))),candidate=glbJson(await readFile(new URL(c.url.slice('/works/'.length),assets)));
  assert.deepEqual(candidate.nodes.map(n=>[n.name,n.extras||{},n.children||[]]),original.nodes.map(n=>[n.name,n.extras||{},n.children||[]]));
  assert.deepEqual((candidate.animations||[]).map(a=>a.name),(original.animations||[]).map(a=>a.name));assert.equal(candidate.skins?.length||0,original.skins?.length||0);
  assert(candidate.extensionsRequired.includes('EXT_meshopt_compression'));
 }
});
test('versioned assets have real matching paths, decoder MIME, immutable cache and Range/ETag behavior',async t=>{
 const handler=await createLibraryHandler({assetsRoot:fileURLToPath(assets)}),server=createServer((req,res)=>handler(req,res).then(ok=>{if(!ok){res.writeHead(404);res.end();}}).catch(error=>{res.writeHead(500);res.end(error.message);}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const origin='http://127.0.0.1:'+server.address().port;
 const config=await(await fetch(origin+'/works/library/performance-assets.json')).json();
 for(const url of [config.library.url,config.hero.url,config.meshoptDecoder]){
  const head=await fetch(origin+url,{method:'HEAD'});assert.equal(head.status,200);assert.match(head.headers.get('cache-control'),/immutable/);
  assert.equal((await fetch(origin+url,{headers:{'If-None-Match':head.headers.get('etag')}})).status,304);
  const range=await fetch(origin+url,{headers:{Range:'bytes=0-31'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
 }
 assert.match((await fetch(origin+config.meshoptDecoder,{method:'HEAD'})).headers.get('content-type'),/javascript/);
 assert.equal((await fetch(origin+'/works/library/performance-assets.json',{method:'HEAD'})).headers.get('cache-control'),'no-cache');
 const hash='a'.repeat(64);assert.equal(isVersionedWorkAsset('/works/library/assets/'+hash+'/model.glb',hash),true);assert.equal(isVersionedWorkAsset('/works/library/model.glb',hash),false);
});
