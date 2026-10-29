import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {activityPortals,ACTIVITY_WORKS,getTasayPortal,SHE_LOVE_POINT_ID} from '../src/activity-catalog.js';
import {createDefaultLiveState,validateLiveState,isEventActive} from '../src/live-state.js';
import {selectActivitiesNow} from '../src/activity-launch.js';
import {createAudienceStore} from '../server/audience-store.mjs';
import {createLiveServer} from '../server/index.mjs';
const child=state=>state.portals.find(point=>point.id===SHE_LOVE_POINT_ID);
const oldState=()=>({...createDefaultLiveState(),portals:activityPortals().filter(point=>point.workId!=='she-love-me')});

test('legacy three-point state gains a linked Einstein entry without changing existing controls',()=>{
  const legacy=oldState();legacy.revision=42;legacy.paused=true;legacy.skyQrVisible=true;
  Object.assign(getTasayPortal(legacy.portals),{x:75,z:23,label:'保留地点',enabled:true,startAt:100,endAt:200});
  const original=structuredClone(legacy),next=validateLiveState(legacy),linked=child(next);
  assert.deepEqual(next.portals.slice(0,3),original.portals);assert.deepEqual(legacy,original);
  assert.equal(next.revision,42);assert.equal(next.paused,true);assert.equal(next.skyQrVisible,true);
  assert.deepEqual({x:linked.x,z:linked.z,radius:linked.radius},{x:848.45,z:-61.39,radius:6});
  assert.deepEqual([linked.enabled,linked.startAt,linked.endAt],[true,100,200]);
  assert.equal(linked.url,'/works/she-love-me/');assert.equal(linked.workId,'she-love-me');
  assert.equal(ACTIVITY_WORKS.find(work=>work.id==='she-love-me').ready,'page_opened');
  assert.deepEqual(validateLiveState(next),next,'projection is idempotent');
});

test('linked entry preserves edited location and cannot escape the master schedule or missing master',()=>{
  const state=oldState();Object.assign(getTasayPortal(state.portals),{enabled:true,startAt:100,endAt:200});
  const linked={...activityPortals().at(-1),x:999,z:-888,radius:9,label:'用户位置',enabled:false,startAt:700,endAt:800};
  state.portals.push(linked);const next=validateLiveState(state);
  assert.deepEqual([child(next).x,child(next).z,child(next).radius,child(next).label],[999,-888,9,'用户位置']);
  for(const time of [99,100,199,200])assert.equal(isEventActive(child(next),time),isEventActive(getTasayPortal(next.portals),time));
  const orphan=validateLiveState({...state,portals:[{...linked,enabled:true}]});
  assert.deepEqual([child(orphan).enabled,child(orphan).startAt,child(orphan).endAt],[false,null,null]);
  assert.deepEqual(validateLiveState(createDefaultLiveState()).portals,[]);
  assert.equal(validateLiveState({...state,portals:state.portals.filter(point=>point.workId==='library')}).portals.length,1);
});

test('automatic migration never exceeds twelve points, removes custom points or creates duplicate ids',()=>{
  const state=oldState();while(state.portals.length<12)state.portals.push({...state.portals[0],id:'custom-'+state.portals.length,workId:'custom'});
  assert.deepEqual(validateLiveState(state).portals,state.portals);
  assert.equal(child(validateLiveState(state)),undefined);
  assert.equal(validateLiveState({...state,portals:state.portals.slice(0,-1)}).portals.length,12);
  assert.throws(()=>validateLiveState({...state,portals:[...state.portals,{...state.portals[0],id:'overflow'}]}),/最多 12/);
  const blocked=oldState();blocked.markers=[{id:SHE_LOVE_POINT_ID,label:'既有光柱',x:0,z:0,color:'#ffffff',enabled:false,height:40,radius:3}];
  assert.equal(child(validateLiveState(blocked)),undefined);
  const malformed=oldState();getTasayPortal(malformed.portals).enabled='true';assert.throws(()=>validateLiveState(malformed),/启用状态/);
});

