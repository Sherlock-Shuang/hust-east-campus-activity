import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {adaptLibsql,createTursoDatabase} from '../serverless/database.mjs';
import {createActivityHandler} from '../serverless/handler.mjs';
import {createNodeActivityHandler} from '../serverless/node-handler.mjs';
import * as api from '../serverless/activity-api.mjs';
const PASSWORD='local-vercel-api-test-only';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const schema=await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8');
function timerClock(){
  let now=Date.now(),id=0;const tasks=new Map();
  return {now:()=>now,setTimeout(fn,ms){const key=++id;tasks.set(key,{fn,at:now+ms});return key;},clearTimeout(key){tasks.delete(key);},get active(){return tasks.size;},
    async advance(ms){const end=now+ms;for(;;){const next=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;tasks.delete(next[0]);now=next[1].at;await next[1].fn();await settle();}now=end;await settle();}};
}
async function fixture(t,{clock,diagnostics}={}){
  const dir=await mkdtemp(path.join(tmpdir(),'campus-vercel-test-'));
  const url=pathToFileURL(path.join(dir,'activity.db')).href,clients=[createClient({url,intMode:'number'}),createClient({url,intMode:'number'})],dbs=clients.map(adaptLibsql),env={ADMIN_PASSWORD:PASSWORD};
  await dbs[0].batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>dbs[0].prepare(s)));
  let handlers=dbs.map(db=>createActivityHandler({env,db,streamClock:clock,diagnostics}));
  const readers=[];t.after(async()=>{await Promise.all(readers.map(r=>r.cancel().catch(()=>{})));clients.forEach(c=>c.close());await rm(dir,{recursive:true,force:true});});
  const origin='https://campus.example.test';
  const request=(url,init={},server=0)=>handlers[server](new Request(origin+url,{...init,headers:{Origin:origin,'Content-Type':'application/json','x-vercel-forwarded-for':'192.0.2.1',...init.headers}}));
  const login=async()=>{const r=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:PASSWORD})});assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrfToken};};
  const join=async(name,tabId,cookie,server=0)=>{const r=await request('/api/audience/join',{method:'POST',headers:cookie?{Cookie:cookie}:{},body:JSON.stringify({nickname:name,tabId})},server);assert.equal(r.status,200,await r.clone().text());return {cookie:r.headers.get('set-cookie').split(';')[0],...await r.json()};};
  const post=(a,event,server=0)=>request('/api/audience/events',{method:'POST',headers:{Cookie:a.cookie,'X-CSRF-Token':a.csrfToken},body:JSON.stringify(event)},server);
  const admin=await login(),stats=()=>request('/api/admin/audience',{headers:{Cookie:admin.cookie}},1).then(r=>r.json());
  const save=async state=>{const response=await request('/api/admin/state',{method:'PUT',headers:{Cookie:admin.cookie,'X-CSRF-Token':admin.csrf},body:JSON.stringify({state,expectedRevision:state.revision})});assert.equal(response.status,200,await response.clone().text());return (await response.json()).state;};
  const enableAll=async()=>{const {state}=await (await request('/api/live/state')).json();return save({...state,portals:state.portals.map(p=>({...p,enabled:true}))});};
  return {request,join,post,stats,save,enableAll,admin,dbs,api,env,origin,nodeHandler:()=>createNodeActivityHandler({activity:handlers[0]}),async stream(server=0){const response=await request('/api/live/events',{},server);assert.equal(response.status,200);const reader=response.body.getReader();readers.push(reader);return reader;},async restart(){handlers=dbs.map(db=>createActivityHandler({env,db,streamClock:clock}));}};
}

