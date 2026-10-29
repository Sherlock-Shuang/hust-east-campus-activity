import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createLiveServer} from '../server/index.mjs';
import {createDefaultLiveState,validateLiveState} from '../src/live-state.js';

const PASSWORD='test-password-for-campus-2026';
async function fixture(t,options={}){
  const root=await mkdtemp(path.join(tmpdir(),'campus-live-test-')),dataDir=path.join(root,'data'),distDir=path.join(root,'dist');
  await mkdir(distDir);await writeFile(path.join(distDir,'index.html'),'<h1>Campus</h1>');await writeFile(path.join(distDir,'admin.html'),'<h1>Control</h1>');
  const app=await createLiveServer({rootDir:root,dataDir,distDir,password:PASSWORD,heartbeatMs:60000,...options});
  const address=await app.listen(0);const origin=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const request=(url,init={})=>fetch(origin+url,{...init,headers:{'Content-Type':'application/json',Origin:origin,...init.headers}});
  const login=async()=>{const response=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:PASSWORD})});assert.equal(response.status,200);return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:(await response.json()).csrfToken};};
  const save=(session,state,revision=state.revision)=>request('/api/admin/state',{method:'PUT',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf},body:JSON.stringify({state,expectedRevision:revision})});
  return {app,root,dataDir,origin,request,login,save};
}
async function stream(origin){
  const controller=new AbortController();const response=await fetch(origin+'/api/live/events',{signal:controller.signal});assert.equal(response.status,200);
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  return{close(){controller.abort();},async next(event='snapshot'){
    const deadline=Date.now()+3000;
    while(Date.now()<deadline){
      let end;
      while((end=buffer.indexOf('\n\n'))!==-1){
        const packet=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const kind=/^event: (.+)$/m.exec(packet)?.[1],data=/^data: (.+)$/m.exec(packet)?.[1];
        if(kind===event)return JSON.parse(data);
      }
      const result=await Promise.race([reader.read(),new Promise((_,reject)=>{const id=setTimeout(()=>reject(new Error('SSE timeout')),3000);id.unref();})]);
      if(result.done)throw new Error('SSE ended');buffer+=decoder.decode(result.value,{stream:true});
    }throw new Error('SSE timeout');
  }};
}

test('sky QR visibility defaults to hidden for old states and accepts only booleans',()=>{
  const state=createDefaultLiveState();assert.equal(state.skyQrVisible,false);
  const {skyQrVisible,...legacy}=state;
  assert.equal(validateLiveState(legacy).skyQrVisible,false);
  assert.equal(Object.hasOwn(legacy,'skyQrVisible'),false,'normalization does not mutate the saved input');
  for(const visible of [true,false])assert.equal(validateLiveState({...state,skyQrVisible:visible}).skyQrVisible,visible);
  for(const invalid of [null,'true','false',0,1,[],{},new Boolean(true)]){
    assert.throws(()=>validateLiveState({...state,skyQrVisible:invalid}),/天空二维码显示状态/);
  }
});

test('legacy disk state loads with the sky QR hidden without rewriting the saved activity',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'campus-legacy-qr-test-')),dataDir=path.join(root,'data');
  await mkdir(dataDir);
  const {skyQrVisible,...legacy}=createDefaultLiveState();legacy.revision=7;
  const source=JSON.stringify(legacy)+'\n',file=path.join(dataDir,'live-state.json');
  await writeFile(file,source);
  const app=await createLiveServer({rootDir:root,dataDir,password:PASSWORD});
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  assert.equal(app.getState().skyQrVisible,false);assert.equal(app.getState().revision,7);
  assert.equal(await readFile(file,'utf8'),source);
});

test('admin sky QR toggles stay guarded, durable and synchronized through the existing SSE channel',async t=>{
  const f=await fixture(t),client=await stream(f.origin);t.after(()=>client.close());
  const initial=(await client.next()).state;assert.equal(initial.skyQrVisible,false);
  const visible={...initial,skyQrVisible:true},body=JSON.stringify({state:visible,expectedRevision:initial.revision});
  assert.equal((await f.request('/api/admin/state',{method:'PUT',body})).status,401);
  const session=await f.login();
  assert.equal((await f.request('/api/admin/state',{method:'PUT',headers:{Cookie:session.cookie},body})).status,403);
  assert.equal((await f.request('/api/admin/state',{method:'PUT',headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,Origin:'https://other.test'},body})).status,403);
  for(const invalid of [null,'true',1])assert.equal((await f.save(session,{...initial,skyQrVisible:invalid})).status,400);
  assert.deepEqual((await (await f.request('/api/live/state')).json()).state,initial);

  const shownResponse=await f.save(session,visible);assert.equal(shownResponse.status,200);
  const shown=(await shownResponse.json()).state;
  assert.equal(shown.skyQrVisible,true);assert.equal(shown.revision,1);
  assert.deepEqual((await client.next()).state,shown);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir,'live-state.json'),'utf8')),shown);
  const restarted=await createLiveServer({rootDir:f.root,dataDir:f.dataDir,password:PASSWORD});t.after(()=>restarted.close());
  assert.deepEqual(restarted.getState(),shown);
  const reconnected=await stream(f.origin);t.after(()=>reconnected.close());
  assert.equal((await reconnected.next()).state.skyQrVisible,true);

  const stale=await f.save(session,{...initial,skyQrVisible:false});assert.equal(stale.status,409);
  assert.equal((await stale.json()).state.skyQrVisible,true);
  const hiddenResponse=await f.save(session,{...shown,skyQrVisible:false});assert.equal(hiddenResponse.status,200);
  const hidden=(await hiddenResponse.json()).state;
  assert.equal(hidden.skyQrVisible,false);assert.equal(hidden.revision,2);
  assert.deepEqual((await client.next()).state,hidden);assert.deepEqual((await reconnected.next()).state,hidden);
  assert.deepEqual((await (await f.request('/api/live/state')).json()).state,hidden);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir,'live-state.json'),'utf8')),hidden);
});
