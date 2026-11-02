import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {LEARNING_BOARD} from '../src/activity-catalog.js';
if(!existsSync(new URL('../serverless/activity-api.mjs',import.meta.url))){
  test('Private message serverless contracts run in a deployment workspace',{skip:true},()=>{});
}else{
const {createClient}=await import('@libsql/client');
const {adaptLibsql}=await import('../serverless/database.mjs');
const {createActivityHandler}=await import('../serverless/handler.mjs');
const origin='https://campus.example.test',password='local-message-board-test';
test('independent serverless workers persist private messages, enforce authentication and deduplicate concurrent retries',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'message-board-api-')),url=pathToFileURL(path.join(dir,'test.db')).href;
  const clients=[createClient({url}),createClient({url})],dbs=clients.map(adaptLibsql),env={ADMIN_PASSWORD:password};
  const schema=(await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(Boolean);
  await dbs[0].batch(schema.map(sql=>dbs[0].prepare(sql)));
  let handlers=dbs.map(db=>createActivityHandler({db,env}));
  t.after(async()=>{clients.forEach(c=>c.close());await rm(dir,{recursive:true,force:true});});
  const request=(route,init={},i=0)=>handlers[i%2](new Request(origin+route,{...init,headers:{Origin:origin,'Content-Type':'application/json',...init.headers}}));
  const join=async i=>{const r=await request('/api/audience/join',{method:'POST',body:JSON.stringify({nickname:'留言同学'+i,tabId:'message-test-'+i})},i);assert.equal(r.status,200);return {cookie:r.headers.get('set-cookie').split(';')[0],...await r.json()};};
  const post=(p,input,i=0,headers={})=>request('/api/audience/events',{method:'POST',headers:{Cookie:p.cookie,'X-CSRF-Token':p.csrfToken,...headers},body:JSON.stringify(input)},i);
  const own=(p,i=0)=>request('/api/audience/learning-requests',{headers:{Cookie:p.cookie}},i).then(r=>r.json());
  const [a,b]=await Promise.all([join(1),join(2)]);
  const input={type:'learning_request',eventId:'message-concurrent-1',tabId:'message-test-1',text:'活动很好玩！\n希望下次讲 AI 视频。<img src=x onerror=alert(1)>',position:LEARNING_BOARD};
  for(const route of ['/api/audience/learning-requests','/api/admin/learning-requests'])assert.equal((await request(route)).status,401);
  assert.equal((await request('/api/admin/learning-requests',{headers:{Cookie:a.cookie}})).status,401);
  assert.equal((await post(a,input,0,{'X-CSRF-Token':''})).status,403);
  assert.equal((await post(a,input,0,{Origin:'https://other.test'})).status,403);
  assert.equal((await post(a,{...input,position:{x:0,y:0,z:0}})).status,403);
  assert.equal((await post(a,{...input,text:' '})).status,400);
  assert.equal((await post(a,{...input,text:'字'.repeat(301)})).status,400);
  // Legacy identities need no separate data migration.
  const row=await dbs[0].prepare('SELECT payload FROM activity_audiences WHERE id=?').bind(a.audience.id).first();const legacy=JSON.parse(row.payload);delete legacy.learningRequests;
  await dbs[0].prepare('UPDATE activity_audiences SET payload=? WHERE id=?').bind(JSON.stringify(legacy),a.audience.id).run();
  const writes=await Promise.all([post(a,input,0),post(a,input,1),post(b,{...input,eventId:'message-concurrent-2',text:'有没有入门资料？'},1)]);
  for(const r of writes)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await own(a,1)).messages.length,1);
  assert.equal((await own(b)).messages.length,1);
  assert.deepEqual((await own(a)).messages[0].text,input.text);
  const spoofed=await (await request('/api/audience/learning-requests?audienceId='+a.audience.id,{headers:{Cookie:b.cookie}})).json();assert.equal(spoofed.messages[0].text,'有没有入门资料？');
  assert.equal((await post(a,{...input,eventId:'fast-second-message'})).status,429);
  const login=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken;
  const admin=q=>request('/api/admin/learning-requests'+(q?'?q='+encodeURIComponent(q):''),{headers:{Cookie:cookie}},1).then(r=>r.json());
  let all=await admin();assert.equal(all.total,2);assert.equal(all.participants,2);assert.ok(!JSON.stringify(all).includes('identityHash'));
  assert.equal((await admin('AI 视频')).messages[0].nickname,'留言同学1');assert.equal((await admin('同学2')).messages.length,1);assert.equal((await admin('不存在')).messages.length,0);
  handlers=dbs.map(db=>createActivityHandler({db,env}));assert.deepEqual(await admin(),all,'messages survive replacement of both workers');
  const state=(await (await request('/api/live/state')).json()).state;
  assert.equal((await request('/api/admin/state',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({state:{...state,paused:true},expectedRevision:state.revision})})).status,200);
  assert.equal((await post(a,{...input,eventId:'paused-message'})).status,409);
  assert.equal((await (await post(a,input,1)).json()).duplicate,true,'already saved messages still acknowledge lost responses during pause');
  assert.equal((await admin()).total,2);
});
}
