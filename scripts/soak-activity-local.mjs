// Real wall-clock HTTP/SSE soak using ONLY a freshly-created local SQLite DB.
// No .env is loaded, and there is no remote-URL option. This intentionally does
// not test CDN/model downloads, WebGL devices or production Turso latency.
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {adaptLibsql} from '../serverless/database.mjs';
import {createActivityHandler} from '../serverless/handler.mjs';
import {createNodeActivityHandler} from '../serverless/node-handler.mjs';

const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const durationSeconds=Math.max(5,Math.min(3600,Number(option('--seconds','1800'))||1800));
const audienceCount=Math.max(2,Math.min(100,Number(option('--audiences','100'))||100));
const output=path.resolve(option('--output','artifacts/optimization-2026-10-30/activity-soak.json'));
const directory=await mkdtemp(path.join(tmpdir(),'campus-isolated-soak-'));
const url=pathToFileURL(path.join(directory,'activity.db')).href;
const password='isolated-soak-local-only-password';
const clients=[createClient({url,intMode:'number'}),createClient({url,intMode:'number'})];
const databaseQueries={total:0,stateReads:0,counts:0,writes:0};
for(const client of clients){
  const execute=client.execute.bind(client);
  client.execute=(statement,...rest)=>{
    const sql=typeof statement==='string'?statement:statement.sql;
    databaseQueries.total++;
    if(sql.startsWith('SELECT revision,payload FROM activity_state'))databaseQueries.stateReads++;
    if(sql.startsWith('SELECT COUNT'))databaseQueries.counts++;
    if(/^(UPDATE|INSERT|DELETE)/.test(sql))databaseQueries.writes++;
    return execute(statement,...rest);
  };
}
const dbs=clients.map(adaptLibsql),schema=await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8');
await dbs[0].batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>dbs[0].prepare(s)));
const handlers=dbs.map(db=>createNodeActivityHandler({activity:createActivityHandler({env:{ADMIN_PASSWORD:password},db})}));
const server=http.createServer((req,res)=>handlers[Number(req.headers['x-soak-instance'])===1?1:0](req,res));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const startedAt=new Date().toISOString(),started=performance.now(),deadline=started+durationSeconds*1000;
const metrics={apiRequests:0,errors:[],transientErrors:[],eventLatencies:[],hostLatencies:[],heartbeats:0,snapshots:0,clockFrames:0,connectionsOpened:0,rotationCloses:0,deliberateReconnects:0,cycles:0};
const phaseSummaries=[],streamStates=[],commands=new Map();let ending=false,admin,state;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values,p)=>{if(!values.length)return null;const sorted=[...values].sort((a,b)=>a-b);return Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)].toFixed(2));};
function summary(){return {elapsedSeconds:Number(((performance.now()-started)/1000).toFixed(1)),databaseQueries:{...databaseQueries},apiRequests:metrics.apiRequests,errors:metrics.errors.length,transientErrors:metrics.transientErrors.length,snapshots:metrics.snapshots,connectionsOpened:metrics.connectionsOpened,rotationCloses:metrics.rotationCloses,deliberateReconnects:metrics.deliberateReconnects,eventP95Ms:percentile(metrics.eventLatencies,.95),hostP95Ms:percentile(metrics.hostLatencies,.95)};}
async function call(route,{method='GET',payload,identity,instance=0}={}){
  const before=performance.now();let response;
  const retrySafe=method==='GET'||route==='/api/audience/heartbeat'||(route==='/api/audience/events'&&typeof payload?.eventId==='string');
  for(let attempt=0;attempt<2;attempt++){
    metrics.apiRequests++;
    try{
      response=await fetch(origin+route,{method,signal:AbortSignal.timeout(15000),headers:{Origin:origin,'x-forwarded-proto':'http','x-soak-instance':String(instance),'Content-Type':'application/json',...(identity?{Cookie:identity.cookie,'X-CSRF-Token':identity.csrfToken}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
      break;
    }catch(error){
      const record={route,code:error.cause?.code||error.name,message:error.cause?.message||error.message,atSeconds:Math.round((performance.now()-started)/1000)};
      if(!retrySafe||attempt){metrics.errors.push(record);throw new Error(`${route}: ${record.code}: ${record.message}`);}
      metrics.transientErrors.push(record);await sleep(100);
    }
  }
  const data=await response.json();
  assert.equal(response.status,200,`${route}: ${response.status} ${data.error||''}`);
  if(route==='/api/audience/events')metrics.eventLatencies.push(performance.now()-before);
  return {...data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function save(patch){
  const next={...state,...patch},revision=state.revision+1;commands.set(revision,{at:performance.now(),received:new Set()});
  const result=await call('/api/admin/state',{method:'PUT',identity:admin,payload:{state:next,expectedRevision:state.revision},instance:metrics.cycles%2});state=result.state;
}
function received(stream,kind,data){
  if(kind==='clock'){metrics.clockFrames++;return;}
  if(kind!=='snapshot')return;
  metrics.snapshots++;assert.ok(data.state.revision>=stream.lastRevision,'stream revision moved backwards');stream.lastRevision=data.state.revision;
  const command=commands.get(data.state.revision);
  if(command&&!command.received.has(stream.id)){command.received.add(stream.id);metrics.hostLatencies.push(performance.now()-command.at);}
}
async function watch(stream){
  while(!ending){
    const abort=new AbortController();stream.abort=abort;
    try{
      const response=await fetch(origin+'/api/live/events',{signal:abort.signal,headers:{'x-forwarded-proto':'http','x-soak-instance':String(stream.instance)}});
      assert.equal(response.status,200);metrics.connectionsOpened++;
      const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
      for(;;){
        const packet=await reader.read();if(packet.done){if(!ending)metrics.rotationCloses++;break;}
        pending+=decoder.decode(packet.value,{stream:true});
        let at;while((at=pending.indexOf('\n\n'))>=0){const block=pending.slice(0,at);pending=pending.slice(at+2);
          const kind=/^event: (.+)$/m.exec(block)?.[1],raw=/^data: (.+)$/m.exec(block)?.[1];if(raw)received(stream,kind,JSON.parse(raw));}
      }
    }catch(error){if(!ending&&!abort.signal.aborted)metrics.errors.push({kind:'stream',message:error.message,atSeconds:Math.round((performance.now()-started)/1000)});}
    if(!ending)await sleep(50);
  }
}
let tasks=[],result;
try{
  admin=await call('/api/admin/login',{method:'POST',payload:{password}});
  state=(await call('/api/live/state')).state;
  await save({portals:state.portals.map(p=>({...p,enabled:true}))});
  const viewers=await Promise.all(Array.from({length:audienceCount},(_,i)=>call('/api/audience/join',{method:'POST',payload:{nickname:`隔离压测-${i}`,tabId:`tab-${i}`},instance:i%2})));
  for(let i=0;i<audienceCount;i++){const stream={id:i,instance:i%2,lastRevision:-1};streamStates.push(stream);tasks.push(watch(stream));}
  const expectedVisitors=[0,0,0],expectedOpened=[0,0,0];
  await Promise.all(viewers.map(async(viewer,i)=>{
    const point=state.portals[i%3],base={pointId:point.id,workId:point.workId,position:{x:point.x,y:0,z:point.z},tabId:`tab-${i}`,attemptId:`attempt-${i}`};
    expectedVisitors[i%3]++;
    for(const [j,type] of['visit','opening',i%5===0?'open_failed':'opened',...(i%5!==0?['returned']:[])].entries()){
      await call('/api/audience/events',{method:'POST',identity:viewer,instance:i%2,payload:{...base,type,eventId:`event-${i}-${j}`}});
    }
    if(i%5!==0)expectedOpened[i%3]++;
    // Replayed visit must not inflate unique visitors or append another record.
    const duplicate=await call('/api/audience/events',{method:'POST',identity:viewer,instance:(i+1)%2,payload:{...base,type:'visit',eventId:`event-${i}-0`}});assert.equal(duplicate.duplicate,true);
  }));
  // A second tab retains each of ten identities; this must not add people.
  await Promise.all(viewers.slice(0,10).map((viewer,i)=>call('/api/audience/join',{method:'POST',identity:viewer,instance:1,payload:{nickname:`隔离压测-${i}`,tabId:`extra-${i}`}})));
  let nextHeartbeat=performance.now(),nextControl=performance.now()+1000,nextSummary=performance.now()+60000,nextReconnect=performance.now()+180000;
  while(performance.now()<deadline){
    const now=performance.now();
    if(now>=nextHeartbeat){
      await Promise.all(viewers.map((viewer,i)=>call('/api/audience/heartbeat',{method:'POST',identity:viewer,instance:i%2,payload:{tabId:`tab-${i}`}})));metrics.heartbeats+=audienceCount;nextHeartbeat=performance.now()+15000;
    }
    if(now>=nextControl){
      metrics.cycles++;
      await save({paused:metrics.cycles%4===2,phase:{id:metrics.cycles%2?'gather':'explore',label:metrics.cycles%2?'集合':'自由探索',guidance:metrics.cycles%2?'隔离验收集合':'隔离验收探索'}});
      nextControl=performance.now()+60000;
    }
    if(now>=nextReconnect){
      for(let i=0;i<Math.min(10,streamStates.length);i++){streamStates[i].abort.abort();metrics.deliberateReconnects++;}
      nextReconnect=performance.now()+180000;
    }
    if(now>=nextSummary){const report=summary();phaseSummaries.push(report);console.log(JSON.stringify(report));nextSummary=performance.now()+60000;}
    await sleep(Math.min(1000,Math.max(1,deadline-performance.now())));
  }
  if(state.paused)await save({paused:false});
  const stats=await call('/api/admin/audience',{identity:admin,instance:1});
  assert.equal(stats.summary.totalParticipants,audienceCount);assert.equal(stats.summary.onlineParticipants,audienceCount);
  assert.deepEqual(stats.summary.points.slice(0,3).map(p=>p.visitors),expectedVisitors);
  assert.deepEqual(stats.summary.works.slice(0,3).map(w=>w.openedParticipants),expectedOpened);
  assert.equal(stats.summary.currentParticipants,0);
  assert.equal(metrics.errors.length,0);
  if(durationSeconds>=300)assert.ok(metrics.rotationCloses>=audienceCount-10,'uninterrupted SSE clients rotate after their real 240-second lifetime');
  result={passed:true,...summary(),startedAt,durationSeconds,audienceCount,nodeVersion:process.version,instanceCount:2,expectedVisitors,expectedOpened,summary:stats.summary,clockFrames:metrics.clockFrames,heartbeats:metrics.heartbeats,phaseSummaries,errors:metrics.errors,transientErrors:metrics.transientErrors,scope:'Actual localhost HTTP/SSE, two serverless handlers and two SQLite clients sharing a fresh local DB. No production traffic, physical devices, GPU or CDN throughput test.'};
}catch(error){result={passed:false,...summary(),startedAt,durationSeconds,audienceCount,nodeVersion:process.version,error:error.message,errors:metrics.errors,transientErrors:metrics.transientErrors,phaseSummaries};process.exitCode=1;}
finally{
  ending=true;for(const stream of streamStates)stream.abort?.abort();await Promise.allSettled(tasks);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await sleep(100);
  const remaining=await dbs[0].prepare('SELECT COUNT(*) AS count FROM activity_connections').first();result.remainingConnectionLeases=Number(remaining.count);
  if(result.remainingConnectionLeases){result.passed=false;process.exitCode=1;}
  clients.forEach(client=>client.close());await rm(directory,{recursive:true,force:true});
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({completed:true,...summary(),passed:result.passed,output}));
}
