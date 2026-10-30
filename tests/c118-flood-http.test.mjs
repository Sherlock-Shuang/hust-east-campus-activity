import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLiveServer} from '../server/index.mjs';
import {getC118FloodElapsed} from '../src/c118-flood-state.js';

async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'c118-flood-test-'));let time=100000;
  const app=await createLiveServer({rootDir:root,password:'c118-test-only-password',now:()=>time,heartbeatMs:60000});
  const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const request=(url,init={})=>fetch(origin+url,{...init,headers:{'Content-Type':'application/json',Origin:origin,...init.headers}});
  const loginResponse=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:'c118-test-only-password'})});
  const session={Cookie:loginResponse.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await loginResponse.json()).csrfToken};
  const save=(state,headers=session)=>request('/api/admin/state',{method:'PUT',headers,body:JSON.stringify({state,expectedRevision:state.revision})});
  const read=async()=>(await (await request('/api/live/state')).json()).state;
  return {root,app,origin,request,session,save,read,setTime:v=>time=v};
}
async function stream(t,origin){
  const controller=new AbortController(),response=await fetch(origin+'/api/live/events',{signal:controller.signal});
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  t.after(()=>controller.abort());
  return {async next(){
    while(true){
      let end;
      while((end=buffer.indexOf('\n\n'))!==-1){
        const packet=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(/^event: snapshot$/m.test(packet))return JSON.parse(/^data: (.+)$/m.exec(packet)[1]);
      }
      const result=await reader.read();if(result.done)throw new Error('SSE ended');buffer+=decoder.decode(result.value,{stream:true});
    }
  }};
}

test('host flood writes stay authorized and synchronize one durable clock across both rooms', {timeout:15000}, async t=>{
  const f=await fixture(t),a=await stream(t,f.origin),b=await stream(t,f.origin);
  const initial=(await a.next()).state;await b.next();
  const wanted={...initial,c118Flood:{id:'flood-one',startAt:999999,pausedAt:null,pausedMs:0}};
  assert.equal((await f.save(wanted,{})).status,401);
  assert.equal((await f.save(wanted,{Cookie:f.session.Cookie})).status,403);
  assert.equal((await f.save(wanted,{...f.session,Origin:'https://wrong.example'})).status,403);
  assert.equal((await f.save({...wanted,c118Flood:{...wanted.c118Flood,startAt:Infinity}})).status,400);
  assert.equal((await f.read()).c118Flood,null);
  const startedResponse=await f.save(wanted);assert.equal(startedResponse.status,200);
  const started=(await startedResponse.json()).state;
  assert.deepEqual(started.c118Flood,{id:'flood-one',startAt:103000,pausedAt:null,pausedMs:0});
  const [roomA,roomB]=await Promise.all([a.next(),b.next()]);
  assert.deepEqual(roomA.state.c118Flood,roomB.state.c118Flood);assert.deepEqual(roomA.state,started);
  assert.equal(getC118FloodElapsed(roomA.state.c118Flood,105500),2.5);
  assert.equal(getC118FloodElapsed(roomB.state.c118Flood,105500),2.5);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root,'server-data/live-state.json'),'utf8')),started);
  const late=await stream(t,f.origin);assert.deepEqual((await late.next()).state.c118Flood,started.c118Flood);
  const stale=await f.save(wanted);assert.equal(stale.status,409);

  f.setTime(109000);
  const pausedResponse=await f.save({...started,paused:true,c118Flood:{...started.c118Flood,startAt:1,pausedMs:888}});
  const paused=(await pausedResponse.json()).state;
  assert.deepEqual(paused.c118Flood,{id:'flood-one',startAt:103000,pausedAt:109000,pausedMs:0});
  await Promise.all([a.next(),b.next(),late.next()]);
  assert.equal(getC118FloodElapsed(paused.c118Flood,200000),6);
  f.setTime(119000);
  const {c118Flood,...legacy}=paused;
  const resumedResponse=await f.save({...legacy,paused:false,pauseMessage:'普通管理员编辑'});
  const resumed=(await resumedResponse.json()).state;
  assert.deepEqual(resumed.c118Flood,{id:'flood-one',startAt:103000,pausedAt:null,pausedMs:10000});
  const [ra,rb]=await Promise.all([a.next(),b.next()]);await late.next();
  assert.deepEqual(ra.state.c118Flood,rb.state.c118Flood);assert.equal(getC118FloodElapsed(ra.state.c118Flood,120000),7);
  f.setTime(121000);
  const resetResponse=await f.save({...resumed,c118Flood:null});assert.equal(resetResponse.status,200);
  const reset=(await resetResponse.json()).state;
  assert.equal(reset.c118Flood,null);
  for(const snapshot of await Promise.all([a.next(),b.next(),late.next()]))assert.equal(snapshot.state.c118Flood,null);
  assert.equal((await f.read()).c118Flood,null);
});
