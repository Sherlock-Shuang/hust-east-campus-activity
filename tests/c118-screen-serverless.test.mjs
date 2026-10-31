import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {adaptLibsql} from '../serverless/database.mjs';
import {createActivityHandler} from '../serverless/handler.mjs';

const schema=await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function timeline(){
  let now=1000000,id=0;const tasks=new Map();
  return {now:()=>now,setTimeout(fn,ms){const key=++id;tasks.set(key,{fn,at:now+ms});return key;},clearTimeout(key){tasks.delete(key);},
    async advance(ms){const end=now+ms;for(;;){const next=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;tasks.delete(next[0]);now=next[1].at;await next[1].fn();await settle();}now=end;await settle();}};
}
async function fixture(t){
  const clock=timeline();t.mock.method(Date,'now',clock.now);
  const dir=await mkdtemp(path.join(tmpdir(),'c118-screen-serverless-'));
  const url=pathToFileURL(path.join(dir,'activity.db')).href;
  const clients=[createClient({url,intMode:'number'}),createClient({url,intMode:'number'})],dbs=clients.map(adaptLibsql),readers=[];
  t.after(async()=>{await Promise.all(readers.map(reader=>reader.cancel().catch(()=>{})));clients.forEach(client=>client.close());await rm(dir,{recursive:true,force:true});});
  await dbs[0].batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>dbs[0].prepare(s)));
  const env={ADMIN_PASSWORD:'c118-screen-serverless-only'};
  let handlers=dbs.map(db=>createActivityHandler({env,db,streamClock:clock}));
  const origin='https://c118.example.test';
  const request=(url,init={},server=0)=>handlers[server](new Request(origin+url,{...init,headers:{Origin:origin,'Content-Type':'application/json',...init.headers}}));
  const login=await request('/api/admin/login',{method:'POST',body:JSON.stringify({password:env.ADMIN_PASSWORD})});assert.equal(login.status,200);
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':(await login.json()).csrfToken};
  const read=async(server=0)=>(await (await request('/api/live/state',{},server)).json()).state;
  const put=(state,{server=0,auth=headers,revision=state.revision}={})=>request('/api/admin/state',{method:'PUT',headers:auth,body:JSON.stringify({state,expectedRevision:revision})},server);
  const save=async(state,server=0)=>{const response=await put(state,{server});assert.equal(response.status,200,await response.clone().text());return (await response.json()).state;};
  async function stream(server){
    const response=await request('/api/live/events',{},server);assert.equal(response.status,200);
    const reader=response.body.getReader();readers.push(reader);let buffer='';const decoder=new TextDecoder();
    return {async next(){for(;;){let end;while((end=buffer.indexOf('\n\n'))!==-1){const packet=buffer.slice(0,end);buffer=buffer.slice(end+2);if(/^event: snapshot$/m.test(packet))return JSON.parse(/^data: (.+)$/m.exec(packet)[1]);}const result=await reader.read();if(result.done)throw Error('SSE ended before snapshot');buffer+=decoder.decode(result.value,{stream:true});}}};
  }
  return {clock,dbs,read,put,save,headers,stream,restart(){handlers=dbs.map(db=>createActivityHandler({env,db,streamClock:clock}));}};
}

test('screen commands reach independent handlers and SSE viewers, survive restart, and preserve old-client saves',{timeout:10000},async t=>{
  const f=await fixture(t),initial=await f.read(),a=await f.stream(0),b=await f.stream(1);
  await Promise.all([a.next(),b.next()]);
  assert.deepEqual(initial.c118Screen,{mediaId:'vibe-coding',revision:0});
  const selected=await f.save({...initial,c118Screen:{mediaId:'club-promo',revision:1}});
  await f.clock.advance(1500);
  for(const snapshot of await Promise.all([a.next(),b.next()]))assert.deepEqual(snapshot.state.c118Screen,selected.c118Screen);
  const {c118Screen,...legacy}=selected;
  const ordinary=await f.save({...legacy,paused:true},1);
  assert.deepEqual(ordinary.c118Screen,c118Screen);
  const repeated=await f.save({...ordinary,c118Screen:{...c118Screen,revision:2}},1);
  assert.deepEqual(repeated.c118Screen,{mediaId:'club-promo',revision:2});
  const updated=await f.save({...repeated,paused:false});assert.deepEqual(updated.c118Screen,repeated.c118Screen);
  f.restart();const late=await f.stream(1);
  assert.deepEqual((await late.next()).state.c118Screen,repeated.c118Screen);
  const persisted=JSON.parse((await f.dbs[1].prepare('SELECT payload FROM activity_state WHERE key=?').bind('current').first()).payload);
  assert.deepEqual(persisted,updated);
});