test('Turso configuration rejects local filesystem production URLs and missing credentials',()=>{
  assert.throws(()=>createTursoDatabase({}),/configuration/);
  assert.throws(()=>createTursoDatabase({TURSO_DATABASE_URL:'file:/tmp/private.db',TURSO_AUTH_TOKEN:'test'}),/remote/);
});
test('serverless sky QR state uses the shared boolean schema and survives handler replacement',async t=>{
  const f=await fixture(t),initial=(await (await f.request('/api/live/state')).json()).state;
  assert.equal(initial.skyQrVisible,false);
  const invalid=await f.request('/api/admin/state',{method:'PUT',headers:{Cookie:f.admin.cookie,'X-CSRF-Token':f.admin.csrf},body:JSON.stringify({state:{...initial,skyQrVisible:'true'},expectedRevision:initial.revision})});
  assert.equal(invalid.status,400);
  const shown=await f.save({...initial,skyQrVisible:true});assert.equal(shown.skyQrVisible,true);
  await f.restart();
  assert.deepEqual((await (await f.request('/api/live/state',{},1)).json()).state,shown);
  const hidden=await f.save({...shown,skyQrVisible:false});assert.equal(hidden.skyQrVisible,false);
  await f.restart();
  assert.deepEqual((await (await f.request('/api/live/state',{},1)).json()).state,hidden);
});
test('two independent libSQL clients preserve identity, admin sessions, revision CAS and origin protection',async t=>{
  const f=await fixture(t),initial=await (await f.request('/api/live/state')).json();
  assert.deepEqual(initial.state.portals.map(p=>p.workId),['library','wanyan','tasay','she-love-me']);
  assert.ok(initial.state.portals.every(p=>p.enabled===false));
  assert.equal((await f.request('/api/admin/audience')).status,401);
  const a=await f.join('同名','one'),b=await f.join('同名','one',undefined,1),again=await f.join('同名','two',a.cookie,1);
  assert.notEqual(a.audience.id,b.audience.id);assert.equal(a.audience.id,again.audience.id);
  assert.equal((await f.request('/api/audience/heartbeat',{method:'POST',headers:{Cookie:a.cookie},body:'{"tabId":"one"}'})).status,403);
  assert.equal((await f.request('/api/audience/heartbeat',{method:'POST',headers:{Origin:'https://other.test',Cookie:a.cookie,'X-CSRF-Token':a.csrfToken},body:'{"tabId":"one"}'})).status,403);
  const save=server=>f.request('/api/admin/state',{method:'PUT',headers:{Cookie:f.admin.cookie,'X-CSRF-Token':f.admin.csrf},body:JSON.stringify({state:{...initial.state,paused:true},expectedRevision:0})},server);
  assert.deepEqual((await Promise.all([save(0),save(1)])).map(r=>r.status).sort(),[200,409]);
  await f.restart();const stats=await f.stats();assert.equal(stats.summary.totalParticipants,2);assert.equal(stats.summary.onlineParticipants,2);assert.ok(!JSON.stringify(stats).includes('identityHash'));
  const me=await (await f.request('/api/audience/me',{headers:{Cookie:a.cookie}},1)).json();assert.equal(me.audience.id,a.audience.id);
  const quota=await f.request('/api/works/tasay/default/chat/completions',{method:'POST',body:'{}'});assert.equal(quota.status,401);
  const config=await f.request('/api/works/tasay/default/chat/completions',{method:'POST',headers:{Cookie:a.cookie},body:'{}'});assert.equal(config.status,503);
});
test('simultaneous tabs retain every attempt and do not turn failed loads into opened works',async t=>{
  const f=await fixture(t),viewer=await f.join('多窗口','one'),point=(await f.enableAll()).portals[0];
  const base={pointId:point.id,workId:point.workId,position:{x:point.x,y:0,z:point.z}};
  await Promise.all(Array.from({length:6},async(_,i)=>{for(const [j,type] of ['visit','opening',i===5?'open_failed':'opened'].entries()){
    const r=await f.post(viewer,{...base,type,eventId:`event-${i}-${j}`,tabId:`tab-${i}`,attemptId:`attempt-${i}`},i%2);assert.equal(r.status,200,await r.text());
  }}));
  const result=await f.stats();assert.equal(result.summary.totalParticipants,1);assert.equal(result.summary.currentParticipants,1);assert.equal(result.summary.points[0].visitors,1);assert.equal(result.participants[0].currentExperiences.length,5);
  const duplicate=await f.post(viewer,{...base,type:'opened',eventId:'event-0-2',tabId:'tab-0',attemptId:'attempt-0'},1);assert.equal((await duplicate.json()).duplicate,true);
});
test('100 audiences, 100 SSE connections and 340 events aggregate correctly across two handlers',async t=>{
  const f=await fixture(t),start=performance.now(),latencies=[],points=(await f.enableAll()).portals;
  const viewers=await Promise.all(Array.from({length:100},(_,i)=>f.join(`观众${i}`,`tab-${i}`,undefined,i%2)));
  const readers=await Promise.all(viewers.map((_,i)=>f.stream(i%2)));await Promise.all(readers.map(r=>r.read()));
  const live=await (await f.request('/api/live/state')).json();assert.equal(live.onlineAudienceCount,100);assert.equal(live.onlineCount,100);
  await Promise.all(viewers.map(async(viewer,i)=>{const point=points[i%3],base={pointId:point.id,workId:point.workId,position:{x:point.x,y:0,z:point.z},tabId:`tab-${i}`,attemptId:`attempt-${i}`};
    for(const [j,type] of ['visit','opening',i%5===0?'open_failed':'opened',...(i%5!==0&&i%2===0?['returned']:[])].entries()){
      const before=performance.now(),response=await f.post(viewer,{...base,type,eventId:`event-${i}-${j}`},i%2);latencies.push(performance.now()-before);assert.equal(response.status,200,await response.text());
    }
  }));
  const stats=await f.stats();assert.equal(stats.summary.totalParticipants,100);assert.deepEqual(stats.summary.points.map(p=>p.visitors),[34,33,33,0]);assert.equal(stats.summary.works.reduce((n,w)=>n+w.openedParticipants,0),80);assert.equal(stats.summary.currentParticipants,40);
  await Promise.all(readers.map(r=>r.cancel()));assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count,0);
  latencies.sort((a,b)=>a-b);t.diagnostic(JSON.stringify({environment:'local libSQL SQLite with two clients/handlers; not Turso network or WebGL',audiences:100,sseConnections:100,eventRequests:latencies.length,totalMs:Math.round(performance.now()-start),eventP95Ms:Math.round(latencies[Math.floor(latencies.length*.95)])}));
});
test('SSE reaches its real 240-second lifecycle, removes both timers/lease and reconnects with a snapshot',async t=>{
  const clock=timerClock(),f=await fixture(t,{clock}),reader=await f.stream();assert.equal(f.api.STREAM_LIFETIME_MS,240000);
  assert.match(new TextDecoder().decode((await reader.read()).value),/event: snapshot/);await settle();
  const consume=(async()=>{for(;;){if((await reader.read()).done)return;}})();
  assert.equal(clock.active,2);
  await clock.advance(239999);assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count,1);
  await clock.advance(1);await consume;
  await settle();assert.equal(clock.active,0);assert.equal((await f.dbs[1].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count,0);
  const again=await f.stream(1);assert.match(new TextDecoder().decode((await again.read()).value),/event: snapshot/);await again.cancel();assert.equal(clock.active,0);
});
test('model quota conditional INSERT stays atomic across clients, caps day totals and never charges rejected requests',async t=>{
  const f=await fixture(t),day=86400000,now=Math.floor(2000000000000/day)*day+12*3600000;
  const quota=(id,time=now,i=0)=>f.api.consumeModelQuota(id,{DB:f.dbs[i%2]},{now:time});
  const results=await Promise.all(Array.from({length:30},(_,i)=>quota('one',now,i)));assert.equal(results.filter(Boolean).length,6);
  for(let minute=1;minute<=6;minute++){const values=await Promise.all(Array.from({length:6},(_,i)=>quota('one',now+minute*61000,i)));assert.equal(values.filter(Boolean).length,minute===6?4:6);}
  assert.equal(await quota('one',now+600000),false);
  await f.dbs[0].batch(Array.from({length:459},(_,i)=>f.dbs[0].prepare('INSERT INTO activity_login_attempts (ip_hash,count,until) VALUES (?,1,?)').bind(`model:seed:${i}`,now+day)));
  const final=await Promise.all(Array.from({length:30},(_,i)=>quota(`other-${i}`,now+600000,i)));assert.equal(final.filter(Boolean).length,1);
  assert.equal((await f.dbs[1].prepare("SELECT COUNT(*) AS count FROM activity_login_attempts WHERE ip_hash LIKE 'model:%'").first()).count,500);
  assert.equal(await quota('one',now+day),true);
});


