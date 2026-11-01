import {newGomoku,placeGomokuStone,nearGomoku,GOMOKU_GRACE_MS} from '../src/gomoku-rules.js';
export const GOMOKU_SCHEMA=[
  'CREATE TABLE IF NOT EXISTS activity_gomoku_players (audience_id TEXT PRIMARY KEY, nickname TEXT NOT NULL, joined_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, game_id TEXT)',
  'CREATE INDEX IF NOT EXISTS activity_gomoku_waiting ON activity_gomoku_players(game_id, joined_at)',
  'CREATE TABLE IF NOT EXISTS activity_gomoku_games (id TEXT PRIMARY KEY, black_id TEXT NOT NULL, white_id TEXT NOT NULL, black_name TEXT NOT NULL, white_name TEXT NOT NULL, status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)',
];
const ready=new WeakMap(),fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
async function ensure(db){
  if(!ready.has(db))ready.set(db,db.batch(GOMOKU_SCHEMA.map(sql=>db.prepare(sql))).catch(e=>{ready.delete(db);throw e;}));
  await ready.get(db);
}
export function createGomokuStore({db,now=Date.now,idFactory=()=>crypto.randomUUID()}){
  const run=(sql,...args)=>db.prepare(sql).bind(...args);
  async function own(id){return run('SELECT g.* FROM activity_gomoku_players p JOIN activity_gomoku_games g ON g.id=p.game_id WHERE p.audience_id=?',id).first();}
  async function expire(record){
    const game=await own(record.id);if(!game||game.status!=='playing')return;
    const opponent=game.black_id===record.id?game.white_id:game.black_id;
    const person=await run('SELECT last_seen FROM activity_gomoku_players WHERE audience_id=? AND game_id=?',opponent,game.id).first();
    if(person&&person.last_seen>=now()-GOMOKU_GRACE_MS)return;
    const self=await run('SELECT last_seen FROM activity_gomoku_players WHERE audience_id=? AND game_id=?',record.id,game.id).first();
    const abandoned=!self||self.last_seen<now()-GOMOKU_GRACE_MS;
    const state={...JSON.parse(game.payload),status:abandoned?'draw':'won',winner:abandoned?null:game.black_id===record.id?1:2,reason:abandoned?'abandoned':'disconnect'};
    await run('UPDATE activity_gomoku_games SET payload=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status=?',JSON.stringify(state),state.status,now(),game.id,game.revision,'playing').run();
  }
  async function snapshot(record){
    await ensure(db);
    const player=await run('SELECT game_id,last_seen FROM activity_gomoku_players WHERE audience_id=?',record.id).first();
    const row=player?.game_id?await own(record.id):null;
    const waiting=await run('SELECT COUNT(*) AS count FROM activity_gomoku_players WHERE game_id IS NULL AND last_seen>=?',now()-GOMOKU_GRACE_MS).first();
    let game=null;
    if(row){
      const color=row.black_id===record.id?1:2,state=JSON.parse(row.payload);
      const rival=await run('SELECT last_seen FROM activity_gomoku_players WHERE audience_id=? AND game_id=?',color===1?row.white_id:row.black_id,row.id).first();
      game={...state,id:row.id,revision:row.revision,status:row.status,you:color,blackName:row.black_name,whiteName:row.white_name,opponentLastSeen:rival?.last_seen??0};
    }
    return {game,waiting:!!player&&!row&&player.last_seen>=now()-GOMOKU_GRACE_MS,waitingCount:waiting.count,serverTime:now()};
  }
  async function action(record,input,{paused=false}={}){
    await ensure(db);
    if(!input||!['join','heartbeat','move','leave'].includes(input.action))fail(400,'未知的对局操作');
    if(paused&&['join','move'].includes(input.action))fail(409,'活动暂停中，恢复后可以继续下棋');
    const stamp=now();
    if(input.action==='join'){
      const current=await own(record.id);
      if(current?.status==='playing'){await expire(record);await run('UPDATE activity_gomoku_players SET last_seen=? WHERE audience_id=?',stamp,record.id).run();return snapshot(record);}
      if(!nearGomoku(input.position))fail(403,'请走到操场五子棋桌旁加入');
      const id=idFactory();
      // Pair selection, game insertion and assigning BOTH seats are one write
      // transaction. Concurrent serverless workers cannot claim the same person.
      await db.batch([
        run('DELETE FROM activity_gomoku_players WHERE game_id IS NULL AND last_seen<?',stamp-GOMOKU_GRACE_MS),
        run("INSERT INTO activity_gomoku_players(audience_id,nickname,joined_at,last_seen,game_id) VALUES(?,?,?,?,NULL) ON CONFLICT(audience_id) DO UPDATE SET nickname=excluded.nickname,last_seen=excluded.last_seen,joined_at=CASE WHEN game_id IS NULL THEN joined_at ELSE excluded.joined_at END,game_id=CASE WHEN game_id IN (SELECT id FROM activity_gomoku_games WHERE status='playing') THEN game_id ELSE NULL END",record.id,record.nickname,stamp,stamp),
        run(`INSERT INTO activity_gomoku_games(id,black_id,white_id,black_name,white_name,status,revision,payload,updated_at)
          SELECT ?,a.audience_id,b.audience_id,a.nickname,b.nickname,'playing',0,?,?
          FROM activity_gomoku_players a JOIN activity_gomoku_players b ON a.audience_id<>b.audience_id
          WHERE a.game_id IS NULL AND b.game_id IS NULL AND a.last_seen>=? AND b.last_seen>=?
          AND (a.joined_at<b.joined_at OR (a.joined_at=b.joined_at AND a.audience_id<b.audience_id))
          ORDER BY a.joined_at,a.audience_id,b.joined_at,b.audience_id LIMIT 1`,id,JSON.stringify(newGomoku()),stamp,stamp-GOMOKU_GRACE_MS,stamp-GOMOKU_GRACE_MS),
        run('UPDATE activity_gomoku_players SET game_id=? WHERE audience_id IN (SELECT black_id FROM activity_gomoku_games WHERE id=? UNION SELECT white_id FROM activity_gomoku_games WHERE id=?) AND game_id IS NULL',id,id,id),
        run("DELETE FROM activity_gomoku_players WHERE last_seen<? AND game_id NOT IN (SELECT id FROM activity_gomoku_games WHERE updated_at>=?)",stamp-86400000,stamp-86400000),
        run('DELETE FROM activity_gomoku_games WHERE updated_at<? AND id NOT IN (SELECT game_id FROM activity_gomoku_players WHERE game_id IS NOT NULL)',stamp-86400000),
      ]);
    }else if(input.action==='heartbeat'){
      await expire(record);await run('UPDATE activity_gomoku_players SET last_seen=? WHERE audience_id=?',stamp,record.id).run();
    }else{
      await expire(record);
      const row=await own(record.id);
      if(input.action==='move'){
        if(!row||row.id!==input.gameId)fail(409,'这局已改变，请刷新棋盘');
        const before={...JSON.parse(row.payload),status:row.status},color=row.black_id===record.id?1:2;
        const next=placeGomokuStone(before,{...input,color,revision:row.revision});
        if(next!==before){
          const saved=await run('UPDATE activity_gomoku_games SET payload=?,status=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',JSON.stringify(next),next.status,stamp,row.id,row.revision).run();
          if(!saved.meta.changes)fail(409,'棋局已更新，请在最新棋盘上落子');
        }
        await run('UPDATE activity_gomoku_players SET last_seen=? WHERE audience_id=?',stamp,record.id).run();
      }else{
        if(!row&&input.gameId)return snapshot(record);
        if(row?.id!==(input.gameId??undefined))fail(409,'已匹配到对手，请确认当前对局后再离开');
        if(row?.status==='playing'){
          const next={...JSON.parse(row.payload),status:'won',winner:row.black_id===record.id?2:1,reason:'resign'};
          const saved=await run("UPDATE activity_gomoku_games SET payload=?,status='won',revision=revision+1,updated_at=? WHERE id=? AND revision=?",JSON.stringify(next),stamp,row.id,row.revision).run();
          if(!saved.meta.changes)fail(409,'棋局已更新，请重试离开');
        }
        await run('DELETE FROM activity_gomoku_players WHERE audience_id=? AND (game_id=? OR (game_id IS NULL AND ? IS NULL))',record.id,input.gameId??null,input.gameId??null).run();
      }
    }
    return snapshot(record);
  }
  return {snapshot,action};
}
