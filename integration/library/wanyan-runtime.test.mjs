import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {loadWanyanRuntime,WANYAN_RUNTIME_FILES} from './wanyan-runtime.mjs';

async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'wanyan-skill-runtime-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(path.join(dir,'Build'));
 const provenance={schemaVersion:1,bridgeVersion:1,files:[]};
 for(const file of WANYAN_RUNTIME_FILES){const bytes=Buffer.from(file.endsWith('framework.js')?'window.bookrealmNativeSkill={}':file);await writeFile(path.join(dir,file),bytes);provenance.files.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
 await writeFile(path.join(dir,'provenance.json'),JSON.stringify(provenance));return {dir,provenance};
}
test('only four verified runtime files are exposed; source metadata stays private',async t=>{
 const {dir,provenance}=await fixture(t);provenance.privateSource='/private/original-gift';await writeFile(path.join(dir,'provenance.json'),JSON.stringify(provenance));
 const loaded=await loadWanyanRuntime(dir);assert.equal(loaded.files.size,4);assert.equal(loaded.provenance.privateSource,undefined);assert.equal(loaded.provenance.bridgeVersion,1);
});
test('partial or stale builds fail rather than silently shipping a dark skill button',async t=>{
 const {dir,provenance}=await fixture(t);await writeFile(path.join(dir,'Build/wanyan.wasm'),'corrupted');await assert.rejects(loadWanyanRuntime(dir),/fingerprint mismatch/);
 provenance.files.push(provenance.files[0]);await writeFile(path.join(dir,'provenance.json'),JSON.stringify(provenance));await assert.rejects(loadWanyanRuntime(dir),/exactly one/);
 await assert.rejects(loadWanyanRuntime(path.join(dir,'missing')),/Missing activity Unity build/);
});
test('runtime symlinks cannot publish files from outside the build',async t=>{
 const {dir}=await fixture(t),outside=path.join(dir,'..',path.basename(dir)+'-outside');t.after(()=>rm(outside,{force:true}));await writeFile(outside,'secret');await rm(path.join(dir,'Build/wanyan.data'));await symlink(outside,path.join(dir,'Build/wanyan.data'));await assert.rejects(loadWanyanRuntime(dir),/escapes/);
});
