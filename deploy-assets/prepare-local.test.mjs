import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,link,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareLocal} from './prepare-local.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
test('local prestart restores real work mappings and skips verified existing files',async t=>{
  const root=await mkdtemp(path.join(here,'.local-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,'asset-source'),workAssets=path.join(root,'work-assets');await mkdir(path.join(source,'chunks'),{recursive:true});
  let fixtureSource=path.join(here,'asset-source');try{await stat(fixtureSource);}catch(error){if(error.code!=='ENOENT')throw error;fixtureSource=path.join(here,'../asset-source');}
  const original=JSON.parse(await readFile(path.join(fixtureSource,'manifest.json'),'utf8'));
  await writeFile(path.join(source,'manifest.json'),JSON.stringify(original));
  for(const name of await readdir(path.join(fixtureSource,'chunks')))await link(path.join(fixtureSource,'chunks',name),path.join(source,'chunks',name));
  const first=await prepareLocal({assetSource:source,workAssets});assert.equal(first.prepared,true);
  const library=JSON.parse(await readFile(path.join(workAssets,'library-manifest.json'),'utf8'));
  assert.equal(library.schemaVersion,1);assert(library.entries.some(e=>e.url==='/works/library/api/games'&&e.file==='library/api/games.json'));
  assert(library.entries.some(e=>e.url==='/works/library/games/isaac/'));
  for(const file of ['library/model.glb','library/hero.glb','wanyan/Build/wanyan.wasm','wanyan/Build/wanyan.data','tasay/index.html'])assert((await stat(path.join(workAssets,file))).size>0,file);
  const model=path.join(workAssets,'library/model.glb'),mtime=(await stat(model)).mtimeMs;
  const second=await prepareLocal({assetSource:source,workAssets});assert.equal(second.prepared,false);assert.equal((await stat(model)).mtimeMs,mtime,'verified files are not rewritten/decompressed');
  const index=path.join(workAssets,'tasay/index.html'),bytes=await readFile(index);bytes[bytes.length-1]^=1;await writeFile(index,bytes);
  const repair=await prepareLocal({assetSource:source,workAssets});assert.equal(repair.prepared,true);assert.equal(repair.reason,'missing-or-invalid-file');
  const stable=await prepareLocal({assetSource:source,workAssets});assert.equal(stable.prepared,false);
  await writeFile(path.join(source,'manifest.json'),JSON.stringify({...original,localVerification:'new manifest fingerprint'}));
  const changed=await prepareLocal({assetSource:source,workAssets});assert.equal(changed.prepared,true);assert.notEqual(changed.fingerprint,first.fingerprint);
  assert(!(await readdir(workAssets)).some(name=>name.startsWith('.local-restore-')||name.endsWith('.lock')),'temporary restore and lock are removed');
});
