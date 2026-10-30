// Standalone Vercel API; SQLite protocol matches the existing activity backend.
// Only persistence transport, trusted edge-IP header and bounded SSE lifecycle differ.
import {createDefaultLiveState,validateLiveState} from '../src/live-state.js';
import {reconcileC118Flood} from '../src/c118-flood-state.js';
import {reconcileC118Screen} from '../src/c118-screen-state.js';
import {ACTIVITY_WORKS,activityPortals} from '../src/activity-catalog.js';
import {createAudienceRecord,touchAudience,applyAudienceEvent,summarizeAudience,audienceDetail,aggregateAudiences,normalizeNickname,validId,PRESENCE_TTL} from '../server/audience-store.mjs';

const ADMIN_COOKIE='campus_admin',AUDIENCE_COOKIE='campus_audience';
const encoder=new TextEncoder();
const error=(status,message)=>Object.assign(new Error(message),{status});
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const cookie=(request,name)=>request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${name}=`))?.slice(name.length+1)||'';
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function same(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
function sameOrigin(request){
  if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')throw error(403,'请求来源不被允许');
}
async function body(request){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))throw error(415,'请使用 JSON 请求');
  if(Number(request.headers.get('Content-Length')||0)>65536)throw error(413,'请求内容过大');
  let length=0;const chunks=[],reader=request.body?.getReader();
  if(!reader)throw error(400,'JSON 格式不正确');
  while(true){const item=await reader.read();if(item.done)break;length+=item.value.length;if(length>65536){await reader.cancel();throw error(413,'请求内容过大');}chunks.push(item.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw error(400,'JSON 格式不正确');}
}
const setCookie=(name,token,path,maxAge,request)=>`${name}=${token}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
const adminCsrf=token=>digest(`campus-admin:${token}`);
const audienceCsrf=token=>digest(`campus-audience:${token}`);
const allRows=async statement=>(await statement.all()).results||[];
const changes=result=>Number(result?.meta?.changes||0);

