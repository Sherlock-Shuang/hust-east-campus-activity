import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRoutes} from './materialize.mjs';
test('deployment route cache is immutable only for a matching complete content hash',()=>{
 const hash='a'.repeat(64),routes=createRoutes({routes:{['/works/library/assets/'+hash+'/model.glb']:{sha256:hash,mime:'model/gltf-binary'},'/works/library/model.glb':{sha256:hash,mime:'model/gltf-binary'}}}).routes;
 const versioned=routes.find(route=>route.headers?.['Cache-Control']?.includes('immutable'));assert(versioned);
 assert.equal(routes.filter(route=>route.headers?.['Cache-Control']?.includes('immutable')&&route.src.startsWith('^/works/')).length,1);
});
test('the actual Vercel config contains current model hashes and future Vite chunk policy',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../asset-source/manifest.json',import.meta.url),'utf8'));
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
 assert.deepEqual(config.routes,createRoutes(manifest).routes,'Run npm run sync:routes before committing changed assets');
 const headersFor=url=>Object.assign({},...config.routes.filter(r=>r.headers&&r.continue&&new RegExp(r.src).test(url)).map(r=>r.headers));
 assert.match(headersFor('/assets/campus-Future9h.js')['Cache-Control'],/immutable/);
 assert.match(headersFor('/works/library/performance-assets.json')['Cache-Control'],/no-cache/);
 assert.equal(headersFor('/assets/unversioned.js')['Cache-Control'],undefined);
 for(const [url,entry] of Object.entries(manifest.routes))if(/^\/works\/(library|wanyan)\/assets\/[a-f0-9]{64}\//.test(url)){
  assert.ok(url.includes('/'+entry.sha256+'/'));
  assert.match(headersFor(url)['Cache-Control'],/immutable/);
 }
});
