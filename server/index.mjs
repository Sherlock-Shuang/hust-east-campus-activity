import http from 'node:http';
import {readFile, writeFile, mkdir, rename, unlink, stat, realpath, chmod} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDefaultLiveState, validateLiveState} from '../src/live-state.js';
import {reconcileC118Flood} from '../src/c118-flood-state.js';
import {createAudienceStore,createAudienceData,validateAudienceData,summarizeAudience} from './audience-store.mjs';
import {createWorkRouter} from '../integration/work-router.mjs';
import {ACTIVITY_WORKS,activityPortals} from '../src/activity-catalog.js';

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon','.mp4':'video/mp4'};
const COOKIE='campus_admin';
const AUDIENCE_COOKIE='campus_audience';
const hash=value=>createHash('sha256').update(value).digest();
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&timingSafeEqual(hash(a),hash(b));
function cookieValue(req,name){return req.headers.cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith(`${name}=`))?.slice(name.length+1)||'';}
function httpError(status,message){return Object.assign(new Error(message),{status});}
async function readJson(req){
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw httpError(415,'请使用 JSON 请求');
  let size=0;const parts=[];
  for await(const chunk of req){size+=chunk.length;if(size>65536)throw httpError(413,'请求内容过大');parts.push(chunk);}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw httpError(400,'JSON 格式不正确');}
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}

