import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {adaptLibsql} from '../serverless/database.mjs';
import {handleActivityAPI} from '../serverless/activity-api.mjs';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
const schema=await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8');
function timeline(){
  let now=1_000_000,id=0;const jobs=new Map();
  return {now:()=>now,setTimeout(fn,ms){const key=++id;jobs.set(key,{fn,at:now+ms});return key;},clearTimeout(key){jobs.delete(key);},get active(){return jobs.size;},
    async advance(ms){const end=now+ms;for(;;){const next=[...jobs].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;jobs.delete(next[0]);now=next[1].at;await next[1].fn();await settle();}now=end;await settle();}};
}
async function fixture(t){
  const clock=timeline();t.mock.method(Date,'now',clock.now);
  const dir=await mkdtemp(path.join(tmpdir(),'campus-shared-stream-'));
  const clients=[0,1].map(()=>createClient({url:pathToFileURL(path.join(dir,'activity.db')).href,intMode:'number'}));
  const dbs=clients.map(adaptLibsql),readers=[],errors=[],queries=[];
  await dbs[0].batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>dbs[0].prepare(s)));
  for(const [instance,db] of dbs.entries()){
    const prepare=db.prepare.bind(db);db.prepare=sql=>{queries.push({instance,sql});return prepare(sql);};
  }
  const env=i=>({DB:dbs[i],STREAM_CLOCK:clock,ACTIVITY_DIAGNOSTICS:e=>errors.push(e)});
  const request=(route,i=0,options={})=>handleActivityAPI(new Request('https://shared-stream.example'+route,options),env(i));
  await request('/api/live/state');
  t.after(async()=>{await Promise.all(readers.map(reader=>reader.cancel().catch(()=>{})));await settle();clients.forEach(client=>client.close());await rm(dir,{recursive:true,force:true});});
  return {clock,dbs,errors,queries,request,
    async stream(i=0){const response=await request('/api/live/events',i);assert.equal(response.status,200);const reader=response.body.getReader();readers.push(reader);return reader;},
    async leases(){return Number((await dbs[1].prepare('SELECT COUNT(*) AS count FROM activity_connections').first()).count);},
    async change(){const row=await dbs[1].prepare('SELECT revision,payload FROM activity_state WHERE key=?').bind('current').first(),state=JSON.parse(row.payload);state.revision++;state.paused=!state.paused;await dbs[1].prepare('UPDATE activity_state SET revision=?,payload=? WHERE key=?').bind(state.revision,JSON.stringify(state),'current').run();return state.revision;},
  };
}
function consume(reader){
  const packets=[];const done=(async()=>{for(;;){const result=await reader.read();if(result.done)return;const text=new TextDecoder().decode(result.value);packets.push({name:/^event: (.+)$/m.exec(text)?.[1],data:JSON.parse(/^data: (.+)$/m.exec(text)[1])});}})();
  return {packets,done};
}

test('200 live streams share one poll timer and four lease SQLs per minute, while another instance publishes changes',{timeout:10000},async t=>{
  const f=await fixture(t),readers=await Promise.all(Array.from({length:200},()=>f.stream()));
  const streams=readers.map(consume);await settle();
  assert.ok(streams.every(s=>s.packets[0]?.name==='snapshot'));
  assert.equal(f.clock.active,201,'200 independent lifetimes plus one polling scheduler');
  const mark=f.queries.length;await f.clock.advance(60000);
  const interval=f.queries.slice(mark),leases=interval.filter(q=>q.sql.startsWith('UPDATE activity_connections'));
  assert.equal(leases.length,4,'one shared renewal each 15 seconds');
  assert.ok(leases.every(q=>(q.sql.match(/\?/g)||[]).length===201),'200 IDs plus the timestamp');
  assert.equal(interval.filter(q=>q.sql.startsWith('SELECT revision,payload FROM activity_state')).length,40);
  assert.ok(streams.every(s=>s.packets.filter(p=>p.name==='clock').length===5));
  const revision=await f.change();await f.clock.advance(1500);
  assert.ok(streams.every(s=>s.packets.filter(p=>p.name==='snapshot').at(-1).data.state.revision===revision));
  await Promise.all(readers.map(reader=>reader.cancel()));await Promise.all(streams.map(s=>s.done));
  assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);assert.deepEqual(f.errors,[]);
  t.diagnostic(JSON.stringify({streams:200,elapsedSimulatedSeconds:60,pollTimers:1,independentExpiryTimers:200,stateSelects:40,leaseUpdateStatements:4,leaseRowsRenewed:800,scope:'Real local SQLite, virtual clock; fewer statements, not fewer billed rows or a remote latency result'}));
});

