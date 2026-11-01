import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {newGomoku,placeGomokuStone,GOMOKU_POINT,nearGomoku} from '../src/gomoku-rules.js';
import {createGomokuStore} from '../server/gomoku-store.mjs';
import {openGomokuDatabase} from '../server/gomoku-local.mjs';
import {createLiveServer} from '../server/index.mjs';
const position={...GOMOKU_POINT,y:.14};
const move=(g,cell,color=g.turn)=>placeGomokuStone(g,{cell,color,moveId:`move-test-${g.moves.length}-unique`,revision:g.moves.length,expectedRevision:g.moves.length});
test('all four directions detect five stones, without wrapping board edges',()=>{
  for(const cells of [[0,1,2,3,4],[2,17,32,47,62],[0,16,32,48,64],[14,28,42,56,70]]){
    let g=newGomoku();for(let i=0;i<cells.length;i++){g=move(g,cells[i]);if(i<4)g=move(g,200+i*2);}
    assert.equal(g.status,'won');assert.equal(g.winner,1);assert.equal(g.line.length,5);
  }
  let g=newGomoku();for(const [i,c] of [12,13,14,15,16].entries()){g=move(g,c);if(i<4)g=move(g,200+i*2);}
  assert.equal(g.status,'playing');
});
test('the server rejects wrong turns, occupied cells, invalid coordinates and old revisions; retries are idempotent',()=>{
  const g=move(newGomoku(),112),request={color:1,cell:112,moveId:'move-test-0-unique',revision:1,expectedRevision:0};
  assert.equal(placeGomokuStone(g,request),g);
  for(const change of [{cell:113,moveId:'new-move-unique-1'},{cell:112,color:2,moveId:'new-move-unique-1',expectedRevision:1},{cell:225,color:2,moveId:'new-move-unique-1',expectedRevision:1},{cell:113,color:2,moveId:'new-move-unique-1'},{color:3}])assert.throws(()=>placeGomokuStone(g,{...request,...change}));
  assert.equal(nearGomoku(position),true);assert.equal(nearGomoku({...position,y:30}),false);assert.equal(nearGomoku({...position,x:0}),false);
});
async function fixture(t){
  const dir=await mkdtemp(path.join(tmpdir(),'gomoku-'));let clock=100_000,id=0;
  const db=openGomokuDatabase(path.join(dir,'game.sqlite')),store=createGomokuStore({db,now:()=>clock,idFactory:()=>`game-${++id}`});
  t.after(async()=>{db.close();await rm(dir,{recursive:true,force:true});});
  const players=Array.from({length:8},(_,i)=>({id:`player-${i}`,nickname:`同学 ${i}`}));
  const join=p=>store.action(p,{action:'join',position});
  return {db,store,players,join,setTime:v=>clock=v,clock:()=>clock};
}
test('eight concurrent players create four isolated games; repeated joins never create extra seats',async t=>{
  const f=await fixture(t);await Promise.all(f.players.slice(0,7).map(f.join));
  const seven=await Promise.all(f.players.slice(0,7).map(f.store.snapshot));
  assert.equal(seven.filter(s=>s.waiting).length,1);assert.equal(new Set(seven.flatMap(s=>s.game?[s.game.id]:[])).size,3);
  await f.join(f.players[7]);const all=await Promise.all(f.players.map(f.store.snapshot));
  const counts=new Map();all.forEach(s=>counts.set(s.game.id,(counts.get(s.game.id)||0)+1));assert.equal(counts.size,4);assert.ok([...counts.values()].every(n=>n===2));
  await Promise.all(f.players.map(f.join));assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM activity_gomoku_games').first()).n,4);
  const black=f.players.find((p,i)=>all[i].game.you===1),g=(await f.store.snapshot(black)).game;
  const attempts=await Promise.allSettled([112,113].map(cell=>f.store.action(black,{action:'move',gameId:g.id,cell,moveId:`concurrent-move-${cell}`,expectedRevision:0})));
  assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
  const snapshots=await Promise.all(f.players.map(f.store.snapshot));assert.equal(snapshots.filter(s=>s.game.moves.length===1).length,2);
  const outsider=f.players.find((p,i)=>all[i].game.id!==g.id);
  await assert.rejects(()=>f.store.action(outsider,{action:'move',gameId:g.id,cell:4,moveId:'outsider-invalid-move',expectedRevision:0}),/改变/);
});
test('cancel, disconnect grace, return and resignation use persisted game state',async t=>{
  const f=await fixture(t),[a,b,c,d]=f.players;
  await f.join(a);await f.store.action(a,{action:'leave',gameId:null});assert.equal((await f.store.snapshot(a)).waiting,false);
  await f.join(a);f.setTime(f.clock()+91_000);await f.join(b);assert.equal((await f.store.snapshot(b)).waiting,true);
  await f.join(a);let g=(await f.store.snapshot(a)).game;assert.ok(g);
  f.setTime(f.clock()+50_000);await f.store.action(a,{action:'heartbeat'});assert.equal((await f.store.snapshot(a)).game.status,'playing');
  f.setTime(f.clock()+41_000);await f.store.action(a,{action:'heartbeat'});assert.equal((await f.store.snapshot(a)).game.winner,g.you);
  assert.equal((await createGomokuStore({db:f.db,now:f.clock}).snapshot(b)).game.id,g.id);
  await f.join(c);await f.join(d);g=(await f.store.snapshot(c)).game;
  await f.store.action(c,{action:'leave',gameId:g.id});assert.equal((await f.store.snapshot(d)).game.winner,3-g.you);
  await f.store.action(c,{action:'leave',gameId:g.id});assert.equal((await f.store.snapshot(c)).game,null);
});
test('both disconnected players draw; a fresh match cannot be cancelled by an old leave',async t=>{
  const f=await fixture(t),[a,b]=f.players;await f.join(a);await f.join(b);const old=(await f.store.snapshot(a)).game;
  f.setTime(f.clock()+91_000);await f.store.action(a,{action:'heartbeat'});assert.equal((await f.store.snapshot(a)).game.status,'draw');
  await f.join(a);await f.join(b);await assert.rejects(()=>f.store.action(a,{action:'leave',gameId:old.id}),/确认/);
  assert.equal((await f.store.snapshot(a)).game.status,'playing');
});
test('local HTTP API enforces audience cookies, CSRF, field proximity and host pause',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'gomoku-http-')),password='local-gomoku-testing-password';
  const server=await createLiveServer({dataDir:dir,password});const {port}=await server.listen(0),origin=`http://127.0.0.1:${port}`;
  t.after(async()=>{await server.close();await rm(dir,{recursive:true,force:true});});
  const request=(url,body,headers={})=>fetch(origin+url,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/audience/gomoku')).status,401);
  const response=await request('/api/audience/join',{nickname:'棋手',tabId:'gomoku-local-browser'}),cookie=response.headers.get('set-cookie').split(';')[0],identity=await response.json(),auth={Cookie:cookie,'X-CSRF-Token':identity.csrfToken};
  assert.equal((await request('/api/audience/gomoku',{action:'join',position},{Cookie:cookie})).status,403);
  assert.equal((await request('/api/audience/gomoku',{action:'join',position:{x:0,y:0,z:0}},auth)).status,403);
  assert.equal((await request('/api/audience/gomoku',{action:'join',position},auth)).status,200);
  const login=await request('/api/admin/login',{password}),adminCookie=login.headers.get('set-cookie').split(';')[0],admin=await login.json();
  const live=(await (await request('/api/live/state')).json()).state;
  assert.equal((await fetch(origin+'/api/admin/state',{method:'PUT',headers:{Origin:origin,'Content-Type':'application/json',Cookie:adminCookie,'X-CSRF-Token':admin.csrfToken},body:JSON.stringify({expectedRevision:live.revision,state:{...live,paused:true}})})).status,200);
  assert.equal((await request('/api/audience/gomoku',{action:'join',position},auth)).status,409);
  assert.equal((await request('/api/audience/gomoku',{action:'heartbeat'},auth)).status,200);
});