test('real Node wrapper preserves rewritten API paths, JSON bodies, cookies, filters and SSE disconnect cleanup',async t=>{
  const f=await fixture(t),server=http.createServer(f.nodeHandler());
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const call=(route,init={})=>fetch(origin+'/api/activity?__activity_path='+route,{...init,headers:{Origin:origin,'x-forwarded-proto':'http','Content-Type':'application/json',...init.headers}});
  const initial=await (await call('live/state')).json();assert.equal(initial.state.portals.length,4);
  const login=await call('admin/login',{method:'POST',body:JSON.stringify({password:PASSWORD})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
  const join=await call('audience/join',{method:'POST',body:JSON.stringify({nickname:'Wrapper viewer',tabId:'wrapper-tab'})});assert.equal(join.status,200);assert.match(join.headers.get('set-cookie'),/HttpOnly/);
  const found=await (await call('admin/audience&q=Wrapper',{headers:{Cookie:cookie}})).json();assert.equal(found.participants.length,1);
  const excluded=await (await call('admin/audience&q=absent',{headers:{Cookie:cookie}})).json();assert.equal(excluded.participants.length,0);
  const stream=await call('live/events'),reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: snapshot/);await reader.cancel();
  for(let i=0;i<20;i++){if((await f.dbs[0].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count===0)break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count,0);
});


test('host admission survives handler restart and closed activities reject new visits/openings without deleting past records',async t=>{
  const f=await fixture(t),viewer=await f.join('主持人开关测试','one');
  let state=(await (await f.request('/api/live/state')).json()).state;
  const point=state.portals[0],base={pointId:point.id,workId:point.workId,tabId:'one',attemptId:'first',position:{x:point.x,y:0,z:point.z}};let n=0;
  const event=(type,extra={})=>f.post(viewer,{...base,type,eventId:`gate-${++n}`,...extra},n%2);
  assert.equal((await event('visit')).status,409);assert.equal((await f.stats()).summary.points[0].visitors,0);
  state=await f.save({...state,portals:state.portals.map(p=>({...p,enabled:p.id===point.id}))});
  await f.restart();assert.equal((await (await f.request('/api/live/state',{},1)).json()).state.portals[0].enabled,true);
  for(const type of ['visit','opening','opened'])assert.equal((await event(type)).status,200);
  state=await f.save({...state,portals:state.portals.map(p=>({...p,enabled:false}))});
  assert.equal((await event('visit')).status,409);assert.equal((await event('opening',{attemptId:'second'})).status,409);
  assert.equal((await event('returned')).status,200);
  await f.restart();const stats=await f.stats();assert.equal(stats.summary.points[0].visitors,1);assert.equal(stats.summary.works[0].openedParticipants,1);assert.equal(stats.summary.currentParticipants,0);
  assert.ok((await (await f.request('/api/live/state',{},1)).json()).state.portals.every(p=>!p.enabled));
});

test('old production rows project a fourth linked point for snapshots, SSE, statistics and audience admission',async t=>{
  const f=await fixture(t),initial=(await (await f.request('/api/live/state')).json()).state,now=Date.now();
  const legacy={...initial,revision:17,portals:initial.portals.filter(point=>point.workId!=='she-love-me').map(point=>point.workId==='tasay'?{...point,enabled:true,startAt:now-1000,endAt:now+600000,x:71,z:31}:point)};
  const raw=JSON.stringify(legacy);await f.dbs[0].prepare('UPDATE activity_state SET revision=?,payload=? WHERE key=?').bind(17,raw,'current').run();
  await f.restart();
  let current=(await (await f.request('/api/live/state',{},1)).json()).state;
  const linked=()=>current.portals.find(point=>point.id==='point-she-love-me');
  assert.equal(current.revision,17);assert.equal(current.portals.length,4);assert.deepEqual(current.portals.slice(0,3),legacy.portals);
  assert.deepEqual([linked().enabled,linked().startAt,linked().endAt],[true,now-1000,now+600000]);
  assert.equal((await f.dbs[1].prepare('SELECT payload FROM activity_state WHERE key=?').bind('current').first()).payload,raw,'reads do not rewrite the old database');
  const reader=await f.stream(1),packet=new TextDecoder().decode((await reader.read()).value);assert.equal(JSON.parse(/^data: (.+)$/m.exec(packet)[1]).state.portals.length,4);await reader.cancel();
  const viewer=await f.join('独立广场观众','einstein');let sequence=0;
  const event=(type='opening')=>f.post(viewer,{type,eventId:'event-'+ ++sequence,tabId:'einstein',pointId:'point-she-love-me',workId:'she-love-me',attemptId:'attempt-'+sequence,position:{x:linked().x,y:0,z:linked().z}},1);
  assert.equal((await event('visit')).status,200,'visit only the independent square point');
  assert.equal((await event()).status,200,'no tasay visit or completion is required');
  assert.ok((await f.stats()).summary.points.some(point=>point.id==='point-she-love-me'));
  current=await f.save({...current,portals:current.portals.map(point=>point.workId==='tasay'?{...point,startAt:now+60000,endAt:now+120000}:point)});
  assert.deepEqual([linked().startAt,linked().endAt],[now+60000,now+120000]);assert.equal((await event()).status,409);
  current=await f.save({...current,portals:current.portals.map(point=>point.workId==='tasay'?{...point,enabled:false}:point.workId==='she-love-me'?{...point,enabled:true,startAt:null,endAt:null,x:850}:point)});
  assert.equal(linked().enabled,false);assert.equal(linked().x,850);assert.equal((await event()).status,409);
  const stale=await f.request('/api/admin/state',{method:'PUT',headers:{Cookie:f.admin.cookie,'X-CSRF-Token':f.admin.csrf},body:JSON.stringify({state:legacy,expectedRevision:17})});assert.equal(stale.status,409);
  current=await f.save({...current,paused:true,portals:current.portals.map(point=>point.workId==='tasay'?{...point,enabled:true,startAt:null,endAt:null}:point)});
  assert.equal(linked().enabled,true);assert.equal((await event()).status,409,'pause continues to block both entries');
  current=await f.save({...current,paused:false,portals:current.portals.filter(point=>point.workId!=='tasay')});
  assert.equal(linked().enabled,false);assert.equal((await event()).status,409,'deleting the master cannot leave the dependency open');
  await f.restart();assert.deepEqual((await (await f.request('/api/live/state',{},1)).json()).state,current);
});

test('SSE public-state bursts coalesce without caching identity, admin authentication or fresh snapshots',async t=>{
  const f=await fixture(t),live=await f.enableAll();
  const db=f.dbs[0],prepare=db.prepare.bind(db);let stateReads=0;
  db.prepare=sql=>{if(sql==='SELECT revision,payload FROM activity_state WHERE key=?')stateReads++;return prepare(sql);};
  const readers=await Promise.all(Array.from({length:40},()=>f.stream(0)));
  const snapshots=await Promise.all(readers.map(async reader=>{
    const packet=new TextDecoder().decode((await reader.read()).value);return JSON.parse(/^data: (.+)$/m.exec(packet)[1]);
  }));
  assert.ok(stateReads<=2,`40 concurrent streams used ${stateReads} state reads`);
  assert.ok(snapshots.every(s=>s.state.revision===live.revision));
  const before=stateReads;await f.request('/api/live/state');assert.equal(stateReads,before+1,'public GET always reads the committed database');
  const saved=await f.save({...live,paused:true});
  assert.equal((await (await f.request('/api/live/state')).json()).state.revision,saved.revision);
  await db.prepare('DELETE FROM activity_admin_sessions').run();
  assert.equal((await f.request('/api/admin/audience',{headers:{Cookie:f.admin.cookie}})).status,401,'cached public state cannot keep a deleted admin session alive');
  const viewer=await f.join('缓存不包含身份','cache-tab');
  await db.prepare('DELETE FROM activity_audiences WHERE id=?').bind(viewer.audience.id).run();
  assert.equal((await (await f.request('/api/audience/me',{headers:{Cookie:viewer.cookie}})).json()).audience,null);
  await Promise.all(readers.map(reader=>reader.cancel()));
});

test('public stream caches cannot cross database environments even when origins and cookie names match',async t=>{
  const a=await fixture(t),b=await fixture(t);let state=(await (await a.request('/api/live/state')).json()).state;
  state=await a.save({...state,paused:true});
  const readers=await Promise.all([a.stream(),b.stream()]);
  const snapshots=await Promise.all(readers.map(async reader=>{
    const packet=new TextDecoder().decode((await reader.read()).value);return JSON.parse(/^data: (.+)$/m.exec(packet)[1]).state;
  }));
  assert.equal(snapshots[0].revision,state.revision);assert.equal(snapshots[0].paused,true);
  assert.equal(snapshots[1].revision,0);assert.equal(snapshots[1].paused,false);
  await Promise.all(readers.map(reader=>reader.cancel()));
});

test('clock renewals do not count viewers repeatedly and public counts remain fresh',async t=>{
  const clock=timerClock(),f=await fixture(t,{clock});let counts=0;
  const prepare=f.dbs[0].prepare.bind(f.dbs[0]);f.dbs[0].prepare=sql=>{if(sql.startsWith('SELECT COUNT'))counts++;return prepare(sql);};
  const reader=await f.stream();await reader.read();await settle();const afterStart=counts;
  await clock.advance(46000);assert.equal(counts,afterStart,'lease and clock need no repeated global COUNT');
  await f.request('/api/live/state');assert.equal(counts,afterStart+2,'explicit public stats read fresh counts');
  await reader.cancel();assert.equal(clock.active,0);
});

test('a transient stream database failure is classified, cleans its lease, and reconnects',async t=>{
  const clock=timerClock(),diagnostics=[],f=await fixture(t,{clock,diagnostics:e=>diagnostics.push(e)});
  const reader=await f.stream();await reader.read();await settle();
  const prepare=f.dbs[0].prepare.bind(f.dbs[0]);let fail=true;
  f.dbs[0].prepare=sql=>{if(fail&&sql.startsWith('SELECT revision'))throw Object.assign(Error('secret database URL must not be logged'),{code:'SQLITE_BUSY'});return prepare(sql);};
  await clock.advance(1600);await assert.rejects(reader.read(),/活动连接暂时中断/);
  assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].phase,'state-read');assert.equal(diagnostics[0].code,'SQLITE_BUSY');
  assert.ok(!JSON.stringify(diagnostics).includes('secret'));assert.equal(clock.active,0);
  assert.equal((await prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count,0);
  fail=false;const again=await f.stream();assert.match(new TextDecoder().decode((await again.read()).value),/snapshot/);await again.cancel();
});

test('a non-reading SSE client has a bounded queue and releases its lease',async t=>{
  const clock=timerClock(),events=[],f=await fixture(t,{clock,diagnostics:e=>events.push(e)});
  const reader=await f.stream();await settle();await clock.advance(170000);
  assert.equal(events.at(-1)?.code,'SLOW_CONSUMER');assert.equal(clock.active,0);
  assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count,0);
  await assert.rejects(reader.read(),/活动连接暂时中断/);
});