test('screen commands reject unauthorized, arbitrary media, skipped revisions and concurrent stale requests',{timeout:10000},async t=>{
  const f=await fixture(t),initial=await f.read(),wanted={...initial,c118Screen:{mediaId:'club-promo',revision:1}};
  assert.equal((await f.put(wanted,{auth:{}})).status,401);
  assert.equal((await f.put(wanted,{auth:{Cookie:f.headers.Cookie}})).status,403);
  assert.equal((await f.put(wanted,{auth:{...f.headers,Origin:'https://wrong.example'}})).status,403);
  assert.equal((await f.put({...wanted,c118Screen:{mediaId:'https://untrusted.example/video.mp4',revision:1}})).status,400);
  assert.equal((await f.put({...wanted,c118Screen:{mediaId:'club-promo',revision:500}})).status,400);
  const results=await Promise.all([f.put(wanted),f.put({...wanted,c118Screen:{mediaId:'vibe-coding',revision:1}},{server:1})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=(await results.find(r=>r.status===200).json()).state;
  assert.equal(winner.c118Screen.revision,1);assert.deepEqual(await f.read(1),winner);
  const opposite=winner.c118Screen.mediaId==='club-promo'?'vibe-coding':'club-promo';
  assert.equal((await f.put({...winner,c118Screen:{mediaId:opposite,revision:1}})).status,400);
  assert.deepEqual(await f.read(),winner);
});

test('old persisted activity state projects the default screen without rewriting the database',async t=>{
  const f=await fixture(t),initial=await f.read(),{c118Screen,...legacy}=initial;
  legacy.revision=17;const raw=JSON.stringify(legacy);
  await f.dbs[0].prepare('UPDATE activity_state SET revision=?,payload=? WHERE key=?').bind(17,raw,'current').run();
  const projected=await f.read(1);assert.equal(projected.revision,17);assert.deepEqual(projected.c118Screen,{mediaId:'vibe-coding',revision:0});
  const stored=await f.dbs[0].prepare('SELECT revision,payload FROM activity_state WHERE key=?').bind('current').first();
  assert.equal(stored.revision,17);assert.equal(stored.payload,raw);
});

test('host Codex text broadcasts to separate hall clients, persists through restart and rejects stale text edits',{timeout:10000},async t=>{
 const f=await fixture(t),initial=await f.read(),a=await f.stream(0),b=await f.stream(1);await Promise.all([a.next(),b.next()]);
 const wanted={...initial,c118Screen:{mediaId:'codex',revision:1,codexText:'第一条 Codex 内容\n可回复 <script>普通文字</script>'}};
 assert.equal((await f.put(wanted,{auth:{}})).status,401);
 const sent=await f.save(wanted);await f.clock.advance(1500);
 for(const s of await Promise.all([a.next(),b.next()]))assert.deepEqual(s.state.c118Screen,wanted.c118Screen);
 assert.equal((await f.put({...sent,c118Screen:{...sent.c118Screen,codexText:'同版本替换'}})).status,400);
 const second=await f.save({...sent,c118Screen:{...sent.c118Screen,revision:2,codexText:'第二条'}});
 assert.equal((await f.put({...second,c118Screen:{...second.c118Screen,revision:3,codexText:'x'.repeat(4001)}})).status,400);
 f.restart();assert.deepEqual((await f.read(1)).c118Screen,second.c118Screen);
});
