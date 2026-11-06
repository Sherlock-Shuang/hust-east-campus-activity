import http from 'node:http';
import {createReadStream} from 'node:fs';
import {readFile,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createNodeActivityHandler} from '../serverless/node-handler.mjs';
import {createTursoDatabase} from '../serverless/database.mjs';
import {isVersionedWorkAsset} from '../integration/library/versioned-assets.mjs';

const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MIME={
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8',
  '.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon','.wasm':'application/wasm','.glb':'model/gltf-binary',
  '.gltf':'model/gltf+json','.woff':'font/woff','.woff2':'font/woff2','.otf':'font/otf','.ttf':'font/ttf',
  '.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg','.wav':'audio/wav',
  '.swf':'application/x-shockwave-flash','.data':'application/octet-stream','.bin':'application/octet-stream',
};
const workDirectories=new Set(['/works/library','/works/wanyan','/works/tasay','/works/she-love-me','/works/library/games/isaac']);
const tasayPage=/^\/works\/tasay\/(?!api(?:\/|$)|assets(?:\/|$))[^.]*$/;
const failure=(status,message)=>Object.assign(new Error(message),{status});
function sendJson(res,status,body){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
function configuredOrigin(value){
  try{
    const url=new URL(value);
    if(!['https:','http:'].includes(url.protocol)||url.origin!==value||url.username||url.password)throw new Error();
    return url;
  }catch{throw new Error('PUBLIC_ORIGIN must be an http(s) origin without a path or trailing slash');}
}
function requestUrl(target,origin){
  if(typeof target!=='string'||!target.startsWith('/')||target.startsWith('//'))throw failure(400,'路径无效');
  let decoded;
  try{decoded=decodeURIComponent(target.split('?')[0]);}catch{throw failure(400,'路径无效');}
  // Check before URL normalization, so encoded dot segments cannot bypass the
  // static-file boundary. No dotfiles or backslash paths are public assets.
  if(/[\\\x00-\x1f\x7f]/.test(decoded)||decoded.split('/').some(part=>part.startsWith('.')))throw failure(404,'文件不存在');
  return new URL(target,origin);
}
function cacheControl(url,mime,manifest){
  if(mime.startsWith('text/html')||mime.startsWith('application/json')||mime.startsWith('application/geo+json'))return 'no-cache';
  const hashed=/^\/(?:assets|works\/tasay\/assets)\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(url)
    ||isVersionedWorkAsset(url,manifest[url]?.sha256);
  if(hashed)return 'public, max-age=31536000, immutable';
  if(mime.startsWith('text/'))return 'no-cache';
  return 'public, max-age=3600';
}

/** Persistent Node hosting, with the same SQL-backed API used on Vercel.
 * `db` and `activity` are dependency-injection seams for isolated HTTP tests.
 * The local JSON backend in server/index.mjs is deliberately not imported.
 */
export async function createProductionServer(options={}){
  const env=options.env||process.env;
  const origin=configuredOrigin(options.publicOrigin||env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL);
  if(!options.activity&&(typeof env.ADMIN_PASSWORD!=='string'||env.ADMIN_PASSWORD.length<12))throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
  const distDir=await realpath(options.distDir||path.join(rootDir,'dist'));
  if(!(await stat(path.join(distDir,'index.html'))).isFile())throw new Error('Build dist before starting the production server');
  let manifest={};
  try{manifest=JSON.parse(await readFile(options.manifestFile||path.join(rootDir,'asset-source/manifest.json'),'utf8')).routes||{};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const ownedDb=!options.activity&&!options.db?createTursoDatabase(env):null;
  const api=createNodeActivityHandler({...options,env,...(ownedDb?{db:ownedDb}:{})});
  const active=new Set();

  async function staticFile(urlPath){
    const candidate=path.resolve(distDir,'.'+urlPath);
    if(!candidate.startsWith(distDir+path.sep))return null;
    try{
      let actual=await realpath(candidate);
      if(!actual.startsWith(distDir+path.sep))return null;
      let info=await stat(actual);
      if(info.isDirectory()){
        actual=await realpath(path.join(actual,'index.html'));
        if(!actual.startsWith(distDir+path.sep))return null;
        info=await stat(actual);
      }
      return info.isFile()?{actual,info}:null;
    }catch(error){if(['ENOENT','ENOTDIR','EACCES','ELOOP'].includes(error.code))return null;throw error;}
  }
  async function serveStatic(req,res,url){
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');throw failure(405,'不支持此请求');}
    let pathname=decodeURIComponent(url.pathname);
    if(workDirectories.has(pathname)){
      res.writeHead(308,{Location:pathname+'/'+url.search,'Cache-Control':'no-cache'});res.end();return;
    }
    if(pathname==='/')pathname='/index.html';
    if(pathname==='/admin'||pathname==='/admin/')pathname='/admin.html';
    if(/^\/(?:api\/games|works\/library\/api\/games)\/?$/.test(pathname))pathname='/works/library/api/games.json';
    let file=await staticFile(pathname);
    if(!file&&tasayPage.test(pathname)){pathname='/works/tasay/index.html';file=await staticFile(pathname);}
    if(!file)throw failure(404,'文件不存在');
    const {actual,info}=file,mime=MIME[path.extname(actual).toLowerCase()]||'application/octet-stream';
    res.setHeader('Content-Type',mime);res.setHeader('Content-Length',info.size);
    res.setHeader('Cache-Control',cacheControl(pathname,mime,manifest));
    res.setHeader('Accept-Ranges','bytes');
    // Range applies only to GET. If-Range has no validator on this host, so
    // return the full representation rather than an unsafe partial response.
    if(req.method==='HEAD'){res.end();return;}
    let start=0,end=info.size-1;
    const range=req.headers.range;
    if(typeof range==='string'&&/^bytes=/i.test(range)&&!range.includes(',')&&!req.headers['if-range']){
      const match=/^bytes=(\d*)-(\d*)$/i.exec(range);
      let valid=!!match&&(match[1]!==''||match[2]!=='')&&info.size>0;
      if(valid){
        if(match[1]===''){
          const suffix=Number(match[2]);valid=Number.isSafeInteger(suffix)&&suffix>0;start=Math.max(0,info.size-suffix);
        }else{
          start=Number(match[1]);end=match[2]===''?end:Number(match[2]);
          valid=Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<info.size&&end>=start;
          end=Math.min(end,info.size-1);
        }
      }
      if(!valid){res.writeHead(416,{'Content-Range':`bytes */${info.size}`,'Content-Length':'0'});res.end();return;}
      res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);res.setHeader('Content-Length',end-start+1);
    }
    const stream=createReadStream(actual,info.size?{start,end}:undefined);
    res.once('close',()=>stream.destroy());stream.once('error',()=>res.destroy());stream.pipe(res);
  }
  async function handle(req,res){
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    try{
      const url=requestUrl(req.url,origin.href),pathname=decodeURIComponent(url.pathname);
      if(pathname==='/healthz'&&['GET','HEAD'].includes(req.method)){sendJson(res,200,{ok:true});return;}
      if(pathname.startsWith('/api/')&&!(/^\/api\/games\/?$/.test(pathname)&&['GET','HEAD'].includes(req.method))){
        // This process is not a Vercel function: client-supplied edge headers
        // and rewrite parameters must never determine origin or login quotas.
        url.searchParams.delete('__activity_path');req.url=url.pathname+url.search;
        for(const name of ['forwarded','x-forwarded-host','x-forwarded-proto','x-forwarded-for','x-vercel-forwarded-for','x-real-ip'])delete req.headers[name];
        req.headers.host=origin.host;req.headers['x-forwarded-proto']=origin.protocol.slice(0,-1);
        req.headers['x-vercel-forwarded-for']=req.socket.remoteAddress||'unknown';
        await api(req,res);return;
      }
      await serveStatic(req,res,url);
    }catch(error){
      if(!res.headersSent)sendJson(res,error.status||500,{error:error.status?error.message:'服务暂时不可用'});
      else res.destroy();
    }
  }
  const server=http.createServer((req,res)=>{
    const pending=handle(req,res);active.add(pending);void pending.finally(()=>active.delete(pending));
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  return {
    server,publicOrigin:origin.origin,
    async listen(port=Number(env.PORT||10000),host=env.HOST||'0.0.0.0'){
      if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT must be a valid TCP port');
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
      return server.address();
    },
    async close(){
      server.closeAllConnections();
      await new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()));
      await Promise.allSettled([...active]);
      ownedDb?.close();
    },
  };
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    for(const name of ['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','ADMIN_PASSWORD'])if(!process.env[name])throw new Error(`${name} is required`);
    if(process.env.ADMIN_PASSWORD.length<12)throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
    const app=await createProductionServer(),address=await app.listen();
    console.log(`Campus production server listening on port ${address.port}`);
    let stopping=false;
    const stop=async()=>{
      if(stopping)return;stopping=true;
      const deadline=setTimeout(()=>process.exit(1),10000);deadline.unref();
      await app.close();clearTimeout(deadline);process.exit(0);
    };
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }catch{
    console.error('Production startup failed. Check the build, PUBLIC_ORIGIN, PORT, Turso credentials and ADMIN_PASSWORD.');
    process.exitCode=1;
  }
}
