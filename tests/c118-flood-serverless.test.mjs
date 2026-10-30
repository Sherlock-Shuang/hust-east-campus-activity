import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {adaptLibsql} from '../serverless/database.mjs';
import {createActivityHandler} from '../serverless/handler.mjs';
import {getC118FloodElapsed} from '../src/c118-flood-state.js';

const schema=await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function timeline(){
  let now=1000000,id=0;const tasks=new Map();
  return {now:()=>now,setTimeout(fn,ms){const key=++id;tasks.set(key,{fn,at:now+ms});return key;},clearTimeout(key){tasks.delete(key);},
    async advance(ms){const end=now+ms;for(;;){const next=[...tasks].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;tasks.delete(next[0]);now=next[1].at;await next[1].fn();await settle();}now=end;await settle();}};
}
async function fixture(t){
  const clock=timeline();t.mock.method(Date,'now',clock.now);
  const dir=await mkdtemp(path.join(tmpdir(),'c118-serverless-test-'));
  const url=pathToFileURL(path.join(dir,'activity.db')).href;
  const clients=[createClient({url,intMode:'number'}),createClient({url,intMode:'number'})],dbs=clients.map(adaptLibsql),readers=[];
  t.after(async()=>{await Promise.all(readers.map(reader=>reader.cancel().catch(()=>{})));clients.forEach(client=>client.close());await rm(dir,{recursive:true,force:true});});
  await dbs[0].batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>dbs[0].prepare(s)));
  const env={ADMIN_PASSWORD:'c118-serverless-test-only'};
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
const requested=id=>({id,startAt:99999999,pausedAt:8888,pausedMs:9999});

test('serverless flood uses one server timeline across independent SQLite handlers, SSE and late arrivals',{timeout:10000},async t=>{
  const f=await fixture(t),initial=await f.read(),a=await f.stream(0),b=await f.stream(1);
  assert.equal(initial.c118Flood,null);await Promise.all([a.next(),b.next()]);
  const started=await f.save({...initial,c118Flood:requested('one')});
  assert.deepEqual(started.c118Flood,{id:'one',startAt:1003000,pausedAt:null,pausedMs:0});
  await f.clock.advance(1500);
  for(const snapshot of await Promise.all([a.next(),b.next()]))assert.deepEqual(snapshot.state.c118Flood,started.c118Flood);
  await f.clock.advance(4500);
  const paused=await f.save({...started,paused:true,c118Flood:requested('one')},1);
  assert.deepEqual(paused.c118Flood,{id:'one',startAt:1003000,pausedAt:1006000,pausedMs:0});
  await f.clock.advance(6000);
  for(const snapshot of await Promise.all([a.next(),b.next()]))assert.equal(getC118FloodElapsed(snapshot.state.c118Flood,f.clock.now()),3);
  const {c118Flood,...legacy}=paused;
  const resumed=await f.save({...legacy,paused:false},1);
  assert.deepEqual(resumed.c118Flood,{id:'one',startAt:1003000,pausedAt:null,pausedMs:6000});
  const edited=await f.save({...resumed,pauseMessage:'unrelated edit',c118Flood:requested('one')});
  assert.deepEqual(edited.c118Flood,resumed.c118Flood);
  await f.clock.advance(2000);
  f.restart();
  const late=await f.stream(1),lateState=(await late.next()).state;
  assert.deepEqual(lateState.c118Flood,edited.c118Flood);
  assert.equal(getC118FloodElapsed(lateState.c118Flood,f.clock.now()),5);
  const persisted=JSON.parse((await f.dbs[1].prepare('SELECT payload FROM activity_state WHERE key=?').bind('current').first()).payload);
  assert.deepEqual(persisted,edited);
  const reset=await f.save({...edited,c118Flood:null},1);
  await f.clock.advance(1500);
  assert.equal((await late.next()).state.c118Flood,null);
  assert.equal(reset.c118Flood,null);assert.equal((await f.read()).c118Flood,null);
});

test('serverless flood guards authorization and concurrent reset/start writes without trusting client stamps',{timeout:10000},async t=>{
  const f=await fixture(t),initial=await f.read(),wanted={...initial,c118Flood:requested('one')};
  assert.equal((await f.put(wanted,{auth:{}})).status,401);
  assert.equal((await f.put(wanted,{auth:{Cookie:f.headers.Cookie}})).status,403);
  assert.equal((await f.put(wanted,{auth:{...f.headers,Origin:'https://wrong.example'}})).status,403);
  assert.equal((await f.put({...wanted,c118Flood:{...requested('one'),pausedMs:-1}})).status,400);
  const starts=await Promise.all([f.put(wanted),f.put({...wanted,c118Flood:requested('two')},{server:1})]);
  assert.deepEqual(starts.map(r=>r.status).sort(),[200,409]);
  const active=await f.read();assert.equal(active.c118Flood.startAt,1003000);
  const stale=await f.put({...initial,c118Flood:null});assert.equal(stale.status,409);
  assert.deepEqual((await stale.json()).state.c118Flood,active.c118Flood);
  const attempts=await Promise.all([f.put({...active,c118Flood:null}),f.put({...active,c118Flood:requested('replacement')},{server:1})]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  const winning=(await attempts.find(r=>r.status===200).json()).state;
  assert.deepEqual(await f.read(1),winning);
  // Starting while already paused must preserve the full three-second lead.
  const paused=await f.save({...winning,paused:true,c118Flood:requested('paused-start')});
  await f.clock.advance(20000);
  assert.equal(getC118FloodElapsed(paused.c118Flood,f.clock.now()),-3);
  const resumed=await f.save({...paused,paused:false},1);
  assert.equal(getC118FloodElapsed(resumed.c118Flood,f.clock.now()),-3);
});

test('legacy persisted state gains a null flood field without writing or changing its revision',async t=>{
  const f=await fixture(t),initial=await f.read(),{c118Flood,...legacy}=initial;
  legacy.revision=17;const raw=JSON.stringify(legacy);
  await f.dbs[0].prepare('UPDATE activity_state SET revision=?,payload=? WHERE key=?').bind(17,raw,'current').run();
  const projected=await f.read(1);assert.equal(projected.revision,17);assert.equal(projected.c118Flood,null);
  const stored=await f.dbs[0].prepare('SELECT revision,payload FROM activity_state WHERE key=?').bind('current').first();
  assert.equal(stored.revision,17);assert.equal(stored.payload,raw);
});

test('a competing write between the flood read and SQL commit cannot restore an obsolete timeline',{timeout:10000},async t=>{
  const f=await fixture(t),initial=await f.read();
  const active=await f.save({...initial,c118Flood:requested('original')});
  let notify,release;
  const reached=new Promise(resolve=>{notify=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const prepare=f.dbs[0].prepare.bind(f.dbs[0]);
  t.mock.method(f.dbs[0],'prepare',sql=>{
    const statement=prepare(sql);
    if(!sql.startsWith('UPDATE activity_state SET revision=?,payload=?'))return statement;
    return {...statement,bind(...args){const bound=statement.bind(...args);return {...bound,async run(){notify();await gate;return bound.run();}};}};
  });
  // The old console has read the active event and calculated a pause, but has
  // not yet committed. Another function resets the room at that same revision.
  const {c118Flood,...legacy}=active;
  const pending=f.put({...legacy,paused:true});await reached;
  const reset=await f.save({...active,c118Flood:null},1);
  release();const stale=await pending;assert.equal(stale.status,409);
  assert.deepEqual((await stale.json()).state,reset);
  assert.deepEqual(await f.read(1),reset);
});