test('one-click selection treats the linked point as dependent and never silently closes its master',()=>{
  const points=activityPortals().map(point=>({...point,startAt:100,endAt:200}));
  const opened=selectActivitiesNow(points,['point-tasay']);
  assert.deepEqual(opened.map(point=>point.enabled),[false,false,true,true]);
  for(const point of opened.slice(2))assert.deepEqual([point.startAt,point.endAt],[null,null]);
  assert.throws(()=>selectActivitiesNow(opened,[SHE_LOVE_POINT_ID]),/随过拟合恋人/);
  assert.throws(()=>selectActivitiesNow(opened.filter(point=>point.workId!=='tasay'),[SHE_LOVE_POINT_ID]),/随过拟合恋人/);
  assert.ok(selectActivitiesNow(opened,[]).every(point=>!point.enabled));
});

test('Node reads an old saved state without rewriting it and uses the linked projection for guarded admission',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'linked-node-test-')),dataDir=path.join(root,'data');await mkdir(dataDir);
  const state=oldState();state.revision=7;getTasayPortal(state.portals).enabled=true;
  const file=path.join(dataDir,'live-state.json'),bytes=JSON.stringify(state)+'\n';await writeFile(file,bytes);
  const password='temporary-linked-state-test',app=await createLiveServer({rootDir:root,dataDir,password,workRouter:async()=>false});
  const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
  const request=(url,init={})=>fetch(origin+url,{...init,headers:{Origin:origin,'Content-Type':'application/json',...init.headers}});
  const first=(await (await request('/api/live/state')).json()).state;
  assert.equal(first.revision,7);assert.equal(child(first).enabled,true);assert.equal(await readFile(file,'utf8'),bytes);
  const join=await request('/api/audience/join',{method:'POST',body:JSON.stringify({nickname:'联动测试',tabId:'tab'})});assert.equal(join.status,200);
  const audience={cookie:join.headers.get('set-cookie').split(';')[0],...await join.json()};let sequence=0;
  const event=type=>request('/api/audience/events',{method:'POST',headers:{Cookie:audience.cookie,'X-CSRF-Token':audience.csrfToken},body:JSON.stringify({type,eventId:`event-${++sequence}`,tabId:'tab',pointId:SHE_LOVE_POINT_ID,workId:'she-love-me',attemptId:'opening-'+sequence,position:{x:child(first).x,y:0,z:child(first).z}})});
  assert.equal((await event('visit')).status,200);
  const login=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password})});const admin={cookie:login.headers.get('set-cookie').split(';')[0],...await login.json()};
  const closed={...first,portals:first.portals.map(point=>point.workId==='tasay'?{...point,enabled:false}:point)};
  const save=await request('/api/admin/state',{method:'PUT',headers:{Cookie:admin.cookie,'X-CSRF-Token':admin.csrfToken},body:JSON.stringify({state:closed,expectedRevision:7})});assert.equal(save.status,200);const saved=(await save.json()).state;
  assert.equal(child(saved).enabled,false);assert.equal((await event('opening')).status,409);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved);
  const restarted=await createLiveServer({rootDir:root,dataDir,password,workRouter:async()=>false});t.after(()=>restarted.close());assert.deepEqual(restarted.getState(),saved);
});

test('queued Node audience events recheck a linked closure when their operation actually begins',async()=>{
  let release,blocked=false;const store=createAudienceStore({idFactory:()=> 'viewer',persist:async()=>{if(blocked)await new Promise(resolve=>{release=resolve;});}});
  await store.join({identityHash:'a'.repeat(64),nickname:'排队测试',tabId:'tab'});
  let points=selectActivitiesNow(activityPortals(),['point-tasay']);const point=points.find(point=>point.id===SHE_LOVE_POINT_ID);
  blocked=true;const preceding=store.heartbeat('viewer','tab');while(!release)await new Promise(resolve=>setImmediate(resolve));
  const queued=store.event('viewer',{eventId:'queued',type:'opening',tabId:'tab',pointId:point.id,attemptId:'attempt',position:{x:point.x,y:0,z:point.z}},()=>({points,paused:false}));
  const rejection=assert.rejects(queued,/未开放/);points=selectActivitiesNow(points,[]);blocked=false;release();await preceding;await rejection;
  assert.deepEqual(store.get('viewer').attempts,{});
});
