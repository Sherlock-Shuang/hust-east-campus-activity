import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {GOMOKU_POINT} from '../src/gomoku-rules.js';
if(!existsSync(new URL('../serverless/activity-api.mjs',import.meta.url))){
  test('Gomoku serverless contracts run in the deployment workspace',{skip:true},()=>{});
}else{
const {createClient}=await import('@libsql/client');
const {adaptLibsql}=await import('../serverless/database.mjs');
const {createActivityHandler}=await import('../serverless/handler.mjs');
const origin='https://campus.example.test',password='local-gomoku-api-test';
async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'gomoku-api-')),url=pathToFileURL(path.join(dir,'test.db')).href;
  const clients=[createClient({url}),createClient({url})],dbs=clients.map(adaptLibsql),env={ADMIN_PASSWORD:password};
  // Deliberately install the old schema: the new endpoint must migrate itself.
  const schema=(await readFile(new URL('../serverless/schema.sql',import.meta.url),'utf8')).split(';').map(s=>s.trim()).filter(s=>s&&!s.includes('activity_gomoku'));
  await dbs[0].batch(schema.map(sql=>dbs[0].prepare(sql)));
  let handlers=dbs.map(db=>createActivityHandler({db,env}));
  t.after(async()=>{clients.forEach(c=>c.close());await rm(dir,{recursive:true,force:true});});
  const request=(route,init={},i=0)=>handlers[i%2](new Request(origin+route,{...init,headers:{Origin:origin,'Content-Type':'application/json',...init.headers}}));
  const join=async i=>{const r=await request('/api/audience/join',{method:'POST',body:JSON.stringify({nickname:'棋友'+i,tabId:'gomoku-test-'+i})},i);assert.equal(r.status,200,await r.clone().text());return {cookie:r.headers.get('set-cookie').split(';')[0],...await r.json()};};
  const game=(p,input,i=0)=>request('/api/audience/gomoku',{headers:{Cookie:p.cookie,'X-CSRF-Token':p.csrfToken},...(input?{method:'POST',body:JSON.stringify(input)}:{})},i);
  return {dbs,request,join,game,restart(){handlers=dbs.map(db=>createActivityHandler({db,env}));}};
}
test('two independent API workers pair 20 people into ten games, persist moves and isolate all boards',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/audience/gomoku')).status,401);
  const people=await Promise.all(Array.from({length:20},(_,i)=>f.join(i)));
  const inputs={action:'join',position:GOMOKU_POINT};
  const results=await Promise.all(people.slice(0,19).map((p,i)=>f.game(p,inputs,i)));
  for(const r of results)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS n FROM activity_gomoku_games').first()).n,9);
  assert.equal((await f.dbs[0].prepare('SELECT COUNT(*) AS n FROM activity_gomoku_players WHERE game_id IS NULL').first()).n,1);
  assert.equal((await f.game(people[19],inputs,1)).status,200);
  await Promise.all(people.map((p,i)=>f.game(p,inputs,i)));
  const snapshots=await Promise.all(people.map((p,i)=>f.game(p,undefined,i).then(r=>r.json())));
  assert.equal(new Set(snapshots.map(s=>s.game.id)).size,10);
  for(const s of snapshots)assert.equal(snapshots.filter(v=>v.game.id===s.game.id).length,2);
  const b=snapshots.findIndex(s=>s.game.you===1),w=snapshots.findIndex(s=>s.game.id===snapshots[b].game.id&&s.game.you===2);
  const command={action:'move',gameId:snapshots[b].game.id,cell:112,expectedRevision:0,moveId:'concurrent-gomoku-move-1'};
  assert.equal((await f.game(people[w],command,1)).status,409);
  const race=await Promise.all([f.game(people[b],command),f.game(people[b],{...command,cell:113,moveId:'concurrent-gomoku-move-2'},1)]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const winningCommand=race[0].status===200?command:{...command,cell:113,moveId:'concurrent-gomoku-move-2'};
  assert.equal((await f.game(people[b],winningCommand,1)).status,200,'network retry is idempotent');
  f.restart();
  const after=await Promise.all(people.map((p,i)=>f.game(p,undefined,i).then(r=>r.json())));
  assert.equal(after.filter(s=>s.game.moves.length===1).length,2);
  assert.ok(after.filter(s=>s.game.id!==command.gameId).every(s=>s.game.moves.length===0));
  assert.equal((await f.game(people[w],{...command,cell:114,expectedRevision:1,moveId:'second-valid-gomoku-move'},1)).status,200);
  assert.equal((await f.game(people[b],{action:'leave',gameId:command.gameId})).status,200);
  const won=await (await f.game(people[w],undefined,1)).json();assert.equal(won.game.status,'won');assert.equal(won.game.winner,2);
});
test('serverless auth, CSRF, proximity and host pause protect joins and moves',async t=>{
  const f=await fixture(t),p=await f.join(1);
  assert.equal((await f.request('/api/audience/gomoku',{method:'POST',headers:{Cookie:p.cookie},body:JSON.stringify({action:'join',position:GOMOKU_POINT})})).status,403);
  assert.equal((await f.game(p,{action:'join',position:{x:0,y:0,z:0}})).status,403);
  assert.equal((await f.game(p,{action:'join',position:GOMOKU_POINT})).status,200);
  const login=await f.request('/api/admin/login',{method:'POST',body:JSON.stringify({password})}),cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrfToken;
  const state=(await (await f.request('/api/live/state')).json()).state;
  assert.equal((await f.request('/api/admin/state',{method:'PUT',headers:{Cookie:cookie,'X-CSRF-Token':csrf},body:JSON.stringify({state:{...state,paused:true},expectedRevision:state.revision})})).status,200);
  assert.equal((await f.game(p,{action:'join',position:GOMOKU_POINT})).status,409);
  assert.equal((await f.game(p,{action:'move'})).status,409);
  assert.equal((await f.game(p,{action:'heartbeat'})).status,200);
  assert.equal((await f.game(p,{action:'leave',gameId:null})).status,200);
});
}