test('a canceled stream cannot be resurrected by a shared lease UPDATE already in flight',async t=>{
  const f=await fixture(t),readers=await Promise.all([f.stream(),f.stream()]),streams=readers.map(consume);await settle();
  let release,reached;const gate=new Promise(resolve=>{release=resolve;}),blocked=new Promise(resolve=>{reached=resolve;});
  const prepare=f.dbs[0].prepare.bind(f.dbs[0]);
  f.dbs[0].prepare=sql=>{
    const statement=prepare(sql);if(!sql.startsWith('UPDATE activity_connections'))return statement;
    return {...statement,bind(...args){const bound=statement.bind(...args);return {...bound,async run(){reached();await gate;return bound.run();}};}};
  };
  const advancing=f.clock.advance(15000);await blocked;
  await readers[0].cancel();assert.equal(await f.leases(),1);
  release();await advancing;assert.equal(await f.leases(),1);
  assert.equal(streams[0].packets.filter(p=>p.name==='clock').length,1);
  assert.equal(streams[1].packets.filter(p=>p.name==='clock').length,2);
  await readers[1].cancel();await Promise.all(streams.map(s=>s.done));assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);
});

test('a delayed first snapshot renews an aging initial lease before sending its clock',async t=>{
  const f=await fixture(t);let release,reached;
  const gate=new Promise(resolve=>{release=resolve;}),blocked=new Promise(resolve=>{reached=resolve;});
  const prepare=f.dbs[0].prepare.bind(f.dbs[0]);
  f.dbs[0].prepare=sql=>{
    const statement=prepare(sql);if(!sql.startsWith('SELECT revision,payload FROM activity_state'))return statement;
    return {...statement,bind(...args){const bound=statement.bind(...args);return {...bound,async first(){reached();await gate;return bound.first();}};}};
  };
  const reader=await f.stream(),stream=consume(reader);await blocked;
  await f.clock.advance(20000);release();await settle();await settle();
  assert.deepEqual(stream.packets.map(p=>p.name),['snapshot','clock']);
  assert.equal(f.queries.filter(q=>q.sql.startsWith('UPDATE activity_connections')).length,1);
  const lease=await f.dbs[1].prepare('SELECT expires_at FROM activity_connections').first();
  assert.equal(lease.expires_at,f.clock.now()+45000);
  await reader.cancel();await stream.done;assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);
});

test('a stalled reader is removed without disturbing a healthy reader sharing its scheduler',async t=>{
  const f=await fixture(t),slow=await f.stream(),healthy=await f.stream(),stream=consume(healthy);await settle();
  await f.clock.advance(170000);
  await assert.rejects(slow.read(),/活动连接暂时中断/);
  assert.equal(f.errors.length,1);assert.equal(f.errors[0].code,'SLOW_CONSUMER');
  assert.equal(await f.leases(),1);assert.equal(f.clock.active,2);
  const revision=await f.change();await f.clock.advance(1500);
  assert.equal(stream.packets.filter(p=>p.name==='snapshot').at(-1).data.state.revision,revision);
  await healthy.cancel();await stream.done;assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);
});

test('shared lease failures close all affected streams and a clean scheduler can reconnect',async t=>{
  const f=await fixture(t),readers=await Promise.all([f.stream(),f.stream()]);
  await Promise.all(readers.map(reader=>reader.read()));await settle();
  const prepare=f.dbs[0].prepare.bind(f.dbs[0]);let failing=true;
  f.dbs[0].prepare=sql=>{if(failing&&sql.startsWith('UPDATE activity_connections'))throw Object.assign(Error('private URL must not escape'),{code:'SQLITE_BUSY'});return prepare(sql);};
  await f.clock.advance(15000);await Promise.all(readers.map(reader=>assert.rejects(reader.read(),/活动连接暂时中断/)));
  assert.equal(f.errors.length,2);assert.ok(f.errors.every(e=>e.phase==='lease'&&e.code==='SQLITE_BUSY'));
  assert.ok(!JSON.stringify(f.errors).includes('private'));assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);
  failing=false;const again=await f.stream();assert.match(new TextDecoder().decode((await again.read()).value),/event: snapshot/);
  await again.cancel();assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);
});

test('bulk renewals have bounded SQL parameters and do not cross database adapter instances',{timeout:10000},async t=>{
  const f=await fixture(t),readers=await Promise.all(Array.from({length:420},(_,i)=>f.stream(i<410?0:1)));
  const streams=readers.map(consume);await settle();assert.equal(f.clock.active,422);
  const mark=f.queries.length;await f.clock.advance(15000);
  const leases=f.queries.slice(mark).filter(q=>q.sql.startsWith('UPDATE activity_connections'));
  assert.deepEqual(leases.filter(q=>q.instance===0).map(q=>(q.sql.match(/\?/g)||[]).length),[201,201,11]);
  assert.deepEqual(leases.filter(q=>q.instance===1).map(q=>(q.sql.match(/\?/g)||[]).length),[11]);
  assert.ok(streams.every(s=>s.packets.filter(p=>p.name==='clock').length===2));
  await Promise.all(readers.map(reader=>reader.cancel()));await Promise.all(streams.map(s=>s.done));assert.equal(f.clock.active,0);assert.equal(await f.leases(),0);
});