export async function createLiveServer(options={}) {
  const rootDir=path.resolve(options.rootDir||projectRoot),dataDir=path.resolve(options.dataDir||path.join(rootDir,'server-data'));
  const distDir=path.resolve(options.distDir||path.join(rootDir,'dist'));
  const now=options.now||Date.now;
  await mkdir(dataDir,{recursive:true,mode:0o700});
  let password=options.password||process.env.ADMIN_PASSWORD;
  if(!password){
    const passwordFile=path.join(dataDir,'admin-password.txt');
    try{password=(await readFile(passwordFile,'utf8')).trim();}
    catch(error){if(error.code!=='ENOENT')throw error;password=randomBytes(18).toString('base64url');await writeFile(passwordFile,password+'\n',{mode:0o600,flag:'wx'});}
    await chmod(passwordFile,0o600);
  }
  if(typeof password!=='string'||password.length<12)throw new Error('ADMIN_PASSWORD 必须至少 12 个字符');
  const passwordHash=hash(password);password=undefined;
  const stateFile=path.join(dataDir,'live-state.json');
  let state=validateLiveState(options.initialState||createDefaultLiveState());
  try{state=validateLiveState(JSON.parse(await readFile(stateFile,'utf8')));}catch(error){if(error.code!=='ENOENT')throw new Error(`无法读取活动状态，请检查 ${stateFile}: ${error.message}`);}
  const audienceFile=path.join(dataDir,'audiences.json');
  let audienceData=createAudienceData();
  try{audienceData=validateAudienceData(JSON.parse(await readFile(audienceFile,'utf8')));}catch(error){if(error.code!=='ENOENT')throw new Error(`无法读取观众状态，请检查 ${audienceFile}: ${error.message}`);}
  const audiences=createAudienceStore({initial:audienceData,now,idFactory:()=>randomBytes(16).toString('hex'),persist:async next=>{
    const temp=`${audienceFile}.${randomBytes(8).toString('hex')}.tmp`;
    try{await writeFile(temp,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});await rename(temp,audienceFile);}
    catch{throw httpError(503,'观众记录保存失败，请稍后重试');}
    finally{await unlink(temp).catch(()=>{});}
  }});
  const sessions=new Map(),loginAttempts=new Map(),clients=new Set();
  let closed=false,queue=Promise.resolve(),vite;
  const sessionHours=8,configuredOrigin=options.publicOrigin||process.env.PUBLIC_ORIGIN||null;
  const workRouter=options.workRouter||await createWorkRouter({assetsRoot:options.assetsRoot||path.join(rootDir,'work-assets'),env:options.workEnv||process.env,publicOrigin:configuredOrigin});
  if(configuredOrigin&&new URL(configuredOrigin).origin!==configuredOrigin)throw new Error('PUBLIC_ORIGIN 必须是完整来源，例如 https://campus.example.com，不带路径或结尾斜杠');
  const snapshot=()=>({state,serverTime:now(),onlineCount:clients.size,onlineAudienceCount:audiences.statistics().summary.onlineParticipants});
  function sendEvent(res,event,payload){
    if(res.destroyed||res.writableEnded)return;
    if(res.writableLength>256*1024){res.destroy();return;}
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
  function broadcast(event,payload){for(const res of clients)sendEvent(res,event,payload);}
  const clock=()=>broadcast('clock',{serverTime:now(),onlineCount:clients.size});
  const heartbeat=setInterval(()=>{
    clock();const time=now();
    for(const [token,session] of sessions)if(session.expires<=time)sessions.delete(token);
    for(const [ip,attempt] of loginAttempts)if(attempt.until<=time)loginAttempts.delete(ip);
  },options.heartbeatMs||15000);heartbeat.unref();
  function requireSameOrigin(req){
    const expected=configuredOrigin||`${req.socket.encrypted?'https':'http'}://${req.headers.host}`;
    if(req.headers.origin!==expected)throw httpError(403,'请求来源不被允许');
    if(req.headers['sec-fetch-site']==='cross-site')throw httpError(403,'不允许跨站控制请求');
  }
  function sessionFor(req){
    const token=cookieValue(req,COOKIE),session=sessions.get(token);
    if(!session||session.expires<=now()){sessions.delete(token);return null;}
    return session;
  }
  function requireAdmin(req){
    const session=sessionFor(req);if(!session)throw httpError(401,'请先登录控制台');
    requireSameOrigin(req);
    if(!same(req.headers['x-csrf-token'],session.csrfToken))throw httpError(403,'控制令牌无效，请重新登录');
    return session;
  }
  const cookie=(token,maxAge,req)=>`${COOKIE}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${configuredOrigin?.startsWith('https:')||req.socket.encrypted?'; Secure':''}`;
  const audienceCookie=(token,req)=>`${AUDIENCE_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=31536000${configuredOrigin?.startsWith('https:')||req.socket.encrypted?'; Secure':''}`;
  function audienceFor(req){const token=cookieValue(req,AUDIENCE_COOKIE);return token?audiences.byIdentity(hash(token).toString('hex')):null;}
  const audienceCsrf=req=>hash(`campus-audience:${cookieValue(req,AUDIENCE_COOKIE)}`).toString('hex');
  function requireAudience(req){
    requireSameOrigin(req);const audience=audienceFor(req);
    if(!audience)throw httpError(401,'请先输入昵称加入活动');
    if(!same(req.headers['x-csrf-token'],audienceCsrf(req)))throw httpError(403,'观众令牌无效，请刷新页面');
    return audience;
  }
  async function persist(next){
    const temp=`${stateFile}.${randomBytes(8).toString('hex')}.tmp`;
    try{await writeFile(temp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temp,stateFile);}
    finally{await unlink(temp).catch(()=>{});}
  }
  async function handleApi(req,res,url){
    if(req.method==='GET'&&url.pathname==='/api/audience/me'){
      const record=audienceFor(req);json(res,200,record?{audience:summarizeAudience(record,{now:now()}),csrfToken:audienceCsrf(req)}:{audience:null});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/audience/join'){
      requireSameOrigin(req);const body=await readJson(req);
      const existing=audienceFor(req),token=existing?cookieValue(req,AUDIENCE_COOKIE):randomBytes(32).toString('base64url');
      const audience=await audiences.join({identityHash:hash(token).toString('hex'),nickname:body.nickname,tabId:body.tabId});
      res.setHeader('Set-Cookie',audienceCookie(token,req));json(res,200,{audience,csrfToken:hash(`campus-audience:${token}`).toString('hex')});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/audience/heartbeat'){
      const record=requireAudience(req),body=await readJson(req);
      json(res,200,{audience:await audiences.heartbeat(record.id,body.tabId)});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/audience/events'){
      const record=requireAudience(req),body=await readJson(req);
      json(res,200,await audiences.event(record.id,body,()=>({points:state.portals,paused:state.paused})));return;
    }
    if(req.method==='GET'&&(url.pathname==='/api/admin/audience'||url.pathname.startsWith('/api/admin/audience/'))){
      if(!sessionFor(req))throw httpError(401,'请先登录控制台');
      if(url.pathname==='/api/admin/audience'){json(res,200,audiences.statistics({points:state.portals,works:options.works||[],query:(url.searchParams.get('q')||'').slice(0,100)}));return;}
      const id=url.pathname.slice('/api/admin/audience/'.length);
      json(res,200,{audience:audiences.detail(id)});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/live/state'){json(res,200,snapshot());return;}
    if(req.method==='GET'&&url.pathname==='/api/live/events'){
      if(clients.size>=(options.maxClients||2500))throw httpError(503,'连接繁忙，请稍后重试');
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      res.flushHeaders();clients.add(res);sendEvent(res,'snapshot',snapshot());clock();
      res.on('close',()=>{if(clients.delete(res)&&!closed)clock();});return;
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/session'){
      const session=sessionFor(req);json(res,200,session?{authenticated:true,csrfToken:session.csrfToken}:{authenticated:false});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/login'){
      requireSameOrigin(req);
      const ip=req.socket.remoteAddress||'unknown',time=now();
      let attempt=loginAttempts.get(ip);
      if(attempt&&attempt.until<=time){loginAttempts.delete(ip);attempt=null;}
      if(attempt?.count>=8){res.setHeader('Retry-After',String(Math.ceil((attempt.until-time)/1000)));throw httpError(429,'尝试次数过多，请 10 分钟后重试');}
      // Reserve the attempt before reading the body so parallel requests cannot
      // race with one another and reset the counter to the same old value.
      if(loginAttempts.size>=2000&&!loginAttempts.has(ip))throw httpError(429,'登录暂时繁忙，请稍后重试');
      loginAttempts.set(ip,{count:(attempt?.count||0)+1,until:attempt?.until||time+600000});
      const body=await readJson(req);
      if(typeof body?.password!=='string'||body.password.length>1024||!timingSafeEqual(hash(body.password),passwordHash))throw httpError(401,'密码不正确');
      if(sessions.size>=100)throw httpError(429,'管理员会话过多，请稍后重试');
      loginAttempts.delete(ip);sessions.delete(cookieValue(req,COOKIE));
      const token=randomBytes(32).toString('base64url'),csrfToken=randomBytes(24).toString('base64url');
      sessions.set(token,{csrfToken,expires:time+sessionHours*3600000});res.setHeader('Set-Cookie',cookie(token,sessionHours*3600,req));json(res,200,{authenticated:true,csrfToken});return;
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/logout'){
      requireAdmin(req);sessions.delete(cookieValue(req,COOKIE));res.setHeader('Set-Cookie',cookie('',0,req));json(res,200,{authenticated:false});return;
    }
    if(req.method==='PUT'&&url.pathname==='/api/admin/state'){
      requireAdmin(req);const body=await readJson(req);
      let next;try{next=validateLiveState(body?.state);}catch(error){throw httpError(400,error.message);}
      if(!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)throw httpError(400,'请提供当前状态版本');
      // Serialize the revision check and durable write; concurrent edits never silently overwrite.
      const operation=queue.then(async()=>{
        if(body.expectedRevision!==state.revision){json(res,409,{error:'状态已被其他管理员修改，请载入最新状态',...snapshot()});return;}
        if(!Object.hasOwn(body.state,'c118Flood'))next.c118Flood=state.c118Flood;
        next.c118Flood=reconcileC118Flood(state,next,now());
        next.revision=state.revision+1;
        try{await persist(next);}catch{throw httpError(503,'活动状态保存失败，修改尚未生效');}
        state=next;const result=snapshot();broadcast('snapshot',result);json(res,200,result);
      });queue=operation.catch(()=>{});await operation;return;
    }
    throw httpError(404,'接口不存在');
  }
  async function serveStatic(req,res,url){
    if(!['GET','HEAD'].includes(req.method))throw httpError(405,'不支持此请求');
    let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw httpError(400,'路径无效');}
    if(pathname.includes('\0')||pathname.includes('\\')||pathname.split('/').some(part=>part.startsWith('.')))throw httpError(404,'文件不存在');
    if(pathname==='/'||pathname==='/index.html')pathname='/index.html';
    if(pathname==='/admin'||pathname==='/admin/')pathname='/admin.html';
    const filename=path.resolve(distDir,'.'+pathname);
    if(!filename.startsWith(distDir+path.sep))throw httpError(404,'文件不存在');
    let actual,info;
    try{actual=await realpath(filename);info=await stat(actual);}catch{throw httpError(404,'文件不存在');}
    const actualDist=await realpath(distDir);
    if(!actual.startsWith(actualDist+path.sep)||!info.isFile())throw httpError(404,'文件不存在');
    res.setHeader('Content-Type',MIME[path.extname(actual)]||'application/octet-stream');
    res.setHeader('Content-Length',info.size);
    res.setHeader('Cache-Control',pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache');
    res.setHeader('Accept-Ranges','bytes');
    // Range only applies to GET. Multiple/unknown range units fall back to the
    // full representation; this small static server does not emit multipart.
    if(req.method==='HEAD'){res.end();return;}
    let start=0,end=info.size-1;
    const range=req.headers.range;
    if(typeof range==='string'&&/^bytes=/i.test(range)&&!range.includes(',')&&!req.headers['if-range']){
      const match=/^bytes=(\d*)-(\d*)$/i.exec(range);
      let valid=!!match&&(match[1]!==''||match[2]!=='')&&info.size>0;
      if(valid){
        if(match[1]===''){
          const suffix=Number(match[2]);
          valid=Number.isSafeInteger(suffix)&&suffix>0;
          start=Math.max(0,info.size-suffix);
        }else{
          start=Number(match[1]);end=match[2]===''?end:Number(match[2]);
          valid=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<info.size&&end>=start;
          end=Math.min(end,info.size-1);
        }
      }
      if(!valid){res.writeHead(416,{'Content-Range':`bytes */${info.size}`,'Content-Length':'0'});res.end();return;}
      res.statusCode=206;
      res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);
      res.setHeader('Content-Length',end-start+1);
    }
    const stream=createReadStream(actual,info.size?{start,end}:undefined);
    res.once('close',()=>stream.destroy());
    stream.once('error',()=>res.destroy());stream.pipe(res);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    try{
      const url=new URL(req.url,'http://localhost');
      if(await workRouter(req,res,url,{audience:audienceFor(req)}))return;
      if(url.pathname.startsWith('/api/')){await handleApi(req,res,url);return;}
      if(vite){if(url.pathname==='/admin'||url.pathname==='/admin/')req.url='/admin.html';vite.middlewares(req,res,()=>{json(res,404,{error:'页面不存在'});});return;}
      await serveStatic(req,res,url);
    }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.status?error.message:'服务暂时不可用'});else res.destroy();}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  if(options.dev){const {createServer}=await import('vite');vite=await createServer({root:rootDir,server:{middlewareMode:true,hmr:{server},watch:{ignored:['**/deployment/**','**/work-assets/**','**/integration/**','**/output/**','**/server-data/**']},fs:{deny:['.env','.env.*','**/.dev.vars*','*.{crt,pem}','**/.git/**','**/server-data/**','**/deployment/**','**/integration/**','**/server/**','**/work-assets/**',`${dataDir}/**`]}},appType:'mpa'});}
  return {
    server,getState:()=>structuredClone(state),getAudienceData:()=>audiences.snapshot(),dataDir,
    async listen(port=5178,host='127.0.0.1'){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});return server.address();},
    async close(){closed=true;clearInterval(heartbeat);for(const client of clients)client.end();clients.clear();await queue;await audiences.flush();await vite?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));sessions.clear();},
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),portArg=args.indexOf('--port'),hostArg=args.indexOf('--host');
  const port=Number(portArg>=0?args[portArg+1]:process.env.PORT||5178),host=hostArg>=0?args[hostArg+1]:process.env.HOST||'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口无效');
  const app=await createLiveServer({dev:args.includes('--dev'),initialState:{...createDefaultLiveState(),portals:activityPortals()},works:ACTIVITY_WORKS});
  await app.listen(port,host);
  console.log(`\n校园活动服务：http://${host}:${port}/\n控制台：http://${host}:${port}/admin\n管理员密码：设置 ADMIN_PASSWORD，或查看本机 ${path.join(app.dataDir,'admin-password.txt')}\n`);
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
