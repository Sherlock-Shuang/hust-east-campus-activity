import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveServer} from '../server/index.mjs';

test('standalone project supports GET, HEAD, redirect and only its explicit public assets',async t=>{
  const dataDir=await mkdtemp(path.join(tmpdir(),'she-love-route-'));
  const app=await createLiveServer({dataDir,password:'isolated-route-test-password',workEnv:{}});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  const {port}=await app.listen(0),base=`http://127.0.0.1:${port}`;
  const redirect=await fetch(base+'/works/she-love-me?campusAttempt=test',{redirect:'manual'});
  assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),'/works/she-love-me/?campusAttempt=test');
  for(const [file,mime]of [['','text/html'],['index.html','text/html'],['project.css','text/css'],['project.js','text/javascript'],['analyzer.js','text/javascript'],['demo.js','text/javascript'],['LICENSE.txt','text/plain']]){
    const r=await fetch(base+'/works/she-love-me/'+file);assert.equal(r.status,200,file);assert.ok(r.headers.get('content-type').startsWith(mime));
    assert.equal(r.headers.get('cache-control'),'no-cache');assert.ok((await r.text()).length>0);
    const head=await fetch(base+'/works/she-love-me/'+file,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
  for(const suffix of ['missing.js','.env','src/main.js','api/upload'])assert.equal((await fetch(base+'/works/she-love-me/'+suffix)).status,404);
  assert.equal((await fetch(base+'/works/she-love-me/',{method:'POST',body:'unused'})).status,405);
  assert.equal((await fetch(base+'/works/unknown/')).status,404);
  const input={method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'};
  assert.equal((await fetch(base+'/api/works/she-love-me/analyze',input)).status,401);
  assert.equal((await fetch(base+'/api/works/she-love-me/import',input)).status,401);
  const joined=await fetch(base+'/api/audience/join',{...input,body:JSON.stringify({nickname:'隔离测试',tabId:'she-love-qa'})});
  assert.equal(joined.status,200);const cookie=joined.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/works/she-love-me/analyze',{...input,headers:{...input.headers,Cookie:cookie}})).status,400);
  assert.equal((await fetch(base+'/api/works/she-love-me/import',{...input,headers:{...input.headers,Cookie:cookie}})).status,400);

});