async function stateRow(env){
  let row=await env.DB.prepare('SELECT revision,payload FROM activity_state WHERE key=?').bind('current').first();
  if(!row){
    const initial=validateLiveState({...createDefaultLiveState(),portals:activityPortals()});
    await env.DB.prepare('INSERT OR IGNORE INTO activity_state (key,revision,payload) VALUES (?,?,?)').bind('current',initial.revision,JSON.stringify(initial)).run();
    row=await env.DB.prepare('SELECT revision,payload FROM activity_state WHERE key=?').bind('current').first();
  }
  // Project legacy persisted points once for every consumer, including guarded
  // audience admission; keep the stored revision/payload unchanged until a save.
  return {...row,payload:JSON.stringify(validateLiveState(JSON.parse(row.payload)))};
}
async function counts(env,now=Date.now()){
  const [viewers,connections]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM activity_audiences WHERE online_until>=?').bind(now).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM activity_connections WHERE expires_at>?').bind(now).first(),
  ]);
  return {onlineAudienceCount:Number(viewers?.count||0),onlineCount:Number(connections?.count||0)};
}
async function snapshot(env,row){return {state:JSON.parse((row||await stateRow(env)).payload),serverTime:Date.now(),...await counts(env)};}
async function adminSession(request,env){
  const token=cookie(request,ADMIN_COOKIE);if(!token)return null;
  const session=await env.DB.prepare('SELECT expires_at FROM activity_admin_sessions WHERE token_hash=?').bind(await digest(token)).first();
  return session?.expires_at>Date.now()?{token}:null;
}
async function requireAdmin(request,env,mutation=false){
  const session=await adminSession(request,env);if(!session)throw error(401,'请先登录控制台');
  if(mutation){sameOrigin(request);if(!same(request.headers.get('X-CSRF-Token'),await adminCsrf(session.token)))throw error(403,'控制令牌无效，请重新登录');}
  return session;
}
export async function authenticatedAudience(request,env){
  if(!env.DB)return null;
  const token=cookie(request,AUDIENCE_COOKIE);if(!token)return null;
  const row=await env.DB.prepare('SELECT payload FROM activity_audiences WHERE identity_hash=?').bind(await digest(token)).first();
  return row?JSON.parse(row.payload):null;
}
// Reserve one model request atomically. A single conditional INSERT reads all
// three budgets and records consumption in the same SQLite statement, so two
// isolates cannot both take the final slot. Rejected requests consume nothing.
// The existing rate-limit table stores opaque audience-hashed reservation IDs;
// its `until` column is expiry time, never a prompt or credential.
export async function consumeModelQuota(audienceId,env,{now=Date.now()}={}){
  validId(audienceId,'观众标识');if(!env.DB)throw error(503,'活动数据库尚未配置');
  const day=86400000,dayStart=Math.floor(now/day)*day,prefix=`model:${await digest(audienceId)}:`;
  await env.DB.prepare("DELETE FROM activity_login_attempts WHERE ip_hash LIKE 'model:%' AND until<=?").bind(now).run();
  const saved=await env.DB.prepare("INSERT INTO activity_login_attempts (ip_hash,count,until) SELECT ?,1,? WHERE (SELECT COUNT(*) FROM activity_login_attempts WHERE ip_hash>=? AND ip_hash<? AND until>?)<6 AND (SELECT COUNT(*) FROM activity_login_attempts WHERE ip_hash>=? AND ip_hash<? AND until>=?)<40 AND (SELECT COUNT(*) FROM activity_login_attempts WHERE ip_hash LIKE 'model:%' AND until>=?)<500")
    .bind(prefix+crypto.randomUUID(),now+day,prefix,prefix+'~',now-60000+day,prefix,prefix+'~',dayStart+day,dayStart+day).run();
  return changes(saved)===1;
}
async function requireAudience(request,env){
  sameOrigin(request);const record=await authenticatedAudience(request,env);
  if(!record)throw error(401,'请先输入昵称加入活动');
  if(!same(request.headers.get('X-CSRF-Token'),await audienceCsrf(cookie(request,AUDIENCE_COOKIE))))throw error(403,'观众令牌无效，请刷新页面');
  return record;
}
async function mutateAudience(env,id,operation,{guardActivity=false}={}){
  validId(id,'观众标识');
  for(let tries=0;tries<12;tries++){
    const row=await env.DB.prepare('SELECT revision,payload FROM activity_audiences WHERE id=?').bind(id).first();
    if(!row)throw error(401,'观众身份已失效，请重新加入');
    const live=guardActivity?await stateRow(env):null;
    const previous=JSON.parse(row.payload),result=operation(previous,live?JSON.parse(live.payload):null),next=result.record;
    const onlineUntil=Math.max(0,...Object.values(next.tabs).map(tab=>tab.lastSeenAt+PRESENCE_TTL));
    // Point eligibility and the write share an optimistic activity revision
    // check, so a simultaneous pause/closure cannot admit an old opening.
    const saved=await env.DB.prepare('UPDATE activity_audiences SET revision=revision+1,nickname=?,last_seen_at=?,online_until=?,payload=? WHERE id=? AND revision=? AND (? IS NULL OR EXISTS (SELECT 1 FROM activity_state WHERE key=? AND revision=?))')
      .bind(next.nickname,next.lastSeenAt,onlineUntil,JSON.stringify(next),id,row.revision,live?.revision??null,'current',live?.revision??null).run();
    if(changes(saved))return {audience:summarizeAudience(next),...(result.duplicate===undefined?{}:{duplicate:result.duplicate})};
  }
  throw error(409,'同一观众的其他窗口正在更新，请重试');
}
async function joinAudience(request,env,input){
  const existing=await authenticatedAudience(request,env),token=existing?cookie(request,AUDIENCE_COOKIE):random();
  const nickname=normalizeNickname(input.nickname),tabId=validId(input.tabId,'窗口标识');
  let audience;
  if(existing){audience=(await mutateAudience(env,existing.id,record=>({record:touchAudience({...record,nickname},tabId,Date.now())}))).audience;}
  else{
    const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM activity_audiences').first();if(count.count>=5000)throw error(429,'本场参与人数已达上限');
    const now=Date.now(),record=touchAudience(createAudienceRecord({id:crypto.randomUUID(),identityHash:await digest(token),nickname},now),tabId,now);
    await env.DB.prepare('INSERT INTO activity_audiences (id,identity_hash,revision,nickname,last_seen_at,online_until,payload) VALUES (?,?,0,?,?,?,?)')
      .bind(record.id,record.identityHash,record.nickname,now,now+PRESENCE_TTL,JSON.stringify(record)).run();
    audience=summarizeAudience(record);
  }
  return json({audience,csrfToken:await audienceCsrf(token)},200,{'Set-Cookie':setCookie(AUDIENCE_COOKIE,token,'/api',31536000,request)});
}
async function login(request,env,input){
  if(typeof env.ADMIN_PASSWORD!=='string'||env.ADMIN_PASSWORD.length<12)throw error(503,'管理员密码尚未配置');
  const now=Date.now(),ip=await digest(request.headers.get('x-vercel-forwarded-for')||request.headers.get('x-forwarded-for')||'local-preview');
  // Reserving attempts in one SQL statement prevents parallel guesses bypassing limits.
  const attempt=await env.DB.prepare('INSERT INTO activity_login_attempts (ip_hash,count,until) VALUES (?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET count=CASE WHEN until<=? THEN 1 ELSE count+1 END,until=CASE WHEN until<=? THEN excluded.until ELSE until END RETURNING count,until')
    .bind(ip,now+600000,now,now).first();
  if(attempt.count>8)return json({error:'尝试次数过多，请 10 分钟后重试'},429,{'Retry-After':String(Math.ceil((attempt.until-now)/1000))});
  if(typeof input.password!=='string'||input.password.length>1024||!same(await digest(input.password),await digest(env.ADMIN_PASSWORD)))throw error(401,'密码不正确');
  await env.DB.prepare('DELETE FROM activity_admin_sessions WHERE expires_at<=?').bind(now).run();
  const sessions=await env.DB.prepare('SELECT COUNT(*) AS count FROM activity_admin_sessions').first();if(sessions.count>=100)throw error(429,'管理员会话过多，请稍后重试');
  const token=random(),old=cookie(request,ADMIN_COOKIE);
  const statements=[env.DB.prepare('DELETE FROM activity_login_attempts WHERE ip_hash=?').bind(ip),env.DB.prepare('INSERT INTO activity_admin_sessions (token_hash,expires_at) VALUES (?,?)').bind(await digest(token),now+8*3600000)];
  if(old)statements.push(env.DB.prepare('DELETE FROM activity_admin_sessions WHERE token_hash=?').bind(await digest(old)));
  await env.DB.batch(statements);
  return json({authenticated:true,csrfToken:await adminCsrf(token)},200,{'Set-Cookie':setCookie(ADMIN_COOKIE,token,'/api/admin',8*3600,request)});
}
export const STREAM_LIFETIME_MS=240000;
async function liveStream(request,env){
  const streamClock=env.STREAM_CLOCK||{now:Date.now,setTimeout,clearTimeout};
  const now=Date.now(),existing=await counts(env,now);if(existing.onlineCount>=2500)throw error(503,'连接繁忙，请稍后重试');
  const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO activity_connections (id,expires_at) VALUES (?,?)').bind(id,now+45000).run();
  let closed=false,timer,expiryTimer,controller,lastRevision=-1,lastHeartbeat=0;
  const cleanup=async()=>{if(closed)return;closed=true;streamClock.clearTimeout(timer);streamClock.clearTimeout(expiryTimer);request.signal.removeEventListener('abort',abort);await env.DB.prepare('DELETE FROM activity_connections WHERE id=?').bind(id).run().catch(()=>{});};
  const send=(name,payload)=>controller.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`));
  const abort=()=>{void cleanup();try{controller?.close();}catch{}};
  const pump=async()=>{
    if(closed)return;
    try{
      const row=await stateRow(env);if(closed)return;
      if(row.revision!==lastRevision){send('snapshot',await snapshot(env,row));lastRevision=row.revision;}
      const time=streamClock.now();
      if(time-lastHeartbeat>=15000){
        await env.DB.prepare('UPDATE activity_connections SET expires_at=? WHERE id=?').bind(time+45000,id).run();
        if(closed)return;send('clock',{serverTime:time,...await counts(env,time)});lastHeartbeat=time;
      }
    }catch{if(!closed){try{controller.error(new Error('活动连接暂时中断'));}catch{}await cleanup();}}
    if(!closed)timer=streamClock.setTimeout(pump,1500);
  };
  const stream=new ReadableStream({start(c){controller=c;request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();else{expiryTimer=streamClock.setTimeout(abort,STREAM_LIFETIME_MS);void pump();}},cancel:cleanup});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}

export async function handleActivityAPI(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/live/')&&!path.startsWith('/api/admin/')&&!path.startsWith('/api/audience/'))return null;
  try{
    if(!env.DB)throw error(503,'活动数据库尚未配置');
    if(request.method==='GET'&&path==='/api/live/state')return json(await snapshot(env));
    if(request.method==='GET'&&path==='/api/live/events')return await liveStream(request,env);
    if(request.method==='GET'&&path==='/api/admin/session'){
      const session=await adminSession(request,env);return json(session?{authenticated:true,csrfToken:await adminCsrf(session.token)}:{authenticated:false});
    }
    if(request.method==='POST'&&path==='/api/admin/login'){sameOrigin(request);return await login(request,env,await body(request));}
    if(request.method==='POST'&&path==='/api/admin/logout'){
      const session=await requireAdmin(request,env,true);await env.DB.prepare('DELETE FROM activity_admin_sessions WHERE token_hash=?').bind(await digest(session.token)).run();
      return json({authenticated:false},200,{'Set-Cookie':setCookie(ADMIN_COOKIE,'','/api/admin',0,request)});
    }
    if(request.method==='PUT'&&path==='/api/admin/state'){
      await requireAdmin(request,env,true);const input=await body(request);let next;
      try{next=validateLiveState(input.state);}catch(e){throw error(400,e.message);}
      if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)throw error(400,'请提供当前状态版本');
      const current=await stateRow(env);
      if(current.revision!==input.expectedRevision)return json({error:'状态已被其他管理员修改，请载入最新状态',...await snapshot(env)},409);
      const previous=JSON.parse(current.payload);
      // Preserve the current performance when an older console omits the field.
      // All timeline stamps originate here, and the SQL CAS below guards this read.
      if(!Object.hasOwn(input.state,'c118Flood'))next.c118Flood=previous.c118Flood;
      next.c118Flood=reconcileC118Flood(previous,next,Date.now());
      if(!Object.hasOwn(input.state,'c118Screen'))next.c118Screen=previous.c118Screen;
      try{next.c118Screen=reconcileC118Screen(previous,next);}catch(e){throw error(400,e.message);}
      next.revision=input.expectedRevision+1;
      const saved=await env.DB.prepare('UPDATE activity_state SET revision=?,payload=? WHERE key=? AND revision=?').bind(next.revision,JSON.stringify(next),'current',input.expectedRevision).run();
      if(!changes(saved))return json({error:'状态已被其他管理员修改，请载入最新状态',...await snapshot(env)},409);
      return json({state:next,serverTime:Date.now(),...await counts(env)});
    }
    if(request.method==='GET'&&path==='/api/audience/me'){
      const record=await authenticatedAudience(request,env);return json(record?{audience:summarizeAudience(record),csrfToken:await audienceCsrf(cookie(request,AUDIENCE_COOKIE))}:{audience:null});
    }
    if(request.method==='POST'&&path==='/api/audience/join'){sameOrigin(request);return await joinAudience(request,env,await body(request));}
    if(request.method==='POST'&&path==='/api/audience/heartbeat'){
      const record=await requireAudience(request,env),input=await body(request);
      return json(await mutateAudience(env,record.id,record=>({record:touchAudience(record,input.tabId,Date.now())})));
    }
    if(request.method==='POST'&&path==='/api/audience/events'){
      const record=await requireAudience(request,env),input=await body(request);
      return json(await mutateAudience(env,record.id,(record,live)=>applyAudienceEvent(record,input,{points:live?.portals||[],paused:live?.paused||false,now:Date.now()}),{guardActivity:['visit','opening'].includes(input.type)}));
    }
    if(request.method==='GET'&&path==='/api/admin/audience'){
      await requireAdmin(request,env);const records=await allRows(env.DB.prepare('SELECT payload FROM activity_audiences')),live=JSON.parse((await stateRow(env)).payload);
      return json(aggregateAudiences(records.map(r=>JSON.parse(r.payload)),{points:live.portals,works:ACTIVITY_WORKS,query:(url.searchParams.get('q')||'').slice(0,100)}));
    }
    if(request.method==='GET'&&path.startsWith('/api/admin/audience/')){
      await requireAdmin(request,env);const id=validId(path.slice('/api/admin/audience/'.length),'观众标识');
      const row=await env.DB.prepare('SELECT payload FROM activity_audiences WHERE id=?').bind(id).first();
      if(!row)throw error(401,'观众身份已失效，请重新加入');return json({audience:audienceDetail(JSON.parse(row.payload))});
    }
    throw error(404,'接口不存在');
  }catch(e){return json({error:e.status?e.message:'服务暂时不可用'},e.status||500);}
}
